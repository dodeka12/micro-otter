# Copyright (c) 2026 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

[CmdletBinding()]
param(
    [string]$DeviceNamePattern = "cp210x",
    [switch]$ListOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)

    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-UsbipdPath {
    $command = Get-Command usbipd -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        throw "usbipd was not found on PATH. Install usbipd-win first."
    }

    return $command.Source
}

function Get-UsbipdDevices {
    $usbipdPath = Get-UsbipdPath
    $output = & $usbipdPath list 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "usbipd list failed:`n$output"
    }

    $devices = @()
    foreach ($line in $output) {
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }

        if ($line -match '^(Connected|Persisted):\s*$') {
            continue
        }

        if ($line -match '^BUSID\s{2,}') {
            continue
        }

        $parts = $line -split '\s{2,}'
        if ($parts.Length -lt 3) {
            continue
        }

        $busId = $parts[0].Trim()
        if ($busId -notmatch '^\d+-\d+(?:-\d+)?$') {
            continue
        }

        $vidPid = $parts[1].Trim()
        $state = "Unknown"
        $device = ""

        if ($parts.Length -ge 4) {
            $device = (($parts | Select-Object -Skip 2 | Select-Object -SkipLast 1) -join '  ').Trim()
            $state = $parts[-1].Trim()
        }
        else {
            $device = $parts[2].Trim()
        }

        $normalizedState = $state.Trim().ToLowerInvariant()
        $isAttached = $normalizedState -eq 'attached'
        $isShared = $isAttached -or ($normalizedState -eq 'shared')

        $devices += [pscustomobject]@{
            BusId = $busId
            VidPid = $vidPid
            Device = $device
            State = $state
            IsShared = $isShared
            IsAttached = $isAttached
        }
    }

    return $devices
}

function Get-MatchingDevices {
    param(
        [string]$Pattern
    )

    return @(Get-UsbipdDevices | Where-Object { $_.Device -match [regex]::Escape($Pattern) })
}

function Show-DeviceTable {
    param(
        [object[]]$Devices,
        [string]$Title
    )

    Write-Host ""
    Write-Host $Title
    $Devices |
        Select-Object BusId, Device, State, IsShared, IsAttached |
        Format-Table -AutoSize
}

function Invoke-Usbipd {
    param(
        [string[]]$Arguments
    )

    $usbipdPath = Get-UsbipdPath
    & $usbipdPath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "usbipd $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
    }
}

$matchingDevices = @(Get-MatchingDevices -Pattern $DeviceNamePattern)

if ($matchingDevices.Count -eq 0) {
    Write-Warning "No USB devices matched '$DeviceNamePattern'."
    exit 1
}

Show-DeviceTable -Devices $matchingDevices -Title "Matching USB devices"

if ($ListOnly) {
    Write-Host ""
    Write-Host "List-only mode: no bind or attach operations were performed."
    exit 0
}

$devicesNeedingBind = @($matchingDevices | Where-Object { -not $_.IsShared })
if ($devicesNeedingBind.Count -gt 0) {
    if (-not (Test-IsAdministrator)) {
        $busIds = ($devicesNeedingBind | ForEach-Object { $_.BusId }) -join ", "
        throw "The following devices must be shared first, which requires an elevated PowerShell window: $busIds"
    }

    foreach ($device in $devicesNeedingBind) {
        Write-Host "Sharing $($device.BusId) - $($device.Device)"
        Invoke-Usbipd -Arguments @("bind", "--busid", $device.BusId)
    }

    $matchingDevices = @(Get-MatchingDevices -Pattern $DeviceNamePattern)
    Show-DeviceTable -Devices $matchingDevices -Title "State after bind"
}

$devicesNeedingAttach = @($matchingDevices | Where-Object { -not $_.IsAttached })
if ($devicesNeedingAttach.Count -eq 0) {
    Write-Host ""
    Write-Host "All matching devices are already attached to WSL."
    exit 0
}

foreach ($device in $devicesNeedingAttach) {
    Write-Host "Attaching $($device.BusId) - $($device.Device) to WSL"
    Invoke-Usbipd -Arguments @("attach", "--wsl", "--busid", $device.BusId)
}

$matchingDevices = @(Get-MatchingDevices -Pattern $DeviceNamePattern)
Show-DeviceTable -Devices $matchingDevices -Title "Final state"

$remainingDetached = @($matchingDevices | Where-Object { -not $_.IsAttached })
if ($remainingDetached.Count -gt 0) {
    $busIds = ($remainingDetached | ForEach-Object { $_.BusId }) -join ", "
    throw "Some matching devices are still not attached to WSL: $busIds"
}

Write-Host ""
Write-Host "All matching CP210x devices are attached to WSL."
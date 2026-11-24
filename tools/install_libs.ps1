# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

param(
    [string]$Port,
    [string]$ModuleName,
    [string[]]$Libs
)

Write-Host "Installing libraries for module: $ModuleName"
Write-Host $Libs

if ($Libs.Count -eq 0) {
    $libs = Get-ChildItem -Path "src/$ModuleName" -Directory | Where-Object { $_.Name -ne "app" }
}
else {
    $libs = Get-ChildItem -Path "src/$ModuleName" -Directory | Where-Object { $_.Name -in $Libs }
}
# $libs = $libs | ForEach-Object { $_.Name }
if ($libs.Count -eq 0) {
    Write-Host "No libraries found to install. Exiting script."
    exit
}

foreach ($lib in $libs) {
    $libObj = Get-Item $lib
    $libName = $libObj.Name.Trim()
    Write-Host "Installing library: $libName"
    if ($libName) {
        uv run mpremote connect $Port fs rm -r $libName 2>$null
        uv run mpremote connect $Port fs mkdir $libName 2>$null
        uv run mpremote connect $Port fs cp -r "src/$ModuleName/$libName/" ":"
    }
}

# uv run mpremote connect $Port fs tree
uv run mpremote connect $Port df
uv run mpremote connect $Port reset
# uv run mpremote connect $Port repl

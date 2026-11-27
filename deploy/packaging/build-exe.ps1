# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# Build the Windows `micro-otter.exe` with PyInstaller.
#
# PyInstaller does not cross-compile, so this runs on a Windows host (or the CI
# `windows` job), not in the Linux devcontainer. It installs the wheel built by
# `deploy/packaging/build-wheel.sh` into the project environment first, so the
# PyInstaller spec's `collect_data_files("micro_otter")` embeds the same webapp,
# toolchain assets, and node-package sources the wheel ships.
$ErrorActionPreference = "Stop"

# 1. Resolve the repository root from this script's own location.
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path

# 2. Every required tool must exist; the failure names the missing one.
foreach ($tool in @("python", "uv", "node")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "$tool is required but not on PATH"
    }
}

Push-Location $RepoRoot
try {
    # 3. Install the build dependencies (PyInstaller), then build the wheel and
    #    install it so the exe embeds the same wheel the Docker images use.
    uv sync --group dev
    $Temp = Join-Path $RepoRoot "_tmp"
    New-Item -ItemType Directory -Force -Path $Temp | Out-Null
    bash deploy/packaging/build-wheel.sh --out-dir $Temp
    $Wheel = Get-ChildItem -Path $Temp -Filter "micro_otter-*.whl" | Select-Object -First 1
    if (-not $Wheel) {
        throw "build-wheel.sh produced no micro_otter-*.whl in $Temp"
    }
    uv pip install --reinstall $Wheel.FullName

    # 4. Build the onefile executable.
    uv run pyinstaller --clean --noconfirm deploy/packaging/pyinstaller/micro-otter.spec
}
finally {
    Pop-Location
}

# 5. Assert the exe exists and report it.
$Exe = Join-Path $RepoRoot "dist\micro-otter.exe"
if (-not (Test-Path $Exe)) {
    throw "pyinstaller produced no dist\micro-otter.exe"
}
Write-Host ("exe: {0} ({1} bytes)" -f $Exe, (Get-Item $Exe).Length)

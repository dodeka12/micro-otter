# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

param(
    [string]$Port,
    [string]$ModuleName
)

if (-not (Test-Path "src/$ModuleName")) {
    Write-Error "Path 'src/$ModuleName' does not exist"
    exit 1
}

Write-Host "Running Module '$ModuleName' on Port '$Port'"

uv run mpremote connect $Port fs rm -r app 2>$null
uv run mpremote connect $Port fs mkdir app 2>$null
uv run mpremote connect $Port fs cp "src/$ModuleName/main.py" ":main.py" + fs cp -r "src/$ModuleName/app/" ":" + reset + repl

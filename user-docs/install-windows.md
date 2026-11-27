# Install on Windows

The Windows distribution is a single `micro-otter.exe` — no Python or `uv` needed to run the server.
Firmware building stays on Docker/WSL, because the Windows exe does not bundle the ESP-IDF toolchain.

## Install and run the exe

1. Download `micro-otter.exe` from a release.
2. Put it on your `PATH` (or run it by full path):

```powershell
micro-otter.exe serve       # http://127.0.0.1:8000
micro-otter.exe doctor
```

The exe bundles the server, the web app, and the toolchain assets. The maintainer builds it with
`deploy/packaging/build-exe.ps1`; the CI `windows` job builds and smokes it on every pull request in
the published repository.

> The live Windows host smoke is **deferred** (the packaging milestone recorded it as a follow-up), so
> treat the exe as not yet host-verified until a release carries it.

## Build firmware (Docker/WSL)

Firmware compile runs in Docker/WSL, not in the exe:

1. Install WSL and Docker Desktop (or Docker Engine inside WSL).
2. Follow the [Linux instructions](install-linux.md) inside WSL, using the compile profile.

No installer artifact contains a firmware image: install one from the project's release page as
described in [Firmware view → Get an official image](app/firmware-view.md#get-an-official-image).

## USB serial

- Native: install the Silicon Labs CP210x driver (or the driver for your board's chip).
- In WSL: attach the COM port with `usbipd` and the repository's `tools/attach-cp210x-to-wsl.ps1`
  helper.

## Notes

- State lives under `%LOCALAPPDATA%\micro-otter` (override with `MICRO_OTTER_STATE_DIR` /
  `MICRO_OTTER_HOME`).

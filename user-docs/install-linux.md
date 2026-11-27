# Install on Linux

Run Micro-Otter as a local server from a wheel, or run it in Docker. Both are described here; the
wheel is the simplest start.

## Prerequisites

- Python 3.12 and [uv](https://docs.astral.sh/uv/) (or `pipx`).
- For USB serial access: membership in the `dialout` group.
- Docker + the Compose plugin, only for the container path.

## Install and run the wheel

```bash
uv tool install micro-otter
# or: pipx install micro-otter

micro-otter serve          # http://127.0.0.1:8000
micro-otter doctor         # reports what is missing, with hints
```

State lives under `~/.micro-otter` (override with `MICRO_OTTER_HOME`).

## Build firmware (native toolchain)

To build and flash firmware images from the Firmware tab, install the pinned ESP-IDF/MicroPython
toolchain:

```bash
micro-otter toolchain install
micro-otter toolchain status
```

This is the macOS/Linux path for firmware building; it installs into your toolchain directory and is
safe to re-run.

No installer artifact contains a firmware image: install one from the project's release page as
described in [Firmware view → Get an official image](app/firmware-view.md#get-an-official-image).

## Run in Docker

```bash
cd deploy/docker
cp .env.example .env
docker compose --profile runtime up -d     # server only (no toolchain)
docker compose --profile compile up -d     # server + pinned toolchain
```

Pass USB serial through on a Linux host:

```bash
docker compose -f compose.yaml -f compose.usb.yaml up
```

The image details (stages, `/data` volume, environment) are in the developer documentation — see
[developer-docs.md](developer-docs.md).

## Troubleshooting

- USB device not visible: `sudo usermod -aG dialout $USER`, then log out and back in.
- Missing prerequisites: run `micro-otter doctor`; each failed check carries an actionable hint.

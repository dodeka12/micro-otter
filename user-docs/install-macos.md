# Install on macOS

Install the wheel and, if you build firmware, the native toolchain. macOS needs no Docker compile
image.

## Prerequisites

- Python 3.12 and [uv](https://docs.astral.sh/uv/) (or `pipx`).
- For USB serial: the Silicon Labs CP210x driver if your board uses that chip.

## Install and run

```bash
uv tool install micro-otter
# or: pipx install micro-otter

micro-otter serve          # http://127.0.0.1:8000
micro-otter doctor         # reports what is missing, with hints
```

## Build firmware (native toolchain)

```bash
micro-otter toolchain install
micro-otter toolchain status
```

No installer artifact contains a firmware image: install one from the project's release page as
described in [Firmware view → Get an official image](app/firmware-view.md#get-an-official-image).

## Notes

- Docker Desktop on macOS **cannot pass USB serial through** to a container; use the native wheel for
  device work.
- State lives under `~/Library/Application Support/micro-otter` (override with
  `MICRO_OTTER_STATE_DIR` / `MICRO_OTTER_HOME`).

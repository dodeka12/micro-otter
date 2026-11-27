# Docker images

The runtime and compile images turn the local server into a runnable container. They live under
`deploy/docker/` and are built from the same wheel `deploy/packaging/build-wheel.sh` produces.

## The two images

| Image | Dockerfile | What it adds | Runs as |
|---|---|---|---|
| Runtime | `Dockerfile.runtime` | the installed wheel + the web app it carries, **no toolchain** | non-root `microotter` (uid `10001`) |
| Compile | `Dockerfile.compile` | the runtime image **plus** the pinned ESP-IDF/MicroPython toolchain via `deploy/toolchain/bootstrap.sh` | non-root `microotter` |

The compile image is defined as `FROM` the runtime image, so it is never a parallel build from a bare
`python:3.12-slim`.

## Runtime image

Multi-stage: a `node:22-slim` builder runs `deploy/packaging/build-wheel.sh --out-dir /dist`, then a
`python:3.12-slim` runtime stage installs that wheel and drops everything else. The final stage has
**no ESP-IDF, no `git`, no `gh`, and no gpg**, and no `build-essential`.

- **Version**: the build context excludes `.git/`, so the version comes from
  `--build-arg MICRO_OTTER_VERSION`, exposed as
  `SETUPTOOLS_SCM_PRETEND_VERSION_FOR_MICRO_OTTER` in the builder. A bare `docker build` yields
  `0.0.0` — a development image only.
- **Environment**: `MICRO_OTTER_HOME=/data`, `MICRO_OTTER_WORKSPACE=/data/workspace`,
  `MICRO_OTTER_FIRMWARE_DIR=/data/firmware`, `MICRO_OTTER_BUILD_DIR=/data/build`,
  `MICRO_OTTER_STATE_DIR=/data/state`, `MICRO_OTTER_HOST=0.0.0.0`, `MICRO_OTTER_PORT=8000`,
  `MICRO_OTTER_OPEN_BROWSER=false`.
- **Volume**: `/data` is the only writable volume.
- **Healthcheck**: `HEALTHCHECK` polls `/api/server-capabilities` with stdlib `urllib` (no `curl` in
  the image).
- **Entrypoint**: `micro-otter serve --host 0.0.0.0 --port 8000`.

## Compile image

`Dockerfile.compile` layers the toolchain on the runtime image:

- `USER root` only to install `build-essential`, `ccache`, `git`, `ca-certificates`, `libffi-dev`,
  `libssl-dev`, then runs `micro-otter toolchain install --backend esp-idf`.
- Toolchain paths are baked under `/opt` (read-only-mountable):
  `MICRO_OTTER_TOOLCHAIN_DIR=/opt/micro-otter/toolchain`,
  `IDF_PATH=/opt/micro-otter/toolchain/esp-idf`, `IDF_TOOLS_PATH=/opt/.espressif`,
  `MICROPYTHON_ROOT=/opt/micro-otter/toolchain/micropython`, with `MICRO_OTTER_ENABLE_COMPILE=1`,
  `CCACHE_DIR=/data/ccache`, `MICRO_OTTER_BUILD_DIR=/data/build`.
- Pins come from `deploy/toolchain/versions.env` only. The image does not gain gpg/`gh` or bake any
  credential.
- It is built **manually/nightly** until M8; CI builds only the runtime image.

## Compose profiles

`deploy/docker/compose.yaml` defines two profiled services, both mounting the named
`micro-otter-data` volume at `/data` and mapping `${MICRO_OTTER_PORT:-8000}:8000`:

- `micro-otter` (`--profile runtime`) — the runtime image.
- `micro-otter-compile` (`--profile compile`) — the compile image, with `MICRO_OTTER_ENABLE_COMPILE`
  and build tuning interpolated from `.env.example`.

Build the runtime image first (the compile image's `FROM` needs it):

```bash
cd deploy/docker
cp .env.example .env
docker compose --profile runtime build
docker compose --profile compile build
```

`compose.usb.yaml` overlays the runtime service with `group_add: [dialout]`, cgroup rules for USB
serial majors `188`/`166`, and `devices:` entries for `/dev/ttyACM*` and `/dev/ttyUSB*`:

```bash
docker compose -f compose.yaml -f compose.usb.yaml up
```

Docker Desktop on macOS/Windows cannot pass USB serial through; use the native wheel or WSL/usbipd.

## Verification status

The image and compose files are committed and covered by `tests/test_docker_compose.py` (a
daemon-free contract test). The **live host smoke** (`docker build`/`run`/`compose up`) is
**deferred** until a host with a Docker daemon is available; the CI `docker` job re-runs the runtime
smoke on `ubuntu-latest`.

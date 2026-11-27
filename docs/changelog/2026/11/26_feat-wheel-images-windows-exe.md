# Changes since version 1.43.0

## Features

- **The local server is an installable wheel** — `deploy/packaging/build-wheel.sh` builds a
  self-contained wheel that carries the built web app (`micro_otter/dist/webapp`) and the toolchain
  assets (`micro_otter/toolchain/assets`), and `tools/inspect_wheel.py` proves it ships no `tools/`,
  `tests/`, or `ldev/` path. `uv tool install micro-otter` (or `pipx install micro-otter`) yields a
  server that serves the app and runs `micro-otter toolchain install` without a checkout.
- **Runtime and compile Docker images with compose profiles** — `Dockerfile.runtime` (non-root
  `microotter`, one `/data` volume, a `HEALTHCHECK`, no ESP-IDF/git/gh/gpg) and `Dockerfile.compile`
  (the runtime image plus the pinned ESP-IDF/MicroPython toolchain), started via
  `docker compose --profile runtime|compile up` with a Linux USB-serial overlay.
- **A Windows `micro-otter.exe`** — a PyInstaller `--onefile` build bundles the server, web app, and
  toolchain assets so Windows users install without Python/uv; firmware compile stays on Docker/WSL.
- **Commit/tag signing is dev-opt-in** — the devcontainer signs only when `GIT_SIGNING_ENABLED=1`;
  hook installation, identity wiring, and `GPG_TTY` stay unconditional.

## Refactor

- **Automatic CI is scoped to the published repository** — every job in `.github/workflows/ci.yml`
  now carries `if: github.repository == 'dodeka12/micro-otter' || github.event_name ==
  'workflow_dispatch'`, so a development pull request or merge skips all six jobs and builds no
  wheel, Docker image, or Windows exe. The full gate stays one **Run workflow** click away there,
  and `micro-otter` runs it exactly as before. `tests/test_ci_workflow.py` pins the guard.

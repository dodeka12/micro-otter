# `deploy/docker/`

Owner: **M7** (installing and distributing a local server).

## Files

- `Dockerfile.runtime` — the runtime image. It installs the wheel built by
  `deploy/packaging/build-wheel.sh` (never a source tree) into a `python:3.12-slim` base, runs as
  the non-root `microotter` user, serves the app on port 8000, and health-checks
  `/api/server-capabilities`. It carries no toolchain and no developer tooling: no ESP-IDF, no
  git/gh/gpg.
- `Dockerfile.compile` — the compile image: the runtime image plus the pinned ESP-IDF/MicroPython
  toolchain installed by `deploy/toolchain/bootstrap.sh`.
- `compose.yaml` / `compose.usb.yaml` / `.env.example` — the `runtime` and `compile` compose
  profiles and the Linux USB-serial overlay.

## Rules

- Do not fork the toolchain install path: the compile image calls `deploy/toolchain/bootstrap.sh`,
  and image pins stay consistent with `deploy/toolchain/versions.env`.
- `/data` is the only writable volume; the compile image's `/opt` toolchain is read-only-mountable.
- The runtime image must not gain ESP-IDF, git, gh, or gpg.
- Do not move node-package source deployment into the images; it belongs to the web-app deployment
  path.

## Related

- [docker-images.md](../../docs/dev/deployment/docker-images.md) — the full image, compose, and
  verification reference.



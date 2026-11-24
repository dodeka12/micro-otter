# `deploy/docker/`

Owner: **M7** (installing and distributing a local server). Empty in M1 — only this README exists.

Planned content:

- A runtime image for `micro-otter serve`.
- A compile image that installs the toolchain through `deploy/toolchain/bootstrap.sh` and pins
  ESP-IDF/MicroPython from `deploy/toolchain/versions.env`.
- Compose profiles wiring the runtime and compile images together.

Rules for the owner:

- Do not fork the toolchain install path: call `deploy/toolchain/bootstrap.sh`, and keep image pins
  consistent with `deploy/toolchain/versions.env` (the pin-consistency test enforces the mirror).
- Do not move node-package source deployment into the images; it belongs to the web-app deployment
  path.

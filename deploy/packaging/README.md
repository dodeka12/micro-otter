# `deploy/packaging/`

Owner: **M7** (installing and distributing a local server). Empty in M1 — only this README exists.

Planned content:

- Wheel metadata plus the bundled web-app build shipped with the package.
- PyInstaller (or equivalent) single-file packaging of the local server.
- Post-install verification that the packaged server can locate the host toolchain.

Rules for the owner:

- Packaging installs toolchains by calling `deploy/toolchain/bootstrap.sh`; it must not vendor a
  second copy of the ESP-IDF/MicroPython install steps.
- M1 does not ship a `toolchain`/`doctor` CLI command, so packaging preflight calls
  `deploy/toolchain/doctor.sh` until the CLI equivalent lands.

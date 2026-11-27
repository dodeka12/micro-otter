# `deploy/packaging/`

Owner: **M7** (installing and distributing a local server).

## Files

- `build-wheel.sh` — builds the self-contained install wheel: `npm ci`, the version step,
  `npm run build`, copies `_dist/webapp` → `src/micro_otter/dist/webapp`, then `uv build --wheel`, and
  inspects the result with `tools/inspect_wheel.py`. Flags: `--no-build`, `--out-dir <dir>`.
- `verify-wheel.sh` — installs the wheel into a throwaway venv and smokes `serve` +
  `/api/server-capabilities`. Flags: `--wheel <path>`, `--keep`.
- `build-exe.ps1` — builds the Windows `micro-otter.exe` (PyInstaller) on a Windows host.
- `pyinstaller/micro-otter.spec` + `pyinstaller/micro-otter-entry.py` — the exe spec and entry point.

## Wheel contract

The wheel is the only supported install artifact. It ships runtime code only (`src/micro_otter`) plus
two copied-in source paths produced by `build-wheel.sh`: `_dist/webapp` → `micro_otter/dist/webapp`
and `deploy/toolchain` → `micro_otter/toolchain/assets`. The sdist is a source archive for
inspectors, not an install path.

## Rules

- Packaging installs toolchains by calling `deploy/toolchain/bootstrap.sh`; it must not vendor a
  second copy of the ESP-IDF/MicroPython install steps.
- The asset copies are build inputs: `src/micro_otter/dist` is removed on script exit and never
  tracked.


# Changes since version 1.26.0

## Bug Fixes

- **Flashing firmware no longer leaves an empty filesystem.** A compiled image froze 81 of its 108
  modules under absolute host paths (`MICROPY_FROZEN_LIST_ITEM("/opt/micropython/…")`) because
  `mpy-cross` ran without a source name, so MicroPython's `_boot` never mounted the VFS, the `main`
  shim died on its first import, and no `otter_main`, bootstrap setup, or web server ever started.
  Precompiled modules now embed a **relative** source name (`mpy-cross -s <staged path>`), so every
  frozen module is importable and the frozen-only boot chain runs.
- **The precompile step no longer rewrites MicroPython's own tree.** It compiled and deleted
  MicroPython's `_boot.py`, `inisetup.py`, `flashbdev.py`, `machine.py`, `espnow.py`, and `apa106.py`
  in `ports/<port>/modules`; it now compiles only the files staging wrote, and a build preflight
  check fails fast (with the `git checkout -- ports/<port>/modules` hint) when a tracked stock module
  is shadowed or deleted.
- **A broken boot now reports instead of dying silently.** A failed runtime import logs
  `[error] boot: runtime import failed (…)` on the console, and the runtime's `main.py` and the
  generated shim are kept in parity by a test.
- **An unbootable image can no longer be published.** After a successful build,
  `verify_frozen_module_names()` inspects `frozen_content.c` and rejects any absolute frozen module
  name with `ARTIFACT_VERIFICATION_ERROR` (exit `8`, category `artifact-verification`) before the
  image reaches the publish folder.

## Notes

- The broken published ESP32-S3 image
  (`micro-otter-1.29.0-esp32_generic_s3-general-1.0.0-dev.0.g63e68fc-ad83870114cc.bin`) and its
  sidecar were deleted and rebuilt. The fix changes the binary but not the logical composition, so
  the rebuild was published as a new image
  (`…-1.0.0-dev.0.g0a8b1f4-4244cb9f7aad.bin`) after the device runtime manifest version advanced.
- The resulting frozen-only payload — relative frozen names, the first-boot materialized `/`, the
  boot sequence, and the deploy routing matrix — is documented in
  `docs/dev/firmware-compile/firmware-runtime-payload-contract.md`.

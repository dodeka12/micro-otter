# Changes since version 1.25.0

## Bug Fixes

- **Source overrides survive redeploys** — a host source override uploaded by one deploy is no
  longer reported as `available-dynamic` from the sync manifest and then deleted as stale on the
  next deploy. The prepared library plan is now derived from the node graph and the firmware only;
  the manifest keeps its single job of suppressing re-uploads of unchanged content. The
  `ModuleNotFoundError` / `controller-main-loop-load-failed` that appeared after a second deploy of
  a shadowed package is gone.
- **Stale cleanup never deletes what the firmware cannot replace** — a library the collection still
  needs but the deploy does not upload is only removed when the firmware inventory proves it can
  replace it. Unreadable or missing inventory entries keep the file and log
  `collection-library-stale-keep-firmware-missing`; libraries the graph no longer uses are still
  removed.
- **Devices without readable firmware package versions now shadow instead of failing** — when
  neither `embeddedPackagesSummary` nor `firmwareConstituentVersions.nodePackages` is available,
  every firmware-bundled package the collection uses is uploaded as source, with an explicit
  "firmware version unknown" line in the confirmation dialog (and a matching deploy warning)
  instead of silently trusting an unverifiable firmware copy.
- **Warning when a package is not bundled in the firmware** — embedded deploys that upload the
  source of a package the firmware does not ship now warn that this costs RAM and may fail to run
  on a device sized for the firmware's own package set.
- **Leftover package folders no longer shadow the firmware** — a deploy whose firmware owns a
  package now removes the package *folder*, not only the files the sync manifest happens to list,
  and prunes the package directories its file deletions emptied, because an empty `otter_<pkg>/` was
  already enough to break imports: MicroPython searches the VFS before the frozen modules and
  resolves submodules only inside the directory that won the import
  (`ImportError: no module named 'otter_vars.arrays'`).
- **New `DeviceConnection.removeFolder()`** — recursive or remove-only-if-empty folder removal that
  reports the number of removed entries, so a deploy can tell a real removal (which must soft-reset
  the device) from a folder that was already gone.

## Documentation

- New **Deploy Pattern: Complete Plan, Subtractive Removal** section in
  `docs/dev/deployment/deployment-system-architecture.md`: the `removal = manifest − plan`
  invariant, the upload/keep/delete decision table, the firmware-replaceability guard and the log
  events that make the decision observable.
- New **Redeploy Behaviour** runbook in
  `docs/dev/deployment/embedded-runtime-compatibility-deploy.md`: what a normal redeploy does, the
  log lines that prove correct behaviour, and the triage list for "the override disappeared after a
  second deploy".
- New **Firmware-owned package folders** rules in the same architecture page (when a package folder
  may be removed, the `.mpy` alias, the pruning limits) plus the `ImportError: no module named
  '<pkg>.<sub>'` symptom and REPL recovery recipe in the redeploy runbook.
- `docs/dev/device-communication/webserial-architecture.md` documents the new
  `DeviceConnection.removeFolder(path, { recursive })` primitive and its removed-entry count.
- The deploy view's Device Info block gains a **Libraries on Device** row showing how many
  `libs/` / `otter_*` files the device user space holds (embedded runtimes only). It is
  informational — `DeviceDeployment.getDynamicLibraryPathsOnDevice()` reads the sync manifest and
  never influences the deploy plan.

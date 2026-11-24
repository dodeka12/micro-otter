# Changes since version 1.26.0

## Bug Fixes
- **Stale firmware artifacts no longer block a rebuild** — a build that was interrupted between
  publishing its `.bin` and recording it in `runtime_lineage.json` left a file that the pre-build
  conflict check treated as *already published*, so `mo fw` reported *needs a rebuild
  (source-changed)* and then aborted with `FIRMWARE_ALREADY_PUBLISHED` for a version the lineage had
  never heard of. The conflict check now consults the runtime lineage: a `.bin` whose version has no
  lineage entry for the target is a leftover, so it is replaced automatically (with a warning naming
  the file) and the build proceeds. Recorded versions keep the existing behavior — exit code `9`
  plus the *Remove existing firmware and rebuild?* prompt in the menu, or `--force-overwrite`.
- **Publication is rolled back when bookkeeping fails** — publishing happens before the lineage and
  `latest_versions.json` updates; if either update fails, the freshly published artifact is removed
  again so no unrecorded `.bin` is left behind for the next run to trip over.
- **Pre-build conflict check uses the same version identity as the build** — the early check now
  includes the runtime assets version when resolving the firmware version, so `--force-overwrite`
  removes exactly the artifact the publish step will target instead of a version that differs only
  by runtime assets.

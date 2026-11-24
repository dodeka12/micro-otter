# Changes since version 1.23.0

## Bug Fixes
- **`mo fw` can rebuild an already-published firmware version** — the interactive menu built with
  fixed defaults and had no way to answer `FIRMWARE_ALREADY_PUBLISHED`. When the resolved version
  file already existed (for example because the registry entry for a published build is missing or
  was reverted), the menu showed a *rebuild needed* status, then failed with
  `re-run with --force-overwrite to rebuild` — a flag the menu cannot pass. Build and *Rebuild all
  stale firmware* now show the existing artifact and ask `Remove existing firmware and rebuild?`;
  answering `yes` re-runs the build with `force_overwrite`, answering `no` keeps the published
  firmware and exits with the original failure. Declining during a stale sweep no longer aborts the
  remaining boards.
- **Already-published handling no longer reacts to every exit code `9`** — exit code `9` is shared
  by `FIRMWARE_ALREADY_PUBLISHED` and the `INTERNAL_ERROR` fallback, so `mo fw` and
  `mo compile-runtime` now check the error `code` before offering to delete and replace an
  artifact.

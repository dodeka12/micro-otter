# Changes since version 1.43.0

## New Features

- **A release is assembled from one directory of exported images** — `tools/make_release_index.py`
  turns `<stem>.bin` + `<stem>.manifest.json` + `<stem>.firmware.zip` into `index.json` (one entry per
  board: absolute asset URLs, SHA-256 and size measured from the bytes on disk, board slug, chip,
  flash offset, MicroPython version, embedded packages) and `release-notes.md` (the GitHub Release
  body, built from the same document). `--base-url` is required and must be `https://`, `--check`
  reports drift without writing, `SOURCE_DATE_EPOCH` makes two runs byte-identical, and every failure
  carries a `release-index-*` code. The contract is
  [firmware-index.md](../../../dev/firmware-compile/firmware-index.md); 18 tests cover the document, the
  URLs, determinism and every failure code.
- **`docs/workflow/release.md` is now the whole procedure** — prerequisites, per-board build in the
  compile image, `mo fw export` plus the sidecar copy, index generation, the manual `-dev.`/version
  gates, the signed `firmware-v<base>` tag, `gh release create --verify-tag`, the `releasedAtUtc`
  follow-up, the app release (wheel + exe, uploaded to the `v<version>` release), and a
  board-free import verification (`mo fw import --url` + `mo fw list --json`).
- **Users are told where an image comes from** — *Firmware view → Get an official image* says to take
  the `.firmware.zip` from the `firmware-v<base>` release page and load it through the existing
  **Import** / **Import from URL…** dialogs (or `mo fw import --url`), and the three install pages
  state that no installer artifact carries a firmware image.

## Refactor

- **Releases are cut by hand, so CI stopped building and tagging** — the `windows` job in
  `.github/workflows/ci.yml` now runs on `workflow_dispatch` only
  (`if: github.event_name == 'workflow_dispatch'`) and `bump-version.yml` lost its automatic
  `pull_request: closed` trigger, so nothing builds the exe or mints a tag while a release is being
  assembled. The `windows` job id stays in the required status-check set: a skipped job satisfies the
  check, a removed job would leave every pull request waiting for a status that never arrives.
- **The CI contract pins both facts** — `tests/test_ci_workflow.py` keeps the shared
  public-repository guard for the five automatic jobs (`MANUAL_ONLY_JOB_IDS` excludes `windows`), adds
  `test_manual_only_jobs_never_run_automatically`, and adds `test_ci_builds_no_firmware_image`, which
  fails if a `compile-runtime`, `esptool`, `firmware.bin` or `firmware.import` step ever appears in
  `ci.yml`.
- **The tagging documentation matches** — `docs/dev/guides/build-and-deployment.md`,
  `docs/dev/guides/repository-workflow.md`, `docs/admin/GITHUB_SETUP.md`,
  `docs/admin/release-sync.md`, `docs/workflow/{two-repository-workflow,pull-request,changelog}.md`,
  `CONTRIBUTING.md` and `agents-local.md` no longer say a merge is tagged automatically; they point at
  the manual procedure in `docs/workflow/release.md`. The packaging section also states that no
  installable artifact carries a firmware image.

Nothing in `src/micro_otter/` changes: importing a firmware package from disk or from a URL
(`firmware.import` / `firmware.import-binary`, `mo fw import --url`) and the collection
source-upload fallback are untouched.

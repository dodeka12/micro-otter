# Changes since version 1.43.0

## Refactor

- **Plans live in the private `ldev/` tree** — the maintainers' working plan tree moved out of the
  published scaffold into `ldev/todos/`, and `dev/` is now a tracked scaffold that publishes verbatim
  (`dev/README.md` plus empty `ideas/`, `todos/`, `todos/_done/`, `nodes/`, `manual_tests/`, and
  `tools/` folders). A plan file in `dev/` is no longer valid in either repository; the published
  repository keeps the same shape a contributor already knows.
- **`AGENTS.md` is identical in both repositories** — it describes the published repository only. The
  maintainer-only rules — the private plan tree and the publication procedure — moved to
  `agents-local.md`, which `publish-config.json` lists under `excludedPaths`, so `variants` is now
  empty and no per-repository file has to be kept in sync. Shared documents name `AGENTS.md` →
  **Planning** instead of a path, and `node ldev/tools/rewrite-dev-refs.mjs --check` rejects a stale
  reference.
- **Publication is one command** — `node ldev/tools/publish.mjs status|prepare|publish` builds the
  squashed publication commit on a `publish/<date>-<slug>` branch from the configured public working
  tree, runs eight guards (clean private tree, sync-down, leak, forbidden strings, variant parity,
  stale plan references, generated files, device manifests), pushes it, and optionally opens the pull
  request. An unprepared tree reports the three branch-dependent guards as `skip` instead of as
  failures.
- **`tools/mod` retired** — the module-tree helper is gone; node packages and the device tree are the
  only module sources.
- **Version artifacts are build outputs** — `src/micro_otter/_version.py` (hatch-vcs) and
  `_dist/webapp/html/version.json` (vite `closeBundle`) are generated at install and bundle build and
  are no longer tracked, together with the scripts and the CI workflow that kept the tracked copies in
  sync. `micro_otter.__version__` resolves `._version` → `importlib.metadata` → `"0.0.0+unknown"`, and
  `/api/version` reports the same value the stale-bundle warning compares against.

## Documentation

- New developer guide [repository-workflow.md](../../../dev/guides/repository-workflow.md):
  the two trees and their remotes, the private `agents-local.md`, the version producers, the
  publication tool's commands, flags, exit codes, guards and configuration, the executed publication
  sequence, the plan-tree convention, and what the sdist and the wheel contain.
- `docs/admin/release-sync.md` records the first publication (pull request #2, `aa9bb5e6`, tag
  `v1.43.0`) and the rebaseline pointer for M10; `docs/admin/GITHUB_SETUP.md` lists the real required
  check ids (`python`, `web`, `docs`) and the `v*` tag rule.
- `docs/dev/guides/build-and-deployment.md` documents the three CI jobs, the `_version.py` install step
  and `uv build --wheel` for release artifacts.

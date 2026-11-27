# Changes since version 1.43.0

## Bug Fixes

- **A stray `v0.0.1` tag rewrote the version identity** — `bump-version.yml` ran after a documentation
  merge in this repository, found no `v*` tag (`archive/*` is invisible to the action), and pushed
  `v0.0.1` from its `0.0.0` baseline. The tag sat at distance 0, so it became the nearest version:
  `git describe --tags --match 'v[0-9]*'` reported `v0.0.1` and `uv build --wheel` produced
  `micro_otter-0.0.1-py3-none-any.whl`. The tag is deleted locally and on `origin`, and the version
  resolves through the mirrored `v1.43.0` again.
- **The tagging job cannot mint a baseline-less version any more** — its `if:` now requires the public
  repository, because a merge here releases nothing, and a new `Require a version baseline` step fails
  the run when the checkout has no `v*` tag instead of letting the action fall back to `0.0.0`.
- **The Node test suite no longer gates CI** — `npm run test:node` was 386 s of the ~400 s `web` job,
  so every merge paid it twice (pull request plus the post-merge `push` run) and a publication round
  trip paid it four times. The `web` job keeps the generated-file and payload gates, lint, typecheck,
  Vitest and the build; `test:node` stays the developer gate before a publication and before touching
  `tools/`, `tests/`, `src/micro_otter/` or `deploy/`, which is the only remaining coverage for
  `tests/deployment/`.

## Refactor

- **Tagging and CI docs match the workflows** — `docs/admin/release-sync.md` (§6 and the first
  publication record), `docs/dev/guides/repository-workflow.md`,
  `docs/workflow/two-repository-workflow.md` and `docs/workflow/pull-request.md` state that the tag is
  created by the guarded job in the public repository, record the `v0.0.1` incident, and drop the
  manual tag step; `CONTRIBUTING.md`, `docs/admin/GITHUB_SETUP.md`,
  `docs/dev/guides/build-and-deployment.md` and `docs/dev/guides/testing-architecture.md` document the
  suspended Node suite, and the sync-down troubleshooting no longer suggests `git merge -X ours`.

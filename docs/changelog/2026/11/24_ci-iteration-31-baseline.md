# Changes since version 1.42.1

## Refactor

- **Least-privilege CI baseline** — `.github/workflows/ci.yml` validates every pull request and every
  merge to `main` with three stable jobs (`python`, `web`, `docs`) that hold `contents: read` only,
  cancel superseded runs on the same ref, cache `uv.lock`/`package-lock.json`, run on demand, and
  upload the built site as the `docs-site` artifact; nothing is tagged, packaged, released or
  deployed.
- **`check:ci-local:web` split** — `npm run check:ci-local` chains the web checks and the mpy-cross
  `check:device-syntax` gate as separate scripts, so CI runs every web check without a local
  MicroPython build.
- **Legacy workflows deduplicated** — `payload-docs-check.yml` keeps only the generated web app
  version check that CI deliberately omits, and `bump-version.yml` is marked as post-merge release
  tagging outside the baseline.
- **One run per change** — `push` is limited to `main`, so a feature-branch push does not repeat the
  pull-request run, and `pull_request` is limited to change sets that touch more than `ldev/`, so
  private planning commits spend no run at all. `main` takes no direct pushes, and the post-merge
  `push` run revalidates the tree when another pull request lands in between.
- **Contributor docs** — `CONTRIBUTING.md` and `docs/dev/guides/build-and-deployment.md` list the
  jobs, the required status-check names and the local equivalents.

## Bug Fixes

- **CI-only test failures** — the toolchain help test asserts on ANSI-stripped output for runners
  that style rich/typer help, and two suites no longer nest tests inside a running test, which made
  the DOM-less tests fail on the CI Node runtime.

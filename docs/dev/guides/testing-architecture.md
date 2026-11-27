# Testing Architecture

This document defines the canonical testing architecture for the Micro-Otter v2 codebase.

## Goals

- Keep JavaScript/TypeScript tests fast, deterministic, and runnable in CI and local dev.
- Use one primary assertion/test style for JS unit and integration tests.
- Clearly separate Node-based tests, browser E2E tests, and Python tests.

## Test Framework Matrix

### JavaScript / TypeScript (Primary)

- **Runner**: Node.js built-in `node:test`
- **Assertions**: `node:assert/strict`
- **Execution**: TS source is loaded at runtime with the `tsx` loader
- **File pattern**: `*.test.js`

Use this for:

- core logic tests
- data model tests
- view logic tests that can run in Node (with `jsdom` when DOM APIs are needed)

### Browser End-to-End

- **Runner**: Playwright
- Use for full browser workflows and integration scenarios requiring a real browser runtime.

### Python

- **Runner**: `pytest` (project Python test suite under `tests/*.py`)

## JavaScript Testing Rules

- Prefer `node:test` imports: `describe`, `it`, `beforeEach`, `afterEach`.
- Prefer `node:assert/strict` assertions (`assert.equal`, `assert.deepEqual`, `assert.ok`, `assert.throws`).
- Do **not** introduce Jest or Vitest for standard JS/TS unit/integration tests.
- For DOM behavior in Node tests, use `jsdom`.
- Never assert elapsed wall-clock time around a real timer — a `Date.now()` delta compared with a
  configured `setTimeout`/`setInterval` delay flips under load, because Node timers may fire a
  millisecond early and `Date.now()` truncates. Take the `node:test` context and drive the delay
  with the fake clock instead: `t.mock.timers.enable({ apis: ['setTimeout'] })`, then
  `t.mock.timers.tick(ms)` to step to the boundary (see
  [progress-bar-view.test.js](../../../tests/views/progress-bar-view.test.js)). That asserts the
  exact configured delay instead of a tolerance, and never depends on machine speed.

## Commands

- Run all Node-based JS tests:

```bash
npm run test:node:js
```

- Run TS-aware Node test mode:

```bash
npm run test:node:ts
```

- Run browser tests:

```bash
npm run test:browser
```

- Run full local test pipeline:

```bash
npm run test:all
```

## Temporary CI split

`ci.yml` does not run the Node suite for now. `npm run test:node` is 6,100+ assertions and was 386 s of
the ~400 s `web` job, so it ran twice per merge — on the pull request and again in the post-merge `push`
run of `main` — and four times for a change that went out through a publication and came back with the
sync-down. That made the release round trip wait on the suite instead of on the change.

Automatic CI is also scoped to the published repository (`github.repository ==
'dodeka12/micro-otter'`, or a manual `workflow_dispatch`), so a development pull request runs no CI
job at all — neither this suite nor the packaging, Docker, or Windows gates.

Until the packaging infrastructure is stable and the remaining milestones have landed, the `web` job
runs the generated-file and payload gates, lint, typecheck, the Vitest suite and the build, and leaves
`test:node` to the developer:

```bash
npm run test:node        # before a publication, and before merging tools/, tests/, src/ or deploy/
```

The suite is the only CI coverage for `tests/deployment/` (firmware and packaging behaviour), so that
local run is what catches a regression there. Restoring the gate is one step in the `web` job; the
comment above its `Vitest` step in [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml)
holds the exact snippet.

## Payload Contract Checks

Two checks enforce the `AppEvent`/`AppPayload` conventions across the source tree:

```bash
npm run check:payload-docs
npm run check:event-payload-emissions
```

- `check-payload-docs` (`tools/check-payload-jsdoc.mjs`) requires a ` - description` on every
  `@param` in a payload class docblock.
- `check:event-payload-emissions` (`tools/check-event-payload-emissions.mjs`) rejects literal or
  ad-hoc payloads passed to `.emit()`, `._emit()` or `new AppEvent()`.

Both tools scan **`.js` and `.ts`** files under `src/micro_otter/nodes/html/js`. They accept a
`PAYLOAD_CHECK_ROOT` environment variable so `tests/dev/payload-check-tools.test.js` can run them
against a temporary tree.

## Documentation link gate

`npm run check:docs-links` runs `tools/check_docs_links.mjs` over every published markdown tree
(`README.md`, `CONTRIBUTING.md`, `AGENTS.md`, `docs/**`, `user-docs/**`, `ai/**`, `.cline/**`,
`dev/**`), skipping `ldev/**` and build output. It fails (exit 2) on a relative link whose target
does not exist or whose `#fragment` names no heading, on a case-mismatched path, and on an allowlist
entry that matches nothing. `tools/docs-link-allowlist.json` is the fail-closed allowlist
(`{path, target, reason}`); `mkdocs build --strict` cannot replace this gate because it never renders
the raw `docs/` tree. `tests/dev/docs-link-check.test.js` covers the checker against a temporary tree.

## Packaging and Docker contract tests

The packaging and container distribution are gated by daemon-free contract tests, so a Docker or
Windows host is not required to run them:

- `tests/test_inspect_wheel.py` — the wheel content contract (`REQUIRED_FILES`, `FORBIDDEN_PREFIXES`).
- `tests/test_wheel_smoke.py` — the installed-wheel smoke assertions.
- `tests/test_docker_compose.py` — the Dockerfile/compose/`.env.example` contract.
- `tests/test_pyinstaller_spec.py` — the PyInstaller spec/entry/build-script contract.
- `tests/test_ci_workflow.py` — the CI job ids, permissions, and the packaging/docker/windows gates.
- `tests/dev/docs-link-check.test.js` — the link gate against a temporary tree.

## Contract-document checks

`tests/test_firmware_contract_invariants.py` keeps the firmware contract documents and the code in
step without a network or a build:

- `test_capabilities_payload_has_exactly_contract_keys` compares `CAPABILITY_KEYS` with the key table
  in [server-firmware-api.md](../firmware-compile/server-firmware-api.md), so a `schemaVersion` cannot
  sneak in unnoticed.
- `test_documented_error_codes_match_handler_codes` and
  `test_documented_flash_codes_match_deploy_helper` compare the documented code tables with
  `firmware_ws_handler.ERROR_CODES` and `firmware_deploy.FLASH_ERROR_CODES`. Renaming a code in a
  document alone fails the test — fix whichever side is wrong, never delete the test.
- `test_source_upload_path_ignores_firmware_selection` is a narrow text guard over
  `src/micro_otter/nodes/html/js/deployment/*.ts`: no firmware-selection input (`enable_compile`,
  `enable_deploy`, `packageIds`, `modulePackagingMode`, `firmware-compile`, `firmware-deploy`) may
  appear in the source-upload path. It has a per-file allowlist that must carry a reason, and it never
  replaces `tests/deployment/collection-deployment-*.test.js`, which stay the authoritative
  behavioural gate for the upload fallback.
- `test_compile_frame_never_carries_upload_directives` asserts a parsed `compile.start` /
  `deploy.start` request exposes no field that reads like an upload instruction.

Focused tab-reorder tests can be run directly (the `run-node-tests.mjs` wrapper only parses
`--mode`):

```bash
node --import tsx --test tests/data/collection-graph-reorder.test.js
node --import tsx --test tests/views/tabbed-view-reorder.test.js
node --import tsx --test tests/views/tabbed-view-drag.test.js
node --import tsx --test tests/views/collection-view-tab-reorder.test.js
```

## Test Placement

- JavaScript/TypeScript tests: `tests/**/*.test.js`
- Python tests: `tests/*.py`
- Keep tests near the relevant subsystem folder (`tests/core`, `tests/data`, `tests/views`, etc.).

## Authoring Checklist

- Use `node:test` + `node:assert/strict` for new JS tests.
- Keep fixtures minimal and explicit.
- Cover legacy compatibility behavior when changing serialization or IDs.
- Run focused tests first, then broader suite.

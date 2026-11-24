# AGENTS.md

Canonical, harness-agnostic instructions for AI coding agents in this repository — the public
Micro-Otter product repository. GitHub Copilot and Cline adapters link here; do not duplicate these
rules in harness-specific files.

## Project purpose and layout

- Micro-Otter pairs a browser-based node editor with MicroPython runtime scaffolding so users can
  design ESP32 firmware visually.
- Editor assets live under [src/micro_otter/nodes/html](src/micro_otter/nodes/html); the entry
  point is [src/micro_otter/nodes/html/js/app/main.ts](src/micro_otter/nodes/html/js/app/main.ts).
- The web root is [src/micro_otter/nodes/](src/micro_otter/nodes/); it serves both the HTML
  application and device assets.
- `uv run micro-otter serve` runs
  [micro_otter.tools.serve_nodes:main](src/micro_otter/tools/serve_nodes.py), serving the web
  root on <http://localhost:8000>.
- Python packaging is defined in [pyproject.toml](pyproject.toml); dependencies require Python 3.12+
  with `uv` for environment management and Hatchling for builds.
- There is no `v1/` tree and no `device/general/device.json` example in the current layout. Treat
  references to them as stale and replace them with the current paths above.

## Tooling defaults

- Run Python through `uv run ...` so dependency resolution stays consistent. Inside the
  devcontainer, the workspace interpreter is `.venv/bin/python`; do not hard-code platform-specific
  or user-specific virtualenv paths.
- Standard JavaScript/TypeScript tests use the Node.js built-in test runner (`node:test`,
  `node:assert/strict`) with the `tsx` loader. Existing Vitest and Playwright suites remain; do not
  introduce Vitest/Jest for standard JS/TS unit or integration tests.
- Use `npm run test:node` for standard tests, `npm run test:vitest` for the existing Vitest suite,
  and `npm run test:browser` for Playwright. Use `jsdom` for DOM tests in Node.
- When debugging unexpected errors, scan for unterminated or overlong block comments that may be
  swallowing the following code.
- Run `npm run check:ci-local`, `npm run test:node`, `npm run typecheck`, and `uv run pytest -q`
  before considering a change complete. Run the narrower command for the area you changed when a
  full gate is not practical.
- Use git only in the terminal. Commits are signed; never use `--no-gpg-sign` or another signing
  bypass. The first commit of the day may require the user to enter a PGP passphrase. See the
  [git workflow skill](ai/skills/git-terminal-workflow/SKILL.md).

## Documentation map

Load only the documents needed for the current task to avoid context bloat. The full index is
[docs/dev/README.md](docs/dev/README.md).

| Area | Start here |
|------|------------|
| Coding standards | [docs/dev/guides/coding-style-guide.md](docs/dev/guides/coding-style-guide.md) |
| Testing architecture | [docs/dev/guides/testing-architecture.md](docs/dev/guides/testing-architecture.md) |
| Build and deployment | [docs/dev/guides/build-and-deployment.md](docs/dev/guides/build-and-deployment.md) |
| Architecture overview | [docs/dev/guides/architecture-overview.md](docs/dev/guides/architecture-overview.md) |
| Data model and events | [docs/dev/core/data-backbone-architecture.md](docs/dev/core/data-backbone-architecture.md), [docs/dev/core/progress-event-system.md](docs/dev/core/progress-event-system.md) |
| i18n | [docs/dev/core/i18n-architecture.md](docs/dev/core/i18n-architecture.md) |
| View system | [docs/dev/view-system/view-system-architecture.md](docs/dev/view-system/view-system-architecture.md) |
| Custom views | [docs/dev/view-system/custom-view-architecture.md](docs/dev/view-system/custom-view-architecture.md) |
| Graph panel | [docs/dev/view-system/graph-panel-view-architecture.md](docs/dev/view-system/graph-panel-view-architecture.md) |
| Node definitions | [docs/dev/nodes/node-definition-reference.md](docs/dev/nodes/node-definition-reference.md) |
| Function graphs (`function` execution type) | [docs/dev/nodes/function-graphs.md](docs/dev/nodes/function-graphs.md) |
| Node UI modules | [docs/dev/view-system/node-ui-module-structure.md](docs/dev/view-system/node-ui-module-structure.md) |
| Deployment | [docs/dev/deployment/deployment-system-architecture.md](docs/dev/deployment/deployment-system-architecture.md) |
| MPY precompilation | [docs/dev/mpy-precompilation/workflow.md](docs/dev/mpy-precompilation/workflow.md) |
| Firmware compile contract | [docs/dev/firmware-compile/backend-compile-interface-contract.md](docs/dev/firmware-compile/backend-compile-interface-contract.md) |

Workflow guides live in [docs/workflow/](docs/workflow/):

- [Adding icons](docs/workflow/adding-icons.md) — Google Material Symbols and Material Design Icons,
  app-level and node-package destinations
- [Changelog](docs/workflow/changelog.md)
- [Pull requests](docs/workflow/pull-request.md)

## Skills

Canonical skills live under [ai/skills/](ai/skills/). Each is a standard `SKILL.md` directory with
optional `references/`. Cline adapters under [.cline/skills/](.cline/skills/) and the Copilot adapter
at [.github/copilot-instructions.md](.github/copilot-instructions.md) link to the canonical files.

| Skill | Use when |
|-------|----------|
| [changelog](ai/skills/changelog/SKILL.md) | Adding, updating, or finalizing a changelog entry |
| [code](ai/skills/code/SKILL.md) | Implementing a feature, fixing a bug, or changing code |
| [create-plan](ai/skills/create-plan/SKILL.md) | Planning work as a short, multi-phase, or iterative plan; multi-phase plans include a cumulative `handoff.md` |
| [create-skills](ai/skills/create-skills/SKILL.md) | Creating or updating skills and harness adapters |
| [document](ai/skills/document/SKILL.md) | Updating in-code, developer, or user documentation |
| [git-terminal-workflow](ai/skills/git-terminal-workflow/SKILL.md) | Staging, committing, pushing, or other git operations |
| [implement-plan](ai/skills/implement-plan/SKILL.md) | Executing steps from a plan in the plan tree, including per-phase handoffs and optional context compaction |
| [pull-request-workflow](ai/skills/pull-request-workflow/SKILL.md) | Creating or updating a pull request |

## Planning

- Plans live in the published `dev/` scaffold: `todos/` holds the plans and `todos/_done/` the
  completed ones. The sibling `ideas/`, `nodes/`, `manual_tests/`, and `tools/` folders hold ideas,
  node design documents, manual test scripts, and small development utilities.
- Use the [create-plan](ai/skills/create-plan/SKILL.md) and
  [implement-plan](ai/skills/implement-plan/SKILL.md) skills for plan structure and execution.
- Multi-phase plans carry a cumulative `handoff.md`. Each phase ends by writing its handoff section
  and committing it; the next phase re-reads `overview.md` (Locked Decisions), `handoff.md`, and the
  phase file before editing. Manual context compaction (`/smol` / `/newtask`) happens only after the
  handoff is committed.
- Plans are contributed like code: open an issue or a pull request, and expect the plan itself to be
  reviewed before the implementation. There is no separate planning repository and no publication
  step — a change is complete when the gates in *Tooling defaults* pass in this repository.

## Critical rules

- Never access private members (`_field`, `#field`) of another class; use its public API.
- Reuse the existing component and its exact variant before writing new markup, and do not redesign
  approved layout, APIs, or visuals without agreement. See the
  [Coding Style Guide](docs/dev/guides/coding-style-guide.md) (*Reuse Before Writing*, *Preserve
  Approved Design*).
- Every public symbol and every private function/method needs a docstring/JSDoc. Private class
  attributes need one when their purpose or callers are not obvious.
- Device-tree code under `src/micro_otter/nodes/device/` runs on MicroPython. For every change, run
  `npm run check:device-syntax` and verify any assumed `str`, `bytes`, `dict`, `list`, `asyncio`,
  `machine`, `socket`, `time`, `json`, `os`, or `ssl` member against the pinned MicroPython
  implementation or documentation. Encode missing APIs in
  `tests/test_device_micropython_api_guard.py`.
- Never remove the collection-deploy source-upload fallback. Packages missing from the firmware
  (`missing`) or newer than the firmware copy (`override-required`) must still upload local source;
  this path is independent of firmware images.
- Update developer docs when a change adds a module, public interface, protocol, contract, or
  cross-cutting design decision. See [docs/dev/README.md](docs/dev/README.md).

## Harness adapters

- **Cline:** [.cline/skills/](.cline/skills/) contains thin wrappers with frontmatter and links to
  `ai/skills/`. The canonical skill body is not duplicated.
- **GitHub Copilot:** [.github/copilot-instructions.md](.github/copilot-instructions.md) points
  here and to `ai/skills/`.
- **Other harnesses:** link to this file and the relevant canonical skill. Do not create a new
  source of truth.

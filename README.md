<!-- Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only -->

# micro-otter

Micro-Otter lets you design MicroPython firmware for boards such as the ESP32 by wiring together node
graphs instead of hand-writing every script: a node-based programming environment for
MicroPython-capable microcontrollers that generates executable logic from graphs describing hardware,
signal flow and behaviour.

## Quick start

```bash
uv sync --group dev       # Python 3.12 + dev tools (install uv first)
npm ci                    # frontend dependencies
npm run build             # emits _dist/webapp, which the server serves
uv run micro-otter serve  # http://127.0.0.1:8000
```

`npm run dev:all` instead runs the Vite dev server (`http://localhost:5173`, hot reload) next to the
Python backend. Release builds install the wheel rather than the source tree.

To install the released server (no source checkout): `uv tool install micro-otter`, the Docker
runtime/compile images, or the Windows `micro-otter.exe` — see the install pages
([Linux](user-docs/install-linux.md), [macOS](user-docs/install-macos.md),
[Windows](user-docs/install-windows.md)).

## Start here

| Topic | Document |
| --- | --- |
| Using the app (setup, views, node reference, add-ons) | [user-docs/index.md](user-docs/index.md) |
| Dev container, USB serial forwarding, commit signing | [docs/dev/guides/devcontainer.md](docs/dev/guides/devcontainer.md) |
| Running, building and hosting the web app | [docs/dev/guides/build-and-deployment.md](docs/dev/guides/build-and-deployment.md) |
| Tests (Node, Vitest, Playwright, pytest) | [docs/dev/guides/testing-architecture.md](docs/dev/guides/testing-architecture.md) |
| Coding standards and lint gates | [docs/dev/guides/coding-style-guide.md](docs/dev/guides/coding-style-guide.md) |
| Node types and node packages | [docs/dev/nodes/node-definition-reference.md](docs/dev/nodes/node-definition-reference.md) |
| Add-on node packages | [docs/dev/nodes/addons/index.md](docs/dev/nodes/addons/index.md) |
| Git hooks and manifest version bumps | [docs/dev/guides/git-hooks.md](docs/dev/guides/git-hooks.md) |
| CLI (`serve`, `doctor`, `toolchain`, `info`) | [docs/dev/deployment/configuration.md](docs/dev/deployment/configuration.md) |
| `.mpy` precompilation and deployment | [docs/tools/mpy-runtime-workflow.md](docs/tools/mpy-runtime-workflow.md) |
| Releases only | [docs/workflow/release.md](docs/workflow/release.md) |
| Contributing | [CONTRIBUTING.md](CONTRIBUTING.md) |

## Commands

| Task | Command |
| --- | --- |
| App with hot reload | `npm run dev:all` |
| Production build | `npm run build` |
| Node tests / Vitest / browser tests | `npm run test:node` / `npm run test:vitest` / `npm run test:browser` |
| All local gates (also the `pre-push` hook) | `npm run check:ci-local` |
| Typecheck / Python tests | `npm run typecheck` / `uv run pytest -q` |
| Docs site preview / strict build | `uv run mkdocs serve` / `npm run check:docs` |
| Toolchain diagnosis | `uv run micro-otter doctor` |

Run `git config core.hooksPath hooks` once per clone to enable the commit-msg, pre-commit and pre-push
hooks; the dev container does this for you.

## Repository layout

- `src/micro_otter/` — host Python package: CLI, servers, build and deploy tooling.
- `src/micro_otter/nodes/` — web root of the editor: `html/` (TypeScript app) and `device/`
  (runtimes, node packages, targets).
- `tests/` — Node, Vitest, Playwright and pytest suites.
- `user-docs/` — the published documentation site.
- `docs/` — developer, workflow and administrative markdown, not rendered.
- `deploy/` — toolchain bootstrap, packaging and container assets.
- `hooks/`, `tools/`, `ai/`, `.devcontainer/` — git hooks, generators, AI guidance, dev container.

## Documentation

Two trees, one site:

- `user-docs/` is rendered by MkDocs (`mkdocs.yml`, Material theme, `mike` versioning).
- `docs/` stays raw markdown in the repository; its index is
  [docs/dev/README.md](docs/dev/README.md), and `user-docs/developer-docs.md` is the pointer into it.

`npm run check:docs` is the strict build gate and part of `npm run check:ci-local`; both need
`uv sync --group docs` for the MkDocs toolchain. A development checkout never pushes:
`uv run mike deploy --update-aliases <version> latest` only updates the local `gh-pages` branch.

Happy hacking!

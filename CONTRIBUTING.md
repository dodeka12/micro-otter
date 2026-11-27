# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

# Contributing

Thanks for taking the time to contribute! This project uses a Conventional Commit style for both commit messages and pull request titles so our automation can determine the correct semantic version bump. Please follow the guidelines below when contributing.

## Commit Message Format

We use the following format for commits:

```
<type>[optional scope][!]: <short summary>

[optional body]
[optional footer(s)]
```

### Allowed Types

- `feat`: Add a new feature. Causes a **minor** version bump.
- `fix`: Bug fixes, hot fixes, or patches. Causes a **patch** version bump.
- `perf`: Performance improvements. Treated as **patch**.
- `refactor`: Code refactors without changing behavior. Treated as **patch**.
- `chore`: Tooling, config changes, maintenance. Treated as **patch**.
- `docs`: Documentation-only changes. Treated as **patch**.
- `style`: Formatting, missing semicolons, etc. Treated as **patch**.
- `test`: Adding or updating tests. Treated as **patch**.
- `build`: Build system or dependencies. Treated as **patch**.
- `ci`: Continuous integration configuration or scripts. Treated as **patch**.
- `revert`: Revert a previous commit. Treated as **patch**.

### Breaking Changes

Add an exclamation mark (`!`) right before the colon if the change is breaking, or include a `BREAKING CHANGE:` paragraph in the footer. Either approach forces a **major** version bump.

Examples:

- `feat!: drop Python 3.10 support`
- `fix(core)!: adjust servo boundaries`
- Footer example:
  ```
  BREAKING CHANGE: API signatures changed in motor module.
  ```

## Pull Request Titles

Use the same Conventional Commit format for PR titles. The GitHub Action will inspect both the PR title and merged commits to pick the version bump:

- `feat(app): add web UI controls` ⟶ bumps **minor**
- `fix(html): correct button labels` ⟶ bumps **patch**
- `chore(deps)!: upgrade MicroPython runtime` ⟶ bumps **major**

If a PR mixes multiple types, the highest priority wins: `major > minor > patch`.

## Additional Tips

- Squash merge is recommended so the PR title becomes the default commit message.
- Keep summaries short (≤72 characters) and bodies wrapped at 72 characters.
- Reference issues using `Fixes #123` or `Refs #456` in the footer when applicable.
- Test runner behavior (including `.test.js` against `.ts` source) is documented in [docs/dev/guides/testing-architecture.md](docs/dev/guides/testing-architecture.md#commands).

Following these conventions keeps the changelog, the release notes and the manual release procedure
consistent. Happy hacking!

## Repository layout

| Path | Holds |
|---|---|
| `src/micro_otter/` | The application: the Python CLI and server, the node system, and the browser editor under `nodes/html/` |
| `user-docs/` | The published documentation site (MkDocs + Material) |
| `docs/dev/` | Developer documentation — architecture, guides, node and deployment references, indexed from [docs/dev/README.md](docs/dev/README.md) |
| `docs/workflow/` | The release, changelog, pull-request and icon workflows |
| `tests/` | The Python, Node and browser test suites |
| `dev/` | The plan scaffold: `dev/todos/` for proposals, `dev/todos/_done/` for finished plans, plus empty `ideas/`, `nodes/`, `manual_tests/` and `tools/` folders |

Plans are proposed like code: add a folder under `dev/todos/` with an `overview.md` plus one file per
phase, and open a pull request — or an issue first if you want to agree on the shape. The plan format,
the completion markers and the phase-handoff rules are in [AGENTS.md](AGENTS.md) → **Planning**, and the
[create-plan](ai/skills/create-plan/SKILL.md) and [implement-plan](ai/skills/implement-plan/SKILL.md)
skills describe how to write and execute one. Finished plans move to `dev/todos/_done/`.

A change is complete when the gates below pass: `npm run check:ci-local`, `npm run test:node`,
`npm run typecheck`, and `uv run pytest -q`.

## User documentation

The published documentation site is built only from `user-docs/` (`mkdocs.yml`, Material theme, `mike`
versioning). The developer markdown under `docs/` stays in the repository and is indexed from
`user-docs/developer-docs.md`.

- A user-visible change updates `user-docs/` in the same pull request: a new node, view action,
  setting or message is described on the page that covers it.
- `npm run check:docs` (`uv run mkdocs build --strict`) must pass. It runs inside
  `npm run check:ci-local`, so the pre-push hook enforces it.
- `npm run check:docs-links` (`node tools/check_docs_links.mjs`) must pass: it scans every published
  markdown tree for broken relative links and fails closed on an unused allowlist entry. It also runs
  inside `npm run check:ci-local`.
- Preview with `uv sync --group docs && uv run mkdocs serve`; see
  [README.md](README.md#documentation) for the versioned preview.

## Linting & Pre-Commit Hooks

Three trees are gated, each by the tool that understands it:

- **Host Python** (`src/`, `tools/`, `tests/`) — Ruff: `npm run lint:python`
  (fixes: `npm run lint:python:fix`, formatting: `npm run format:python`).
- **JavaScript + TypeScript** (`src/**/*.js`, `tests/**/*.js`, `src/**/*.ts`) — ESLint 9 with the
  flat config in `eslint.config.js`: `npm run lint` (which delegates to `lint:js` and `lint:ts`).
- **MicroPython device tree** (`src/micro_otter/nodes/device/`) — `mpy-cross`:
  `npm run check:device-syntax` compiles every device source for `xtensa` and `xtensawin`
  without writing bytecode into the repository. Exit `1` means device code is broken, exit `2`
  means the gate itself is (compiler missing, unsupported `-march`, device root missing).

`npm run lint:all` chains all three, and that is the command to run before opening a pull request.

Why the device tree has its own gate: it is MicroPython, so ruff would report viper intrinsics as
undefined names and its autofixes (`UP038` PEP 604 unions, `B905` `zip(strict=)`) would produce
code the firmware rejects. It is excluded through `extend-exclude` **and** `force-exclude` in
`pyproject.toml`, and the compiler gate replaces that coverage. Rules, exclusions, editor setup and
the deferred follow-ups are documented in the
[coding style guide](docs/dev/guides/coding-style-guide.md#tooling).

Ruff is a declared dev dependency (`[dependency-groups].dev` in `pyproject.toml`), so
`uv sync --all-groups --python 3.12` installs it and `uv run ruff` works without the pre-commit
cache. It stays the tool of record in `.pre-commit-config.yaml`, at the same pinned version: a
config test fails when the pin and the `ruff-pre-commit` rev drift, because drifting versions
report different findings in the editor, in pre-commit and in the npm scripts.

To keep checks consistent locally and in CI:

- Ensure repository hooks are active: `git config core.hooksPath hooks`.
- Install pre-commit (one-time): `uv tool install pre-commit`.
- Run lint hooks manually before pushing: `uv run pre-commit run --all-files`.
- Regenerate the About dialog OSS package list (if runtime web-app dependencies changed): `npm run generate:oss`.
- Regenerate the vendored Material Design Icons assets (if the MDI version changed): `npm run generate:mdi`.

With `core.hooksPath=hooks`, [hooks/pre-commit](hooks/pre-commit) stays fast (metadata regeneration + auto-staging), while [hooks/pre-push](hooks/pre-push) runs strict validation through `npm run check:ci-local`. That command chains the web subset (`npm run check:ci-local:web`: generated-file and payload gates, `npm run lint`, `npm run lint:python`, the firmware-release and docs gates) with `npm run check:device-syntax` for the MicroPython tree. The web subset is what CI runs, so a push cannot land code the gates reject.

## Continuous Integration

[.github/workflows/ci.yml](.github/workflows/ci.yml) validates every pull request and every merge
to `main`, and can be started on demand with **Run workflow**. A feature-branch push starts no second
run, because the pull request already covers it; the `push` trigger exists for the post-merge check of
`main`, which takes no direct pushes. It holds `contents: read` only, cancels superseded runs on the
same ref, caches dependencies, and publishes nothing: no tag, package, release or site.

Every job carries a repository guard,
`if: github.repository == 'dodeka12/micro-otter' || github.event_name == 'workflow_dispatch'`, so a run
only does work where a release artifact would be wanted: in `micro-otter` the guard is always true and
CI runs exactly as the table describes, while a fork's pull request skips the jobs until someone starts
a run by hand. `tests/test_ci_workflow.py` pins the guard on every job.

| Job | What it runs | Local equivalent |
| --- | --- | --- |
| `python` | `uv sync --group dev`, `uv run ruff check src/ tools/ tests/`, `uv run pytest` | `npm run lint:python && uv run pytest -q` |
| `web` | `npm ci`, `npm run check:lockfile-sync`, `check:oss-generated`, `check:mdi-generated`, `check:payload-docs`, `check:event-payload-emissions`, `lint`, `typecheck`, `test:vitest`, `uv sync --group dev --reinstall-package micro-otter`, `build` | `npm run check:ci-local:web && npm run typecheck && npm run test:node && npm run test:vitest && npm run build` |
| `docs` | `uv sync --group docs`, `uv run mkdocs build --strict`, `npm run check:docs-links`, upload `site/` as the `docs-site` artifact | `npm run check:docs && npm run check:docs-links` |
| `packaging` | `bash deploy/packaging/build-wheel.sh`, `bash deploy/packaging/verify-wheel.sh`, upload `dist/*.whl` | `bash deploy/packaging/build-wheel.sh && bash deploy/packaging/verify-wheel.sh` |
| `docker` | build `deploy/docker/Dockerfile.runtime`, start + smoke (uid `10001`, no idf.py/git/gh/gpg, `healthy`), `docker compose … config` | a host with a Docker daemon |
| `windows` | `pwsh -File deploy/packaging/build-exe.ps1`, smoke `--help` + `serve`, upload `dist/micro-otter.exe` | a Windows host |

The job ids are the required status-check names. The Node suite (`npm run test:node`) is suspended in
CI for now: it was 386 s of the ~400 s `web` job. Run it locally before merging anything that touches
`tools/`, `tests/`, `src/micro_otter/` or `deploy/`; it includes `tests/deployment/`, so a firmware or
packaging regression is caught there. See
[testing-architecture.md](docs/dev/guides/testing-architecture.md#temporary-ci-split). There is no
`device-syntax` CI job:
mpy-cross is a local toolchain build, so that gate stays in `npm run check:ci-local` and runs in the
firmware compile image instead. A status badge is added once the repository is public.

`pre-commit run --all-files` remains useful for running the Python/JSON lint stack from `.pre-commit-config.yaml` on demand.

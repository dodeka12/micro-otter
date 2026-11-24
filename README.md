<!-- Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only -->

# micro-otter

Micro-Otter lets you design MicroPython firmware for boards such as the ESP32 by wiring together node graphs instead of hand-writing every script.

## Goal

- Provide a node-based programming experience for MicroPython-capable microcontrollers (ESP32 focus).
- Generate executable logic from node graphs that describe hardware interactions, signal flows, and behaviors.

## Installation

1. Install the `uv` package manager by following the official instructions: https://docs.astral.sh/uv/getting-started/installation/
2. Clone this repository and open it in your terminal.
3. Run `uv sync` to create/populate the local virtual environment with all required dependencies.

## Development in a VS Code Dev Container

This repository includes a complete dev-container setup in [.devcontainer/devcontainer.json](.devcontainer/devcontainer.json).

1. Install Docker Desktop/Engine and the VS Code extension `Dev Containers` (`ms-vscode-remote.remote-containers`).
2. Open this repository in VS Code.
3. Run `Dev Containers: Reopen in Container` from the Command Palette.
4. Wait for the first build to finish (image pull + dependency install).

Windows note:

1. If you want the devcontainer to access USB serial devices such as ESP32 boards, install `usbipd-win` on the Windows host.
2. Attach the device to WSL before using it from the container.
3. For CP210x adapters used with this repository, run the helper script from Windows PowerShell: `./tools/attach-cp210x-to-wsl.ps1`.
4. See [docs/tools/windows-cp210x-wsl-setup.md](docs/tools/windows-cp210x-wsl-setup.md) for the full setup and verification steps.

Python is installed and managed by `uv` inside the container (`uv python install 3.12` + `uv sync`).

The container also installs the editor extensions the repository settings rely on — `charliermarsh.ruff`,
`dbaeumer.vscode-eslint`, `esbenp.prettier-vscode`, `ms-python.python`, `ms-python.vscode-pylance`,
`ms-playwright.playwright` and `mhutchie.git-graph` — so Python format-on-save, ESLint autofix and Prettier
work in a fresh container without any manual installation step.

### Git commit signing in the dev container

The dev container automatically configures Git to sign commits (`commit.gpgsign=true`) and persists the container GPG keyring at `/root/.gnupg` (the `micro-otter-gnupg` volume). GPG runs entirely inside the container, so you import your private key once and it survives rebuilds.

Recommended setup:

1. On your host, export the signing key id so post-create configures `user.signingkey`:
	- `export GIT_SIGNING_KEY_ID=<your-long-key-id>`
    - persist it, for example: `echo 'export GIT_SIGNING_KEY_ID=<your-long-key-id>' >> ~/.profile`
2. On your host, export your Git identity so post-create configures `user.name` and `user.email` automatically:
	- `export GIT_USER_NAME="Your Name"`
	- `export GIT_USER_EMAIL="you@example.com"`
    - persist them, for example:
        - `echo 'export GIT_USER_NAME="Your Name"' >> ~/.profile`
        - `echo 'export GIT_USER_EMAIL="you@example.com"' >> ~/.profile`
3. Rebuild/reopen the dev container.
4. Inside the container, import your private key once (this is the step that makes signing work):
	- `gpg --import /path/to/your-secret-key.asc`
    - confirm it is present: `gpg --list-secret-keys --keyid-format long`
5. Verify signing:
	- `git commit --allow-empty -m "test: signed commit"`
	- `git --no-pager log -1 --pretty=format:'%h %G? %GK %s'` (expect `G`)

Notes:

- The private key is imported into the container keyring (the persistent `micro-otter-gnupg` volume), so it survives container rebuilds and only needs to be imported once.
- To export your secret key from the host: `gpg --export-secret-keys <your-long-key-id> > /tmp/mykey.asc`, then import that file inside the container.
- If `GIT_USER_NAME` and `GIT_USER_EMAIL` are set on the host, post-create configures container `user.name`/`user.email` from those values.
- If `GIT_SIGNING_KEY_ID` is not set, the container still enables signing, but Git may fail to sign until `user.signingkey` is configured.
- Signing needs `GPG_TTY` to name the terminal you type in, or pinentry cannot draw the passphrase prompt. Post-create writes a guarded export into `~/.bashrc` **and** `~/.profile`, so both interactive shells and login shells (including the VS Code default profile) get it. A terminal opened before post-create last ran needs `export GPG_TTY=$(tty)` once, or reopen the terminal.

Inside the container, use the usual commands:

- `npm run dev:all`
- `npm run test:browser`
- `uv run micro-otter serve`

### Cline chat history persistence

Cline stores its conversation history inside the container under `/root/.cline` (sessions live in `/root/.cline/data/sessions/`). To keep that history across container rebuilds, the dev container bind-mounts the host folder `~/micro_otter/cline` (i.e. `${HOME}/micro_otter/cline`) onto `/root/.cline`.

- Create the host folder before your first rebuild so it is owned by your user: `mkdir -p ~/micro_otter/cline`.
- Rebuild/reopen the container after adding or removing this mount.

### Dev Container troubleshooting

- Rebuild container after config/dependency changes: `Dev Containers: Rebuild Container`.
- Full clean rebuild (if builds are stale/broken):
	- `docker ps -a`
	- `docker rm <container-id>`
	- `docker image prune -f`
	- reopen with `Dev Containers: Reopen in Container`
- Playwright browser mismatch errors: run `npx playwright install` inside the container.
- Python/interpreter setup issues: run `uv python install 3.12 && uv sync --all-groups --python 3.12` inside the container.
- `npm ci` failures after lockfile updates: run `npm ci` again inside the container after rebuild.
- Docker permission errors on Linux: ensure your user is in the `docker` group (or run Docker with sufficient permissions).
- Windows USB serial devices are not exposed into the Linux devcontainer automatically; forward the device first so it appears as `/dev/ttyUSB*` or `/dev/ttyACM*` in the container. See [docs/tools/windows-usb-forwarding.md](docs/tools/windows-usb-forwarding.md) for the general flow and [docs/tools/windows-cp210x-wsl-setup.md](docs/tools/windows-cp210x-wsl-setup.md) for the validated CP210x setup used with this repository.
- If post-create setup fails, rerun manually in container root: `bash .devcontainer/post-create.sh`.
- `gpg`/`git commit` fails with *Inappropriate ioctl for device*: pinentry has no terminal. Two causes, in order of likelihood:
	- `GPG_TTY` is empty in the shell you are typing in (`echo "GPG_TTY=[$GPG_TTY]"`); fix it with `export GPG_TTY=$(tty)` or open a new terminal, which picks the export up from `~/.profile`/`~/.bashrc`.
	- a `gpg-agent` started by a terminal-less process (editor task, script, background tool) is serving later sessions; run `gpgconf --kill gpg-agent` and retry. `gpg-connect-agent 'GETINFO std_startup_env' /bye` shows the environment the running agent inherited.

## Running the Node Editor

- Start the local editor server: `uv run micro-otter serve`
- Override bind address/port if needed: `uv run micro-otter serve --host 127.0.0.1 --port 9000`
- Open the printed URL (defaults to `http://localhost:8000` unless configured otherwise) in a modern browser.
- The editor hosts the node-graph UI, allowing you to design flows and export firmware bundles.

### Web development (TypeScript-ready workflow)

Preferred single-command startup:

- `npm run dev:all`

This runs frontend + backend concurrently in one terminal.

When working on frontend code (especially as files move from JS to TS), run two processes:

1. Frontend dev server (transpile + HMR): `npm run dev:web`
2. Python backend/assets server (`/api` + `/device`): `npm run dev:backend`

Then open the Vite URL (typically `http://localhost:5173`).

Why two processes:

- Vite handles module transforms/HMR (required for `.ts` in browser dev).
- Python server remains the source for backend-style routes and device assets.

`dev:web` also proxies the `/device` requests only the backend can synthesize — the merged
node-package index, a runtime manifest, and the files of an installed add-on — so installed add-ons
appear in the Firmware tab on `http://localhost:5173`. Everything else under `/device` still comes
from the source tree, and the fallback to those files keeps `dev:web` working without the backend.

Optional single command in two terminals:

- Windows PowerShell: `Start-Process pwsh -ArgumentList '-NoExit', '-Command', 'npm run dev:web'; npm run dev:backend`

## Testing (JS tests with TS source)

You can keep writing tests as `.test.js` files. They can test `.ts` source files directly.

- `npm run test:node` runs both Node test paths (`.test.js` and `.test.ts`).
- `npm run test:node:js` runs existing `.test.js` files using the `tsx` loader, so JS tests can import `.js` specifiers and still execute the matching `.ts` source modules.
- `npm run test:node:ts` runs `.test.ts` files (if present).
- `npm run test:vitest` runs Vitest suites (`.vitest.test.js`/`.vitest.test.ts`).
- `npm run test:browser` runs Playwright browser tests (`.browser.test.js`/`.browser.test.ts`).

No separate TypeScript precompile step is required for these test commands.

## Linting

One command covers every tree: `npm run lint:all`.

- `npm run lint` — ESLint 9 over the JavaScript (`src/**/*.js`, `tests/**/*.js`) and TypeScript
  (`src/**/*.ts`) trees, using the flat config in `eslint.config.js`.
- `npm run lint:python` — Ruff over host Python (`src/`, `tools/`, `tests/`).
  `npm run lint:python:fix` applies safe autofixes, `npm run format:python` formats.
- `npm run check:device-syntax` — compiles every file in `src/micro_otter/nodes/device/` with
  `mpy-cross` for `xtensa` and `xtensawin` (the two supported boards), writing bytecode nowhere.
  Exit `1` = device code is broken, exit `2` = the gate itself is (missing compiler, unsupported
  `-march`, missing device root).

`npm run check:ci-local` — and therefore the `pre-push` hook — runs all three gates, so a push
with lint errors or broken device code fails locally instead of in CI. Rules, the host-Python vs.
device-MicroPython split, and the deferred follow-ups are documented in the
[coding style guide](docs/dev/guides/coding-style-guide.md#tooling).

### Lint tooling troubleshooting

- `npm run lint` fails with *ESLint couldn't find a configuration file*: the checkout predates
  `eslint.config.js`. ESLint 9 does not read `.eslintrc.json`, so pull the current branch (or
  restore `eslint.config.js`) and rerun.
- `uv run ruff: command not found`: the virtualenv was synced without the dev dependency group.
  Run `uv sync --all-groups --python 3.12` inside the container and retry.
- `npm run check:device-syntax` exits `2`: the gate could not run at all. Check that `mpy-cross`
  exists (`/opt/micropython/mpy-cross/build/mpy-cross`, or pass `--mpy-cross`/`$MPY_CROSS`), that
  the `-march` value is one the pinned MicroPython supports, and that
  `src/micro_otter/nodes/device/` still holds the device sources.
- Python format-on-save does nothing: the Ruff extension is not installed in the window. The dev
  container provides it; in a plain VS Code install, add `charliermarsh.ruff`.

## Documentation

Two trees, one site:

- `user-docs/` is the published documentation site (`mkdocs.yml`, Material theme, `mike` versioning) —
  installation, the app views, the node reference and add-on authoring.
- `docs/` holds the developer, workflow and administrative markdown. It is not rendered;
  `user-docs/developer-docs.md` is the index into it.

```bash
uv sync --group docs          # mkdocs, mkdocs-material, mike
uv run mkdocs serve           # preview user-docs/ on http://127.0.0.1:8000
uv run mike serve             # versioned preview from the local gh-pages branch (/latest/)
npm run check:docs            # strict build gate, part of npm run check:ci-local
```

`uv run mike deploy --update-aliases <version> latest` publishes a version to the local `gh-pages`
branch; nothing is pushed from a development checkout.

## CLI reference

- List available device profiles: `uv run micro-otter info`
- Control logging: append `--log-level DEBUG` or adjust formatting with `--log-format "%(levelname)s %(message)s"` on any command.
- Default entrypoint for legacy usage (`uv run micro-otter`) now maps to the Typer-powered CLI described above.

## Static Hosting

If you want to serve the editor from a plain web host, point the document root at `src/micro_otter/nodes/`. The top-level `index.html` pulls UI assets from the `html/` subfolder and loads device descriptors from `device/`, so exposing that directory as-is mirrors the development server’s layout.

## Defining Node Types

See [NODE_SYSTEM_README.md](NODE_SYSTEM_README.md) for details on the JSON schemas and JavaScript hooks that describe custom nodes, generators, and categories.

## MPY Runtime Tooling

For the end-to-end workflow to probe device compatibility values, compile runtime files to .mpy profiles, and deploy them to the device, see [docs/tools/mpy-runtime-workflow.md](docs/tools/mpy-runtime-workflow.md).

## Editor Usage

- Drag nodes from the palette into the canvas to represent sensors, actuators, logic blocks, or utility functions.
- Connect output ports to input ports to define data flow or control signals.
- Configure node properties in the inspector to map hardware pins, PWM ranges, timing, etc.
- Export or deploy the resulting MicroPython graph to your microcontroller using the provided deployment tools (e.g., via `uv run micro-otter` deployment options).

Happy hacking!

## Device Version Hook

- Run `git config core.hooksPath hooks` once per clone to let Git execute [hooks/commit-msg](hooks/commit-msg) during commits.
- The same hooks path also enables [hooks/pre-commit](hooks/pre-commit), which keeps commits fast by regenerating the runtime web metadata file and staging it automatically when needed:
	- `src/micro_otter/nodes/html/js/core/open-source-packages.generated.js` (runtime web OSS packages only)
- [hooks/pre-push](hooks/pre-push) runs strict pre-push validation via `npm run check:ci-local` before updates are pushed. That command runs the generated-file checks **and** the three lint gates (`npm run lint`, `npm run lint:python`, `npm run check:device-syntax`); see [Linting](#linting).
- The hook inspects staged changes under [src/micro_otter/nodes/device/runtime](src/micro_otter/nodes/device/runtime) (excluding each runtime's `manifest.json`) and bumps the matching runtime `manifest.json` version automatically so the bump lands in the same commit.
- Version segments follow commit prefixes: `feat` → minor, `fix|docs|chore|style|refactor|perf|test|build|ci|revert` → patch, and `!` or a `BREAKING CHANGE:` footer → major.
- Device commits without one of the prefixes above are rejected to ensure every firmware change records the expected semantic bump.
- After bumping/staging a runtime `manifest.json`, the hook aborts the commit with instructions to rerun your `git commit` command; the next attempt succeeds and now includes the staged version update.

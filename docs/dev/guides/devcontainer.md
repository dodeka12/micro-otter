# Development Container

The repository ships a complete VS Code dev container in
[.devcontainer/devcontainer.json](../../../.devcontainer/devcontainer.json). It installs Python 3.12
through `uv`, the Node.js dependencies, the pinned ESP-IDF / MicroPython toolchain under `/opt`, the
editor extensions the workspace settings rely on, and a persistent container GPG keyring.

## First start

1. Install Docker Desktop/Engine and the VS Code extension `Dev Containers`
   (`ms-vscode-remote.remote-containers`).
2. Open the repository in VS Code.
3. Run `Dev Containers: Reopen in Container` from the Command Palette.
4. Wait for the first build to finish (image pull + `uv sync` + `npm ci`).

`uv python install 3.12 && uv sync --all-groups --python 3.12` inside the container provisions or
repairs the interpreter and the host-side dependencies.

The container installs `charliermarsh.ruff`, `dbaeumer.vscode-eslint`, `esbenp.prettier-vscode`,
`ms-python.python`, `ms-python.vscode-pylance`, `ms-playwright.playwright` and `mhutchie.git-graph`,
so Python format-on-save, ESLint autofix and Prettier work in a fresh container without any manual
installation step.

## Development and published configuration

`.devcontainer/devcontainer.json` is the **development** configuration: it bind-mounts the
maintainer's public clone at `/workspaces/micro-otter`, which is how `ldev/tools/publish.mjs` reaches
`../micro-otter` from inside the container.

The published `micro-otter` repository receives a **portable variant** of that file instead:
`ldev/devcontainer/devcontainer.public.json`, identical except that the clone mount is gone. It is
declared in `ldev/tools/publish-config.json` and copied into place by `prepare` (see
[release sync §2](../../admin/release-sync.md#variants)). A public clone therefore mounts only its own
workspace plus the `${HOME}/micro_otter/{opt,cline}` host folders documented below, and every other
setting is shared. `tests/test_devcontainer_bootstrap.py` fails when the two files differ by anything
but that mount.

## USB serial access from Windows

Linux hosts see the board as `/dev/ttyUSB*` or `/dev/ttyACM*`; Windows needs one more hop:

1. Install `usbipd-win` on the Windows host.
2. Attach the device to WSL before using it from the container.
3. For the CP210x adapters used with this repository, run
   `./tools/attach-cp210x-to-wsl.ps1` from Windows PowerShell.
4. See [../../tools/windows-cp210x-wsl-setup.md](../../tools/windows-cp210x-wsl-setup.md) for the
   full setup and verification steps, and
   [../../tools/windows-usb-forwarding.md](../../tools/windows-usb-forwarding.md) for the general
   forwarding flow.

## Git commit signing (opt-in)

Commit and tag signing is **off by default** in the dev container: day-to-day commits are unsigned,
and only the publication commit, the release commit, and the `v*` tag must be signed. Enable signing
by setting `GIT_SIGNING_ENABLED=1` on the host before the container starts:

1. `export GIT_SIGNING_ENABLED=1` (persist it, for example:
   `echo 'export GIT_SIGNING_ENABLED=1' >> ~/.profile`).
2. Rebuild/reopen the dev container.

With `GIT_SIGNING_ENABLED=1`, post-create configures `gpg.program`, `gpg.format`,
`commit.gpgsign=true`, and `tag.gpgSign=true`, and keeps the keyring at `/root/.gnupg`, backed by
the `micro-otter-gnupg` volume. GPG runs entirely inside the container, so the private key is
imported once and survives rebuilds. The host-side key recipe (Windows/Gpg4win, GitHub trust, agent
caching) is in [../../general/git-gpg-signing.md](../../general/git-gpg-signing.md).

Signing-key and identity setup (read unconditionally by post-create):

1. On the host, export the signing key id so post-create configures `user.signingkey`:
   - `export GIT_SIGNING_KEY_ID=<your-long-key-id>`
   - persist it, for example: `echo 'export GIT_SIGNING_KEY_ID=<your-long-key-id>' >> ~/.profile`
2. On the host, export the Git identity so post-create configures `user.name` and `user.email`:
   - `export GIT_USER_NAME="Your Name"`
   - `export GIT_USER_EMAIL="you@example.com"`
   - persist them the same way.
3. Inside the container, import the private key once:
   - `gpg --import /path/to/your-secret-key.asc`
   - confirm it is present: `gpg --list-secret-keys --keyid-format long`
4. Verify signing:
   - `git commit -S --allow-empty -m "test: signed commit"`
   - `git --no-pager log -1 --pretty=format:'%h %G? %GK %s'` (expect `G`)

Notes:

- To export the secret key from the host:
  `gpg --export-secret-keys <your-long-key-id> > /tmp/mykey.asc`, then import that file inside the
  container.
- Without `GIT_SIGNING_KEY_ID`, signing fails when `GIT_SIGNING_ENABLED=1` until `user.signingkey`
  is set.
- Signing needs `GPG_TTY` to name the terminal being typed in, or pinentry cannot draw the passphrase
  prompt. Post-create writes a guarded export into `~/.bashrc` **and** `~/.profile`, so interactive
  and login shells (including the VS Code default profile) both get it. A terminal opened before
  post-create last ran needs `export GPG_TTY=$(tty)` once, or must be reopened.

## Cline chat history persistence

Cline stores its conversation history inside the container under `/root/.cline` (sessions live in
`/root/.cline/data/sessions/`). The dev container bind-mounts the host folder `~/micro_otter/cline`
(i.e. `${HOME}/micro_otter/cline`) onto `/root/.cline` so the history survives rebuilds.

- Create the host folder before the first rebuild so it is owned by your user:
  `mkdir -p ~/micro_otter/cline`.
- Rebuild/reopen the container after adding or removing this mount.

## Preconfigured Git settings

`post-create.sh` also:

- points Git at the repository hooks (`git config core.hooksPath hooks`) and marks
  `hooks/commit-msg`, `hooks/pre-commit` and `hooks/pre-push` executable, so the
  [git-hooks.md](git-hooks.md) gate runs without manual setup;
- enables `commit.gpgSign` and `tag.gpgSign` **only when `GIT_SIGNING_ENABLED=1`**;
- bridges Git's credential helper to the GitHub CLI (`gh auth setup-git`) when `gh` is already
  authenticated.

## Everyday commands

- `npm run dev:all` — Vite plus the Python backend
- `npm run test:browser` — Playwright suite
- `uv run micro-otter serve` — production-style server on `_dist/webapp`
- `uv run micro-otter doctor` — which toolchain component is missing and how to fix it

## Troubleshooting

- Rebuild after config/dependency changes: `Dev Containers: Rebuild Container`.
- Full clean rebuild (stale or broken image): `docker ps -a`, `docker rm <container-id>`,
  `docker image prune -f`, then reopen with `Dev Containers: Reopen in Container`.
- Playwright browser mismatch: run `npx playwright install` inside the container.
- Python/interpreter problems: `uv python install 3.12 && uv sync --all-groups --python 3.12`.
- `npm ci` failures after lockfile updates: run `npm ci` again inside the container after a rebuild.
- Docker permission errors on Linux: ensure your user is in the `docker` group.
- USB devices missing: forward them first (see *USB serial access from Windows*); the general flow is
  [../../tools/windows-usb-forwarding.md](../../tools/windows-usb-forwarding.md).
- Post-create setup failed: rerun `bash .devcontainer/post-create.sh` from the container root.
- `gpg`/`git commit` fails with *Inappropriate ioctl for device*: pinentry has no terminal. Check
  `echo "GPG_TTY=[$GPG_TTY]"` and fix it with `export GPG_TTY=$(tty)` or a new terminal; if a
  `gpg-agent` started by a terminal-less process (editor task, script, background tool) is serving
  the session, run `gpgconf --kill gpg-agent` and retry. `gpg-connect-agent 'GETINFO
  std_startup_env' /bye` shows the environment the running agent inherited.

## Related documentation

- [build-and-deployment.md](build-and-deployment.md) — dev server, production build, hosting
- [coding-style-guide.md](coding-style-guide.md#tooling) — lint and format commands
- [updating-micropython-idf-toolchain.md](updating-micropython-idf-toolchain.md) — refreshing the
  pinned toolchain

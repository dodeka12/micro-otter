# Configuration Reference

How Micro-Otter finds its workspace, toolchain, firmware, build, and state locations, and how the
CLI reports them. One resolver — [`src/micro_otter/config.py`](../../../src/micro_otter/config.py) —
answers every question; no other module hardcodes a system path.

## Why one resolver

Inside the devcontainer everything lives under `/opt` (`/opt/micropython`, `/opt/esp-idf`,
`/opt/micro_otter/firmware`) plus a `/usr/local/bin/idf.py` shim. On a developer machine none of that
exists, so every hardcoded path was a second, silently wrong source of truth. `micro_otter.config`
replaces them with a single resolution chain: the CLI, the local server, the compile pipeline, the
device syntax gate, and `micro-otter doctor` all read the same `Config` object.

`/opt` did not disappear — it is now *one layer* of the platform defaults (see below), so the
devcontainer keeps working with zero configuration while a plain host works without it.

`addons_dir` is the one path that is deliberately *not* toolchain-derived: installed third-party node
packages are per-user data, so it lives at `<home>/addons` and is never probed under `/opt`. See
[node-package-addons.md](../nodes/node-package-addons.md) for what is installed there.

## Precedence

Highest wins:

```text
CLI flag  >  environment variable  >  micro-otter.toml  >  platform default
```

The `/opt` discovery rule lives **inside** the platform-default layer only. It is evaluated while the
defaults are built, so it can never override a CLI flag, an environment variable, or a TOML value. The
derived toolchain paths (`micropython_root`, `idf_path`, `idf_tools_path`) follow `toolchain_dir`
*unless* they are set explicitly, which is what makes `MICRO_OTTER_TOOLCHAIN_DIR` relocation work.

## Configuration file discovery

| Order | Source | Notes |
|---|--------|-------|
| 1 | `--config PATH` | Must exist, otherwise `ConfigError`. |
| 2 | `MICRO_OTTER_CONFIG` | Must exist, otherwise `ConfigError`. |
| 3 | `./micro-otter.toml` | Implicit, relative to the working directory. |
| 4 | `~/.micro-otter/micro-otter.toml` | Implicit, per-user. |

A missing implicit file is **not** an error — the platform defaults apply. An unparsable file, an
unknown table, or an unknown key raises `ConfigError` with an actionable `hint`, which the CLI prints
and reports as exit code `2`.

The repository ships a fully commented [`micro-otter.toml`](../../../micro-otter.toml) example; every
key is commented out, so running commands inside the checkout keeps the default behaviour.

## TOML schema

Each key maps one-to-one onto an accessor in `Config`, and onto the environment variable listed next
to it.

### `[paths]`

| Key | Type | Default | Environment variable |
|-----|------|---------|----------------------|
| `home` | path | `~/.micro-otter` | `MICRO_OTTER_HOME` |
| `workspace` | path | nearest ancestor with `pyproject.toml` + `src/micro_otter` | `MICRO_OTTER_WORKSPACE` |
| `toolchain_dir` | path | `<home>/toolchain` | `MICRO_OTTER_TOOLCHAIN_DIR` |
| `firmware_dir` | path | `/opt/micro_otter/firmware`, else `<home>/firmware` | `MICRO_OTTER_FIRMWARE_DIR` |
| `build_dir` | path | `<home>/build` | `MICRO_OTTER_BUILD_DIR` |
| `addons_dir` | path | `<home>/addons` | `MICRO_OTTER_ADDONS_DIR` |
| `micropython_root` | path | `/opt/micropython`, else `<toolchain_dir>/micropython` | `MICRO_OTTER_MICROPYTHON_ROOT`, `MICROPYTHON_ROOT` |
| `idf_path` | path | `/opt/esp-idf`, else `<toolchain_dir>/esp-idf` | `MICRO_OTTER_IDF_PATH`, `IDF_PATH` |
| `idf_tools_path` | path | `/opt/.espressif`, else `<toolchain_dir>/.espressif` | `MICRO_OTTER_IDF_TOOLS_PATH`, `IDF_TOOLS_PATH` |

Relative values are resolved against the directory holding the TOML file (or the working directory
for environment values); `~` and `$VAR`/`${VAR}` are expanded.

### `[build]`

| Key | Type | Default | Environment variable |
|-----|------|---------|----------------------|
| `backend` | string | `auto` | `MICRO_OTTER_BUILD_BACKEND` |
| `flash_backend` | string | `auto` | `MICRO_OTTER_FLASH_BACKEND` |
| `enable_compile` | bool | `true` | `MICRO_OTTER_ENABLE_COMPILE` |
| `enable_deploy` | bool | `true` | `MICRO_OTTER_ENABLE_DEPLOY` |
| `max_jobs` | int ≥ 1 | `1` | `MICRO_OTTER_MAX_BUILD_JOBS` |
| `timeout_seconds` | int ≥ 1 | `3600` | `MICRO_OTTER_BUILD_TIMEOUT` |

`enable_compile` / `enable_deploy` shape the **interactive** `micro-otter firmware` menu and the
`features` list of `GET /api/server-capabilities` (see
[websocket-serial-bridge.md](../device-communication/websocket-serial-bridge.md#server-capabilities)).
They never disable the explicit `compile-runtime` / `deploy-runtime` commands, they are never
consulted to decide whether a job already under way may continue, and they never gate the
collection-deploy node-package source upload. The `host` key also drives the `local-file-access`
feature: it is advertised only while `host` is a loopback bind, because it lets a browser enumerate
this machine's filesystem.

### `[server]`

| Key | Type | Default | Environment variable |
|-----|------|---------|----------------------|
| `host` | string | `127.0.0.1` | `MICRO_OTTER_HOST` |
| `port` | int 1–65535 | `8000` | `MICRO_OTTER_PORT` |
| `open_browser` | bool | `false` | `MICRO_OTTER_OPEN_BROWSER` |

Boolean values accept `1/0`, `true/false`, `yes/no`, `on/off`; an empty environment value counts as
"unset" so a cleared shell variable falls back to the next layer.

## Platform defaults

`<home>` is `MICRO_OTTER_HOME` or `~/.micro-otter`. The `/opt/...` cells apply **only** while
`toolchain_dir` is still the platform default *and* that directory exists; set
`MICRO_OTTER_TOOLCHAIN_DIR` and every derived path moves inside it instead.

| Path | Linux / devcontainer | Windows | macOS |
|------|----------------------|---------|-------|
| home | `~/.micro-otter` | `%USERPROFILE%\.micro-otter` | `~/.micro-otter` |
| toolchain | `<home>/toolchain` (`/opt/micropython`, `/opt/esp-idf`, `/opt/.espressif` probed) | `<home>/toolchain` | `<home>/toolchain` |
| firmware | `/opt/micro_otter/firmware`, else `<home>/firmware` | `<home>/firmware` | `<home>/firmware` |
| build | `<home>/build` | `<home>/build` | `<home>/build` |
| addons | `<home>/addons` | `<home>/addons` | `<home>/addons` |
| state | `$XDG_STATE_HOME/micro-otter`, else `~/.local/state/micro-otter` | `%LOCALAPPDATA%\micro-otter` | `~/Library/Application Support/micro-otter` |

Resolving configuration is read-only: it never creates a directory, downloads anything, or touches the
network.

## State directory

The interactive firmware menu stores its `state.json` (remembered board, port, action, flash options)
at the platform state location:

1. `MICRO_OTTER_STATE_DIR` when set (the file is `<dir>/state.json`);
2. `$XDG_STATE_HOME/micro-otter` on Linux;
3. `%LOCALAPPDATA%\micro-otter` on Windows;
4. `~/Library/Application Support/micro-otter` on macOS;
5. `~/.local/state/micro-otter` as the Linux fallback.

An existing `~/.config/micro-otter/state.json` (or `$XDG_CONFIG_HOME/micro-otter/state.json`) is read
**once** when the resolved file does not exist yet. The legacy file is never written or deleted, so the
migration loses no data and can be reverted by deleting the new file.

## Commands

Every command below accepts `--config PATH` and honours the `MICRO_OTTER_*` variables. Shared exit-code
contract: `0` healthy, `1` a missing/broken component or a failed check, `2` a configuration error
(printed to stderr with its `hint`).

### `micro-otter toolchain status`

```bash
uv run micro-otter toolchain status            # Rich table + resolved-configuration panel
uv run micro-otter toolchain status --json     # machine-readable payload
```

Components, in display order: Python, Node.js, `mpy-cross`, ESP-IDF, esptool, pyserial, then one entry
per registered build backend and per registered flash backend. The panel names the resolved path and
the layer that won for each (`cli`, `env`, `toml`, or `default`).

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-07T10:10:23.690067+00:00",
  "ok": true,
  "config": {
    "workspace_root": "/workspaces/micro-otter",
    "toolchain_dir": "/home/me/.micro-otter/toolchain",
    "micropython_root": "/home/me/.micro-otter/toolchain/micropython",
    "firmware_dir": "/home/me/.micro-otter/firmware",
    "idf_py": "/workspaces/micro-otter/deploy/toolchain/esp-idf/idf.py",
    "config_path": "",
    "toolchain_dir_source": "default"
  },
  "components": [
    {
      "id": "mpy-cross",
      "label": "mpy-cross",
      "status": "missing",
      "version": null,
      "path": "/home/me/.micro-otter/toolchain/micropython/mpy-cross/build/mpy-cross",
      "hint": "run: micro-otter toolchain install"
    }
  ]
}
```

`--json-output` is an alias for `--json` and produces the identical payload.

### `micro-otter toolchain install`

```bash
uv run micro-otter toolchain install --dry-run --dir /tmp/tc
# MICRO_OTTER_TOOLCHAIN_DIR=/tmp/tc bash deploy/toolchain/bootstrap.sh
# (dry run: nothing was executed)

uv run micro-otter toolchain install --backend esp-idf
```

Provisioning is delegated to `deploy/toolchain/bootstrap.sh`; the command only resolves the workspace
and toolchain directory, then hands the child the environment from `Config.toolchain_env()`
(`MICRO_OTTER_TOOLCHAIN_DIR`, `IDF_PATH`, `IDF_TOOLS_PATH`, `MICROPYTHON_ROOT`, plus the launcher
directory on `PATH`). `--backend` and `--dir` override the child environment only — `os.environ` is
never mutated. The exit code is the bootstrap script's, or `2` for a configuration error.

### `micro-otter doctor`

```bash
uv run micro-otter doctor              # checks table + verdict
uv run micro-otter doctor --json       # schemaVersion 1 payload
uv run micro-otter doctor --strict     # warnings also fail the run
```

Checks: interpreter version (≥ 3.12), workspace layout (`pyproject.toml` + `src/micro_otter`), every
toolchain component, writability of the firmware publish and state directories, which configuration
file won, and whether the container-wide `/opt` layout is in use. The payload nests the
`toolchain status` payload under `toolchain`.

### `micro-otter serve`

```bash
uv run micro-otter serve                          # 127.0.0.1:8000
uv run micro-otter serve --host 0.0.0.0           # warns while compile/deploy are enabled
uv run micro-otter serve --port 9000 --open-browser
```

The bind address, port, and browser launch come from `[server]` in `micro-otter.toml`, the
`MICRO_OTTER_HOST` / `MICRO_OTTER_PORT` / `MICRO_OTTER_OPEN_BROWSER` variables, or the platform
defaults; `--host`, `--port`, and `--open-browser/--no-open-browser` override them. Serving on a
non-loopback address prints a warning (never an error) while `enable_compile` or `enable_deploy` is
true, because those endpoints can build and flash firmware.

## Devcontainer parity

The devcontainer keeps working with **zero** configuration: `/opt/micropython`, `/opt/esp-idf`,
`/opt/.espressif`, and `/opt/micro_otter/firmware` exist, so the platform-default layer probes them and
every resolved path matches the pre-resolver behaviour. `deploy/toolchain/esp-idf/idf.py` is linked
into `/usr/local/bin` by the image, and `Config.idf_py` resolves the repository copy either way.

To opt out inside the container:

- `MICRO_OTTER_TOOLCHAIN_DIR=~/micro_otter/opt` (or `[paths] toolchain_dir`) moves the whole toolchain
  to a user-writable directory and stops the `/opt` probes;
- `host = "0.0.0.0"` in `[server]` (or `--host 0.0.0.0`) makes the editor reachable through a
  port-forward or proxy — expect the exposure warning while compile/deploy are enabled.

Run `uv run micro-otter doctor` inside the container to confirm which layer supplied each path.

## Related

- [Deploy layout](deploy-layout.md) — `deploy/` ownership, the toolchain pins, and the `idf.py` launcher.
- [Build backend contract](../firmware-compile/build-backend-contract.md) — protocol, registry, and the
  child environment built by `Config.toolchain_env()`.
- [Build and deployment guide](../guides/build-and-deployment.md) — the supported setup path.
- [WebSocket serial bridge](../device-communication/websocket-serial-bridge.md) — serial-port discovery
  and the `/serial` protocol.

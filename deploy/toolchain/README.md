# `deploy/toolchain/` — Backend Toolchain Contract

Owner: **M1**. This directory installs the host toolchain (ESP-IDF, MicroPython, `mpy-cross`) that
compiles firmware, and holds the one shared pin source.

## Layout

```text
deploy/toolchain/
├── versions.env          # canonical pins shared by every backend
├── bootstrap.sh          # dispatcher: backend selection + install
├── doctor.sh             # dispatcher: generic host checks + optional backend hook
└── <backend>/            # one directory per build backend
    ├── bootstrap.sh      # required
    ├── doctor.sh         # optional
    ├── versions.env      # optional, overrides the shared pins for this backend
    └── idf.py            # launches the backend toolchain (ESP-IDF)
```

`esp-idf/idf.py` is the repository's only `idf.py` launcher: `.devcontainer/link-idf-launcher.sh`
links it onto the container `PATH` instead of embedding a second copy, and
`micro_otter.config.Config.idf_py` / `Config.toolchain_env()` are how the package and the CLI resolve
it. See [the deploy layout](../../docs/dev/deployment/deploy-layout.md#the-idfpy-launcher).

## Dispatcher variables

| Variable | Default | Consumed by |
| --- | --- | --- |
| `MICRO_OTTER_BUILD_BACKEND` | `esp-idf` | `bootstrap.sh`, `doctor.sh` |
| `MICRO_OTTER_TOOLCHAIN_DIR` | `/opt` | `esp-idf/bootstrap.sh` (install root) |
| `IDF_PATH` | `${MICRO_OTTER_TOOLCHAIN_DIR}/esp-idf` | `esp-idf/bootstrap.sh` |
| `IDF_TOOLS_PATH` | `${MICRO_OTTER_TOOLCHAIN_DIR}/.espressif` | `esp-idf/bootstrap.sh` |
| `MICROPYTHON_ROOT` | `${MICRO_OTTER_TOOLCHAIN_DIR}/micropython` | `esp-idf/bootstrap.sh`, build preflight |

`MICRO_OTTER_BUILD_BACKEND` selects the toolchain, not the Python build backend class; the two are
kept aligned by convention so `esp-idf` names the same toolchain in both places.

## Rules

1. **One directory per build backend.** A backend that needs its own clone/install steps gets
   `deploy/toolchain/<id>/bootstrap.sh`. There is no second install path anywhere in the repo.
2. **`bootstrap.sh` is required; `doctor.sh` and `versions.env` are optional.** The doctor
   dispatcher runs the generic host checks and then executes the backend hook when it exists and is
   executable; otherwise it reports that the backend has no hook and exits successfully.
3. **Pins stay in `versions.env`.** The dispatcher and every backend bootstrap apply pins only when
   the variable is not already set, so an explicit environment override (CI, containers, a one-off
   debug session) always wins. The backend `versions.env` is applied before the shared file, so a
   backend pin wins over the shared pin for that backend only.
4. **The dispatcher, the CLI, and the compile image never hardcode a backend's install paths.**
   They call `deploy/toolchain/bootstrap.sh` and read the derived locations from
   `print_toolchain_config()` (or the environment) instead. The `/opt` layout is a default, not an
   assumption: `MICRO_OTTER_TOOLCHAIN_DIR` and the per-path overrides relocate everything.
5. **Unknown backends fail loudly.** A missing backend directory or bootstrap script prints the
   requested id, the expected path, and the available backend directories, then exits non-zero. The
   dispatcher never falls back to another backend silently.
6. **Ids are `[A-Za-z0-9._-]+`.** The dispatcher validates the id before building a path, so a
   malformed value cannot escape this directory.

## Usage

```bash
# Install or refresh the pinned toolchain (backend defaults to esp-idf)
bash deploy/toolchain/bootstrap.sh

# Report host prerequisites
bash deploy/toolchain/doctor.sh

# Relocate the install root
MICRO_OTTER_TOOLCHAIN_DIR=~/micro_otter/opt bash deploy/toolchain/bootstrap.sh
```

Additional arguments are forwarded to the selected backend's `bootstrap.sh` unchanged.

### When to use which entry point

| Entry point | Scope | Use when |
| --- | --- | --- |
| `bash deploy/toolchain/doctor.sh` | Host prerequisites only (`bash`, `git`, `make`, `python3`) plus the backend hook. No config resolution. | Diagnosing a bare machine before any toolchain exists, or inside the devcontainer image build. |
| `micro-otter doctor` | Config-aware superset: interpreter, workspace layout, every toolchain component, writable firmware/state directories, the `micro-otter.toml` that won, and the container-vs-user layout. | Everyday "is anything broken?" checks, `--json` for scripts, `--strict` for CI. |
| `bash deploy/toolchain/bootstrap.sh` | Installs or refreshes the pinned toolchain in `MICRO_OTTER_TOOLCHAIN_DIR`. | Called by the devcontainer `postCreateCommand` and by `micro-otter toolchain install`. |
| `micro-otter toolchain install` | Config-aware wrapper over `bootstrap.sh`: resolves the workspace and toolchain directory, builds the child environment from `Config.toolchain_env()`, and supports `--backend`, `--dir`, `--dry-run`, `--force`. | Host installs, relocation, and `--dry-run` previews. |

`.devcontainer/devcontainer.json` runs `bash deploy/toolchain/bootstrap.sh` in its
`postCreateCommand`; `.devcontainer/post-create.sh` continues to own Python/Node/git setup and does
not install toolchains.

## Related

- [Update procedure](../../docs/dev/guides/updating-micropython-idf-toolchain.md)
- [Deploy layout](../../docs/dev/deployment/deploy-layout.md)
- [Build-backend contract](../../docs/dev/firmware-compile/build-backend-contract.md)

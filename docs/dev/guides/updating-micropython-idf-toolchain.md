# Updating the MicroPython and ESP-IDF Toolchain

Use this guide when you need to bump the MicroPython (or ESP-IDF) version used to
build Micro-Otter firmware. It covers how to discover the latest upstream versions,
how to find the matching ESP-IDF requirement, how to update the repository pins,
and how to refresh the running devcontainer.

## Why This Is Required

The devcontainer does not install MicroPython or ESP-IDF from a package manager.
Both are cloned from source at pinned Git tags and compiled at container build
time:

1. `deploy/toolchain/versions.env` pins the versions; `.devcontainer/Dockerfile`
   mirrors them as build-time defaults.
2. `.devcontainer/devcontainer.json` runs `deploy/toolchain/bootstrap.sh` via
   `postCreateCommand`. The dispatcher selects the `esp-idf` backend, whose
   bootstrap clones the pinned tags into `MICRO_OTTER_TOOLCHAIN_DIR` (default
   `/opt`) and builds `mpy-cross`.
3. `.devcontainer/devcontainer.json` bind-mounts the host's `~/micro_otter/opt`
   directory to `/opt`, so the clones persist outside the container image.

This means updating a version is **not** a `git pull` inside the container: the
checkouts are shallow, detached at a tag, and populated with project-specific
untracked files. The correct flow is to change the pinned version and then
refresh the toolchain, as described below.

## Where the versions are pinned

`deploy/toolchain/versions.env` is the **canonical** pin source. Everything else mirrors it.

| File | Role | Variables |
| ---- | ---- | --------- |
| `deploy/toolchain/versions.env` | Canonical | `ESP_IDF_VERSION`, `MICROPYTHON_VERSION`, `MPY_CROSS_VERSION` |
| `.devcontainer/Dockerfile` | Mirror (Docker layer defaults) | `ESP_IDF_VERSION`, `MICROPYTHON_VERSION` |
| `deploy/toolchain/esp-idf/bootstrap.sh` | Consumer + locations (normally unchanged) | Reads `versions.env`; derives `IDF_PATH`, `IDF_TOOLS_PATH`, `MICROPYTHON_ROOT` from `MICRO_OTTER_TOOLCHAIN_DIR` |

`MPY_CROSS_VERSION` is pinned explicitly rather than derived, so shell scripts and
tests can compare it without variable interpolation. It must equal
`MICROPYTHON_VERSION` unless a build intentionally uses a different `mpy-cross`.

The Dockerfile `ENV` values exist only to keep Docker layer caching stable across
runs; they are not authoritative. `tests/test_toolchain_scripts.py` fails when the
Dockerfile drifts from `deploy/toolchain/versions.env`, so both must be updated
together. The Dockerfile deliberately does **not** set `IDF_PATH`,
`IDF_TOOLS_PATH`, or `MICROPYTHON_ROOT`: an image-level location would override
any relocation of `MICRO_OTTER_TOOLCHAIN_DIR`.

Backend-specific pins, if a backend ever needs its own, belong in
`deploy/toolchain/<backend>/versions.env`. The ESP-IDF bootstrap applies the
backend file before the shared file, so backend values win for that backend only.

## Toolchain locations and overrides

`deploy/toolchain/esp-idf/bootstrap.sh` never hardcodes `/opt`. It derives every
location from `MICRO_OTTER_TOOLCHAIN_DIR` and applies pins only when the variable
is unset, so an exported value always wins:

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `MICRO_OTTER_TOOLCHAIN_DIR` | `/opt` | Install root for every checkout |
| `IDF_PATH` | `${MICRO_OTTER_TOOLCHAIN_DIR}/esp-idf` | ESP-IDF checkout |
| `IDF_TOOLS_PATH` | `${MICRO_OTTER_TOOLCHAIN_DIR}/.espressif` | ESP-IDF tool installer output |
| `MICROPYTHON_ROOT` | `${MICRO_OTTER_TOOLCHAIN_DIR}/micropython` | MicroPython checkout |

To relocate the toolchain (for example into a workspace-local directory):

```bash
MICRO_OTTER_TOOLCHAIN_DIR="$HOME/toolchains/micro-otter" bash deploy/toolchain/bootstrap.sh
```

`deploy/toolchain/bootstrap.sh` is the only supported entry point. Do not call
`deploy/toolchain/esp-idf/bootstrap.sh` directly from tooling: the dispatcher owns
backend selection, and every consumer reads the derived paths from the
environment or from `print_toolchain_config()` instead of recomputing them.

## 1. Check the latest MicroPython version

The authoritative source is the upstream release list. Prefer the latest
**stable** release, not a `-preview` tag.

Using the GitHub API:

```bash
# Latest stable (non-prerelease) release
curl -s https://api.github.com/repos/micropython/micropython/releases/latest \
  | grep '"tag_name"'
```

Using Git without cloning:

```bash
# All stable release tags, newest last
git ls-remote --tags https://github.com/micropython/micropython.git \
  | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+$' \
  | sort -V \
  | tail -5
```

MicroPython tags follow the form `vX.Y.Z` (for example `v1.27.0`, `v1.29.0`).
Preview tags such as `v1.30.0-preview` are not stable releases and should be
avoided for pinned firmware builds.

## 2. Find the ESP-IDF version that MicroPython version needs

The ESP32 port documents its IDF compatibility in three places inside the
MicroPython tree. For a given tag, fetch them from GitHub raw:

```bash
TAG=v1.29.0

# Human-readable list: recommended + supported versions
curl -s "https://raw.githubusercontent.com/micropython/micropython/${TAG}/ports/esp32/README.md" \
  | grep -A2 "recommended version"

# Hard minimum enforced at build time by the IDF component manager
curl -s "https://raw.githubusercontent.com/micropython/micropython/${TAG}/ports/esp32/main/idf_component.yml" \
  | grep -A2 "idf:"

# CI-tested range (filename may vary between releases; verify the path)
curl -s "https://raw.githubusercontent.com/micropython/micropython/${TAG}/.github/workflows/port_esp32.yml" \
  | grep -E "IDF_OLDEST_VER|IDF_NEWEST_VER"
```

How to read these sources:

1. `README.md` gives the **recommended** version and the full list of **supported**
   versions. For MicroPython v1.29.0 the recommended version is `v5.5.2` and the
   supported list includes `v5.3`, `v5.4`, `v5.4.1`, `v5.4.2`, `v5.5.1`, and `v5.5.4`.
2. `main/idf_component.yml` declares the hard **minimum** (`idf: version: ">=5.3.0"`
   for v1.29.0). Builds below this minimum are rejected.
3. The CI workflow bounds the **tested** range (`IDF_OLDEST_VER`/`IDF_NEWEST_VER`).

Choose a version that satisfies all three: at or above the component-manager
minimum, and ideally one of the explicitly supported/tested versions.

## 3. Update the repository pins

Edit both files. Bump `MICROPYTHON_VERSION` to the new tag and, if you are also
moving ESP-IDF, `ESP_IDF_VERSION` to the chosen tag.

`deploy/toolchain/versions.env` (canonical):

```bash
ESP_IDF_VERSION=v5.5.2
MICROPYTHON_VERSION=v1.29.0
MPY_CROSS_VERSION=v1.29.0
```

`.devcontainer/Dockerfile` (mirror, test-enforced):

```dockerfile
ENV ESP_IDF_VERSION=v5.5.2
ENV MICROPYTHON_ROOT=/opt/micropython
ENV MICROPYTHON_VERSION=v1.29.0
```

Notes:

1. Keep the leading `v` on both tags.
2. Do not change `MICROPYTHON_ROOT` or `IDF_PATH` unless the build layout changes.
3. If you bump ESP-IDF, also consider the IDF toolchain marker in the bootstrap
   script: `idf_marker="${IDF_PATH}/.micro_otter_idf_tools_installed_${ESP_IDF_VERSION}"`.
   The marker is version-specific, so a new `ESP_IDF_VERSION` forces a fresh
   `install.sh` run automatically.

## 4. Update the container / toolchain

`deploy/toolchain/esp-idf/bootstrap.sh` is now **version-aware**: it compares the
checked-out tag of `${MICROPYTHON_ROOT}` and `${IDF_PATH}` against the pinned
`MICROPYTHON_VERSION` / `ESP_IDF_VERSION`, and rebuilds `mpy-cross` when its
reported version does not match `MPY_CROSS_VERSION`. Because `/opt` is a host bind
mount, a plain `Dev Containers: Rebuild Container` therefore self-heals the
toolchain after a version bump — no manual cleanup is normally required.

### Option A - rebuild the devcontainer (recommended)

Bump the pinned versions (`deploy/toolchain/versions.env` and the
`.devcontainer/Dockerfile` mirror), then in VS Code run
`Dev Containers: Rebuild Container`, or re-run the dispatcher manually:

```bash
bash deploy/toolchain/bootstrap.sh
```

`postCreateCommand` in `.devcontainer/devcontainer.json` is

```json
"postCreateCommand": "bash deploy/toolchain/bootstrap.sh && bash .devcontainer/post-create.sh"
```

so a rebuild refreshes the toolchain first and then re-runs the Python/Node/git
setup in `.devcontainer/post-create.sh`. `post-create.sh` never installs
toolchains itself.

The script re-clones a checkout whose tag differs from the pin, and rebuilds
`mpy-cross` when it is missing or reports a version other than
`MPY_CROSS_VERSION`. A checkout already at the pin is left untouched, so
refreshing without a rebuild is cheap:

```bash
# inside the running container, after editing a pin
bash deploy/toolchain/bootstrap.sh
```

The full contract - backend selection, optional backend hooks, and pin
precedence - is documented in
[`deploy/toolchain/README.md`](../../../deploy/toolchain/README.md).

#### Manual clean re-clone (fallback)

If the bind-mounted `/opt` has been left in an unusual state that the
version check does not cover, delete the stale clones on the host and rebuild:

```bash
rm -rf ~/micro_otter/opt/micropython            # MicroPython bump
rm -rf ~/micro_otter/opt/esp-idf                # only if bumping ESP-IDF
rm -rf ~/micro_otter/opt/.espressif             # only if bumping ESP-IDF toolchain
```

### Option B - update the existing clones in place

For MicroPython (a shallow, detached checkout), using the default
`MICRO_OTTER_TOOLCHAIN_DIR=/opt` (substitute your own root if you relocated it):

```bash
cd /opt/micropython
git fetch --unshallow origin
git fetch --tags origin
git checkout v1.29.0
git submodule update --init --recursive
rm -f mpy-cross/build/mpy-cross   # force a rebuild
make -C mpy-cross -j"$(nproc)"
```

For ESP-IDF (only if bumping that too):

```bash
cd /opt/esp-idf
git fetch --tags origin
git checkout v5.5.2
git submodule update --init --recursive
IDF_TOOLS_PATH=/opt/.espressif ./install.sh esp32
rm -f /opt/esp-idf/.micro_otter_idf_tools_installed_v5.5.1
touch /opt/esp-idf/.micro_otter_idf_tools_installed_v5.5.2
```

## 5. Verify the toolchain

```bash
# MicroPython version + emitted .mpy bytecode version
/opt/micropython/mpy-cross/build/mpy-cross --version

# ESP-IDF version
git -C /opt/esp-idf describe --tags
idf.py --version
```

Expected after a successful MicroPython bump: the `mpy-cross` output reports the
new MicroPython version. Watch for a CMake warning about changed component
lockfiles when building firmware with a different ESP-IDF version than upstream
shipped (`ports/esp32/lockfiles/`) - under `MICROPY_MAINTAINER_BUILD=1` this
becomes a hard failure.

## 6. Rebuild the firmware

Run the normal firmware build so the Micro-Otter modules are re-staged into the
MicroPython tree and `.mpy` artifacts are recompiled with the new `mpy-cross`:

```bash
mo cr --runtime-id general --board esp32 --clean-staging --clean-build
```

## Notes and caveats

1. `.mpy` bytecode compatibility: MicroPython v1.27.0 and v1.29.0 both emit
   `mpy v6.3` (`MPY_VERSION 6` / `MPY_SUB_VERSION 3` in `py/persistentcode.h`),
   so precompiled modules remain format-compatible. Still rebuild firmware since
   the C core changes between releases.
2. Generated metadata: `runtime_lineage.json`, `latest_versions.json`, and the
   `node_pkgs/*/manifest.json` files record the MicroPython version and
   `mpyCrossVersion`. These are regenerated by the build from the resolved
   `MICROPYTHON_VERSION`/`git describe` value - do not edit them by hand.
3. No version allowlist exists in the code: `resolve_micropython_version()` in
   `src/micro_otter/tools/firmware_compile/version_identity.py` accepts any valid
   semver from the env var or `git describe`.
4. Board catalog metadata: `src/micro_otter/nodes/device/firmware/boards.json`
   records `buildBackend` (`esp-idf`), `flashBackend` (`esptool`), `mcuFamily`, and
   an optional `buildEnv` per board. A toolchain bump that changes the backend or
   tool family must update those fields together with the pins above; the backend
   registries select the adapter from them. See
   [board-catalog-contract.md](../firmware-compile/board-catalog-contract.md).

## Related References

1. [build-and-deployment.md](build-and-deployment.md)
2. [../../tools/firmware-compile-reference.md](../../tools/firmware-compile-reference.md)
3. [../../tools/mpy-runtime-workflow.md](../../tools/mpy-runtime-workflow.md)
4. [deploy/toolchain/README.md](../../../deploy/toolchain/README.md) - backend toolchain contract
5. [deploy-layout.md](../deployment/deploy-layout.md) - `deploy/` tree ownership

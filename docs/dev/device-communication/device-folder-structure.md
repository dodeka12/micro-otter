# Device Folder Structure & Manifest Files

This document summarizes the current device/runtime folder layout used by the V2 editor and how the manifest chain resolves paths for runtimes, node packages, and targets.

## High-Level Layout

```
src/micro_otter/nodes/
├── html/                        # Web application (served under /html)
└── device/                      # Device assets (served under /device)
    ├── manifest.json            # Device-level manifest (root paths)
    ├── node_pkgs/               # Global/shared node packages
    │   ├── index.json           # Global package index (legacy loader support)
    │   ├── core/
    │   │   ├── manifest.json
    │   │   ├── node_definitions.json
    │   │   └── icons/
    │   └── stdmo/
    ├── tools/                   # Device utility modules
    │   ├── manifest.json        # Tools manifest (file list)
    │   ├── __init__.py
    │   ├── fs_utils.py          # Filesystem operations
    │   ├── wifi_manager.py      # WiFi connection management
    │   ├── runtime_info.py      # Runtime introspection
    │   ├── runtime_log.py       # Structured logging
    │   ├── set_wifi.py          # WiFi configuration CLI
    │   ├── wifi_probe.py        # WiFi status inspection
    │   └── wifi_diag.py         # WiFi diagnostics
    ├── runtime/                 # Runtime collection root
    │   ├── manifest.json         # Runtime collection manifest
    │   └── <runtime-id>/
    │       ├── manifest.json     # Runtime manifest (package lists, filters, filesystem)
    │       ├── node_pkgs/        # Runtime-local node packages (optional)
    │       ├── app/
    │       ├── libs/
    │       ├── html/
    │       └── main.py
    ├── targets/                 # Device target definitions
    │   ├── index.json
    │   └── <target-id>.json     # ⚠️ Always load via DeviceTargetInfo class
    └── graphs/                  # Sample graphs (optional)
```

## Manifest Chain

### 1) Device-Level Manifest

Path: device/manifest.json

Defines the root folders for device resources:

- `nodePackagesPath`: global package root (device/node_pkgs)
- `deviceTargetsPath`: device target root (device/targets)
- `runtimesPath`: runtime collection root (device/runtime)
- `graphsPath`: sample graphs root (device/graphs)

This is the single source of truth for device-level paths.

### 2) Runtime Collection Manifest

Path: device/runtime/manifest.json

Defines available runtimes by id and their paths relative to the collection root:

```
{
  "defaultRuntime": "general",
  "runtimes": { "general": "general" }
}
```

### 3) Runtime Manifest

Path: device/runtime/<runtime-id>/manifest.json

Defines runtime metadata and selects which node packages are available to the editor:

- `nodePackages.global`: list of package ids resolved through `device/node_pkgs/index.json` (id → manifest folder) against device/manifest.json → `nodePackagesPath`; the folder name may differ from the id, and multiple index entries may share an id to declare variants
- `nodePackages.local`: list of package ids resolved against device/runtime/<id>/node_pkgs
- `nodePackages.addons`: list of add-on package ids resolved through the add-ons index
- `nodePackages.optional`: list of package ids that default to unchecked in the firmware
  checklist. Cosmetic default only; ids not present in `global`/`local`/`addons` are ignored.
- `deviceTargets.include` / `deviceTargets.exclude`: filter which targets are allowed
- `mainLoopPath`: runtime entry point
- `filesystem`: runtime files to deploy to device

### 4) Node Package Manifest

Path: device/node_pkgs/<package-id>/manifest.json
(also supported in device/runtime/<id>/node_pkgs/<package-id>/manifest.json)

Global packages are registered in `device/node_pkgs/index.json`, which maps each logical package
id to its manifest folder (e.g. `{ "id": "core", "manifest": "core/manifest.json" }`, or
`{ "id": "audio", "manifest": "audio/manifest.viper.json" }` for a package whose only
implementation is a variant). A `manifest.json` *is* the default implementation; a
`manifest.<variant>.json` is that variant, so a package with no default implementation ships no
`manifest.json` at all.
The package id is the stable node-type namespace (`<id>.<type-id>`); the folder mirrors the id,
while the deployable module name (e.g. `otter_audio_viper`) carries the variant and may differ
from the id. Multiple index entries may share an id to declare
alternative implementations (variants); the resolver selects the satisfiable variant with the
highest manifest `precedence` (CNF `requiredCapabilities` first, then precedence).

Two module namespaces are reserved: `otter_*` for Micro-Otter built-ins and `moa_*` for installed
add-ons (base `moa_<id>` / variant `moa_<id>_<variant>`). An add-on may never declare an `otter_*`
root; the install validation enforces this so an add-on cannot overwrite a shipped module.

The firmware resolver (`package_resolver.py`) and the web UI (`package-resolver.ts` +
`DeviceRuntime`) resolve `nodePackages.global` ids through this index, so both sides share the same
id → folder and variant-selection semantics.

Defines how a package resolves its assets and node definitions:

- `assetsRoot`: base path for icons and other assets
- `nodeDefs`: path to node_definitions.json
- `generators`: JS modules that register code generators
- `capabilityChecks`: one JS validation module per package; it may export
  `registerCapabilityChecks` and/or `registerGraphRules`. A module that only creates
  `globalThis.NodeCapabilityChecks` is legacy — see
  [Node Validation Architecture](../nodes/node-validation-architecture.md).
- `mpAssets` / `mpModuleRoots`: MicroPython deployment assets
- `requiredPackages`: ids of other packages whose entire `mpAssets["*"]` set must ship whenever this
  package is in use (currently `webview` → `vars`)

`requiredPackages` expansion is transitive (a required package's own `requiredPackages` are followed)
and cycle-safe: each id is entered once and always with the wildcard asset key `*`, so a dependency's
package-wide assets ship even when the collection contains no node from that package. A missing or
unknown id is ignored.

The field is honoured in:

- `src/micro_otter/nodes/html/js/deployment/collection-deployment.ts` — package-library upload
  preparation (`_expandRequiredPackages`).
- `src/micro_otter/nodes/html/js/deployment/device-deployment.ts` — `_collectUsedNodePackageIds`,
  `_collectUsedNodePackageAssetKeys` (used by the mpy-availability probe), the embedded
  package-override preflight (`_computeEmbeddedOverridePlan`) and `validateNodePackages`.

`src/micro_otter/nodes/html/js/proc/transpiler.ts` still emits `assets.packages` for information
only; it does not perform dependency expansion.

### 5) Node Definitions

Path: device/node_pkgs/<package-id>/node_definitions.json

Defines node types and their UI metadata (title, info, icon, inputs/outputs, controls, etc.).

### 6) Target Configuration Files

Path: device/targets/<target-id>.json

Defines device hardware capabilities (pin configuration, peripheral support, etc.).

> **⚠️ CRITICAL: Always Use DeviceTargetInfo Class**
>
> Target JSON files must **NEVER** be used directly. Always load the JSON and immediately create a `DeviceTargetInfo` instance:
>
> ```ts
> // ✅ CORRECT
> const targetJson = await deviceConnection.readTextFile('/device/targets/active_target.json');
> const deviceTarget = new DeviceTargetInfo(JSON.parse(targetJson));
> // Use deviceTarget instance for all operations
> ```
>
> ```ts
> // ❌ WRONG
> const targetData = JSON.parse(targetJson);
> const pins = targetData.pinCapabilities; // Missing normalization!
> ```
>
> The `DeviceTargetInfo` class provides:
>
> - Field normalization and validation
> - Derived data structures (capabilityToPins)
> - Type-safe access methods
> - Legacy format compatibility

>
> See [Deployment System Architecture](../deployment/deployment-system-architecture.md) for complete documentation.
>
> Extended target fields — `pinCapabilities` now also supports `dac`, `touch`, `i2s`, `rtc`,
> `strapping`, `reserved`, `voltage`, `pullValuesOhm`, `digital.openDrain`, `adc.unit` /
> `adc.wifiConflict`, an open `peripherals` bag, a top-level `resources` block, and granular
> `capabilityToPins` keys. See
> [Target Capability Schema Reference](../nodes/target-capability-schema-reference.md).

### Deployed Active Target

`/device/targets/active_target.json` records the target the *device* was provisioned with. It has
exactly one writer: `DeviceDeployment._uploadTargetConfiguration`
([device-deployment.ts](../../../src/micro_otter/nodes/html/js/deployment/device-deployment.ts)).
Firmware bootstrap setup does not write it, so `/device/targets/` may legitimately not exist before
the first target selection — the app creates the directory when it uploads the target. The stored
payload is the resolved effective target plus the delivery header fields; a payload without pin
information is rejected by the reader and repaired through onboarding (see
[user-target-config-architecture.md](../core/user-target-config-architecture.md)).

## Tools Folder

Path: device/tools/

Provides Python utility modules deployed to devices alongside the runtime. See [Device Tools Reference](device-tools-reference.md) for complete API documentation.

### Purpose

- **Filesystem Operations**: `fs_utils.py` provides path normalization, directory creation, file operations, and filesystem wipes
- **WiFi Management**: `wifi_manager.py` handles station/AP modes, connection workflows, and status reporting
- **Runtime Introspection**: `runtime_info.py` detects MicroPython version and platform
- **Structured Logging**: `runtime_log.py` emits JSON logs with `[otter]` prefix for host parsing
- **WiFi Configuration**: `set_wifi.py`, `wifi_probe.py`, `wifi_diag.py` provide CLI utilities for device management

### Deployment

Tools are uploaded to the device during every runtime deployment using hash-based incremental updates:

1. Host calculates SHA-256 hashes for all tools files
2. Host loads centralized sync manifest from device (`/.micro-otter-sync-manifest`)
3. Host compares hashes and uploads only changed files
4. Host saves updated centralized sync manifest to device

**Performance**: First deployment uploads all files (~5 seconds), subsequent deployments only upload changed files.

### Manifest

Path: device/tools/manifest.json

```json
{
    "files": [
        "tools/__init__.py",
        "tools/wifi_manager.py",
        "tools/fs_utils.py",
        "tools/runtime_info.py",
        "tools/runtime_log.py",
        "tools/set_wifi.py",
        "tools/wifi_probe.py",
        "tools/wifi_diag.py"
    ]
}
```

**Note**: The centralized sync manifest (`/.micro-otter-sync-manifest`) is
auto-generated on device and not included in this manifest. This replaces the
older per-tools `tools/hashes.json` approach.

### Usage Examples

**WiFi Connection**:

```python
from tools.wifi_manager import load_wifi_settings, maybe_create_interface, connect_station
import uasyncio as asyncio

settings = load_wifi_settings()
sta_if = maybe_create_interface('sta')
ipconfig = await connect_station(sta_if, settings['ssid'], settings['password'])
```

**File Operations**:

```python
from tools.fs_utils import ensure_dirs, reset_file, append_base64_chunk

ensure_dirs('app/libs')
reset_file('app/config.json')
append_base64_chunk('app/data.bin', base64_chunk)
```

**Structured Logging**:

```python
from tools.runtime_log import log_startup, log_wifi_state, log_error

log_startup('init', version='1.0.0')
log_wifi_state('connected', ip='192.168.1.100')
log_error('Failed to connect', reason='timeout')
```

## Index Files

The editor supports index.json files for legacy and tooling workflows:

- device/node_pkgs/index.json → list of global packages and their manifest paths
- device/runtime/<id>/nodes/packages/index.json → runtime asset bundles (if present)
- device/targets/index.json → list of device targets

## URL Mapping (Dev Server)

The dev server exposes the device root at /device. Examples:

- /device/manifest.json
- /device/tools/manifest.json
- /device/tools/wifi_manager.py
- /device/runtime/manifest.json
- /device/runtime/general/manifest.json
- /device/node_pkgs/core/icons/input_24dp.svg

For UI assets, use /html (served from src/micro_otter/nodes/html).

## Runtime Versioning Hook

When using the repository commit hook (`git config core.hooksPath hooks`), staged changes inside
`src/micro_otter/nodes/device/runtime/<runtime-id>/` automatically bump that runtime's
`manifest.json` `version` field (excluding direct edits to the same `manifest.json`).

Semver bump type follows the Conventional Commit prefix:

- `feat` → minor
- `fix|docs|chore|style|refactor|perf|test|build|ci|revert` → patch
- `!` marker or `BREAKING CHANGE:` footer → major

## On-device First-Boot Layout

A firmware install leaves the user filesystem empty; the frozen runtime materializes the tree at
first boot, writing each path only when it is missing:

- `manifest.json`, `device.json`, `app/main_loop.py`
- `custom_view.json`
- `html/`, `locales/`

`/device/targets/active_target.json` is **not** part of first boot: firmware never writes target
content; the app writes it on target selection.

There is **no `/boot.py`** (that is MicroPython's frozen `_boot.py`) and **no `/main.py`** (the entry
point is the frozen `main` module). A device listing neither is correct, not broken. The full
payload, boot sequence, and verification recipe are in
[`firmware-runtime-payload-contract.md`](../firmware-compile/firmware-runtime-payload-contract.md).

## Related References

- build-and-deployment.md
- node-definition-reference.md
- deployment-access-control.md

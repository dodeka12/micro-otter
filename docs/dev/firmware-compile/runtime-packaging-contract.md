# Runtime Packaging Contract (Phase 1)

**Status:** Implemented Contract  
**Scope:** Firmware-embedded runtime packaging model for Micro-Otter

> See also the [Firmware Runtime Payload Contract](firmware-runtime-payload-contract.md) for the
> end-to-end payload — runtime modes, the frozen layout and relative-name invariant, the first-boot
> `/`, and the verification recipe. The frozen names below are **relative**: a `.py` freezes under its
> manifest path and a `.mpy` under the name `mpy-cross -s` embeds, because `tools/mpy-tool.py freeze`
> reads that name from the `.mpy` header.

## Purpose

This contract defines exactly which files are embedded into firmware for a selected runtime,
where they are placed in the MicroPython tree, and how embedded metadata merges with existing
dynamic upload metadata.

## Inputs

- Runtime index: `src/micro_otter/nodes/device/runtime/manifest.json`
- Runtime manifest: `src/micro_otter/nodes/device/runtime/<runtime-id>/manifest.json`
- Device tools manifest: `src/micro_otter/nodes/device/tools/manifest.json`
- Runtime-compatible node package manifests (`mpAssets`)
- Node package index: `src/micro_otter/nodes/device/node_pkgs/index.json`

## Node Package Resolution

Global package ids are resolved through `node_pkgs/index.json` by `package_resolver.py`. An index entry maps a logical package id to its manifest folder (e.g. `core` → `core/manifest.json`, or `audio` → `audio/manifest.viper.json` for a package whose only implementation is a variant), and multiple entries may share an id to declare alternative implementations (variants) of the same node set. When variants exist, the build selects the satisfiable variant with the highest manifest `precedence` — `requiredCapabilities` (CNF) is evaluated first, then precedence. `package_resolver.py` is the single source of truth shared by staging, version collection, and precompilation.

## Path Roots and Target Selection

- Default MicroPython root: `src/micropython/`
- Device target is selectable (for example `esp32`, `rp2`)
- Default modules destination is target-derived:
  - `ports/<target>/modules/`
- Optional explicit override for root/modules path is allowed for advanced use cases.

## Included File Groups

For v1 embedded payload generation, include:

1. Runtime filesystem files required for boot/runtime.
2. Tools files resolved from tools manifest.
3. All runtime-compatible node package `mpAssets`.

### Include Policy

- Baseline policy: include all compatible package `mpAssets`, even if the active collection does not use all packages.
- Future policy extension may introduce profile-based subset packaging.

## Canonical Path Mapping Rules

### Node Package Assets

- Canonical mapping for all package modules:
  - `libs/<pkg-name>/<module>`
- Mapping is source-agnostic:
  - Applies equally to embedded and dynamically uploaded files.

### Target Tree Layout Under `ports/<target>/modules/`

- `tools/` - embedded runtime tools payload
- `libs/` - runtime and package libraries (including `micro_otter_main.py`)
- `app/` - runtime app artifacts when applicable
- `otter/` - immutable embedded metadata files

## Runtime Bootstrap Contract

- Firmware startup entrypoint remains the frozen `main` module (a generated `main.py` shim).
- Startup logic lives in `otter_main.py` (frozen as `otter_main`).
- The generated `main.py` shim must:
  - import `otter_runtime.bootstrap_setup_startup` and `otter_main`
  - run the bootstrap setup trigger, then explicitly call `_micro_otter_main.run()`
- Import side effects are not used as startup mechanism.
- `_boot.py` is MicroPython's VFS mounter (frozen, not Micro-Otter); there is no user-space `/boot.py`
  and no `/main.py` on the device. See the
  [Firmware Runtime Payload Contract](firmware-runtime-payload-contract.md).

## Embedded Metadata Contract

## File Locations

- Immutable embedded metadata files are stored in `/otter/`:
  - `/otter/embedded_manifest.json`
  - `/otter/embedded_hashes.json`
- Root `manifest.json` remains reserved for mutable host-managed deployment/runtime state.

## Schema Proposal

### `/otter/embedded_manifest.json` (proposal)

```json
{
  "schemaVersion": 1,
  "runtime": {
    "mode": "embedded",
    "id": "general",
    "version": "1.11.0"
  },
  "build": {
    "profileId": "default",
    "target": "esp32",
    "sourceRevision": "optional"
  },
  "packages": {
    "included": [
      { "id": "pkg-1", "version": "1.0.0" }
    ],
    "listHash": "sha256:..."
  },
  "inventory": {
    "hashSchemaVersion": 1,
    "hashFile": "/otter/embedded_hashes.json",
    "selfHash": "sha256:..."
  }
}
```

### `/otter/embedded_hashes.json` (proposal)

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-04-17T00:00:00Z",
  "files": [
    {
      "path": "libs/example_pkg/example.py",
      "packageId": "example_pkg",
      "packageVersion": "1.2.3",
      "fileHash": "sha256:...",
      "fileKind": "py",
      "source": "embedded"
    },
    {
      "path": "libs/example_pkg/example.mpy",
      "packageId": "example_pkg",
      "packageVersion": "1.2.3",
      "fileHash": "sha256:...",
      "fileKind": "mpy",
      "source": "embedded"
    }
  ]
}
```

## Dynamic Overlay Merge Contract

This contract preserves current dynamic metadata behavior while adding immutable embedded baseline data.

### Inputs

- Embedded immutable inventory/hash tables in `/otter/`
- Existing mutable dynamic upload manifest/hash tables

### Effective Availability Rule

- Effective inventory is computed as:
  - `embedded baseline` overlaid by `dynamic entries`
- Collision precedence:
  - If canonical path exists in both, dynamic entry wins.

### Override Semantics

- Overrides are explicit and user-driven when writing to canonical runtime paths.
- Override events should be visible in deployment logs and metadata markers.

## Failure and Validation Expectations

Contract consumers should fail explicitly for:

- Missing runtime manifest for selected runtime id
- Malformed package manifest or invalid `mpAssets`
- Duplicate canonical output paths in embedded staging
- Invalid MicroPython root or unresolved target modules path

## Acceptance Mapping (Phase 1)

This document satisfies phase-1 contract deliverables for:

- Included file groups
- Mapping rules to MicroPython modules tree
- Manifest/schema extension proposal for embedded mode
- Immutable inventory/hash schema and merge contract with dynamic metadata

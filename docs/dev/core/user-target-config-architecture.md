# Derived Target Config Architecture

## Overview

Target configs — both **shipped** and **user** — may derive from a `baseTargetId` plus sparse
overrides. User target configs are runtime-independent hardware descriptors stored in IndexedDB and
merged into runtime target listings at the Workspace boundary; shipped targets may declare the same
shape directly in `device/targets/`.

This feature enables:

- Uploading hand-authored target configs (`.json` and `.jsonc`) from the workspace menu.
- Persisting user targets across sessions.
- Including user targets in runtime target selection without storing runtime linkage.
- Backing up and restoring user targets together with collections.

---

## Core Contracts

### Persisted Record Shape

`TargetConfigStore` persists records with these fields:

- `id` (string, unique key)
- `displayName` (string)
- `version` (`x.y.z`)
- `source` (`"user"`)
- `created` (human-readable date string)
- `baseTargetId` (string, optional — the shipped target this derived target builds on)
- `targetData` (the sparse override payload, merged onto the base)

Implementation: [target-config-store.ts](../../../src/micro_otter/nodes/html/js/data/target-config-store.ts)

### Validation Rules

- Payload must be compatible with `DeviceTargetInfo`.
- Metadata `id` must match payload id.
- `version` must match `x.y.z`.
- `created` must be a parseable human-readable date.
- Duplicate user IDs are rejected by default.
- `openPins` is rejected on user configs (`ERR_TARGET_OPEN_PINS`) — inherited from the base only.
- `baseTargetId`, when present, must name a shipped target (`ERR_TARGET_BASE_UNKNOWN`), must not be
  itself a user target (`ERR_TARGET_BASE_CHAINED`), and must not be `custom`.
- A payload carrying `metadata.isCustomTarget` is rejected (`ERR_TARGET_CUSTOM_DEPRECATED`) — the
  Custom target was removed in M4w.

### Merge Contract

A derived target is resolved by [mergeTargetPayload()](../../../src/micro_otter/nodes/html/js/data/target-resolution.ts):

- scalars replace;
- `pinCapabilities[pin]` merges per pin, `null` removes the pin;
- `resources` / `generalCapabilities` / `capabilityToPins` merge key-wise with the override winning;
- `metadata` merges key-wise with `notes` concatenated (base first);
- `openPins` is inheritable-only.

### Resolution Chain & Build Base

One [TargetResolver](../../../src/micro_otter/nodes/html/js/data/target-resolver.ts) walks the
`baseTargetId` chain (shipped **and** user hops) to an effective payload plus a terminal
`buildBaseId` — the id whose `compile_target_mappings.json` rule a firmware build actually uses.
Guards: unknown base (`ERR_TARGET_BASE_UNKNOWN`), cycle (`ERR_TARGET_CYCLE`), depth > 8
(`ERR_TARGET_CHAIN_LIMIT`), duplicate `openPins` (`ERR_TARGET_OPEN_PINS_OVERRIDE`). The same chain
is resolved server-side by `firmware_compile/target_resolution.py`, and an image records the base id
as `buildBaseTargetId` instead of enumerating every derived config in `allowedWebTargetIds`.

### Stored Target Payload and Single Writer

`/device/targets/active_target.json` has exactly one writer:
`DeviceDeployment._uploadTargetConfiguration`
([device-deployment.ts](../../../src/micro_otter/nodes/html/js/deployment/device-deployment.ts)).
Firmware bootstrap setup never writes target content, so the stored file can only differ from what
the app wrote when it was written by an older firmware/App combination. The app writes a *resolved
effective payload* — never a raw derived target file, which only carries `baseTargetId` and sparse
overrides.

The stored payload is the effective target content

- `pinCapabilities` (or `openPins` for the open-pin target),
- `resources`,
- `generalCapabilities`,
- `metadata`,

plus the four delivery header fields the writer normalises on top of it: `targetId`,
`displayName`, `description` and `configVersion`. The legacy `capabilities` key is **gone**: the
writer does not emit it, no device validator requires it, and no host path reads it. No
compatibility shim ships, because there are no public releases to stay compatible with.

### Completeness Predicate

`isCompleteActiveTargetPayload(payload)`
([target-payload.ts](../../../src/micro_otter/nodes/html/js/data/target-payload.ts)) is the one
completeness rule for a stored target:

- the payload is a plain object with a non-empty string `targetId`, **and**
- it has a non-empty `pinCapabilities` object **or** an `openPins` range with finite `min`/`max`
  and `min <= max`.

Two call sites use it:

- `DeviceDeployment._uploadTargetConfiguration` — write guard. It refuses an incomplete payload and
  throws an error with `code = 'target-incomplete'` (localised
  `deployment.errors.targetIncomplete`) before anything is written.
- `DeviceConnection.loadDeviceInfo` — read guard. It does not construct `DeviceTargetInfo` for an
  incomplete payload; the deployment layer reports the device as needing a target and the
  onboarding dialog repairs it.

The false case is the legacy firmware bootstrap skeleton: `targetId`, `displayName`, `description`,
`configVersion` and `capabilities`, with no pin information at all. Adopting it silently emptied
`DeviceTargetInfo.capabilityToPins` and made the derived `irq` pin capability disappear.

### Image-Family Rule

A target may only be stored on a device whose flashed image can run it. The rule lives inside the
writer (`_assertTargetCompatibleWithImage`, called from `_uploadTargetConfiguration`) and compares
the target's terminal build base id against the image's `buildBaseTargetId` (`allowedWebTargetIds`
remains a legacy fallback), using `isTargetCompatibleWithImage`. There is no device-side check:
MicroPython cannot resolve derived targets, so the rule must be enforced where the merge happens.

`DeviceTargetInfo.capabilityToPins` is derived from the per-pin `pinCapabilities` records
([device-target.ts](../../../src/micro_otter/nodes/html/js/data/device-target.ts)), not read from
the payload, which is why removing the payload's `capabilities` key changes no host behaviour.

### Collision Policy

Runtime-shipped target IDs are read-only baseline IDs. User target configs cannot reuse runtime IDs.

Enforcement is in Workspace API (not in UI): [workspace.ts](../../../src/micro_otter/nodes/html/js/core/workspace.ts)

---

## Data Flow

### Upload Flow

1. User selects **Upload Target Config** in workspace menu.
2. WorkspaceView reads file as text and parses JSONC (supports `//`, `/* */`, trailing commas).
3. Parsed content is normalized to target-config input shape.
4. `Workspace.saveUserTargetConfig()` validates and persists via `TargetConfigStore`.

Implementation: [workspace-view.ts](../../../src/micro_otter/nodes/html/js/views/workspace-view.ts)

### Target Listing Flow

1. Runtime targets are loaded from runtime manifests.
2. Workspace maintains cached user target configs and syncs them into the runtime
   (`DeviceRuntime.setUserTargets()`) and the collection manager.
3. `DeviceRuntime.listOnboardingTargets()` returns shipped targets plus resolved derived targets
   (deduplicated by id); `CollectionManager.listTargetsForRuntime(runtimeId)` exposes the same
   merged list and filters it by `allowedWebTargetIds` when the connected board's firmware records
   them.

Implementations:

- [workspace.ts](../../../src/micro_otter/nodes/html/js/core/workspace.ts)
- [collection-manager.ts](../../../src/micro_otter/nodes/html/js/data/collection-manager.ts)
- [device-runtime.ts](../../../src/micro_otter/nodes/html/js/data/device-runtime.ts)

---

## Backup and Restore

### Backup Envelope

Database backup format now supports:

- `version: "1.1"`
- `collections` (existing)
- `targetConfigs: { count, items }`

Restore validation remains backward-compatible with `1.0` backups (no `targetConfigs` section).

### Restore Modes

`DBRestoreDialogView` applies the same mode semantics used for collections:

- `replace`
- `merge`
- `manual`

Target-config version conflict comparison uses simple semantic `x.y.z` comparison.

Implementations:

- [workspace-view.ts](../../../src/micro_otter/nodes/html/js/views/workspace-view.ts)
- [db-restore-dialog-view.ts](../../../src/micro_otter/nodes/html/js/views/db-restore-dialog-view.ts)
- [manual-collection-selection-dialog-view.ts](../../../src/micro_otter/nodes/html/js/views/manual-collection-selection-dialog-view.ts)

---

## Workspace Menu and i18n

New workspace menu entries:

- `menu.item.uploadTargetConfig`
- `menu.item.downloadTargetConfigTemplate`

Locale files:

- [en.json](../../../src/micro_otter/nodes/html/locales/en.json)
- [de.json](../../../src/micro_otter/nodes/html/locales/de.json)

---

## Tests

Primary coverage:

- Store validation and persistence: [target-config-store.test.js](../../../tests/data/target-config-store.test.js)
- Workspace API and collision policy: [workspace-target-config-api.test.js](../../../tests/core/workspace-target-config-api.test.js)
- Restore parity and manual mode: [db-restore-dialog-view.test.js](../../../tests/views/db-restore-dialog-view.test.js), [manual-collection-selection-dialog-view.test.js](../../../tests/views/manual-collection-selection-dialog-view.test.js)
- Workspace menu routing + JSONC parser behavior: [workspace-view-target-config.test.js](../../../tests/views/workspace-view-target-config.test.js)
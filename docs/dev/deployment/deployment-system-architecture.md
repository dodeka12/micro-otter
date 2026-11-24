# Deployment System Architecture

**Last Updated**: February 10, 2026  
**Status**: Implemented (Phases 1-3 Complete)

## Overview

The deployment system manages the complete lifecycle of deploying MicroPython runtime environments and user node graph collections to ESP32 devices. Built on WebSerial communication, it provides a modular, event-driven architecture with automatic device detection, progress tracking, and smart file synchronization.

**Core Design Principles:**

- **Delegation Pattern**: Main orchestrator delegates to specialized deployment classes
- **Event-Driven**: EventTarget-based communication for UI integration
- **Progress Tracking**: Integrated with ProgressEventBus for consistent feedback
- **Auto-Detection**: Automatic MicroPython detection and device info loading on connect
- **Smart Sync**: Hash-based file comparison to minimize unnecessary transfers
- **Error Recovery**: Graceful handling of connection failures and partial deployments

---

## Architecture Overview

### Three-Tier Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ UI Layer                                                      │
│  └─ DeviceDeploymentView                                     │
│     ├─ Device status display                                 │
│     ├─ Install Runtime button                                │
│     ├─ Deploy Collection button                              │
│     ├─ Progress indicators                                   │
│     └─ Error handling                                        │
└────────────────────┬─────────────────────────────────────────┘
                     │ Events: device-state-changed,
                     │         device-info-loaded,
                     │         device-info-load-error
┌────────────────────▼─────────────────────────────────────────┐
│ Orchestration Layer                                           │
│  └─ DeviceDeployment (Main Coordinator)                      │
│     ├─ Device state management                               │
│     ├─ Connection event handling                             │
│     ├─ MicroPython auto-detection                            │
│     ├─ Device info auto-loading                              │
│     ├─ Progress event coordination                           │
│     └─ Delegation to specialists:                            │
│        ├─ RuntimeDeployment (Phase 2)                        │
│        └─ CollectionDeployment (Phase 3)                     │
└────────────────────┬─────────────────────────────────────────┘
                     │
         ┌───────────┴──────────┐
         │                       │
┌────────▼──────┐   ┌───────────▼──────┐
│ Phase 2       │   │ Phase 3           │
│ Runtime       │   │ Collection        │
│ Deployment    │   │ Deployment        │
│               │   │                   │
│ - Install     │   │ - Deploy          │
│ - Upgrade     │   │ - Sync            │
│ - Remove      │   │ - Remove          │
│ - Refresh     │   │ - Validate        │
└────────┬──────┘   └───────────┬───────┘
         │                       │
         └───────────┬───────────┘
                     │
┌────────────────────▼─────────────────────────────────────────┐
│ Communication Layer                                           │
│  └─ DeviceConnection (Protocol & Serial Communication)       │
│     ├─ MicroPython raw REPL protocol (mpremote-compatible)   │
│     ├─ File transfer (sendFile, receiveFile)                 │
│     ├─ Code execution (executeCode)                          │
│     ├─ Connection lifecycle management                       │
│     └─ Message parsing and event emission                    │
└──────────────────────────────────────────────────────────────┘
```

The `WorkspaceView` toolbar deploy button (and the hamburger menu's "Upload to Device"
item) call `DeviceDeployment.deployCollection()` with default options. With `force: false`
this performs a hash-based incremental sync when the device has a sync manifest, or a full
upload otherwise, and shows no options dialog — advanced options remain available via the Deploy
tab (`DeviceDeploymentView`): force upload and include full definition always, and **Upload
firmware package source** only while `validateNodePackages().shadowPackages` is non-empty, i.e.
while the gate would actually shadow a firmware package. Each checkbox carries its own hint line
(`FormFieldDefinition.description`); the dialog itself has no shared message paragraph. The
toolbar button is disabled while a deployment is in flight.

---

## Core Components

### 1. DeviceDeployment (Main Orchestrator)

**Location**: `src/micro_otter/nodes/html/js/deployment/device-deployment.ts`

**Purpose**: Central coordinator that manages device state, handles connection events, and delegates phase-specific operations to specialist classes.

**Key Responsibilities**:

- **Device State Management**: Tracks connection status, MicroPython detection, runtime/collection deployment state
- **Connection Event Handling**: Listens to DeviceConnection state changes and triggers appropriate actions
- **Auto-Detection**: Automatically detects MicroPython and loads device info when device connects
- **Initialization Status Orchestration**: Subscribes to `DeviceConnection` initialization-status events and runs onboarding policy (dialogs + target persistence) in deployment layer
- **Progress Coordination**: Creates ProgressTrackers and coordinates progress events
- **Event Forwarding**: Forwards events from RuntimeDeployment and CollectionDeployment to UI
- **Public API**: Provides high-level methods for device queries and manual operations

**Device State Structure**:

```ts
{
    // Connection
    connected: boolean,

    // Device Info Loading
    deviceInfoLoading: boolean,      // True while MicroPython detection + info load in progress
    deviceInfoLoadError: string|null, // Error message if loading failed

    // MicroPython Detection
    hasMicroPython: boolean|null,     // null=unknown, true=detected, false=not found
    micropythonVersion: string|null,  // e.g., "1.22.1"

    // Runtime State
    runtimeInstalled: boolean,
    runtimeDeploymentMode: 'dynamic'|'embedded',
    runtimeEmbedded: boolean,
    runtimeVersion: string|null,      // e.g., "1.0.0"
    runtimeId: string|null,           // e.g., "general"
    runtimeName: string|null,         // e.g., "Micro-Otter"
    embeddedPackagesSummary: {
      totalPackages: number,
      totalFiles: number,
      totalBytes: number
    }|null,
    effectiveInventorySummary: {
      totalEntries: number,
      embeddedEntries: number,
      dynamicEntries: number,
      overriddenEntries: number,
    }|null,

    // Target/Device Configuration
    deviceTargetInfo: DeviceTargetInfo|null,  // Target instance with all capabilities and instanceData
                                               // Access instance data: deviceTargetInfo.instanceData.userDescription
                                               //                      deviceTargetInfo.instanceData.configPath
                                               //                      deviceTargetInfo.instanceData.uploadedAt

    // Collection State
    collectionDeployed: boolean,
    collectionName: string|null,
    collectionVersion: string|null
}
```

**Key Methods**:

```ts
// State Queries
getDeviceState(): DeviceState
get targetConfigurationIssue(): 'missing'|'incomplete'|'image-incompatible'|null
                                  // why the stored target was rejected; non-null keeps
                                  // deviceTargetInfo null and arms needs-onboarding
isConnected(): boolean
hasMicroPython(): boolean
hasRuntime(): boolean
hasCollection(): boolean
getRuntimeVersion(): string|null
getCollectionName(): string|null

// MicroPython Detection
async detectMicroPython(): Promise<boolean>
async refreshDeviceInfo(): Promise<void>
async refreshConnectionState(): Promise<boolean>

// Device Queries
async getDeviceInfo(): Promise<Object>

// Delegation happens internally via RuntimeDeployment/CollectionDeployment
```

**Event Flow**:

```
DeviceConnection fires 'statechange' (connected)
  ↓
DeviceDeployment._handleDeviceConnect()
  ↓
ProgressTracker('device-info-load', 2) created
  ↓
Step 1: detectMicroPython()
  → Updates: hasMicroPython, micropythonVersion
  ↓
Step 2: refreshDeviceInfo() (if MicroPython detected)
  → Updates: runtimeInstalled, runtimeVersion, deviceTargetInfo (DeviceTargetInfo), etc.
  → DeviceTargetInfo includes capabilities + instanceData (userDescription, configPath, uploadedAt)
  → Emits: 'device-info-loaded' event
  ↓
ProgressTracker.complete()
  ↓
UI receives 'device-state-changed' event
```

**Auto-Loading Mechanism**:

When a device connects (either via event or already connected at construction):

1. Sets `deviceInfoLoading = true`
2. Creates ProgressTracker for 2-step process
3. Executes `detectMicroPython()` - checks for MicroPython REPL and version
4. If MicroPython found, executes `refreshDeviceInfo()` - loads runtime/collection state
5. Sets `deviceInfoLoading = false` on completion or error
6. Emits `device-info-loaded` (success) or `device-info-load-error` (failure)

### Initialization Status Ownership

- `DeviceConnection` emits transport/runtime initialization status (`device-initialization-status`) after `loadDeviceInfo()` completes (and on load-error path).
- `DeviceDeployment` owns policy/UI decisions from that status (for example embedded target onboarding dialog).
- Dependency direction is one-way: `DeviceConnection` does not call deployment methods or open dialogs.

### Deploy Preflight Ordering

Collection deploy path runs initialization preflight before target compatibility checks:

1. Read latest initialization status.
2. If status is actionable `needs-onboarding`, force refresh/onboarding gate first.
3. Only then run target mismatch validation.
4. If onboarding is cancelled, fail deploy with explicit onboarding-required diagnostics.

Capability compatibility (`validateCollectionCompatibility`) evaluates the same requirement contract
as the editor: `resolveNodeCapabilityRequirements` runs **per node** (not per node type), so
`resourceUsage`-derived pin requirements and their `requiredWhen` conditions are honoured. Messages
are deduplicated by node type plus capability path and keep the format
`Missing required capability for <nodeType>: <path>`.

App-provided type ids are exempt from that resolution. The function-graph ids
(`function_graph.<graphId>` call nodes and the structural `graph.function.input` /
`graph.function.output` nodes) have no runtime definition by design, so all three deploy gates — this
capability preflight, `validateNodePackages()` and `CollectionDeployment._validateNodePackages()` —
skip them through `isFunctionGraphManagedNodeType()` instead of failing the upload with
`Node type not found`. Their work is validated on the callee graph, which is part of the same
collection.

### Embedded Runtime Metadata Detection (Phase 8)

During `refreshDeviceInfo()`, `DeviceDeployment` queries runtime metadata through
the runtime API boundary (`runtime.embedded_metadata_api`) over the existing
device execution channel.

- Metadata source: runtime API payload (mode, identity, package summary, inventory)
- Embedded mode is enabled only when the API reports runtime mode `embedded`
- API unavailability, execution failures, or invalid payloads are non-fatal and
  fall back to dynamic mode
- Runtime identity and embedded package summary are applied only for embedded mode
- Existing runtime/collection load behavior remains canonical; metadata extension is additive

**Race Condition Prevention**:

Constructor uses `queueMicrotask()` to defer initial detection, ensuring:

- Constructor completes before async operations start
- Event listeners are properly attached
- Views can subscribe before events fire

---

### 2. RuntimeDeployment (Phase 2 Specialist)

**Location**: `src/micro_otter/nodes/html/js/deployment/runtime-deployment.ts`

**Purpose**: Handles all runtime-related deployment operations including installation, upgrade, removal, and device info refresh.

**Key Responsibilities**:

- **Runtime Installation**: Upload runtime files, tools folder, base libraries
- **Runtime Upgrade**: Smart sync using HashManifestManager to upload only changed files
- **File Preparation**: Fetch and prepare files from runtime manifests before upload
- **Manifest Management**: Centralized hash manifest via HashManifestManager
- **Progress Tracking**: Detailed progress events for all operations

**Key Methods**:

```ts
// Preparation (Phase 1 - generates file lists)
async prepareInstall(runtimeId, options): Promise<Object>
async prepareUpgrade(runtimeId, options): Promise<Object>

// Execution (Phase 2 - performs uploads)
async installRuntime(runtimeId, options): Promise<void>
async upgradeRuntime(runtimeId, options): Promise<void>
async removeRuntime(): Promise<void>

// Maintenance
async refreshRuntime(runtimeId, options): Promise<void>
```

**Installation Flow**:

```
installRuntime(runtimeId)
  ↓
1. prepareInstall() - Fetch and prepare files
   → Downloads runtime manifest
   → Fetches all file contents from URLs
   → Calculates hashes for all files
   → Returns {totalFiles, toolsCount, runtimeCount, librariesCount}
  ↓
2. Upload Tools Folder (core Python utilities)
   → /tools/lib/device_runtime.py
   → /tools/lib/node_library_loader.py
   → etc.
  ↓
3. Upload Runtime Files (bootstrap code)
   → /boot.py
   → /main.py
  ↓
4. Upload Base Libraries (nodes folder)
   → /nodes/base/.../*.py
  ↓
5. Save Hash Manifest via HashManifestManager
   → hashManager.updateHashes('runtime', runtimeHashes, metadata)
   → hashManager.updateHashes('tools', toolsHashes)
   → hashManager.save() → /.micro-otter-sync-manifest
  ↓
6. Update Device State
   → runtimeInstalled = true
   → runtimeVersion = "1.0.0"
   → runtimeId = "general"
  ↓
7. Emit 'runtime-installed' event
```

**Smart Upgrade Flow**:

```
upgradeRuntime(runtimeId)
  ↓
1. Load hash manifest via HashManifestManager
   → hashManager.load() from /.micro-otter-sync-manifest
   → deviceRuntimeHashes = hashManager.getFiles('runtime')
   → deviceToolsHashes = hashManager.getFiles('tools')
  ↓
2. prepareUpgrade() - Compare hashes
   → Downloads new runtime manifest
   → Fetches new file contents and calculates hashes
   → hashManager.needsUpload() determines changed files
   → Returns only CHANGED files
  ↓
3. Upload only changed files
   → Runtime files with different hashes
   → Tools files with different hashes
  ↓
4. Update and save hash manifest
   → hashManager.updateHashes('runtime', newRuntimeHashes, metadata)
   → hashManager.updateHashes('tools', newToolsHashes)
   → hashManager.save()
  ↓
5. Update device state and emit 'runtime-upgraded'
```

---

### 3. CollectionDeployment (Phase 3 Specialist)

**Location**: `src/micro_otter/nodes/html/js/deployment/collection-deployment.ts`

**Purpose**: Handles node graph collection deployment including code generation, library resolution, file syncing, and validation.

**Key Responsibilities**:

- **Collection Deployment**: Transpile node graphs and upload collection files
- **Library Resolution**: Determine which node libraries are used and upload only those
- **Code Generation**: Invoke transpiler to convert node graphs to MicroPython
- **Collection Sync**: Update only changed files in deployed collections
- **Validation**: Check collection compatibility with runtime and target
- **Removal**: Clean removal of collection files from device

**Key Methods**:

```ts
// Preparation (generates files and resolves dependencies)
async prepareDeployCollection(collection, options): Promise<Object>
async prepareSyncCollection(collection, options): Promise<Object>

// Execution (performs uploads/operations)
async deployCollection(collection, options): Promise<void>
async syncCollection(collection, options): Promise<void>
async removeCollection(): Promise<void>

// Validation
async validateCollectionCompatibility(collection): Promise<void>

// Library Management
async resolveRequiredLibraries(collection): Promise<Array>
async filterLibrariesByGraph(collection, libraryFiles): Promise<Array>
```

**Deployment Flow**:

```text
deployCollection(collection)
  ↓
1. Validate compatibility
   → Check runtime installed
   → Check target matches (and the collection target is in `allowedWebTargetIds` when the board's
     firmware records one — a mismatch fails fast with `target-not-compatible`, before any upload)
   → Check graph validity
  ↓
2. prepareDeployCollection()
   → Transpile all graphs in collection
   → Generate metadata file
   → Resolve required node libraries
   → Filter libraries to only used nodes
   → Calculate hashes for generated files
  ↓
3. Upload Collection Files
   → app/main_loop.py (transpiled code)
   → collection/node_graph_cln.json (metadata)
  ↓
4. Upload Node Libraries
   → /nodes/<library>/*.py (only used nodes)
  ↓
5. Save Hash Manifest via HashManifestManager
   → hashManager.updateHashes('collection', collectionHashes, {
       collectionId, collectionName
     })
   → hashManager.save() → /.micro-otter-sync-manifest
  ↓
6. Update Device State
   → collectionDeployed = true
   → collectionName = "My Collection"
   → collectionVersion = "1.0.0"
  ↓
7. Emit 'collection-deployed' event
```

**Runtime Mode Preservation**:

- Collection deploy/sync captures the pre-deploy runtime mode through `DeviceConnection.isExecutionRunning()`.
- The post-upload reset restores that same mode via `DeviceConnection.softReset({ startRunning })`.
- Result: deploy from play mode returns to play mode; deploy from stopped mode returns to stopped mode.

**Embedded Runtime Library Planning (single source of truth)**:

- Collection library planning remains owned by `CollectionDeployment` and is additive to the
  existing deploy/sync pipeline.
- Embedded behavior is activated only when runtime metadata is explicit (`runtimeDeploymentMode`
  is `embedded` and `runtimeEmbedded` is `true`) and runtime identity validation succeeds.
- One pure function — `resolveFirmwareModulePlan()` in
  `src/micro_otter/nodes/html/js/deployment/embedded-module-plan.ts` — is the single source of
  truth for every library path the graph needs. It receives the declared paths, the package→file
  mapping, the firmware version source and the firmware inventory, and returns one decision per
  path plus the derived sets (uploads, firmware-provided, shadowed packages, firmware-owned
  folders, blocked paths):

  | State | Meaning | Deploy action |
  |---|---|---|
  | `host-only` | not a firmware-bundled package (or dynamic mode) | upload host source (`dynamic`) |
  | `firmware-current` | firmware version ≥ host version **and** every needed file inventory-confirmed | skip upload; may delete the user-space copy |
  | `firmware-outdated` | firmware version < host version | shadow the whole package (`override-embedded`) |
  | `firmware-unknown` | firmware reports no usable `x.y.z` version | shadow the whole package (`override-embedded`) |
  | `firmware-incomplete` | version current but a needed file is absent from the inventory | shadow the whole package (`override-embedded`) |
  | `firmware-content-mismatch` | version current **and** complete, but the device-side probe found different bytes | shadow the whole package (`override-embedded`) |
  | `host-missing` | neither firmware nor host provides a package-owned file | block the deploy |

- A package is **current** only when *both* the version comparison and the inventory presence
  agree. A version-equal package whose inventory misses a needed file is `firmware-incomplete`
  and is shadowed as a whole — the former hard "Deployment blocked" behaviour is gone.
- Version equality is not proof of identical bytes. `DeviceDeployment._probeEmbeddedContentMismatches()`
  compares host SHA-256 with `DeviceConnection.calculateHash()` for the in-use files of every
  firmware-owned package and promotes a proven difference to `firmware-content-mismatch` (whole
  package shadowed, `deployment.packageContentMismatch` warning). The probe is capped, cached per
  runtime/firmware/package/version and skipped when the connection cannot hash; see
  [Embedded Runtime Compatibility → Content-Based Staleness](./embedded-runtime-compatibility-deploy.md#content-based-staleness-same-version-different-bytes).
- Non-semver firmware versions are never accepted as evidence of currency: they fall through to
  `firmware-unknown` (shadow + `deployment.packageVersionUnknown` warning). The same strict
  `x.y.z` grammar is enforced at firmware build time in
  `src/micro_otter/tools/firmware_compile/staging_resolver.py`.
- Plan membership is derived from the node graph plus firmware information only, **never** from the
  hash manifest, because the manifest is the left-hand side of the stale subtraction (see
  [Deploy Pattern: Complete Plan, Subtractive Removal](#deploy-pattern-complete-plan-subtractive-removal)).
  `HashManifestManager` only decides which planned files actually need a re-upload.
- In embedded mode, libraries the firmware proves current are skipped by default; every other
  firmware-bundled package is shadowed only after the consent gate approves it.
- The consent gate (`DeviceDeployment._resolveEmbeddedSourceOverrides`) asks the user once for the
  full shadow set (outdated + unknown + incomplete) and the approved paths flow to collection as
  `embeddedLibraryOverridePaths`. Collection re-derives the same plan from the same inputs, so a
  warning and an actual shadow upload can never disagree.
- An embedded override always ships **complete** packages: the override set contains every
  `mpAssets` file of a shadowed package, not just the asset keys the collection uses, because
  MicroPython resolves submodules only inside the package directory that won the import
  (`__path__`).

#### Shadow uploads require approval (fail-closed)

The approval is an invariant of the upload phase, not advice:

- No `shadowPackages` path may reach the upload stage without appearing in
  `embeddedLibraryOverridePaths`. `CollectionDeployment._prepareNodeLibrariesUpload()` compares the
  planned shadow packages against the approved set and throws
  `EmbeddedOverrideApprovalRequiredError` (`code: 'EMBEDDED_OVERRIDE_APPROVAL_REQUIRED'`,
  `packageIds`, `missingPaths`) before a single file is transferred.
- A **partial** approval is an error too: a shadow copy that misses files hides the firmware copy
  and breaks the submodule imports that were left out (see
  *Whole-Package Invariant* in
  [Embedded Runtime Compatibility](./embedded-runtime-compatibility-deploy.md#whole-package-invariant)).
- The gap is still logged as `collection-library-override-package-expanded` before the throw, so
  the failure stays diagnosable in the deploy log.
- `CollectionDeployOptions.embeddedOverrideMode: 'forced'` records that the user explicitly asked
  for the shadow upload (deploy-options checkbox). It changes the log to
  `collection-library-override-forced` and **never** approves a path implicitly — the approved list
  must still cover every shadow file.
- The UI maps the error to the deploy view's error dialog; the deploy button simply re-enables once
  the user confirms the next attempt.
- Collection manifest metadata remains backward compatible and may include optional
  `libraryPathTags` with per-path tags (`dynamic`, `override-embedded`) for deployed library files.
- Packages the firmware does not bundle are uploaded as source in embedded mode (there is no
  firmware copy); because that consumes RAM on a device sized for the firmware set,
  `validateNodePackages()` reports one display-only `deployment.packageNotInFirmware` warning per
  such package without ever blocking the deploy.
- Stale cleanup subtracts the plan from the on-device manifest, but never deletes a library the
  graph still needs while the firmware cannot replace it:

  | Path in manifest, not in plan | Still needed by the graph? | Firmware inventory confirms it? | Action |
  |---|---|---|---|
  | `libs/*`, `otter_*`/`moa_*` | yes | yes | delete — the firmware copy takes over (firmware caught up) |
  | `libs/*`, `otter_*`/`moa_*` | yes | no / inventory unknown | **keep** + `collection-library-stale-keep-firmware-missing` (warn) |
  | `libs/*`, `otter_*`/`moa_*` | no (package no longer used) | — | delete — user-space garbage |
  | `app/*`, `collection/*` | — | — | delete (unchanged behaviour) |

  The "still needed" side comes from `_candidateLibraryPaths`, the snapshot of every planned path
  taken by `_prepareNodeLibrariesUpload()`. Only an inventory-confirmed path lands in
  `_firmwareProvidedLibraryPaths`, so an unreadable `embeddedInventory` keeps the file
  (`reason: 'inventory-unavailable'`). Dynamic mode is never guarded there, since every needed
  library is part of the plan and therefore never stale.

##### Firmware-owned package folders

Beyond the per-file rules above, the deploy records which package folders it leaves *entirely* to
the firmware, so the whole directory can be removed in one device call instead of only its known
files. `_prepareNodeLibrariesUpload()` ends with `_firmwareOwnedPackageFolders` (folder → package
id), computed by `_collectFirmwareOwnedPackageFolders()`; a folder qualifies only when **all** of the
following hold:

1. the runtime is embedded (`_isEmbeddedRuntimeMode()`),
2. the package is firmware-bundled (`runtime.nodePackagesGlobal`),
3. the graph still needs at least one of its files (`_candidateLibraryPaths`),
4. this deploy uploads **no** file of the package (an override owns the folder, so it must survive),
5. the plan classifies the package `firmware-current` and every needed file is inventory-confirmed
   (`plan.firmwareOwnedPackageIds`). An unreadable inventory never authorises folder removal.

Additional rules:

- **`.mpy` alias.** A firmware shipping precompiled modules lists `otter_x/y.mpy` where the node
  package declares `otter_x/y.py` (or `moa_x/y.py`); the two count as the same module.
- **A planned path wins over the folder.** Two packages may share a root (`libs/<name>`), so a
  folder that any planned path lives under is never collected.
- **Plain `libs/foo.py` has no folder.** Only `libs/<name>/…` and `otter_*/…`/`moa_*/…` define a package
  folder.
- **The `.mpy` alias is shared, not defensive.** The plan, the `validateNodePackages` compatibility
  check, the stale-cleanup guard, and the folder decision all use the same
  `resolveFirmwareInventoryPath()` helper, so a firmware `x/y.mpy` entry counts as the declared
  `x/y.py` module. A firmware-bundled package therefore qualifies completely when the firmware
  ships its precompiled form, and the deploy no longer stops just because the inventory names
  `.mpy` instead of `.py`.

Log events: `collection-firmware-owned-package-folders` (the snapshot, one entry per collected
folder), `collection-library-stale-keep-firmware-missing` (warn — an unconfirmed firmware copy)
and `collection-library-folder-keep-planned` (a planned path lives under the folder). How the
collected folders are removed is described in
[Deploy Pattern: Complete Plan, Subtractive Removal](#deploy-pattern-complete-plan-subtractive-removal).

#### Deploy Pattern: Complete Plan, Subtractive Removal

Library deploys follow one invariant that every change to planning, hashing or cleanup must
respect:

```
files on device = prepared plan ∪ (manifest entries the firmware cannot replace)
removal         = (files recorded in the hash manifest) − (files in the prepared plan)
folders on dev  = prepared plan ∪ (package folders the firmware does not own wholesale)
```

Removal therefore operates on **files and package folders** — the folder half of the pattern is
described in item 7.

1. **The invariant.** Removal is a plain set subtraction: `stale = manifest − prepared plan`. The
   only correctness condition is that the prepared plan is *complete*. Anything that makes the plan
   incomplete becomes a **deletion** on the next deploy.
2. **The plan must never be derived from the hash manifest.** Plan membership is a function of
   `(node graph, firmware inventory, firmware package versions)` only. The manifest is the *left-hand
   side* of the subtraction; feeding it back into plan membership creates the self-reinforcing loop
   "present on device ⇒ not planned ⇒ deleted as stale" that this pattern exists to prevent.
   `HashManifestManager.getFilesToUpload()` is the manifest's single legitimate job: suppressing
   re-uploads of unchanged content **after** the plan exists.
3. **Decision table:**

   | Situation | Prepared plan | Removal | Result |
   |---|---|---|---|
   | Needed, firmware older / unknown / content-mismatched | `override-required` | — | source shadow uploaded, survives redeploys |
   | Needed, firmware current | skipped (`available-embedded` / `available-embedded-global-current`) | removed, firmware inventory lists it | firmware copy takes over |
   | Needed, firmware current, firmware inventory does **not** list it | skipped | guarded — **kept** | `collection-library-stale-keep-firmware-missing` (warn) |
   | Needed, not bundled in firmware | `missing` → uploaded | — | RAM warning `deployment.packageNotInFirmware` |
   | No longer needed by the graph | never collected | removed | user-space garbage is cleaned up |
   | `app/*`, `collection/*` | plan as usual | removed when absent from the plan | unchanged behaviour |

4. **The guard and why it is asymmetric.** A still-needed library (`_candidateLibraryPaths`) that
   this deploy does not upload may only be deleted when the firmware inventory proves it can replace
   it. Unreadable inventory (`embeddedInventory == null`) means *keep* — deleting on an unknown is
   exactly the failure mode the pattern removes. A library outside `_candidateLibraryPaths` is not
   guarded: nothing needs it any more. Dynamic mode is exempt, because there every needed library is
   uploaded and therefore always in the plan.
5. **Observability.** These log events let a reviewer confirm the pattern without reading the code:
   - `collection-library-decision` with `action: upload|skip` and `decision: missing |
     available-embedded | override-required | available-embedded-global-current`
   - `collection-library-override-package-expanded` (whole-package override expansion)
   - `collection-file-removed` (a stale path was actually deleted)
   - `collection-library-folder-removed` (a package folder was removed; `packageId`,
     `removedEntries`, `removalReported` — the last one is `false` on a connection without
     `removeFolder`, where the count is unknowable)
   - `collection-library-folder-remove-failed` (warn — the folder survived, e.g. `EPERM`)
   - `collection-library-folder-keep-planned` (a path of the prepared plan lives under the folder)
   - `collection-library-stale-keep-firmware-missing` (the guard kept a still-needed file)
   - `collection-embedded-override-preflight` (one runtime, one plan: `runtimeId`,
     `runtimeIdSource`, `collectionRuntimeId`, per-package `reason`/versions)
   - `collection-embedded-override-decision` / `-memoized` / `-approval-remembered` (consent gate)
   - `collection-embedded-override-forced-request` and `collection-library-override-forced`
     (user-requested shadow run)
   - `embedded-content-mismatch`, `embedded-content-probe-skipped`, `embedded-content-probe-limit`,
     `embedded-content-probe-error` (device-side content probe)
   - `collection-dynamic-inventory-load-failed` (manifest unreadable ⇒ empty display inventory)

   The `collection-hashes-saved` payload reports `staleFilesRemoved` and
   `staleLibraryFoldersRemoved` side by side.
6. **Display-only inventory.** `_dynamicLibraryPathsOnDevice` and
   `getDynamicLibraryPathsOnDevice()` report the `libs/` / `otter_*` paths the user space holds
   according to the manifest. They are informational (Device Info row, diagnostics) and never an
   input to plan membership.
7. **Package folders are removed too.** The subtraction can only name paths the manifest enumerates,
   so a folder the device still holds but the manifest never listed — files uploaded before the
   whole-package override invariant existed, a manual `mpremote` copy, a package whose file set
   changed with the firmware version — is removed by `_removeStaleLibraryFolders()`, which consumes
   the `_firmwareOwnedPackageFolders` snapshot described in
   [Firmware-owned package folders](#firmware-owned-package-folders):

   | Situation | Prepared plan | File removal | Folder removal |
   |---|---|---|---|
   | Needed, firmware older / unknown / incomplete (shadow) | all package files | none | keep — the folder *is* the override |
   | Needed, firmware current, inventory proves every file | none | manifest-listed paths | **whole folder, recursively** |
   | Needed, inventory unreadable | none | guarded (kept) | keep (no folder removal) |
   | Needed, package not bundled in firmware | all package files | none | keep + the RAM warning |
   | Package no longer used by the graph | none | all manifest paths | empty directories pruned |
   | `app/*`, `collection/*` | unchanged | unchanged | never pruned |

   A folder removal is a **device change**: `_removeStaleLibraryFolders()` returns the number of
   folders that really existed, and both deploy paths add it to their change counter so the soft
   reset runs and the device reloads the module search path. A folder that was already gone reports
   `0` removed entries from the device and does not trigger a reset.

   **Empty-parent pruning (Rule B).** After `_removeStaleCollectionFiles()` has deleted a set of
   files, `_pruneEmptyFolders()` removes the folders those deletions emptied — `os.rmdir` only,
   deepest ancestor first (`_collectPrunableFolders()`). This matters because an *empty* directory
   is enough to shadow the firmware: MicroPython searches the VFS before the frozen modules and
   resolves a package's submodules only inside the directory that won the import, so a leftover
   `otter_vars/` turns the next `otter_vars.arrays` import into `ImportError`. Rules:

   - only `otter_<pkg>/…` and `libs/<pkg>/…` ancestors are pruned — never `libs` itself, never
     `app/`, `collection/` or the device root;
   - only paths whose deletion **succeeded** contribute candidates, so a failed deletion is never
     followed by an attempt to remove the folder that still holds the file;
   - pruning does not change the change counter: the file deletions that emptied the folder already
     made the run count as a change;
   - a failing prune is non-fatal — it logs `collection-folder-keep-non-empty` and continues, and a
     successful one logs `collection-folder-removed` (`removalReported` is `false` on a connection
     without `removeFolder`, where the count is unknowable).

   Recovery for devices already carrying an empty remnant is documented in
   [Embedded Runtime Compatibility → Redeploy Behaviour](./embedded-runtime-compatibility-deploy.md#symptom-importerror-no-module-named-pkgsub).

**Library Filtering Strategy**:

Collection deployment analyzes node graphs to determine which node types are used, then uploads only the required node library files:

```ts
// Example: Graph uses only GPIO.DigitalOut and Time.Delay nodes
// Only these libraries are uploaded:
/nodes/gpio/digital_out.py
/nodes/time/delay.py
// NOT uploaded: /nodes/gpio/analog_in.py, /nodes/sensor/*, etc.
```

---

### 4. HashManifestManager (Centralized Hash Management)

**Location**: `src/micro_otter/nodes/html/js/deployment/hash-manifest-manager.ts`

**Purpose**: Manages the unified hash manifest for all deployment phases. Provides single source of truth for file hash operations across runtime, tools, and collection deployments.

**Key Responsibilities**:

- **Manifest Loading**: Load central manifest from device (` /. micro-otter-sync-manifest`)
- **Hash Comparison**: Determine which files need upload based on hash differences
- **Manifest Updates**: Update file hashes for runtime, tools, and collection sections
- **Manifest Persistence**: Save manifest to device with automatic timestamp updates
- **Section Management**: Isolate runtime, tools, and collection hashes in separate sections

**Staging Area Architecture**:

The HashManifestManager implements a staging area pattern for atomic hash operations:

1. **Preparation Phase**: `prepareFile(section, path, content)` calculates hash and stages it internally
   - Returns `{needsUpload, hash}` by comparing against existing manifest
   - Hash is staged but not yet committed to manifest
   - Multiple files can be prepared before commit

2. **Upload Phase**: Deployment classes upload only files that need updates
   - Use staged data to determine what to upload
   - No hash operations during upload (already staged)

3. **Commit Phase**: `commitStaging(section, metadata)` atomically moves all staged hashes to manifest
   - All staged hashes become part of manifest in single operation
   - Metadata (runtimeId, collectionId, etc.) saved with hashes
   - Staging area cleared after commit

4. **Rollback Support**: `clearStaging(section)` discards staged hashes on error
   - Allows recovery from failed uploads without corrupting manifest
   - Staging area cleared, manifest unchanged

**Benefits of Staging Pattern**:
- **Atomic Commits**: All hashes updated together, no partial states
- **Error Recovery**: Can rollback staged data if upload fails
- **No Duplication**: Each file's hash calculated once and reused
- **Centralized Logic**: All hash operations in HashManifestManager, deployment classes just orchestrate

**Unified Manifest Structure**:

```json
{
  "version": "1.0.0",
  "created": "2026-02-12T10:00:00Z",
  "updated": "2026-02-12T14:30:00Z",
  "runtime": {
    "runtimeId": "general",
    "version": "1.0.0",
    "files": {
      "main.py": "sha256:abc123...",
      "boot.py": "sha256:def456...",
      "app/custom_settings.py": "sha256:ghi789..."
    }
  },
  "tools": {
    "files": {
      "tools/log.py": "sha256:jkl012...",
      "tools/device_manager.py": "sha256:mno345..."
    }
  },
  "collection": {
    "collectionId": "my-firmware",
    "collectionName": "My Firmware",
    "files": {
      "app/main_loop.py": "sha256:pqr678...",
      "collection/node_graph_cln.json": "sha256:stu901..."
    }
  }
}
```

**Key Methods**:

```ts
// Loading and Saving
async load(): Promise<void>                    // Load from device
async save(): Promise<void>                    // Write to device (if dirty)
async exists(): Promise<boolean>               // Check if manifest exists
createEmpty(): void                            // Initialize new manifest
reset(): void                                  // Reset to empty state

// Hash Comparison
needsUpload(section, devicePath, localHash): boolean  // True if file needs upload
getHash(section, devicePath): string|null              // Get hash for file
getFiles(section): Object                              // Get all files in section

// Hash Updates
updateHashes(section, pathHashMap, metadata): void    // Batch update hashes
removeSection(section): void                          // Remove entire section
removeFile(section, devicePath): void                 // Remove specific file

// Staging Area API (for atomic hash operations)
async prepareFile(section, path, content): Promise<{needsUpload, hash}>  // Stage file hash
getFilesToUpload(section): Array<string>                                  // Get staged files needing upload
getStagedHash(section, path): string|null                                 // Get staged hash for file
getAllStagedHashes(section): Object                                       // Get all staged hashes
commitStaging(section, metadata): void                                    // Commit staged hashes to manifest
clearStaging(section): void                                               // Clear staged data (rollback)

// State Queries
isLoaded(): boolean                           // Check if manifest loaded
isDirty(): boolean                            // Check for unsaved changes
getVersion(): string|null                     // Get manifest version
getCreated(): string|null                     // Get creation timestamp
getUpdated(): string|null                     // Get update timestamp
```

**Usage in RuntimeDeployment**:

```ts
// New Staging API Pattern (centralized hash management)
// Step 1: Prepare files and stage hashes
for (const file of runtimeFiles) {
    const content = await fetch(file.url).then(r => r.text());
    const { needsUpload, hash } = await this._hashManager.prepareFile('runtime', file.path, content);
    
    if (needsUpload) {
        filesToUpload.push({ path: file.path, content, hash });
    }
}

// Step 2: Upload files
for (const file of filesToUpload) {
    await this._deviceConnection.writeTextFile(file.path, file.content);
}

// Step 3: Commit staged hashes to manifest (atomic operation)
this._hashManager.commitStaging('runtime', {
    runtimeId: 'general',
    version: '1.0.0'
});
this._hashManager.commitStaging('tools');
await this._hashManager.save();

// On error, rollback staging
try {
    // upload operations...
} catch (error) {
    this._hashManager.clearStaging('runtime');
    this._hashManager.clearStaging('tools');
    throw error;
}
```

**Usage in CollectionDeployment**:

```ts
// New Staging API Pattern
// Step 1: Prepare collection files and stage hashes
const transpileResult = await transpiler.transpile(nodeGraph);
const { needsUpload: codeNeedsUpload, hash: codeHash } = 
    await this._hashManager.prepareFile('collection', 'app/main_loop.py', transpileResult.code);

const metadataStr = JSON.stringify(metadata, null, 2);
const { needsUpload: metadataNeedsUpload, hash: metadataHash } = 
    await this._hashManager.prepareFile('collection', 'collection/node_graph_cln.json', metadataStr);

// Step 2: Upload only files that changed
if (codeNeedsUpload) {
    await this._deviceConnection.writeTextFile('app/main_loop.py', transpileResult.code);
}
if (metadataNeedsUpload) {
    await this._deviceConnection.writeTextFile('collection/node_graph_cln.json', metadataStr);
}

// Step 3: Commit staged hashes with collection metadata
this._hashManager.commitStaging('collection', {
    collectionId: collection.id,
    collectionName: collection.getTitle()
});
await this._hashManager.save();
```

**Architectural Benefits**:

- **Single Source of Truth**: One manifest for all file hashes
- **Consistent API**: Same methods for runtime, tools, and collection
- **Encapsulation**: Deployment classes never access manifest structure directly
- **Testability**: Hash logic isolated in dedicated class with comprehensive unit tests
- **No Code Duplication**: Eliminates scattered hash operations across deployments

---

## Add-on node packages do not create a second deploy path

> **Invariant:** source upload is independent of firmware. A package being absent from an image
> (`staged: false`, or narrowed away by `packageIds`), a disabled `enable_compile` / `enable_deploy`, a
> `compiled-mpy` packaging mode, and a `source: local` firmware origin are all *content* facts about a
> firmware image. None of them suppresses the source upload performed for `missing` /
> `override-required` packages, and none of them is read by the decision table above. The firmware-side
> statement of the same rule is in
> [package-selection.md](../firmware-compile/package-selection.md#what-this-does-not-mean); the
> authoritative JS gate is `tests/deployment/collection-deployment-*.test.js`.

An installed add-on package (see [node-package-addons.md](../nodes/node-package-addons.md)) is a node
package like any other: its libraries take part in the same collection-deploy decision table above.

- The decision is still `(node graph, firmware inventory, firmware package versions)` only. Adding or
  removing an add-on changes which libraries the graph *needs*; it never changes how a needed library
  is classified.
- A library whose `mpyCompileProfiles` record matches the image is classified `available-embedded` and
  skipped. A library the image cannot serve is classified `missing` (or `override-required` when the
  firmware copy is older/unknown) and its **source is uploaded**, so the
  add-on still runs on a device without rebuilding firmware.
- `provenance` (`builtin` / `addon`) is cosmetic. It drives the palette badge and the compile
  payload's `metadata.packageProvenance`, and the deploy classifiers never read it — the same class
  of decision for a shipped and an installed package is the whole point of the shared contract.
- Installing or uninstalling an add-on touches local inventory only. The image keeps whatever was
  frozen at build time until the next build, and the next deploy's plan simply follows the new
  inventory.

## Firmware image flashing is a separate seam

Firmware *image* flashing (writing one `.bin` to one board over one port) is not part of this
deployment pipeline at all. It lives behind the flash backend seam
(`src/micro_otter/tools/firmware_compile/flash/`) with one headless entry point,
`flash_firmware()` in
[firmware_deploy.py](../../../src/micro_otter/tools/firmware_compile/firmware_deploy.py).

Boundary rules:

- `firmware_deploy` flashes a finished image. It never builds, never stages, and never uploads
  node-package source, so `FlashRequest` continues to carry firmware images only.
- The helper adds image resolution (`resolve_firmware_image` /
  `resolve_latest_firmware_for_board`), one structured error family
  (`FirmwareDeployError` and its subclasses, `deploy` category, `flash-*` codes for adapter
  failures), and a report object. The `esptool` argv itself stays inside the adapter; the helper
  never re-implements a tool invocation.
- `mo deploy-runtime --firmware … --json-output` and the `WS /firmware` deploy job both serialise
  through `build_deploy_payload`, so a client parses one deploy shape regardless of entry point.
  Without those options `mo dr --firmware` keeps its historical inline `esptool` call.
- A flash result, successful or not, is **not** an input to the source-upload decision above.
  `missing` and `override-required` packages are still uploaded by `runtime-deployment.ts`
  independently of whether — or how — the last image flash went.

## Progress Event System Integration

All long-running operations integrate with **ProgressEventBus** for consistent progress feedback:

### ProgressTracker Usage

```ts
// Create tracker with operation ID and total steps
const tracker = new ProgressTracker('runtime-install', 8);

// Start operation
tracker.start('Installing runtime...');

// Update progress with step number and optional details
tracker.update('Uploading tools folder...', 1);
tracker.update('Uploading runtime files...', 2);

// Complete successfully
tracker.complete('Runtime installed successfully');

// Or report error
tracker.error('Installation failed', errorMessage);
```

### Standard Operation IDs

- `device-info-load` - Auto-load device info on connect (2 steps)
- `runtime-install` - Full runtime installation (8 steps)
- `runtime-upgrade` - Runtime upgrade with smart sync (6 steps)
- `runtime-refresh` - Refresh device runtime info (3 steps)
- `collection-deploy` - Full collection deployment (6 steps)
- `collection-sync` - Collection sync with changed files (5 steps)

### Progress Event Flow

```
Operation starts
  ↓
ProgressTracker.start() emits ProgressEvent(START)
  ↓
ProgressEventBus.emit() broadcasts to all subscribers
  ↓
UI views (DeviceDeploymentView, etc.) receive event
  ↓
Display progress indicators, disable buttons
  ↓
... operation steps ...
  ↓
ProgressTracker.update() emits ProgressEvent(UPDATE)
  ↓
UI updates progress bar, message
  ↓
ProgressTracker.complete() emits ProgressEvent(COMPLETE)
  ↓
UI hides progress, re-enables buttons
```

---

## Connection and Raw REPL Protocol

### DeviceConnection Layer

**Location**: `src/micro_otter/nodes/html/js/serial/device-connection.ts`

**Purpose**: Low-level serial communication and MicroPython REPL protocol implementation.

**Key Features**:

- **Raw REPL Protocol**: Implements MicroPython raw REPL following mpremote conventions
- **Command Execution**: Execute Python code via raw REPL with timeout handling
- **File Transfer**: Binary-safe file upload/download using base64 encoding
- **Connection Management**: Connect, disconnect, state tracking
- **Message Parsing**: Parse structured messages from device firmware

### `device-initialization-status` Event Contract

Emitted by `DeviceConnection` after `loadDeviceInfo()` success and on load failure.

Payload fields:

- `connectionState`: current connection state (`connected`, `connecting`, etc.)
- `runtimeDeploymentMode`: `embedded`, `dynamic`, or `unknown`
- `runtimePresent`: whether runtime is installed
- `specificTargetPresent`: whether an exact target id is present on device
- `initializationVerdict`: `ready`, `ready-for-runtime-install`, `needs-onboarding`, or `unknown`
- `onboardingActionable`: true only when verdict is `needs-onboarding` in embedded mode
- `reason` (optional): error context for unknown/error paths

Verdict rules:

- Embedded runtime + missing specific target id -> `needs-onboarding`
- Dynamic runtime + missing specific target id -> `ready-for-runtime-install`
- No runtime installed -> `ready-for-runtime-install`

### Raw REPL Entry (mpremote-compatible)

Following mpremote's proven protocol:

```ts
async _enterRawRepl() {
    return new Promise((resolve, reject) => {
        // 1. Send CR + Ctrl-C to interrupt running code
        await connection.send('\r\x03');
        await delay(100);

        // 2. Flush receive buffer
        this._receiveBuffer = '';

        // 3. Send CR + Ctrl-A to enter raw REPL
        await connection.send('\r\x01');

        // 4. Wait for exact prompt: "raw REPL; CTRL-B to exit\r\n>"
        // (Event-driven, not fixed delay)

        // 5. Clear buffer and resolve when prompt received
        this._receiveBuffer = '';
        resolve();
    });
}
```

**Key Improvements Over Fixed Delays**:

- Event-driven: Waits for actual prompt, not arbitrary timeout
- Carriage return prefix: `\r\x03` and `\r\x01` per mpremote protocol
- Buffer flushing: Clears stale data before and after entry
- 10-second timeout: Prevents hanging if device unresponsive
- Exact prompt matching: Looks for `"raw REPL; CTRL-B to exit"` string

### Command Execution Flow

```
executeCode(pythonCode)
  ↓
_executeRawCommand(code)
  ↓
_executeRawCommandWithTimeout(code, 10000ms)
  ↓
1. Remove permanent data handler (prevent dual processing)
  ↓
2. Install temporary handler for this command
  ↓
3. Send code + '\x04' (Ctrl-D to execute)
  ↓
4. Wait for 'OK\x04' (command accepted)
  ↓
5. Wait for output + '\x04>' (command complete)
  ↓
6. Extract output between OK and final \x04
  ↓
7. Restore permanent data handler
  ↓
8. Return output as Uint8Array
```

**Timeout Handling**:

- Default: 10 seconds per command
- Configurable via `commandTimeout` property
- Cleans up event listeners on timeout
- Throws `Error('Command timeout')` for error handling

---

## File Synchronization Strategy

### Hash-Based Change Detection

Both runtime upgrade and collection sync use **HashManifestManager** for centralized SHA256 hash-based file change detection:

```ts
// Unified Central Manifest (/.micro-otter-sync-manifest)
{
    "version": "1.0.0",
    "created": "2026-02-12T10:00:00Z",
    "updated": "2026-02-12T14:30:00Z",
    "runtime": {
        "runtimeId": "general",
        "version": "1.0.0",
        "files": {
            "main.py": "a1b2c3d4e5f6...",
            "boot.py": "f6e5d4c3b2a1..."
        }
    },
    "tools": {
        "files": {
            "tools/log.py": "1a2b3c4d5e6f...",
            "tools/wifi_manager.py": "2b3c4d5e6f7g..."
        }
    },
    "collection": {
        "collectionId": "my-collection",
        "collectionName": "My Collection",
        "files": {
            "app/main_loop.py": "3c4d5e6f7g8h...",
            "collection/node_graph_cln.json": "4d5e6f7g8h9i..."
        }
    }
}
```

### Comparison Logic

```ts
// Using HashManifestManager
await hashManager.load();  // Load from device

// Check if file needs upload
for (const file of localFiles) {
    if (hashManager.needsUpload('runtime', file.devicePath, file.localHash)) {
        filesToUpload.push(file);  // Hash differs or file missing → upload
    } else {
        skippedFiles.push(file);   // Hash matches → skip
    }
}

// After upload, update manifest
hashManager.updateHashes('runtime', localHashes);
await hashManager.save();  // Write back to device
```

### Benefits

- **Minimizes Transfers**: Only upload files that actually changed
- **Fast Upgrades**: Upgrade runtime in seconds instead of minutes
- **Bandwidth Efficient**: Critical for slow serial connections (~115200 baud)
- **Integrity Verification**: Hash mismatch detects corruption
- **Single Source of Truth**: One manifest for runtime + tools + collection
- **Consistent Logic**: Same hash comparison across all deployment phases

---

## View Integration

### Deployment Entry Points

Two callers reach the shared deployment path, and both only pass parameters:

- **Main toolbar quick action** (`WorkspaceView._handleUploadToDevice`) → `deployCollection(collection, { includeFullDefinition: false, force: false })`. It never opens the deploy options dialog, not even when the firmware's node packages are out of date: the override decision is not a toolbar decision. The dialog that does appear in that case is the shared embedded source override confirmation, raised one layer down while the deploy runs, and confirming it uploads the package sources. A user decline (`EMBEDDED_SOURCE_OVERRIDE_DECLINED`) is swallowed silently so the button simply re-enables. When the fail-closed gate blocks the upload instead (`EMBEDDED_OVERRIDE_APPROVAL_REQUIRED`), the quick action swaps the generic failure text for a *Firmware Packages Outdated* dialog that names `packageIds` and points at the Device tab's **Upload firmware package source** option, logged as `upload-blocked-firmware-package-override`.
- **Device Deployment view** (`DeviceDeploymentView._handleDeployCollection` / `_handleSyncCollection`) → same services with the options chosen in its form dialog.

Neither caller decides whether host sources may shadow firmware packages: that gate lives in
`DeviceDeployment` and is described in
[Device Deployment API](./device-deployment-api.md#embedded-source-override-consent-gate-collection-deploy).

### DeviceDeploymentView

**Location**: `src/micro_otter/nodes/html/js/views/device-deployment-view.ts`

**Purpose**: Primary UI for deployment operations with runtime/collection control and progress display.

**Event Subscriptions**:

```ts
// Device state changes
deviceDeployment.addEventListener('device-state-changed', (event) => {
    const state = event.detail;
    // Update UI: connection indicator, runtime status, collection status
});

// Device info loaded
deviceDeployment.addEventListener('device-info-loaded', () => {
    // Show device details, enable deployment buttons
});

// Device info load error
deviceDeployment.addEventListener('device-info-load-error', (event) => {
    // Show error message, provide retry option
});

// Progress events (via ProgressEventBus)
ProgressEventBus.subscribe((progressEvent) => {
    // Update progress bars, status messages
    // Show/hide loading panels
    // Disable buttons during operations
});
```

**UI Components**:

- **Connection Status Panel**: Shows connect/disconnect state, MicroPython detection
- **Device Info Panel**: Displays runtime version, target, collection
- **Runtime Controls**: Install/Upgrade/Remove runtime buttons
- **Collection Controls**: Deploy/Sync/Remove collection buttons
- **Progress Indicators**: Loading spinners, progress bars during operations
- **Refresh Button**: Manual trigger for device info reload

**Loading State Handling**:

```ts
_updateUI(state) {
    if (state.deviceInfoLoading) {
        // Show loading panel
        // Disable all buttons except refresh
        // Display "Loading device info..." message
    } else if (!state.connected) {
        // Show disconnected state
    } else if (!state.hasMicroPython) {
        // Show "MicroPython not found" message
    } else {
        // Show device details and enable controls
    }
}
```

---

## Error Handling

### Multi-Layer Error Strategy

**1. DeviceConnection Layer**:

- Connection failures: `Error('Connection failed')`
- Timeout errors: `Error('Command timeout')`
- Protocol errors: `Error('Invalid response')`

**2. DeviceDeployment Layer**:

- Pre-condition checks: `if (!connected) throw Error('Device not connected')`
- State validation: `if (!hasMicroPython) throw Error('MicroPython not detected')`
- Error event emission: `dispatchEvent(new CustomEvent('operation-error', {...}))`

**3. Specialist Layers (Runtime/Collection)**:

- Operation-specific errors: `Error('Runtime not found')`
- Validation errors: `Error('Collection incompatible with target')`
- Progress error events: `tracker.error('Installation failed', errorMessage)`

**4. UI Layer**:

- Catch errors from async operations
- Display user-friendly error messages via dialogs
- Log detailed errors to console for debugging
- Provide retry mechanisms where appropriate

### Error Recovery

```ts
try {
    await deviceDeployment.installRuntime('general');
} catch (error) {
    // Log detailed error
    console.error('Runtime installation failed:', error);

    // Show user-friendly dialog
    await showErrorDialog({
        title: 'Installation Failed',
        message: i18n.t('errorInstallRuntime'),
        details: error.message,
        actions: ['Retry', 'Cancel'],
    });
}
```

---

## State Machine

### Device State Transitions

```
┌─────────────────┐
│  DISCONNECTED   │
│  connected=false│
└────────┬────────┘
         │ connect()
         ▼
┌─────────────────┐
│   CONNECTING    │ (brief intermediate)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   CONNECTED     │  deviceInfoLoading=true
│ hasMicroPython  │  auto-trigger: detectMicroPython()
│    = null       │              + refreshDeviceInfo()
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌──────┐  ┌──────────────┐
│  NO  │  │ MICROPYTHON  │ hasMicroPython=true
│  MP  │  │   DETECTED   │ deviceInfoLoading=false
└──────┘  └──────┬───────┘
              │ refreshDeviceInfo()
              │
          ┌───┴────┐
          │        │
          ▼        ▼
    ┌─────────┐ ┌───────────────┐
    │   NO    │ │   RUNTIME     │ runtimeInstalled=true
    │ RUNTIME │ │  INSTALLED    │
    └─────────┘ └───────┬───────┘
                    │ deployCollection()
                    │
                ┌───┴──────┐
                │          │
                ▼          ▼
          ┌──────────┐ ┌──────────────┐
          │    NO    │ │  COLLECTION  │ collectionDeployed=true
          │COLLECTION│ │   DEPLOYED   │
          └──────────┘ └──────────────┘
```

---

## Testing Strategy

### Manual Testing Checklist

See: `ldev/manual_tests/deployment-phase1-phase2-testing.md`

**Key Test Cases**:

1. **Auto-Detection on Connect**
    - Connect device → MicroPython detected → Device info loaded
    - Progress events emitted correctly
    - UI shows loading state then device details

2. **Auto-Detection on Startup**
    - Device already connected when app starts
    - Constructor triggers detection via queueMicrotask
    - No race conditions with event listener attachment

3. **Runtime Installation**
    - Fresh install uploads all files
    - Sync manifest created on device
    - State updated correctly

4. **Runtime Upgrade**
    - Existing manifest downloaded
    - Only changed files uploaded
    - Fast completion (seconds, not minutes)

5. **Collection Deployment**
    - Graphs transpiled successfully
    - Only used node libraries uploaded
    - Collection metadata correct

6. **Error Scenarios**
    - Disconnection during operation
    - Command timeout handling
    - Invalid runtime/collection
    - Incompatible target

### Unit Testing

**Location**: `tests/deployment/`

- `device-deployment.test.js` - Main orchestrator tests
- Runtime/collection specialist tests

**Approach**:

- Mock DeviceConnection for controlled testing
- Test state transitions and event emission
- Verify delegation to specialists
- Test error handling and recovery

---

## Future Enhancements

### Phase 4 Feature Ideas

1. **Advanced Configuration**
    - Per-device configuration profiles
    - Custom boot behavior
    - Network/WiFi setup

2. **Multi-Graph Deployment**
    - Deploy multiple graphs simultaneously
    - Graph dependency resolution
    - Inter-graph communication

3. **Over-The-Air (OTA) Updates**
    - Wireless runtime/collection updates
    - Delta patching for large files
    - Rollback on failure

4. **Device Fleet Management**
    - Deploy to multiple devices
    - Version tracking across fleet
    - Centralized monitoring

---

## Related Documentation

- **[DeviceDeployment API Reference](device-deployment-api.md)** - Complete API documentation
- **[Deployment Access Control](deployment-access-control.md)** - Public vs internal methods
- **[Device Communication Protocol](../device-communication/)** - Low-level REPL protocol details
- **[Progress Event System](../core/progress-event-system.md)** - Progress tracking patterns

---

## Revision History

| Date       | Version | Changes                                                                                                                                                          |
| ---------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-02-10 | 1.0     | Initial documentation of implemented architecture                                                                                                                 |
|            |         | Added auto-loading device info on connect                                                                                                                        |
|            |         | Documented delegation pattern with specialist classes                                                                                                            |
|            |         | Added mpremote-compatible raw REPL protocol                                                                                                                      |
|            |         | Documented progress event integration                                                                                                                            |
| 2026-11-03 | 1.1     | Documented the deploy pattern "Complete Plan, Subtractive Removal" (invariant, decision table, firmware-replaceability guard, observability log events)           |
|            |         | Removed the manifest-derived `available-dynamic` availability decision; recorded the on-device library inventory as display-only metadata                         |
|            |         | Added the null-version shadow fallback (`UNKNOWN_DEVICE_VERSION`) and the non-firmware RAM warning (`deployment.packageNotInFirmware`)                            |

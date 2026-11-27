# DeviceDeployment API Reference

## Overview

**DeviceDeployment** is the core business logic class for deploying MicroPython runtimes and user collections to ESP32 devices via Web Serial. It provides high-level operations for device management, file synchronization, and runtime lifecycle control.

**Location**: `src/micro_otter/nodes/html/js/deployment/device-deployment.ts`

**Implementation Status**:

- ✅ **Phase 1**: File operations & MicroPython detection (Complete)
- ✅ **Phase 2**: Runtime installation & upgrade (Complete)
- ✅ **Phase 3**: Collection deployment (Complete)
- ✅ **Phase 4**: Device info loading + custom runtime views (Complete)

### Runtime Mode Contract (Collection Deploy)

Collection deployment preserves the device's pre-deploy runtime mode:

- If the device is in **play mode** before deploy, deployment ends in **play mode**.
- If the device is in **stopped mode** before deploy, deployment ends in **stopped mode**.

This behavior is implemented through `DeviceConnection` public APIs:

- `isExecutionRunning()` captures current mode before deployment reset.
- `softReset({ startRunning })` restores the same mode after file updates.

This keeps runtime mode restoration centralized in deployment/reset orchestration and avoids duplicated mode logic in UI layers.

### Embedded Source Override Consent Gate (Collection Deploy)

`deployCollection()` and `syncCollectionFiles()` are the **only** entry points that may upload
host sources which shadow firmware-bundled (embedded) packages. Both run the same gate:

1. `_computeEmbeddedOverridePlan(collection)` builds the override plan from the shared firmware
   module plan (`resolveFirmwareModulePlan()` in `embedded-module-plan.ts`), which classifies every
   firmware-bundled package as current, outdated, unknown, incomplete or content-mismatched and
   shadows the whole package for everything but "current" (see
   [Embedded Runtime Compatibility](./embedded-runtime-compatibility-deploy.md)). The preflight
   resolves exactly one runtime (`_resolveEmbeddedPlanRuntime()`) and logs
   `collection-embedded-override-preflight`.
2. When the plan is empty or `null`, no dialog is shown and the deploy proceeds unchanged.
3. Otherwise `_resolveEmbeddedSourceOverrides()` asks the user once through the injected
   `ViewManager`:
   - `showConfirmationWithCheckbox({ title, message, confirmLabel, cancelLabel,
     checkboxLabel, checkboxChecked })` when available — it returns
     `{ confirmed, checkboxChecked }`;
   - `showConfirmation(options)` as a fallback (no checkbox, therefore never remembered).
   - If **neither** exists the deploy fails closed with
     `Error('Cannot confirm embedded source override: confirmation dialog unavailable')`;
     nothing is uploaded.
4. Confirming proceeds with the plan as `embeddedLibraryOverridePaths`; declining throws
   `EmbeddedSourceOverrideDeclinedError` (`code: 'EMBEDDED_SOURCE_OVERRIDE_DECLINED'`,
   `packageIds`), which callers treat as a user cancellation rather than a failure.
5. `CollectionDeployment` then enforces the approval: a planned shadow path that is not in
   `embeddedLibraryOverridePaths` aborts the deploy with
   `EmbeddedOverrideApprovalRequiredError` (`code: 'EMBEDDED_OVERRIDE_APPROVAL_REQUIRED'`,
   `packageIds`, `missingPaths`) before any file is uploaded. The toolbar quick action turns that
   code into a *Firmware Packages Outdated* dialog naming the packages and pointing at the Device
   tab's **Upload firmware package source** option (log `upload-blocked-firmware-package-override`)
   instead of a generic upload failure. See
   [deployment-system-architecture.md → Shadow uploads require approval](./deployment-system-architecture.md#shadow-uploads-require-approval-fail-closed).

**Gate options.**

| Option | Meaning |
|---|---|
| `forceShadow` | Internal flag of `_resolveEmbeddedSourceOverrides()`: shadow every in-use firmware-bundled package with reason `forced-override`, always show the dialog (a remembered approval is ignored), and log `collection-embedded-override-forced-request`. Declining throws `EmbeddedSourceOverrideDeclinedError`. |
| `embeddedOverrideMode: 'forced'` | `CollectionDeployOptions` value forwarded to `CollectionDeployment` when the user ticked **Upload firmware package source** in the deploy options. It only changes the audit log to `collection-library-override-forced`; the approved path list must still cover every shadow file. |
| `overrideFirmwarePackages?: boolean` | Public option of `deployCollection()` / `syncCollectionFiles()` set by that checkbox. It becomes `forceShadow` for the gate (every in-use firmware-bundled package shadows as a whole, dialog always shown, decline throws) and forwards `embeddedOverrideMode: 'forced'`. Independent of `force`, which rewrites the deployed files without touching firmware-provided packages. |

**"Remember for this version".** When the confirmation carries the optional checkbox and the
user ticks it *and* confirms, the approval is remembered for the rest of the page session under
the signature `<packageId>@<deviceVersion>-><hostVersion>#<reason>` (sorted, joined with `|`) of
every shadowed package (outdated, unknown, incomplete or content-mismatched):

- a different package set, firmware version, host version or shadow reason produces a different
  signature and therefore asks again;
- the approval is **never persisted**, is cleared on `device-connected`/`device-disconnected`,
  and is never written by a decline;
- the remembered path still forwards a freshly computed plan, so it can never freeze a stale
  file list;
- a legacy `showConfirmation`-only view manager can never memoise an approval.

Relevant log tags: `collection-embedded-override-decision`,
`collection-embedded-override-memoized`, `collection-embedded-override-approval-remembered`.

**Dialog gating.** `DeviceDeploymentView` offers the checkbox only when the same preflight would
shadow something: `validateNodePackages(collection)` returns `shadowPackages` (sorted
`{ packageId, deviceVersion, hostVersion, reason }` entries, embedded mode only, empty array
otherwise) and the options dialog is built from its length. That list is exactly the set the
`deployment.packageVersion*` / `deployment.packageIncomplete` warnings are derived from, so the
option can never promise an upload the plan would skip. A content mismatch proven by the later
device probe is still covered — the gate dialog above always asks before it shadows anything.

The approval only controls *whether* host source may shadow firmware; *what* the deploy then uploads
and what it removes is governed by the
[Deploy Pattern: Complete Plan, Subtractive Removal](./deployment-system-architecture.md#deploy-pattern-complete-plan-subtractive-removal) —
the manifest never decides plan membership, so an approved override survives every later redeploy
until the firmware catches up or the collection stops using the package.

### On-Device Library Inventory (Display Only)

`CollectionDeployment.getDynamicLibraryPathsOnDevice()` returns the `libs/` / `otter_*` paths that
the device user space currently holds according to the hash manifest, sorted alphabetically:

```js
const paths = await deployment.getDynamicLibraryPathsOnDevice();
// e.g. ['otter_stdmo/servo.py', 'otter_vars/arrays.py']
```

- It re-loads the manifest, so it also works before the first deploy of the page session.
- It never throws: an unreadable or corrupt manifest yields `[]` and logs
  `collection-dynamic-inventory-load-failed`.
- It is **informational only** — it feeds the Device Info block in the deployment dialog and
  diagnostics. It is **not** an input to plan membership. The deploy plan is derived from the node
  graph plus firmware (embedded inventory) information; the manifest is only the left-hand side of
  the stale subtraction (`removal = manifest − plan`). Using this set to skip paths would make
  "on device ⇒ not planned ⇒ deleted as stale", which is exactly the bug fixed for source
  overrides — see
  [Deploy Pattern: Complete Plan, Subtractive Removal](./deployment-system-architecture.md#deploy-pattern-complete-plan-subtractive-removal).
- The same data is recorded during a deploy in `CollectionDeployment._dynamicLibraryPathsOnDevice`
  (a `Set<string>`), which is only assigned for diagnostics; after the deploy it holds the
  pre-deploy inventory.

`DeviceDeployment.getDynamicLibraryPathsOnDevice()` is a thin passthrough to the same accessor for
consumers that only hold the service object:

```js
const paths = await deviceDeployment.getDynamicLibraryPathsOnDevice();
```

The deploy view calls it from `_onDeviceInfoLoaded` (fire-and-forget) to fill the Device Info row
**Libraries on Device** (`deployment.dynamicLibrariesOnDevice`), which renders
`deployment.fileCountOnDevice` when the list is non-empty and `deployment.noneOnDevice` when it is
empty. Dynamic (non-embedded) runtimes render `-` without reading the manifest, and a read failure
also renders `-` (logged as `dynamic-libraries-on-device-failed`) instead of surfacing an error.

### Embedded Setup API Runtime Deploy

When API-based runtime detection reports embedded mode, runtime upgrade/refresh
requests are routed to a firmware-owned setup API path instead of full runtime
filesystem upload.

Embedded route behavior:

1. Call `apply_bootstrap_setup(options)` over `executeCode`.
2. Pass `force` / `forcePaths` only — firmware setup does not accept target content.
3. Validate setup response payload (`schemaVersion`, `ok`, `results`, `errors`).
4. Abort and surface setup-result errors if any file actions fail.
5. Run mandatory `refreshDeviceInfo()` after successful setup.

`/device/targets/active_target.json` is not a setup artifact: the app is its only writer, through
`_uploadTargetConfiguration` on target confirmation.

Embedded setup route emits:

1. `runtime-embedded-compatibility-deployed`
2. `runtime-upgraded` (completion signal for existing listeners)

If embedded metadata API detection is unavailable or invalid, routing falls back
to default dynamic deploy behavior.

### Specific Target Onboarding

Embedded refresh flow now enforces specific board onboarding when target identity is unset.

Ownership contract:

1. `DeviceConnection` emits `device-initialization-status` after `loadDeviceInfo()`.
2. `DeviceDeployment` subscribes to that status event and decides whether onboarding is required.
3. Dialog rendering and target persistence remain deployment-layer responsibilities.
4. `DeviceConnection` remains transport/runtime-state only (no dialog/policy logic).

Behavior contract:

1. `refreshDeviceInfo()` loads embedded runtime metadata and judges the stored target: a complete
   payload yields `deviceTargetInfo`; a missing file, an incomplete/legacy skeleton or an
   image-family mismatch yields `deviceTargetInfo === null` plus a `targetConfigurationIssue`
   verdict (`missing` | `incomplete` | `image-incompatible`). Malformed JSON is also dropped (no
   target adopted) but carries no verdict.
2. If the target is unset **or** unusable, DeviceDeployment computes allowed targets from `/device/targets/compile_target_mappings.json` using runtime id + compile board metadata.
3. Runtime filtering uses rule lists `runtimeIdInclude` and `runtimeIdExclude`; exclude entries always override include matches.
4. Legacy `runtimeIdPattern` rules are unsupported in current mapping files.
5. A required target dialog is shown with filtered options, a custom user-description input, and the
   previously stored id pre-filled as a hint (`getConfiguredTargetIdHint()`) so repair does not start
   from an empty selection.
6. Selection is persisted via the single writer `_uploadTargetConfiguration`:
    - `/device/targets/active_target.json`
    - `/device.json` target fields (`targetId`, display/description, `targetUserDescription`)
7. If a complete target is already stored, refresh does not prompt.

Log keys: `load-target-config-missing` (info), `load-target-capabilities-incomplete` (info),
`load-target-capabilities-failed` (read error), `target-config-image-incompatible`
(`result: 'reject'`).

Failure semantics:

1. Empty allowed-target set for embedded onboarding is treated as an error.
2. User cancellation is treated as a blocking error because specific target selection is mandatory before continuing.

### Deploy Preflight Guard (Target Validation Ordering)

`deployCollection()` now enforces initialization preflight before target mismatch validation:

1. Evaluate latest initialization status from `DeviceConnection`.
2. If actionable `needs-onboarding`, run refresh/onboarding gate first.
3. Validate collection target compatibility only after onboarding is complete.
4. If onboarding is cancelled, deployment fails with explicit onboarding-required diagnostics.

---

## Constructor

```ts
const deviceDeployment = new DeviceDeployment({
    deviceConnection, // DeviceConnection instance (required)
    collectionManager, // CollectionManager instance (required)
    runtimeCollection, // RuntimeCollection instance (required)
    transpiler, // Transpiler instance (required)
    i18nService, // I18nService instance (required)
    viewManager, // ViewManager instance (required)
});
```

**Parameters**:

- **deviceConnection**: Instance of `DeviceConnection` for serial communication
- **collectionManager**: Instance of `CollectionManager` for collection data access
- **runtimeCollection**: Instance of `RuntimeCollection` for runtime manifest access
- **transpiler**: Instance of `Transpiler` for code generation
- **i18nService**: Instance of `I18nService` for localized prompts
- **viewManager**: Instance of `ViewManager` for modal dialogs

**Example**:

```ts
import { DeviceDeployment } from './deployment/device-deployment.js';
import { DeviceConnection } from './serial/device-connection.js';
import { RuntimeCollection } from './data/runtime-collection.js';

const deviceConnection = new DeviceConnection({
    /* ... */
});
const runtimeCollection = new RuntimeCollection();
await runtimeCollection.load();

const deviceDeployment = new DeviceDeployment({
    deviceConnection,
    collectionManager: workspace.collectionManager,
    runtimeCollection,
    transpiler: workspace.transpiler,
    i18nService: workspace.i18nService,
    viewManager: workspace.viewManager,
});
```

---

## Device State Management

### getDeviceState()

Returns the current immutable `DeviceState` instance.

**Signature**:

```ts
getDeviceState(): DeviceState
```

**Returns**: `DeviceState` with the following properties:

```ts
{
    connected: boolean,              // Connection status
    hasMicroPython: boolean|null,    // null=unknown, true/false=detected/missing
    micropythonVersion: string|null, // MicroPython version string
    runtimeInstalled: boolean,       // Runtime presence
    runtimeDeploymentMode: 'dynamic'|'embedded'|null,
    runtimeEmbedded: boolean,
    runtimeVersion: string|null,     // Installed runtime version (e.g., "1.0.0")
    runtimeId: string|null,          // Runtime identifier (e.g., "general")
    runtimeName: string|null,        // Runtime display name
    runtimeDescription: string|null, // Runtime description
    runtimeCustomView: string|null,  // Custom view path/filename
    bootstrapSetupReady: boolean|null,
    bootstrapSetupStatus: {
        schemaVersion: number,
        ready: boolean,
        files: Array<{ path: string, exists: boolean, valid: boolean, reason: string|null }>,
        missingOrInvalid: Array<{ path: string, reason: string }>,
        errors: Array<{ category: string, message: string, path?: string }>
    }|null,
    collectionDeployed: boolean,     // Collection deployment status
    collectionName: string|null,     // Deployed collection name
    collectionVersion: string|null,  // Deployed collection version
    deviceTargetInfo: DeviceTargetInfo|null, // Target capabilities + instance data
    deviceInfoLoading: boolean,      // True while loading device info
    deviceInfoLoadError: string|null // Error message if loading failed
}
```

**Example**:

```ts
const state = deviceDeployment.getDeviceState();
console.log('Connected:', state.connected);
console.log('Runtime:', state.runtimeId, state.runtimeVersion);

if (state.deviceTargetInfo) {
    const target = state.deviceTargetInfo;
    console.log('Target:', target.displayName || target.id);
    if (target.instanceData?.userDescription) {
        console.log('Notes:', target.instanceData.userDescription);
    }
}
```

**Note**: `DeviceState` instances are immutable; use `DeviceState.update()` to derive new state.

When the stored target is rejected, `deviceTargetInfo` is `null` and the deployment layer exposes
the reason as `deviceDeployment.targetConfigurationIssue`: `'missing'` (file absent),
`'incomplete'` (payload lacks pin information), `'image-incompatible'` (stored target's base does not
match the flashed image's board family), or `null` (usable, or not judgeable without a runtime). That
non-null issue is what arms the `needs-onboarding` verdict and the pre-filled repair dialog.

`validateCollectionCompatibility()` reports the same split with localised messages:
`deployment.errors.deviceTargetNotConfigured` for a missing/incomplete target (re-select a target) and
`deployment.errors.deviceTargetIncompatible` for an image-family mismatch (select a target from the
same board family).

### isConnected()

Check if device is currently connected.

**Signature**:

```ts
isConnected(): boolean
```

**Returns**: `true` if device is connected, `false` otherwise

**Example**:

```ts
if (!deviceDeployment.isConnected()) {
    console.warn('Device not connected');
    return;
}
```

### hasMicroPython()

Check if MicroPython has been detected on the device.

**Signature**:

```ts
hasMicroPython(): boolean | null
```

**Returns**:

- `true` - MicroPython detected
- `false` - MicroPython not found
- `null` - Detection not yet performed

**Example**:

```ts
const hasMicroPython = deviceDeployment.hasMicroPython();
if (hasMicroPython === null) {
    console.log('Detection not yet performed');
} else if (!hasMicroPython) {
    console.error('MicroPython not found on device');
}
```

---

## Phase 1: File Operations

**Note**: Basic file operations are implemented in **DeviceConnection**, not DeviceDeployment. Access them via the `deviceConnection` instance.

### uploadFile(remotePath, content)

Upload a file to the device.

**Signature**:

```ts
// Use DeviceConnection directly
async sendFile(remotePath: string, content: string | Uint8Array): Promise<void>
```

**Parameters**:

- **remotePath**: Device file path (e.g., `/main.py`, `/libs/servo.py`)
- **content**: File content (string or binary data)

**Example**:

```ts
// Upload text file
await deviceConnection.sendFile('/main.py', pythonCode);

// Upload binary file
const binaryData = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
await deviceConnection.sendFile('/data.bin', binaryData);

// For text files, you can also use:
await deviceConnection.writeTextFile('/config.json', jsonString);
```

**Behavior**:

- Uses chunked base64 transfer (4096 bytes per chunk)
- Creates parent directories automatically
- Emits progress events via ProgressEventBus
- Throws if device not connected or upload fails

### downloadFile(remotePath)

Download a file from the device.

**Signature**:

```ts
// Use DeviceConnection directly
async readTextFile(remotePath: string): Promise<string>
async receiveFile(remotePath: string): Promise<Uint8Array>
```

**Parameters**:

- **remotePath**: Device file path to download

**Returns**:

- `readTextFile`: File content as string
- `receiveFile`: Binary file content as `Uint8Array`

**Example**:

```ts
const text = await deviceConnection.readTextFile('/config.json');
const config = JSON.parse(text);

const binary = await deviceConnection.receiveFile('/firmware.bin');
console.log(binary.length);
```

**Behavior**:

- Uses `DeviceConnection.readTextFile()` for text content
- Uses `DeviceConnection.receiveFile()` for binary content
- Throws if file not found or download fails

### deleteFile(remotePath)

Delete a file from the device.

**Signature**:

```ts
async deleteFile(remotePath: string): Promise<void>
```

**Parameters**:

- **remotePath**: Device file path to delete

**Example**:

```ts
await deviceConnection.deleteFile('/old_main.py');
```

**Behavior**:

- Executes `DeviceConnection.deleteFile()`
- Throws if file not found or deletion fails

### deleteFolderRecursive(remotePath)

Delete a folder and its contents from the device.

**Signature**:

```ts
async deleteFolderRecursive(remotePath: string): Promise<void>
```

**Example**:

```ts
await deviceConnection.deleteFolderRecursive('/nodes');
```

### deleteFileSystem()

Delete all files and folders from the device root.

**Signature**:

```ts
async deleteFileSystem(): Promise<string>
```

**Example**:

```ts
await deviceConnection.deleteFileSystem();
```

### listFiles(remotePath)

List files and directories at the specified path.

**Signature**:

```ts
async listFiles(remotePath: string = '/'): Promise<FileEntry[]>
```

**Parameters**:

- **remotePath**: Directory path to list (defaults to root `/`)

**Returns**: Array of `FileEntry` objects:

```ts
{
    name: string,      // File or directory name
    type: 'file'|'dir', // Entry type
    size: number       // Size in bytes (0 for directories)
}
```

**Example**:

```ts
const files = await deviceDeployment.listFiles('/libs');
for (const file of files) {
    console.log(`${file.name} (${file.type}): ${file.size} bytes`);
}
```

**Behavior**:

- Executes `os.listdir()` and `os.stat()` via MicroPython REPL
- Returns empty array if path doesn't exist

### calculateHash(remotePath)

Calculate SHA256 hash of a file on the device.

**Signature**:

```ts
async calculateHash(remotePath: string): Promise<string>
```

**Parameters**:

- **remotePath**: Device file path to hash

**Returns**: SHA256 hash as 64-character hexadecimal string

**Example**:

```ts
const hash1 = await deviceDeployment.calculateHash('/main.py');
// Upload new version
await deviceDeployment.uploadFile('/main.py', newCode);
const hash2 = await deviceDeployment.calculateHash('/main.py');

if (hash1 !== hash2) {
    console.log('File changed');
}
```

**Behavior**:

- Executes `hashlib.sha256()` via MicroPython REPL
- Used for incremental sync (upload only changed files)

### detectMicroPython()

Detect if MicroPython is installed on the connected device.

**Signature**:

```ts
async detectMicroPython(): Promise<boolean>
```

**Returns**: `true` if MicroPython detected, `false` otherwise

**Example**:

```ts
const hasMicroPython = await deviceDeployment.detectMicroPython();
if (!hasMicroPython) {
    console.error('MicroPython not found. Please flash MicroPython firmware first.');
    return;
}
```

**Behavior**:

1. Executes a simple REPL command to confirm MicroPython responsiveness
2. Queries `sys.version` when a prompt is available
3. Parses version information
4. Updates device state

---

## Phase 2: Runtime Lifecycle

### listInstalledRuntime()

Read runtime and target configuration information from the connected device.

**Signature**:

```ts
async listInstalledRuntime(): Promise<Object|null>
```

**Returns**: Runtime information object or `null` if no runtime installed

**Runtime Information Object**:

```ts
{
    id: string,                    // Runtime identifier (e.g., "general")
    name: string,                  // Runtime display name
    version: string,               // Runtime version (e.g., "1.0.0")
    description: string,           // Runtime description
    targetId?: string,             // Target device identifier (e.g., "esp32_wroom")
    targetDisplayName?: string,    // Human-readable target name
    targetDescription?: string     // Target configuration description
}
```

**Example**:

```ts
const runtime = await deviceDeployment.listInstalledRuntime();
if (runtime) {
    console.log(`Runtime: ${runtime.id} (${runtime.name}) v${runtime.version}`);
    if (runtime.targetId) {
        console.log(`Target: ${runtime.targetDisplayName} (${runtime.targetId})`);
        console.log(`Description: ${runtime.targetDescription}`);
    }
} else {
    console.log('No runtime installed');
}
```

**Behavior**:

1. Uses cached device info if available
2. Otherwise loads device info from the device
3. Returns runtime + target metadata (if present)
4. Returns `null` if no runtime is installed or data is unavailable
5. Does NOT update device state (read-only query)

**Use Cases**:

- Check if runtime needs upgrade before installation
- Display device information to user on reconnection
- Validate target compatibility before collection deployment

**Note**: This is a read-only query method. Use `installRuntime()` to modify the device state.

### installRuntime(runtimeId, options)

Install a complete runtime environment on the device.

**Signature**:

```ts
async installRuntime(runtimeId: string, options?: InstallOptions): Promise<void>
```

**Parameters**:

- **runtimeId**: Runtime identifier (e.g., `'general'`)
- **options**: Optional configuration object

**InstallOptions**:

```ts
{
    skipLibs: boolean,      // Skip library upload (default: false)
    forceUpload: boolean,   // Force upload all files (default: false)
    preserveData: boolean   // Preserve user data (default: false)
}
```

**Example**:

```ts
// Full runtime installation
await deviceDeployment.installRuntime('general');

// Install without libraries (for testing)
await deviceDeployment.installRuntime('general', { skipLibs: true });
```

**Behavior**:

1. Detect MicroPython presence (throws if not found)
2. **Target Selection**: If no usable target is stored (file missing, payload incomplete, or
   image-family mismatch), show the target selection dialog:
    - Options are filtered to targets that can run on the flashed firmware (`targetConstraints`)
    - The rejected target id is pre-filled as a hint when there was one
    - User selects target from available options (e.g., ESP32-WROOM-32, ESP32-S3)
    - Target description is displayed (read-only) to help user choose
    - User can optionally add custom notes (e.g., "Workshop device - pin 5 broken")
    - Confirming persists the selection through `_uploadTargetConfiguration` →
      `/device/targets/active_target.json` plus the `/device.json` target fields
3. Preserve files declared in `manifest.preservedPaths` (if `preserveData: true`)
4. Delete existing runtime files (`/libs/`, `/app/`, `/main.py`)
5. Upload all files from runtime `filesystem` manifest
6. Upload base libraries from `nodeLibraries.alwaysInclude`
7. Restore preserved files
8. Update device state (runtime installed, version, ID, target info)
9. Emit progress events for UI

**Target Selection Dialog**:

The target selection dialog appears on first runtime installation and allows users to:

- Choose the hardware variant (different ESP32 models have different pin layouts)
- View target description (read-only) showing hardware specifications
- Add custom description for personal notes (optional, e.g., device location or known issues)

Dialog fields:

- **Device Target** (dropdown): Hardware configuration (required)
- **Target Description** (read-only textarea): Configuration details from target manifest
- **Your Description** (editable textarea): User's custom notes (optional)

Target content is persisted in `/device/targets/active_target.json` (the app is its only writer), and
`/device.json` mirrors the id/display name/descriptions for quick reads; both are retrieved on
reconnection by `refreshDeviceInfo()` / `listInstalledRuntime()`.

**Progress Events**:

- Source: `'runtime-install'`
- Steps: detect, target-selection (if needed), delete, upload, verify

**Emitted Events**:

- `device-state-changed` - Runtime state updated

**Errors**:

- Throws if device not connected
- Throws if MicroPython not detected
- Throws if runtime not found in RuntimeCollection

### upgradeRuntime(runtimeId, options)

Upgrade existing runtime with smart file synchronization.

**Signature**:

```ts
async upgradeRuntime(runtimeId: string, options?: UpgradeOptions): Promise<void>
```

**Parameters**:

- **runtimeId**: Runtime identifier (e.g., `'general'`)
- **options**: Optional configuration object

**UpgradeOptions**:

```ts
{
    skipLibs: boolean,      // Skip library upload (default: false)
    forceUpload: boolean,   // Force upload all files (default: false)
    preserveData: boolean   // Preserve user data (default: true for upgrade)
}
```

**Example**:

```ts
// Upgrade with smart sync
await deviceDeployment.upgradeRuntime('general');

// Force full re-upload
await deviceDeployment.upgradeRuntime('general', { forceUpload: true });
```

**Behavior**:

1. Check if runtime currently installed (throws if not)
2. Preserve files declared in `manifest.preservedPaths`
3. Get file hashes from device
4. Compare with local runtime file hashes
5. Upload **only changed files**
6. Skip unchanged files (optimization)
7. Restore preserved files
8. Update device state (new version)

**Smart Upload**:

- Calculates SHA256 hashes for all runtime files
- Compares with device file hashes
- Uploads only files that changed
- Significantly faster than full re-upload

**Progress Events**:

- Source: `'runtime-upgrade'`
- Steps: preserve, compare, upload, restore

**Emitted Events**:

- `device-state-changed` - Runtime version updated

### removeRuntime(options)

Remove runtime from the device.

**Signature**:

```ts
async removeRuntime(options?: RemoveOptions): Promise<void>
```

**Parameters**:

- **options**: Optional configuration object

**RemoveOptions**:

```ts
{
    preserveData: boolean; // Preserve user data (default: false)
}
```

**Example**:

```ts
// Complete removal
await deviceDeployment.removeRuntime();

// Remove but keep user data
await deviceDeployment.removeRuntime({ preserveData: true });
```

**Behavior**:

1. Preserve files declared in `manifest.preservedPaths` (if `preserveData: true`)
2. Delete runtime folders: `/libs/`, `/app/`, `/nodes/`
3. Delete `main.py` and `boot.py`
4. Update device state (no runtime installed)

**Emitted Events**:

- `device-state-changed` - Runtime removed

### refreshRuntime(runtimeId, options)

Selective update of runtime files (fix corrupted installation).

**Signature**:

```ts
async refreshRuntime(runtimeId: string, options?: RefreshOptions): Promise<void>
```

**Parameters**:

- **runtimeId**: Runtime identifier
- **options**: Optional configuration object

**RefreshOptions**:

```ts
{
    skipLibs: boolean,      // Skip library upload (default: false)
    forceUpload: boolean    // Force upload all files (default: false)
}
```

**Example**:

```ts
// Refresh all files
await deviceDeployment.refreshRuntime('general');

// Refresh only runtime code, skip libraries
await deviceDeployment.refreshRuntime('general', { skipLibs: true });
```

**Behavior**:

- Similar to `upgradeRuntime()` but with more granular control
- Does NOT delete files first (overwrites existing)
- Preserves files declared in `manifest.preservedPaths`
- Useful for fixing corrupted files or reverting manual edits

**Difference from Install**:

- **Install**: Deletes everything first, then uploads
- **Refresh**: Overwrites files without deletion (faster, preserves unknown files)

### reconfigureDeviceTarget()

Re-open the target selection dialog to correct the device's saved target type and
custom user description.

**Signature**:

```ts
async reconfigureDeviceTarget(): Promise<void>
```

**Example**:

```ts
// User made a mistake during first-connect target setup.
await deviceDeployment.reconfigureDeviceTarget();
```

**Behavior**:

1. Throws if the device is not connected.
2. Throws if no runtime id is available (the dialog needs a runtime to enumerate targets).
3. Opens the same target selection dialog used during first connect, pre-filled with the
   currently saved target (`deviceTargetInfo.id`, else `getConfiguredTargetIdHint()`) and user
   description.
4. If the user cancels, no device files are written and no state changes occur.
5. On confirm, persists the selection through `_uploadTargetConfiguration` — the single writer — which
   also re-applies the image-family guard:
   - `/device/targets/active_target.json`
   - `/device.json` target fields (`targetId`, display/description, `targetUserDescription`)
6. Refreshes device info so `deviceTargetInfo`, `targetConfigurationIssue` and the UI reflect the new
   values.

**Errors**:

- Throws if device not connected
- Throws if no runtime id is available for target selection

---

## Internal Methods

These methods are intended for internal use by DeviceDeployment. External code should use the public API methods instead.

### \_uploadToolsFolder(toolsBaseUrl, deviceHashes)

Upload tools folder to device with incremental updates.

**Signature**:

```ts
async _uploadToolsFolder(toolsBaseUrl: string, deviceHashes: Object<string, string>): Promise<number>
```

**Parameters**:

- **toolsBaseUrl** (string): Base URL for tools folder (e.g., '/device/tools')
- **deviceHashes** (Object<string, string>): Existing device file hashes (from previous deployment)

**Returns**: `Promise<number>` - Count of uploaded files

**Behavior**:

1. Fetches tools manifest from `${toolsBaseUrl}/manifest.json`
2. Loads centralized sync manifest via `HashManifestManager`
3. Calculates host-side SHA-256 hashes for all tools files
4. Compares with device hashes to identify changed files
5. Creates `/tools/` directory on device if it doesn't exist
6. Uploads only files that have changed or are new
7. Saves updated centralized sync manifest to `/.micro-otter-sync-manifest`

**Progress Events**:

- Emits progress updates for each uploaded file
- Logs `tools-upload-complete` with statistics when finished

**Example**:

```ts
// Load centralized sync manifest
await this._hashManager.load();

// Upload tools folder (only changed files)
const uploadCount = await this._uploadToolsFolder('/device/tools', {});

// Persist staged hash updates
await this._hashManager.save();

console.log(`Uploaded ${uploadCount} tools files`);
// uploadCount = 2 (only changed files)
```

**Performance**:

- **First deployment**: All tools files uploaded (~5 seconds for 10 files)
- **Subsequent deployments**: Only changed files uploaded (typically 0 seconds if unchanged)
- **Modified file**: Single file upload instead of full folder

**Error Handling**:

- Continues uploading remaining files if one file fails
- Logs warnings for individual file failures
- Throws error if manifest fetch fails or upload critically fails

**See Also**:

- [deployment-utils.ts](../../../src/micro_otter/nodes/html/js/deployment/deployment-utils.ts) - Shared hashing utilities
- [Deployment System Architecture](deployment-system-architecture.md) - Tools deployment architecture

---

### \_uploadTargetConfiguration(targetId, runtimeId, userDescription)

Write the device's target configuration. This method is the **only** writer of
`/device/targets/active_target.json`; firmware bootstrap setup never creates or touches that file.

**Signature**:

```ts
async _uploadTargetConfiguration(
    targetId: string,
    runtimeId: string,
    userDescription = ''
): Promise<TargetConfigLike>
```

**Parameters**:

- **targetId** (string): Selected target id (shipped or derived user target)
- **runtimeId** (string): Runtime whose target catalog resolves the effective payload
- **userDescription** (string): Free-text device note persisted as `/device.json.targetUserDescription`

**Behavior**:

1. Resolves the effective payload through the target resolver, then asserts the image-family rule
   with `_assertTargetCompatibleWithImage`. A target whose base does not match the flashed image is
   refused with a `TargetNotCompatibleError` carrying
   `deployment.errors.targetNotCompatible` and logged as `target-compatibility-not-allowed`
   (`result: 'reject'`). The check lives here, inside the only writer, because MicroPython cannot
   resolve derived targets and so no device-side check exists.
2. Refuses a payload without pin information (`isCompleteActiveTargetPayload`) with an error coded
   `target-incomplete` and `deployment.errors.targetIncomplete` (logged as
   `upload-target-incomplete-payload`), instead of writing a file the app itself would reject.
3. Writes the resolved effective target content (`pinCapabilities` or `openPins`, `resources`,
   `generalCapabilities`, `metadata`) plus the delivery header fields `targetId`, `displayName`,
   `description`, `configVersion` (and the legacy `id` mirror). There is no `capabilities` key:
   `capabilityToPins` is derived from `pinCapabilities` on read.
4. Creates `/device/targets/` when it is missing, uploads the file, then calls
   `_updateDeviceInfoWithTarget` to set `/device.json` `targetId`, `targetDisplayName`,
   `targetDescription`, `targetUserDescription` and `targetConfigPath`.

**See Also**:

- [user-target-config-architecture.md](../core/user-target-config-architecture.md)
- [device-info-ownership-and-onboarding-lifecycle.md](device-info-ownership-and-onboarding-lifecycle.md)

---


## Events

DeviceDeployment extends EventTarget and emits the following events:

### device-connected

Emitted when device successfully connects.

**Event Detail**:

```ts
{
    connected: true,
    deviceState: { /* current state */ }
}
```

**Example**:

```ts
deviceDeployment.addEventListener('device-connected', (event) => {
    console.log('Device connected:', event.detail.deviceState);
});
```

### device-disconnected

Emitted when device disconnects.

**Event Detail**:

```ts
{
    connected: false,
    deviceState: { /* current state */ }
}
```

### device-state-changed

Emitted when device state changes (runtime installed, version updated, etc.).

**Event Detail**:

```ts
{
    state: { /* new state */ },
    changes: { /* properties that changed */ }
}
```

**Example**:

```ts
deviceDeployment.addEventListener('device-state-changed', (event) => {
    const { state, changes } = event.detail;
    if (changes.runtimeVersion) {
        console.log('Runtime version changed:', state.runtimeVersion);
    }
});
```

### device-message

Emitted for unsolicited messages from the device.

**Event Detail**:

```ts
{
    type: 'user' | 'system' | 'error' | 'info',
    message: string,
    timestamp: number
}
```

### micropython-not-detected

Emitted when MicroPython is not found on the device (triggers UI dialog).

**Event Detail**:

```ts
{
    reason: string; // Human-readable explanation
}
```

**Example**:

```ts
deviceDeployment.addEventListener('micropython-not-detected', (event) => {
    alert(`MicroPython not found: ${event.detail.reason}`);
});
```

### operation-error

Emitted when a deployment operation fails.

**Event Detail**:

```ts
{
    operation: string,  // Operation name (e.g., 'installRuntime')
    error: Error,       // Error object
    deviceState: {}     // State at time of error
}
```

**Example**:

```ts
deviceDeployment.addEventListener('operation-error', (event) => {
    const { operation, error } = event.detail;
    console.error(`${operation} failed:`, error.message);
});
```

---

## Progress Tracking

DeviceDeployment integrates with **ProgressEventBus** for operation tracking.

**See**: [Progress Event System Documentation](../core/progress-event-system.md)

**Progress Sources**:

- `'runtime-install'` - Runtime installation progress
- `'runtime-upgrade'` - Runtime upgrade progress
- `'runtime-remove'` - Runtime removal progress
- `'file-transfer'` - Individual file uploads

**Example Subscription**:

```ts
import { ProgressEventBus } from '../core/progress-events.ts';

ProgressEventBus.subscribe((event) => {
    if (event.source === 'runtime-install') {
        console.log(`[${event.progress}%] ${event.message}`);
    }
});
```

---

## Error Handling

All async methods throw on errors. Always use try-catch:

```ts
try {
    await deviceDeployment.installRuntime('general');
} catch (error) {
    console.error('Installation failed:', error.message);
    // Handle error (show dialog, log, etc.)
}
```

**Common Errors**:

- **"Device not connected"** - Call operation without active connection
- **"MicroPython not detected"** - Device doesn't have MicroPython firmware
- **"Runtime not found"** - Invalid runtime ID
- **"File not found"** - Attempting to download non-existent file
- **"Upload failed"** - File transfer interrupted or device full

---

## Cleanup

When done with DeviceDeployment, call `destroy()` to unsubscribe from events:

```ts
deviceDeployment.destroy();
```

This prevents memory leaks by removing all event listeners.

---

## Usage Examples

### Complete Runtime Installation Workflow

```ts
import { DeviceDeployment } from './deployment/device-deployment.js';
import { DeviceConnection } from './webserial/device-connection.js';
import { RuntimeCollection } from './data/runtime-collection.js';

// Setup
const deviceConnection = new DeviceConnection({
    /* ... */
});
const runtimeCollection = new RuntimeCollection();
await runtimeCollection.load();

const deviceDeployment = new DeviceDeployment({
    deviceConnection,
    runtimeCollection,
    collectionManager: workspace.collectionManager,
});

// Connect to device
await deviceConnection.connect('webserial');

// Detect MicroPython
const hasMicroPython = await deviceDeployment.detectMicroPython();
if (!hasMicroPython) {
    console.error('Please flash MicroPython firmware first');
    return;
}

// Install runtime
try {
    await deviceDeployment.installRuntime('general');
    console.log('Runtime installed successfully');
} catch (error) {
    console.error('Installation failed:', error);
}

// Verify installation
const state = deviceDeployment.getDeviceState();
console.log('Runtime:', state.runtimeId, state.runtimeVersion);
```

### Smart Runtime Upgrade

```ts
// Upgrade with automatic file comparison
await deviceDeployment.upgradeRuntime('general');

// Only changed files uploaded
// Preserved paths maintained
```

### File Management

```ts
// Upload custom configuration
const config = JSON.stringify({ wifi: { ssid: 'MyNetwork' } });
await deviceDeployment.uploadFile('/config.json', config);

// Verify upload
const hash = await deviceDeployment.calculateHash('/config.json');
console.log('File hash:', hash);

// List files
const files = await deviceDeployment.listFiles('/');
console.log('Files on device:', files);

// Download for backup
const backup = await deviceDeployment.downloadFile('/config.json');
console.log('Backup:', new TextDecoder().decode(backup));
```

---

## Related Documentation

- **[Deployment System Architecture](deployment-system-architecture.md)** - High-level overview
- **[WebSerial Architecture](../device-communication/webserial-architecture.md)** - DeviceConnection API
- **[Progress Event System](../core/progress-event-system.md)** - Progress tracking
- **Phase 1 Implementation Plan** - File operations details
- **Phase 2 Implementation Plan** - Runtime lifecycle details

---

## Testing

**Unit Tests**: `tests/deployment/device-deployment.test.js`  
**Manual Tests**: `src/micro_otter/nodes/tests/deployment-manual-test.html`  
**Test Guide**: Deployment Testing Guide

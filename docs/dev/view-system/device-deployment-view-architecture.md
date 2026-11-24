# DeviceDeploymentView Architecture

**Last Updated**: November 15, 2026
**Status**: Implemented (standard split-view shell)
**Related**: [Deployment System Architecture](../deployment/deployment-system-architecture.md)

---

## Overview

DeviceDeploymentView is the primary UI component for managing runtime and collection deployment to ESP32 devices. It uses the standard view shell: one vertical `SplitView` whose panes are `CollapsibleView` sections. Runtime-specific views are owned by
`DeviceConnectionView`, not by this tab.

**Core Responsibilities**:

- Display device connection status and MicroPython detection
- Show runtime and collection deployment information
- Provide toolbar actions for runtime/collection operations
- Validate collection compatibility with device target
- Show the device-info loading progress (`device-info-load`) in its own loading panel;
  deployment and runtime writes report through the modal
  [`DeploymentProgressDialogView`](deployment-progress-dialog.md) instead
- Render one collapsible split view: five deployment panes when connected, a single Markdown
  Help pane when disconnected
- Handle user confirmations and error reporting
- Apply embedded runtime mode gating for runtime reinstall/remove actions while
    keeping collection deployment actions available when runtime is present
- Display explicit runtime mode and embedded package summary in runtime status
    section when metadata is available

---

## Architecture

### Component Hierarchy

```
DeviceDeploymentView (extends ViewBase)
    ├─ .device-deployment-view__split-host
    │   └─ SplitView (vertical, minPaneSize 40, gap 0)
    │       ├─ Connected state (five panes)
    │       │   ├─ _toolbarCollapsible (28 px header default, sizeToContent)
    │       │   │   └─ ToolbarView
    │       │   │       ├─ Install/Upgrade Runtime button
    │       │   │       ├─ Remove Runtime button
    │       │   │       ├─ Refresh Device Info button
    │       │   │       ├─ Edit Device Target button
    │       │   │       ├─ Deploy Collection button
    │       │   │       ├─ Sync Collection button
    │       │   │       └─ Remove Collection button
    │       │   ├─ _deviceInfoCollapsible
    │       │   │   └─ ContentView → device key/value DataTableView
    │       │   ├─ _runtimeInfoCollapsible
    │       │   │   └─ ContentView → runtime DataTableView
    │       │   │       └─ .status-subtables → constituent versions + node packages
    │       │   ├─ _collectionInfoCollapsible
    │       │   │   └─ ContentView → collection key/value DataTableView
    │       │   └─ _collectionComparisonCollapsible
    │       │       └─ ContentView → comparison panel + download button
    │       └─ Disconnected state (single pane)
    │           └─ _emptyStateCollapsible
    │               └─ ContentView → MarkdownView prompt (no connect button)
    │
    └─ Loading panel (outside the split, shown while device info loads)
        └─ .deployment-loading-panel (spinner + progress message/percent)
```

### Dependencies

```ts
import { ViewBase } from './view-base.ts';
import { ToolbarView } from './toolbar-view.ts';
import { TextDialogView } from './text-dialog-view.ts';
import { IconProvider } from './icon-provider.ts';
import { SplitView } from './split-view.ts';
import { CollapsibleView } from './collapsible-view.ts';
import { ContentView } from './content-view.ts';
import { DataTableView } from './data-table-view.ts';
import { MarkdownView } from './markdown-view.ts';
import { ProgressEventBus, ProgressEventType } from '../core/progress-events.ts';
```

**External Dependencies** (via constructor):

- `deviceDeployment` (DeviceDeployment): Orchestrator for deployment operations
- `runtimeCollection` (RuntimeCollection): Registry of available runtimes
- `collectionManager` (CollectionManager): Manages user collections
- `viewManager` (ViewManager): Handles modal dialogs and confirmations
- `i18nService` (I18nService): Internationalization support
- `logger` (Logger): Logging service

---

## Lifecycle

### Construction

```ts
constructor({
    deviceDeployment,
    runtimeCollection,
    collectionManager,
    viewManager,
    i18nService = null,
    logger = null,
    ...rest
} = {})
```

**Initialization**:

1. Validates required dependencies
2. Creates internal state tracking variables
3. Initializes event listener references (null initially)
4. Initializes the shell view references (`SplitView`, collapsibles, content views)

### Render

```ts
render(container)
```

**DOM Structure Creation**:

1. Creates root `.device-deployment-view` container
2. Creates the reusable `ToolbarView` and `_createToolbarControls()`
3. Wraps the toolbar in `_toolbarCollapsible` (`deployment.toolbarTitle`, `sizeToContent`)
4. Creates the four sections through `_createSection()`: Device Information, Runtime
   Information, Collection on Device, and Collection Comparison
5. Creates the Markdown Help collapsible through `_createEmptyStateSection()`
6. Creates `SplitView` with `_getSplitPaneViews()` (`minPaneSize: 40`, `gap: 0`). The helper
   returns the five deployment panes when connected and only `_emptyStateCollapsible` when
   disconnected, so both states share the same split host and shell
7. Clears `_statusCellTargets` and attaches the split; the content views populate the map
   while rendering their `DataTableView`s
8. Calls `_createToolbarControls()` if the reused toolbar has no controls yet and
   `refreshSize()` on the toolbar collapsible
9. Creates the loading panel
10. Triggers initial `_updateUI()` to reflect current state

### After Attach

```ts
afterAttach()
```

**Event Listener Registration**:

1. **DeviceDeployment Events**:
   - `device-state-changed` → `_updateUI()`
   - `device-info-loaded` → `_onDeviceInfoLoaded()`
   - `device-info-load-error` → `_onDeviceInfoLoadError()`
   - `runtime-installed` → `_updateUI()`
   - `runtime-upgraded` → `_updateUI()`
   - `runtime-removed` → `_updateUI()`
   - `collection-deployed` → `_updateUI()`
   - `collection-synced` → `_updateUI()`
   - `collection-removed` → `_updateUI()`
   - `operation-error` → `_handleOperationError()`

2. **ProgressEventBus**:
   - Subscribe to `device-info-load` progress → `_onProgress()` → `_onDeviceInfoProgress()`
     (the loading panel); deployment/runtime writes are handled by
     `js/app/deployment-progress-controller.ts`

3. **I18nService**:
   - Subscribe to language changes → `_rerenderForLocale()`

4. **CollectionManager**:
   - Subscribe to active collection changes → `_onCollectionChange()`
   - Subscribe to collection's internal changes for compatibility updates

### Before Detach

```ts
beforeDetach()
```

**Cleanup**:

1. Unsubscribe from all DeviceDeployment events
2. Unsubscribe from ProgressEventBus
3. Unsubscribe from CollectionManager events
4. Detach `_splitView` (which detaches whichever pane set is active), `_toolbarCollapsible`, and
   the four section collapsibles
5. Detach the status content views and, when not already detached by the split,
   `_emptyStateCollapsible` / `_emptyStateContentView` / `_emptyStateHintView`
6. Call `super.beforeDetach()`

`_rerenderForLocale()` performs the same shell teardown, then calls `render(this._container)` so
every pane header, the Help pane, and toolbar labels are recreated with the active locale.

---

## UI States

### State Machine

```
┌─────────────────────────┐
│  DISCONNECTED           │
│  - One-pane Help split  │
│  - Markdown Help body   │
│  - Toolbar not mounted  │
└───────────┬─────────────┘
            │ device connects
            ▼
┌─────────────────────────┐
│  LOADING                │
│  - Loading panel visible│
│  - Spinner animation    │
│  - "Loading..." message │
└───────────┬─────────────┘
            │ device info loads
        ┌───┴────┐
        │        │
        ▼        ▼
┌─────────┐  ┌─────────────┐
│   NO    │  │ MICROPYTHON │
│ MICROPYTHON│ │  DETECTED   │
│  FOUND  │  │             │
│ - Dialog│  │ - Show info │
│ - Guide │  │ - Enable    │
│         │  │   buttons   │
└─────────┘  └─────────────┘
                    │
            ┌───────┴───────┐
            │               │
            ▼               ▼
      ┌─────────┐     ┌──────────┐
      │   NO    │     │ RUNTIME  │
      │ RUNTIME │     │INSTALLED │
      │         │     │          │
      │ - Install│    │ - Deploy │
      │   button│     │   buttons│
      └─────────┘     └──────────┘
                            │
                    ┌───────┴───────┐
                    │               │
                    ▼               ▼
              ┌──────────┐    ┌─────────────┐
              │    NO    │    │  COLLECTION │
              │COLLECTION│    │  DEPLOYED   │
              │          │    │             │
              │ - Deploy │    │ - Sync      │
              │   enabled│    │ - Remove    │
              └──────────┘    └─────────────┘
```

### State Update Logic

```ts
_updateUI() {
    const state = this._deviceDeployment.getDeviceState();
    
    // Swap the split's pane set first; reconnect reattaches the toolbar
    this._updateEmptyState(state);
    
    // Update button labels (Install vs Upgrade) and states on the mounted toolbar
    this._updateToolbarLabels();
    this._updateToolbarStates(state);
    
    if (!state.connected) {
        return;
    }
    
    // Show loading if device info is currently being loaded
    if (state.deviceInfoLoading) {
        this._showLoading();
        return;
    }
    
    // Hide loading and show content
    this._hideLoading();
    this._updateStatusPanel(state);
    this._updateCollectionComparisonPanel(state);
    this._updateDownloadButtonVisibility(state);
    this._maybeShowMicroPythonDialog(state);
}
```

`_updateEmptyState()` delegates to `_syncSplitPaneViews()`, which compares the desired pane list
with the split's current views and calls `SplitView.setViews()` only when the connection state
changes. The same `SplitView` instance and split host stay mounted; switching back to connected
clears `_statusCellTargets` before the status `ContentView`s re-render and repopulate it.

### Embedded Runtime Mode UI Behavior (Phase 5)

When device state reports embedded runtime mode (`runtimeEmbedded=true` or
`runtimeDeploymentMode='embedded'`), `DeviceDeploymentView` behavior is:

- Keep runtime deploy/upgrade action enabled so users can run firmware setup API flow.
- Keep runtime removal disabled and attach explanatory tooltip text.
- Keep collection deploy/sync/remove actions governed by runtime presence and
    loading state only (embedded mode does not block them).
- Render runtime mode label (`Embedded` / `Dynamic`) in runtime status section.
- Render embedded package summary in runtime status section when summary data
    is present.
- Use `bootstrapSetupReady` / `bootstrapSetupStatus` to decide whether setup prompt is needed.
- Prompt with setup API semantics and show per-file setup result summaries from
    `apply_bootstrap_setup()` responses.

---

## Toolbar Actions

### Runtime Operations

**Install or Upgrade Runtime** (`_handleInstallOrUpgradeRuntime`):

1. Check if runtime is already installed
2. If installed → delegate to `_handleUpgradeRuntime()`
3. If not installed → delegate to `_handleInstallRuntime()`

**Install Runtime** (`_handleInstallRuntime`):

1. Fetch available runtimes from RuntimeCollection
2. Show FormDialog with dropdown to select runtime
3. Call `deviceDeployment.installRuntime(runtimeId)`
4. Handle errors with user-friendly dialog

**Upgrade Runtime** (`_handleUpgradeRuntime`):

1. Show FormDialog with "Preserve collection" checkbox
2. Call `deviceDeployment.upgradeRuntime(runtimeId, options)`
3. Handle errors

**Remove Runtime** (`_handleRemoveRuntime`):

1. Show FormDialog with options:
   - Delete preserved files (checkbox)
   - Delete entire filesystem (checkbox)
2. Call `deviceDeployment.removeRuntime(options)`
3. Handle errors

**Refresh Device Info** (`_handleRefreshDeviceInfo`):

1. Show loading panel
2. Call `deviceDeployment.refreshConnectionState()`
3. If connected + MicroPython → `deviceDeployment.refreshDeviceInfo()`
4. `_onDeviceInfoLoaded()` hides loading panel
5. Handle errors

### Collection Operations

**Deploy Collection** (`_handleDeployCollection`):

1. Get active collection from CollectionManager
2. Validate compatibility via `deviceDeployment.validateCollectionCompatibility()`
3. If incompatible → show error dialog with issues
4. Show FormDialog with options:
   - Include full definition (checkbox)
   - Force upload (checkbox)
5. Call `deviceDeployment.deployCollection(collection, options)`
6. Handle errors

**Override policy is not a view decision.** Neither this view nor the main-toolbar quick action
decides whether host sources may shadow firmware-bundled packages. Both only choose *parameters*
(`includeFullDefinition`, `force`) and delegate to `DeviceDeployment`, which owns the consent gate
(see [Device Deployment API](../deployment/device-deployment-api.md)). Consequences:

- The collection comparison pane's `packageVersionOutdated` warnings are **display-only**; this
  view no longer caches them and no longer prompts before deploying.
- The only dialog the deploy flow may raise about overrides is the shared confirmation, and it is
  raised one layer down (with the optional *"Remember for this version"* checkbox).
- The main-toolbar quick action therefore shows **no** options dialog even while the firmware is
  out of date; it shows the shared confirmation when the gate would shadow a package, and a
  *Firmware Packages Outdated* dialog when the approval gate blocks the upload
  (`EMBEDDED_OVERRIDE_APPROVAL_REQUIRED`).
- A `EmbeddedSourceOverrideDeclinedError` (`code: 'EMBEDDED_SOURCE_OVERRIDE_DECLINED'`) surfacing
  here is reported through the regular `_showError` path, i.e. as a cancelled deploy.

**Sync Collection** (`_handleSyncCollection`):

1. Get active collection
2. Show FormDialog with options:
   - Include full definition (checkbox)
3. Call `deviceDeployment.syncCollectionFiles(collection, options)`
4. Handle errors

**Remove Collection** (`_handleRemoveCollection`):

1. Show confirmation dialog (destructive action)
2. Call `deviceDeployment.removeCollection()`
3. Handle errors

---

## Status Panes

Each status section is a direct `SplitView` pane. The `CollapsibleView` header supplies the
section title, so the pane bodies no longer render their own `h3` headings. The three status
bodies use `.deployment-pane`; the comparison body uses
`.deployment-collection-comparison-panel`.

### Device Information Pane

**Fields**:

- **Connection**: `Connected` / `Disconnected`
- **MicroPython**: Version string (e.g., `1.24.0`)
- **Target**: Device target ID (e.g., `esp32-s3-devkitc-1`)
- **Description**: User-provided device description
- **Libraries on Device** (`dynamic-libraries-on-device`): number of `libs/` / `otter_*` files
  the device user space holds, or `deployment.noneOnDevice` when there are none. Embedded mode
  only — dynamic runtimes show `-` because their library set is whatever the last deploy uploaded.
  The value comes from `DeviceDeployment.getDynamicLibraryPathsOnDevice()`, which reads the sync
  manifest; it is display-only and never influences the deploy plan.

**Update Logic**:

```ts
_updateStatusPanel(state) {
    this._setStatusValue(
        'connection',
        state.connected ? this.t('deployment.connected') : this.t('deployment.disconnected')
    );
    this._setStatusValue(
        'micropython-version',
        state.micropythonVersion || this.t('deployment.unknown')
    );
    this._setStatusValue('target', state.deviceTargetInfo?.id || this.t('deployment.unknown'));
    // ... runtime and collection fields ...
}
```

### Runtime Information Pane

**Fields**:

- **Installed**: Whether a runtime is present
- **Runtime Mode**: `Embedded` / `Dynamic`
- **Name**: Human-readable runtime name (e.g., `General Runtime`)
- **Version**: Runtime version (e.g., `1.0.0`)
- **Firmware Full Version** and **Runtime Firmware Version**
- **Embedded Packages**: package/file/byte summary when embedded

Below the runtime table, `.status-subtables` holds the constituent-versions table and the node
packages table side by side.

### Collection on Device Pane

The collection key/value table shows the deployed collection's name, version, and deployed state.
The collection comparison pane shows the separate local-versus-device comparison.

### Collection Comparison Pane

**Purpose**: Automatically validates the active collection against the device target and shows
local/device values side by side.

**Validation Triggers**:

- Active collection changes
- Device info loads
- Collection is modified

**Display States**:

1. **Disconnected**: "Connect to a device to run compatibility checks."
2. **Loading**: "Checking compatibility..."
3. **Waiting**: "Waiting for device information..."
4. **OK**: "Current collection compatible with device"
5. **Errors**: List of incompatibilities (missing capabilities, wrong target, etc.)

The pane is updated by `_updateCollectionComparisonPanel(state)`, which writes the comparison rows
and toggles the download button through `_updateDownloadButtonVisibility(state)`.

---

## Progress Tracking

### Progress Handling

The Device tab reports **only** `device-info-load`, because that progress belongs to its own
loading panel:

```ts
_onProgress(event) {
    if (event.source === 'device-info-load') {
        this._onDeviceInfoProgress(event);
    }
}
```

Every deployment and runtime **write** is reported by the modal
[`DeploymentProgressDialogView`](deployment-progress-dialog.md), driven by
`js/app/deployment-progress-controller.ts`. The view does not subscribe to `collection-*`,
`runtime-*` or `file-send-*` events at all; see
[progress-event-system.md](../core/progress-event-system.md#device-write-operations-the-modal-progress-dialog)
for the routing and the linger values.

---

## Runtime-Specific Views

Runtime-specific views are not rendered by this tab. `DeviceConnectionView` owns the runtime
provided view section and its custom-view contract. `DeviceDeploymentView` has no
`_customView`, `_customViewContainer`, `customViewPath` lookup, dynamic import, or
`deployment.customViewError` path; its runtime pane is the status table described above.

---

## MicroPython Detection

### Auto-Detection Dialog

**Trigger**: First time MicroPython is NOT detected after connection.

**Guarding**: Dialog shown once per session (`_hasShownMicroPythonDialog` flag).

**Content**:

```
Title: "MicroPython Not Detected"
Message: "MicroPython firmware was not detected on this device. 
          Please install MicroPython before continuing."

Steps:
1. Download the latest MicroPython firmware for your device.
2. Flash the firmware using esptool.py or a flashing tool.
3. Reconnect and try again.

Button: OK
```

**Implementation**:

```ts
_maybeShowMicroPythonDialog(state) {
    if (!state.connected || state.hasMicroPython !== false) {
        return;
    }
    
    if (this._hasShownMicroPythonDialog) {
        return;
    }
    
    this._hasShownMicroPythonDialog = true;
    
    const steps = document.createElement('div');
    steps.className = 'deployment-micropython-steps';
    
    const list = document.createElement('ul');
    list.appendChild(this._makeListItem(this.t('deployment.microPythonInstallStep1')));
    list.appendChild(this._makeListItem(this.t('deployment.microPythonInstallStep2')));
    list.appendChild(this._makeListItem(this.t('deployment.microPythonInstallStep3')));
    steps.appendChild(list);
    
    const dialog = new TextDialogView({
        title: this.t('deployment.microPythonNotDetected'),
        message: this.t('deployment.microPythonNotDetectedMessage'),
        content: steps,
        confirmLabel: this.t('dialog.ok'),
        showCancel: false,
        i18nService: this._i18nService,
    });
    
    this._viewManager.showModal(dialog, { scrim: true });
}
```

---

## Error Handling

### Error Display Strategy

**Async Operation Errors**:

```ts
try {
    await this._deviceDeployment.installRuntime(runtimeId);
} catch (error) {
    await this._showError(error?.message || this.t('deployment.errorGeneric'));
}
```

**Error Dialog**:

```ts
async _showError(message, detail = null) {
    if (!this._viewManager?.showError) {
        this._logger?.error?.(message, detail || '');
        return;
    }
    
    await this._viewManager.showError({
        title: this.t('deployment.errorTitle'),
        message,
        detail,
    });
}
```

**Operation Error Event**:

DeviceDeployment emits `operation-error` events:

```ts
async _handleOperationError(event) {
    const detail = event?.detail || {};
    if (!detail.error) {
        return;
    }
    await this._showError(detail.error);
}
```

---

## Internationalization

### Translation Keys

**Location**: `src/micro_otter/nodes/html/locales/en.json`

**Key Structure**:

```json
{
  "deployment": {
    "title": "Deployment",
    "toolbarTitle": "Deployment Actions",
    "deviceInfo": "Device Information",
    "runtimeInfo": "Runtime Information",
    "collectionInfo": "Collection on Device",
    "helpTitle": "Deployment Help",
    "noDeviceConnected": "No device connected",
    "connectViaTitleBar": "Connect a device with the cable badge in the title bar to enable deployment.",
    "installRuntime": "Install Runtime",
    "deployCollection": "Deploy Collection",
    "microPythonNotDetected": "MicroPython Not Detected",
    "errorTitle": "Deployment Error",
    // ... 50+ keys
  }
}
```

**Usage**:

```ts
this.t('deployment.toolbarTitle')   // "Deployment Actions"
this.t('deployment.helpTitle')      // "Deployment Help"
this.t('deployment.installRuntime')  // "Install Runtime"
this.t('deployment.confirmUpgradeMessage', { runtime: 'general', currentVersion: '1.0.0' })
// "Upgrade runtime general from version 1.0.0?"
```

`deployment.helpTitle` labels the disconnected Help collapsible. Its Markdown body combines
`deployment.noDeviceConnected` (as a heading) and `deployment.connectViaTitleBar` (the badge
prompt). `deployment.customViewError` no longer exists.

---

## Styling

### CSS Structure

**File**: `src/micro_otter/nodes/html/styles/standard/device-deployment-view.css`

**Key Classes**:

- `.device-deployment-view` - Root container
- `.device-deployment-view__split-host` - Flex host for the vertical `SplitView`
- `.deployment-pane` - Body padding for the Device, Runtime, and Collection panes
- `.deployment-device-info`, `.deployment-runtime-info`, `.deployment-collection-info` -
  Test/identification hooks for the three status bodies
- `.status-subtables` - Runtime constituent/node-package sub-table row
- `.deployment-collection-comparison-wrapper` / `.deployment-collection-comparison-panel` -
  Comparison pane and its payload
- `.deployment-empty-state__body` - Body of the disconnected Help split pane; its padding and
  text colours live here, and `.deployment-empty-state__hint` mounts the `MarkdownView`
- `.deployment-loading-panel` - Device-info loading state

The toolbar pane has no deployment-specific CSS: `CollapsibleView` provides the 28 px fit-content
header (its shared default) and `ToolbarView` provides its 40px control row. `.deployment-custom-view-container`,
`.deployment-status-panel`, `.deployment-compatibility-panel`, and the unused `.status-item` /
`.compatibility-success` rules are gone.

**Loading Progress**:

```css
.deployment-loading-panel {
    position: absolute;
    inset: 0;
    z-index: 200;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    background: rgba(15, 20, 31, 0.78);
}

.deployment-loading-progress {
    margin: 0;
    color: var(--mo-accent, #63b5ff);
    font-size: 12px;
    font-weight: 600;
}
```

The determinate deployment bars live in
`styles/standard/progress-detail-view.css` as the reusable `ProgressDetailView` (see
[progress-detail-view.md](progress-detail-view.md)); the modal dialog hosts it and keeps only its
phase line (`deployment-progress-dialog.css`, [deployment-progress-dialog.md](deployment-progress-dialog.md)).
The Device tab no longer styles a `progress-*` block.

---

## Serialization

### Serialize

```ts
serialize() {
    return {
        ...super.serialize(),
        type: 'DeviceDeploymentView',
    };
}
```

### Deserialize

```ts
static deserialize(data = {}, viewFactory = null, context = {}) {
    const {
        deviceDeployment,
        runtimeCollection,
        collectionManager,
        viewManager,
        i18nService = null,
        logger = null,
    } = context;
    
    return new DeviceDeploymentView({
        deviceDeployment,
        runtimeCollection,
        collectionManager,
        viewManager,
        i18nService,
        logger,
        title: data.title || 'Deployment',
        icon: data.icon || IconProvider.upload,
        id: data.id || null,
    });
}
```

---

## Testing Strategy

### Unit Tests

**Files**:

- `tests/views/device-deployment-view-shell.test.js` — shell contract: five connected panes in
  order, the single disconnected Help pane, toolbar nested in the first collapsible,
  `collapsible-view--fit-content`, expanded state, locale re-render, removed custom-view host,
  locale parity, CSS contract
- `tests/views/device-deployment-view-empty-state.test.js` — the single Help pane in the shared
  split while disconnected, the five-pane connected state, and live pane swaps
- `tests/views/device-deployment-view-status-tables.test.js` — device/runtime/collection pane
  tables, sub-tables, and dynamic-library values
- `tests/views/device-deployment-view-runtime-mode-gating.test.js` — embedded-mode button gating
- `tests/views/device-deployment-view-collection-comparison.test.js` — comparison values/status
- `tests/views/device-deployment-view-download-collection.test.js` — download flow
- `tests/views/device-deployment-view-deploy-confirmation.test.js` — deploy confirmation
- `tests/views/device-deployment-view-progress-removal.test.js` — loading-panel-only progress

**Test Cases**:

1. **Lifecycle**:
   - Constructor validates required dependencies
   - `render()` creates the split and mounts either its five connected panes or the Help pane
   - `afterAttach()` registers all event listeners
   - `beforeDetach()` cleans up listeners and every shell view

2. **State Updates**:
   - Help is the only split pane when disconnected; five deployment panes when connected
   - Loading panel shown during device info load
   - Status panes updated from device state
   - Toolbar buttons enabled/disabled correctly

3. **User Actions**:
   - Install runtime triggers FormDialog + deviceDeployment call
   - Deploy collection validates compatibility first
   - Error handling shows user-friendly dialogs

4. **Progress Tracking**:
   - The loading panel follows `device-info-load` start/update/complete
   - Deployment and runtime writes report through the modal `DeploymentProgressDialogView`
     (`tests/app/deployment-progress-controller-integration.test.js`)
   - The Device tab subscribes to no write-operation progress source

### Integration Tests

**Pending**: `tests/integration/device-deployment-view.test.js`

**Test Scenarios**:

1. End-to-end runtime installation workflow
2. Collection deployment with real DeviceDeployment
3. MicroPython detection dialog flow

### Manual Testing

**Checklist** (see `ldev/manual_tests/deployment-phase1-phase2-testing.md`):

- Connect device → UI updates correctly
- Install runtime → progress shown in the modal dialog, UI reflects changes
- Deploy collection → compatibility validated, progress shown in the modal dialog
- Disconnect during operation → error handled gracefully
- Language change → UI re-renders with new strings

---

## Related Documentation

- **[Deployment System Architecture](../deployment/deployment-system-architecture.md)** - Overall deployment system design
- **[DeviceDeployment API](../deployment/device-deployment-api.md)** - Core deployment logic API
- **[View System Architecture](view-system-architecture.md)** - ViewBase lifecycle and patterns
- **[Progress Event System](../core/progress-event-system.md)** - Progress tracking patterns
- **[I18n Architecture](../core/i18n-architecture.md)** - Translation and localization

---

## Future Enhancements

### Device Control

- Device start/stop/reset controls
- REPL command execution UI
- Device output monitoring

### Phase 7: Advanced Features

- Multi-device deployment
- Deployment profiles
- Operation cancellation
- Rollback on failure

---

**Document Status**: Complete  
**Shell**: Standard collapsible `SplitView`; five panes connected, one Help pane disconnected
**Implementation**: Complete
**Testing**: Standard Node suites passing

# Progress Event System - Developer Documentation

## Overview

The Progress Event System provides a standardized, reusable architecture for tracking and displaying progress of long-running operations throughout the Micro-Otter application. Originally implemented for application startup, this system can be extended to track any asynchronous operation such as file transfers, compilation, deployment, or data synchronization.

**Key Benefits:**

- **Separation of Concerns**: Progress emission, coordination, and display are independent
- **Reusability**: Same infrastructure works for startup, file transfers, or any async operation
- **Type Safety**: Strongly typed events with validation
- **Testability**: Non-DOM components are unit-testable
- **Extensibility**: New progress sources can be added without modifying existing code

## Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│ Progress Sources (Data Layer)                                │
│  - Workspace initialization                                  │
│  - Device runtime loading                                    │
│  - Node package loading                                      │
│  - View system creation                                      │
│  - File transfers (future)                                   │
└────────────────────┬────────────────────────────────────────┘
                     │ emit ProgressEvent
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ ProgressEventBus (Event System)                              │
│  - Singleton pub/sub system                                  │
│  - Type-safe event emission                                  │
│  - Error isolation between listeners                         │
└────────────────────┬────────────────────────────────────────┘
                     │ subscribe
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Coordinator (Business Logic)                                 │
│  - Workspace (for startup)                                   │
│  - FileTransferManager (example for other operations)        │
│  - Tracks completion, forwards to UI                         │
└────────────────────┬────────────────────────────────────────┘
                     │ updateProgress()
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ UI Components (Presentation Layer)                           │
│  - SplashScreen (startup)                                    │
│  - ProgressDialog (file transfers, etc.)                     │
│  - StatusBar (background operations)                         │
└─────────────────────────────────────────────────────────────┘
```

### Core Components

#### 1. ProgressEventType (Enum)

Defines the lifecycle stages of an operation:

```ts
export const ProgressEventType = Object.freeze({
    START: 'start', // Operation begins (progress = 0)
    UPDATE: 'update', // Incremental progress (0-100)
    COMPLETE: 'complete', // Operation succeeds (progress = 100)
    ERROR: 'error', // Operation fails
});
```

#### 2. ProgressEvent (Data Class)

Immutable event representing a single progress update:

**Properties:**

- `source: string` - Identifier for the operation source (e.g., "workspace", "file-transfer")
- `type: ProgressEventType` - Event type (START, UPDATE, COMPLETE, ERROR)
- `message: string` - User-friendly description of current state
- `progress?: number` - Optional progress percentage (0-100)
- `detail?: any` - Optional metadata (error objects, file names, etc.)
- `timestamp: number` - Auto-generated timestamp (ms since epoch)

**Features:**

- Validation on construction (throws TypeError for invalid data)
- Immutable via `Object.freeze()`
- Serialization: `toJSON()`, `toString()`

#### 3. ProgressEventBus (Singleton)

Global pub/sub system for progress events:

**API:**

```ts
// Subscribe to all progress events
ProgressEventBus.subscribe((event) => {
    console.log(event.source, event.message, event.progress);
});

// Emit a progress event
const event = new ProgressEvent({
    source: 'my-operation',
    type: ProgressEventType.UPDATE,
    message: 'Processing file 3 of 10',
    progress: 30,
});
ProgressEventBus.emit(event);

// Unsubscribe (important for cleanup!)
ProgressEventBus.unsubscribe(listener);
```

**Features:**

- Static methods (no instance creation needed)
- Duplicate listener prevention (Set-based storage)
- Error isolation: failing listeners don't break others
- Synchronous emission with listener snapshots

#### 4. ProgressTracker (Helper)

Convenience wrapper for common progress tracking patterns:

**Basic Usage:**

```ts
const tracker = new ProgressTracker('my-operation');
tracker.start('Starting operation...');
tracker.update('Processing...');
tracker.complete('Operation complete!');
```

**With Automatic Progress Calculation:**

```ts
const tracker = new ProgressTracker('file-transfer', 10); // 10 total steps

tracker.start('Starting file transfer...');
for (let i = 1; i <= 10; i++) {
    await transferFile(files[i]);
    tracker.update(`Transferred file ${i}/10`, i); // Auto-calculates 10%, 20%, 30%...
}
tracker.complete('All files transferred');
```

**Error Handling:**

```ts
const tracker = new ProgressTracker('deployment');
tracker.start('Deploying to device...');
try {
    await deployFirmware();
    tracker.complete('Deployment successful');
} catch (error) {
    tracker.error('Deployment failed', error); // Includes error in detail
}
```

## Startup Progress Flow

### Initialization Sequence

The application startup uses the Progress Event System to track 5 concurrent initialization sources:

1. **feature-detection**: Browser capability checks
2. **workspace**: Workspace and collection loading
3. **device-runtime**: Device runtime collection loading
4. **node-packages**: Node package loading
5. **views**: View system initialization

### Detailed Flow

#### Phase 0: Feature Detection (main.ts)

```ts
// 1. Create splash screen EARLY (before any checks)
const splash = new SplashScreen();
await splash.show();

// 2. Run feature detection
const detector = new FeatureDetector();
const results = detector.checkAll();

// 3. Handle missing features
if (!results.allRequiredAvailable) {
    splash.showFeatureWarnings(results.missingRequired, [], results.details);
    throw new Error('Cannot start: missing required features');
}

// 4. Store splash globally for Phase 1
window.microOtterSplash = splash;
```

#### Phase 1: App Initialization (main.ts)

```ts
// 1. Create Workspace with splash screen
const splashScreen = window.microOtterSplash;
const workspace = new Workspace({ splashScreen });

// 2. Emit feature-detection COMPLETE (after subscription is active)
const completionEvent = new ProgressEvent({
    source: 'feature-detection',
    type: ProgressEventType.COMPLETE,
    message: 'Feature detection complete',
    progress: 100,
});
ProgressEventBus.emit(completionEvent);

// 3. Start workspace loading (emits workspace events)
await workspace.load();

// 4. Build views (emits views events)
buildDefaultLayout();
```

#### Workspace Coordinator (workspace.ts)

```ts
constructor({ splashScreen } = {}) {
    this.splashScreen = splashScreen || new SplashScreen();
    this.#completedSources = new Set();

    // Subscribe to ProgressEventBus
    this.#progressListener = (event) => {
        // Forward all events to splash screen
        this.splashScreen.updateProgress(event);

        // Track COMPLETE events
        if (event.type === ProgressEventType.COMPLETE) {
            this.#onSourceComplete(event.source);
        }
    };
    ProgressEventBus.subscribe(this.#progressListener);

    // Show splash immediately
    this.splashScreen.show();
}

#onSourceComplete(source) {
    this.#completedSources.add(source);

    // Check if all 5 expected sources have completed
    const allComplete = ['feature-detection', 'workspace', 'device-runtime',
                         'node-packages', 'views']
        .every(s => this.#completedSources.has(s));

    if (allComplete) {
        this.#hideSplashScreen();
    }
}

#hideSplashScreen() {
    // Wait 500ms for user to read final message
    setTimeout(async () => {
        await this.splashScreen.hide();
        // Clean up DOM after fade-out
        setTimeout(() => this.splashScreen.destroy(), 1000);
    }, 500);
}
```

#### Progress Source Example (workspace.ts)

```ts
async load() {
    const tracker = new ProgressTracker('workspace', 5);

    try {
        tracker.start('Initializing workspace...');

        tracker.update('Loading device runtime collection...', 1); // 20%
        await this.#loadRuntimeCollection();

        tracker.update('Loading collections from store...', 2); // 40%
        await this.#loadCollections();

        tracker.update('Initializing workspace configuration...', 3); // 60%
        await this.#loadConfig();

        tracker.update('Processing collections...', 4); // 80%
        this.#processCollections();

        tracker.update('Finalizing workspace setup...', 5); // 100%
        this.#finalize();

        tracker.complete('Workspace ready');
    } catch (error) {
        tracker.error('Workspace initialization failed', error);
        throw error;
    }
}
```

### Critical Timing Considerations

**⚠️ Event Emission Order Matters:**

The feature-detection COMPLETE event must be emitted **after** the Workspace constructor subscribes to ProgressEventBus. If emitted too early, the event is lost and the splash screen never closes.

**Correct Order:**

1. Create Workspace (subscribes to ProgressEventBus)
2. Emit feature-detection COMPLETE
3. Call workspace.load() (emits workspace events)

**Incorrect Order:**

1. ❌ Emit feature-detection COMPLETE (no listeners yet!)
2. Create Workspace
3. Call workspace.load()

## Reusing for Other Operations

The Progress Event System is designed for reuse beyond application startup. Here's how to implement progress tracking for other long-running operations:

### Example: File Transfer via Web Serial

#### Step 1: Create a Progress Source

```ts
// src/micro_otter/nodes/html/js/serial/file-transfer.ts

import { ProgressTracker } from '../core/progress-events.ts';

export class FileTransferManager {
    async transferFiles(files, port) {
        const tracker = new ProgressTracker('file-transfer', files.length);

        try {
            tracker.start(`Starting transfer of ${files.length} files...`);

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const step = i + 1;

                tracker.update(`Transferring ${file.name} (${step}/${files.length})`, step);

                await this.#transferSingleFile(file, port);
            }

            tracker.complete(`Successfully transferred ${files.length} files`);
            return { success: true, fileCount: files.length };
        } catch (error) {
            tracker.error('File transfer failed', {
                error: error.message,
                failedFile: files[i]?.name,
            });
            throw error;
        }
    }

    async #transferSingleFile(file, port) {
        // Emit granular updates for large files
        const chunks = this.#splitIntoChunks(file);
        const fileTracker = new ProgressTracker(`file-transfer-${file.name}`, chunks.length);

        fileTracker.start(`Sending ${file.name}...`);

        for (let i = 0; i < chunks.length; i++) {
            await this.#sendChunk(chunks[i], port);
            fileTracker.update(`Chunk ${i + 1}/${chunks.length}`, i + 1);
        }

        fileTracker.complete(`${file.name} complete`);
    }
}
```

#### Step 2: Create a Coordinator (Optional)

```ts
// src/micro_otter/nodes/html/js/serial/transfer-coordinator.ts

import { ProgressEventBus } from '../core/progress-events.ts';

export class TransferCoordinator {
    constructor(progressDialog) {
        this.progressDialog = progressDialog;

        // Subscribe to only file-transfer events
        this.#listener = (event) => {
            if (event.source.startsWith('file-transfer')) {
                this.progressDialog.updateProgress(event);
            }
        };

        ProgressEventBus.subscribe(this.#listener);
    }

    cleanup() {
        ProgressEventBus.unsubscribe(this.#listener);
    }
}
```

#### Step 3: Create a UI Component

```ts
// src/micro_otter/nodes/html/js/views/progress-dialog.ts

export class ProgressDialog {
    constructor() {
        this._createDOM();
    }

    updateProgress(event) {
        // Similar to SplashScreen.updateProgress()
        if (event.type === ProgressEventType.UPDATE) {
            this._progressBar.value = event.progress || 0;
            this._message.textContent = event.message;
        } else if (event.type === ProgressEventType.COMPLETE) {
            this._progressBar.value = 100;
            this._message.textContent = event.message;
            this._message.classList.add('success');
        } else if (event.type === ProgressEventType.ERROR) {
            this._message.textContent = event.message;
            this._message.classList.add('error');
        }
    }

    async show() {
        this._container.style.display = 'flex';
        return new Promise((resolve) => {
            setTimeout(() => {
                this._container.classList.add('visible');
                resolve();
            }, 10);
        });
    }

    async hide() {
        this._container.classList.remove('visible');
        return new Promise((resolve) => {
            setTimeout(() => {
                this._container.style.display = 'none';
                resolve();
            }, 300);
        });
    }
}
```

#### Step 4: Wire It Together

```ts
// Usage in your application
async function handleFileTransfer(files) {
    // Create UI
    const dialog = new ProgressDialog();
    await dialog.show();

    // Create coordinator
    const coordinator = new TransferCoordinator(dialog);

    try {
        // Start transfer (automatically emits progress events)
        const manager = new FileTransferManager();
        await manager.transferFiles(files, serialPort);

        // Wait a moment for user to see completion
        await new Promise((resolve) => setTimeout(resolve, 1000));
    } finally {
        // Cleanup
        await dialog.hide();
        coordinator.cleanup();
        dialog.destroy();
    }
}
```

### Example: Background Status Updates

For operations that run in the background without blocking the UI:

```ts
// src/micro_otter/nodes/html/js/views/status-bar.ts

export class StatusBar {
    constructor() {
        this._activeOperations = new Map();

        this.#listener = (event) => {
            this.#updateOperationStatus(event);
        };

        ProgressEventBus.subscribe(this.#listener);
    }

    #updateOperationStatus(event) {
        if (event.type === ProgressEventType.START) {
            this._activeOperations.set(event.source, {
                message: event.message,
                progress: 0,
            });
        } else if (event.type === ProgressEventType.UPDATE) {
            const op = this._activeOperations.get(event.source);
            if (op) {
                op.message = event.message;
                op.progress = event.progress || 0;
            }
        } else if (
            event.type === ProgressEventType.COMPLETE ||
            event.type === ProgressEventType.ERROR
        ) {
            this._activeOperations.delete(event.source);
        }

        this.#renderOperations();
    }

    #renderOperations() {
        // Display all active operations in status bar
        const html = Array.from(this._activeOperations.entries())
            .map(
                ([source, op]) => `
                <div class="status-item">
                    <span>${op.message}</span>
                    <progress value="${op.progress}" max="100"></progress>
                </div>
            `
            )
            .join('');

        this._container.innerHTML = html;
    }
}
```

## Device Write Operations: The Modal Progress Dialog

Every device **write** is reported by `js/app/deployment-progress-controller.ts`
(`startDeploymentProgressController`) in one modal
[`DeploymentProgressDialogView`](../view-system/deployment-progress-dialog.md). The controller is
started once from `App.initialize()` and lives for the page lifetime.

It listens to the operation trackers' own sources, so a deploy started from the title bar shows the
same dialog as one started from the Device tab, with no per-trigger code:

| Tracker source | Dialog title key |
|---|---|
| `collection-deploy` | `deployment.deployCollection` |
| `collection-sync` | `deployment.syncCollection` |
| `collection-remove` | `deployment.removeCollection` |
| `runtime-install` | `deployment.installRuntime` |
| `runtime-upgrade` | `deployment.upgradeRuntime` |
| `runtime-remove` | `deployment.removeRuntime` |
| `runtime-refresh` | `deployment.refreshRuntime` |

Routing:

- **`start`** opens the dialog (only when no operation is running), sets the phase line, resets both
  tiers and shows it with `ViewManager.showModal(dialog, { scrim: true })`. A second `start` while an
  operation runs is ignored and logged as `deployment-progress-start-ignored`: the scrim blocks a
  second trigger, and flipping the title mid-operation would mislabel the dialog.
- **`update`** forwards the message and percentage; an update without `progress` keeps the last
  percentage.
- **`complete`** marks the dialog complete and closes it after **2000 ms**; **`error`** marks it
  failed and closes after **5000 ms** (the values of the removed inline panel).
- **`file-send-*`** drives the file tier of the running operation. A file `complete` never closes the
  dialog, because the operation that started the transfer is still running.
- **This controller ignores** `device-info-load` (the Device tab's loading panel keeps it),
  `file-receive-*`, `transpiler`, `workspace`, `views`, `fs`, `node-packages`, `device-runtime`,
  `custom-function-*` and the batch trackers `collection-files-upload`, `runtime-files-upload`,
  `runtime-libraries-upload` and `tools-upload`.

The modal layer holds one dialog, and `ViewManager.showModal` / its close watcher clear it
unconditionally, so the controller guards every close:

- it compares `viewManager.modalView` with the **dialog instance** before calling `clearModal()`, so a
  late linger never evicts a foreign error or form dialog;
- a linger timer only closes the operation it was armed for (generation counter), so operation *n*'s
  timer cannot close operation *n+1*'s dialog;
- when a foreign dialog took the layer, the controller keeps updating the stored state and re-shows
  the **same** dialog instance on the next event once `modalView` is `null` again (the dialog replays
  its state on re-attach).

Once a `complete` or `error` arrived the operation is settled: a new operation may start during the
linger, which disarms the old timer and creates a new dialog.

See [deployment-progress-dialog.md](../view-system/deployment-progress-dialog.md) for the view's
setter contract and ARIA attributes. The *Create a UI Component* example above stays the pattern for
progress that belongs to one section.

## Best Practices

### 1. Always Clean Up Subscriptions

```ts
class MyComponent {
    constructor() {
        this.#listener = (event) => {
            /* ... */
        };
        ProgressEventBus.subscribe(this.#listener);
    }

    destroy() {
        // CRITICAL: Prevent memory leaks
        ProgressEventBus.unsubscribe(this.#listener);
    }
}
```

### 2. Use Descriptive Source Names

```ts
// ✅ Good: Descriptive, hierarchical
new ProgressTracker('workspace-init');
new ProgressTracker('file-transfer-firmware');
new ProgressTracker('device-deployment-esp32');

// ❌ Bad: Generic, ambiguous
new ProgressTracker('operation');
new ProgressTracker('transfer');
new ProgressTracker('loading');
```

### 3. Provide User-Friendly Messages

```ts
// ✅ Good: Clear, actionable
tracker.update('Loading node package "core" (2/5)');
tracker.error('Failed to connect to device. Check USB cable.');

// ❌ Bad: Technical, vague
tracker.update('Processing item 2');
tracker.error('Connection error');
```

### 4. Include Useful Detail for Errors

```ts
// ✅ Good: Includes context for debugging
tracker.error('Deployment failed', {
    error: error.message,
    stack: error.stack,
    deviceId: device.id,
    firmwareVersion: firmware.version,
});

// ❌ Bad: No context
tracker.error('Deployment failed');
```

### 5. Use totalSteps for Predictable Operations

```ts
// ✅ Good: Automatic progress calculation
const tracker = new ProgressTracker('package-install', packages.length);
for (let i = 0; i < packages.length; i++) {
    await installPackage(packages[i]);
    tracker.update(`Installed ${packages[i].name}`, i + 1);
}

// ⚠️ OK but manual: Must calculate percentages yourself
const tracker = new ProgressTracker('package-install');
tracker.update('Installing...', 0);
tracker.update('Installing...', 33);
tracker.update('Installing...', 67);
tracker.update('Installing...', 100);
```

### 6. Filter Events by Source When Needed

```ts
// Subscribe to only specific sources
ProgressEventBus.subscribe((event) => {
    if (event.source.startsWith('file-transfer')) {
        // Only handle file transfer events
        this.fileTransferDialog.updateProgress(event);
    }
});
```

## Testing

### Unit Testing Progress Sources

```ts
// tests/node/workspace.test.js

import { ProgressEventBus } from '../../src/micro_otter/nodes/html/js/core/progress-events.ts';

test('workspace emits progress events during load', async () => {
    const events = [];
    const listener = (event) => events.push(event);

    ProgressEventBus.subscribe(listener);

    const workspace = new Workspace();
    await workspace.load();

    ProgressEventBus.unsubscribe(listener);

    // Verify expected events
    expect(events.some((e) => e.source === 'workspace' && e.type === 'start')).toBe(true);
    expect(events.some((e) => e.source === 'workspace' && e.type === 'complete')).toBe(true);
    expect(
        events.filter((e) => e.source === 'workspace' && e.type === 'update').length
    ).toBeGreaterThan(0);
});
```

### Integration Testing with UI

```ts
// Manual testing with test page
// src/micro_otter/nodes/html/test/progress-test.html

async function testFileTransfer() {
    const dialog = new ProgressDialog();
    await dialog.show();

    const tracker = new ProgressTracker('test-transfer', 5);
    tracker.start('Starting test...');

    for (let i = 1; i <= 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        tracker.update(`Step ${i} of 5`, i);
    }

    tracker.complete('Test complete!');

    await new Promise((resolve) => setTimeout(resolve, 1000));
    await dialog.hide();
}
```

## API Reference

### ProgressEvent

```typescript
class ProgressEvent {
    constructor(config: {
        source: string;
        type: ProgressEventType;
        message: string;
        progress?: number;
        detail?: any;
        timestamp?: number;
    });

    // Getters (read-only)
    get source(): string;
    get type(): ProgressEventType;
    get message(): string;
    get progress(): number | undefined;
    get detail(): any | undefined;
    get timestamp(): number;

    // Serialization
    toJSON(): object;
    toString(): string;
}
```

### ProgressEventBus

```typescript
class ProgressEventBus {
    static subscribe(listener: (event: ProgressEvent) => void): void;
    static unsubscribe(listener: Function): boolean;
    static emit(event: ProgressEvent): void;
    static getListenerCount(): number;
    static clearAllListeners(): void; // For testing only
}
```

### ProgressTracker

```typescript
class ProgressTracker {
    constructor(source: string, totalSteps?: number);

    start(message: string, detail?: any): void;
    update(message: string, step?: number, detail?: any): void;
    complete(message: string, detail?: any): void;
    error(message: string, errorOrDetail?: any): void;

    // Getters (read-only)
    get source(): string;
    get totalSteps(): number | undefined;
    get currentStep(): number;
    get isStarted(): boolean;
    get isFinished(): boolean;
}
```

## Migration Guide

### Adding Progress to Existing Code

If you have existing long-running operations without progress tracking:

**Before:**

```ts
async function deployFirmware(device, firmware) {
    await connectToDevice(device);
    await uploadFirmware(firmware);
    await verifyUpload();
    return { success: true };
}
```

**After:**

```ts
import { ProgressTracker } from '../core/progress-events.ts';

async function deployFirmware(device, firmware) {
    const tracker = new ProgressTracker('firmware-deploy', 3);

    try {
        tracker.start('Connecting to device...');
        await connectToDevice(device);

        tracker.update('Uploading firmware...', 1);
        await uploadFirmware(firmware);

        tracker.update('Verifying upload...', 2);
        await verifyUpload();

        tracker.complete('Firmware deployed successfully');
        return { success: true };
    } catch (error) {
        tracker.error('Deployment failed', error);
        throw error;
    }
}
```

## Troubleshooting

### Splash Screen Doesn't Close

**Symptom:** Splash screen stays visible after app loads.

**Common Causes:**

1. Not all expected sources emitted COMPLETE events
2. Events emitted before Workspace subscribed
3. Source name mismatch (e.g., "file-transfer" vs "file_transfer")

**Solution:**

- Check console logs for completion tracking
- Verify all 5 sources: feature-detection, workspace, device-runtime, node-packages, views
- Ensure feature-detection COMPLETE is emitted AFTER Workspace creation

### Memory Leaks

**Symptom:** Application performance degrades over time.

**Cause:** Forgetting to unsubscribe from ProgressEventBus.

**Solution:**

```ts
// Always unsubscribe in cleanup/destroy methods
class MyComponent {
    constructor() {
        this.#listener = (event) => {
            /* ... */
        };
        ProgressEventBus.subscribe(this.#listener);
    }

    destroy() {
        ProgressEventBus.unsubscribe(this.#listener);
    }
}
```

### Events Not Appearing in UI

**Symptom:** Progress events logged to console but not displayed.

**Causes:**

1. UI component not subscribed to ProgressEventBus
2. Source filter too strict
3. UI component created after events emitted

**Solution:**

- Subscribe UI component before emitting events
- Log events in listener to verify subscription
- Check source name filters

## Future Enhancements

Potential improvements to the Progress Event System:

1. **Hierarchical Progress**: Parent/child relationships for nested operations
2. **Cancelation Support**: Add CANCEL event type and cancelation tokens
3. **Rate Limiting**: Throttle rapid UPDATE events to prevent UI flooding
4. **Persistence**: Save progress state to resume after page reload
5. **Multiple UI Targets**: Route different sources to different UI components automatically
6. **Progress Estimation**: ML-based time estimation for known operations

## Conclusion

The Progress Event System provides a flexible, reusable foundation for tracking long-running operations in Micro-Otter. By following the patterns and best practices in this guide, you can add professional progress tracking to any asynchronous operation while maintaining clean separation of concerns and testability.

**Key Takeaways:**

- Use `ProgressTracker` for convenience
- Always clean up subscriptions
- Emit events in the correct order (after subscriptions are active)
- Provide user-friendly messages
- Include context in error events
- Test progress tracking in isolation

For questions or improvements, open an issue or a pull request.

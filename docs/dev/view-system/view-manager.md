# ViewManager

The **ViewManager** orchestrates three layered containers and provides high-level APIs for managing views, dialogs, themes, and i18n integration.

## Layer Structure

```
ViewManager._rootElement
  ├── _rootLayer (z-index: 0)
  │   └── Root view tree (SplitView, TabbedView, etc.)
  ├── _overlayLayer (z-index: 10)
  │   └── OverlayWindow instances (floating windows)
  └── _modalLayer (z-index: 20)
      └── Modal dialogs (confirmation, error, etc.)
```

## Root Management

```ts
// Attach main view tree
manager.attachRoot(new SplitView({ views: [...] }));

// Clear root
manager.clearRoot();
```

## Overlay Management

```ts
// Add overlay window
const overlay = manager.addOverlay(new TextView({ text: 'Info' }), {
    title: 'Information',
    width: 400,
    height: 300,
    x: 100,
    y: 100,
});

// Close specific overlay
manager.closeOverlay(overlay);

// Close all overlays
manager.clearOverlays();
```

A menu that opens a nested menu (`menuview` entry) adds its child window to the **overlay layer
element** without registering it in `_overlays`: `addOverlay()`, `closeOverlay()` and `clearOverlays()`
only ever see the top-level menu. The child's lifetime belongs to the parent `MenuWindow`, which closes
it on `detach()`; `constrainOverlays()` exists but no caller wires it up, so an open submenu keeps its
position after a resize. See [Menu System](menu-system.md#known-limitations).

## Modal Dialogs

ViewManager provides convenience methods for common dialog patterns:

### Confirmation Dialog

**`showConfirmation(options)` → `Promise<boolean>`**

Displays a confirmation dialog. Returns `true` if confirmed, `false` if cancelled.

```ts
const confirmed = await manager.showConfirmation({
    title: 'Delete File', // Dialog title
    message: 'Delete this file?', // Main message
    detail: 'Cannot be undone.', // Optional details
    destructive: true, // Red warning style
    confirmLabel: 'Delete', // Confirm button text
    cancelLabel: 'Cancel', // Cancel button text
});
if (confirmed) {
    /* proceed */
}
```

**Options**: `title`, `message`, `detail?`, `icon?`, `confirmLabel?`, `cancelLabel?`, `destructive?`, `showCancel?`, `scrim?`, `checkboxLabel?`, `checkboxChecked?`

> **Destructive menu actions use this helper.** A menu action that only needs a yes/no decision asks
> for confirmation through `showConfirmation()` instead of building its own
> `ConfirmationDialogView` + `showModal()` pair:
>
> ```ts
> const confirmed = await this._viewManager.showConfirmation({
>     title: 'Delete item?',
>     message: `Delete "${itemName}"?`,
>     destructive: true,
> });
> if (confirmed) {
>     this._deleteItem(itemId);
> }
> ```
>
> Dialogs that need custom lifecycle/content control (for example
> `CollectionView._onGraphCloseRequested()`) build `ConfirmationDialogView` and call `showModal()`
> directly.

**`showConfirmationWithCheckbox(options)` → `Promise<{confirmed, checkboxChecked}>`**

Same dialog, but it also renders an optional checkbox (for example *"Remember for this
version"*) and reports both answers. Use it whenever the confirmation carries an extra opt-in.

```ts
const { confirmed, checkboxChecked } = await manager.showConfirmationWithCheckbox({
    title: 'Upload override?',
    message: 'Host sources will replace the firmware copy.',
    checkboxLabel: 'Remember for this version',
});
if (confirmed && checkboxChecked) {
    /* remember the opt-in */
}
```

`checkboxLabel` is skipped when empty, `checkboxChecked` sets the initial state, and a plain
`showConfirmation()` keeps resolving a boolean. No new event payloads are emitted: the checkbox
state is read from the dialog instance before the promise resolves.

### Info Dialog

**`showInfo(options)` → `Promise<void>`**

Displays an informational dialog. Returns when dismissed.

```ts
await manager.showInfo({
    title: 'No Runtime Installed', // Dialog title
    message: 'Please install the Micro-Otter runtime before deploying.', // Info message
});
```

**Options**: `title?`, `message?`, `icon?`, `confirmLabel?`, `scrim?`

### Error Dialog

**`showError(options)` → `Promise<void>`**

Displays an error dialog. Returns when dismissed.

```ts
try {
    await connectToDevice();
} catch (error) {
    await manager.showError({
        title: 'Connection Failed', // Dialog title
        message: error.message, // Error message
        detail: error.stack, // Optional stack trace
    });
}
```

**Options**: `title?`, `message?`, `detail?`, `detailCollapsible?`, `icon?`, `confirmLabel?`, `scrim?`

### Form Dialog

**`showFormDialog(options)` → `Promise<{confirmed: boolean, formData: object|null}>`**

Displays a form dialog with input fields. Returns confirmation status and form data.

```ts
const result = await manager.showFormDialog({
    title: 'Create Collection',
    message: 'Enter collection details',
    fields: [
        { id: 'name', type: 'text', label: 'Name', required: true },
        { id: 'runtime', type: 'dropdown', label: 'Runtime', options: runtimes, required: true },
        { id: 'active', type: 'checkbox', label: 'Set as active', defaultValue: true },
    ],
    confirmLabel: 'Create',
    cancelLabel: 'Cancel',
});

if (result.confirmed) {
    console.log('Form data:', result.formData);
    // { name: '...', runtime: '...', active: true }
}
```

**Options**: `title?`, `message?`, `fields`, `icon?`, `confirmLabel?`, `cancelLabel?`, `scrim?`

#### Field Properties

Common properties for all field types:

- `id` (string, required): Unique field identifier
- `type` (string, required): Field type - `'text'`, `'dropdown'`, or `'checkbox'`
- `label` (string, required): Display label for the field
- `description` (string, optional): Hint text rendered under the control and wired to it through
  `aria-describedby`; checkbox hints are indented under the label
- `required` (boolean, optional): Whether field must be filled (default: false)
- `onChange` (function, optional): Callback `(value, dialog) => void` called when field changes

**Text field properties:**

- `value` (string, optional): Initial value (alias for `defaultValue`)
- `defaultValue` (string, optional): Initial value
- `placeholder` (string, optional): Placeholder text
- `readonly` (boolean, optional): Make field read-only (default: false)
- `multiline` (boolean, optional): Create textarea instead of input (default: false)
- `rows` (number, optional): Number of rows for multiline textarea (default: 3)

**Dropdown field properties:**

- `options` (array, required): Array of `{value, label}` objects or string array
- `default` (string, optional): Initially selected value (alias for `defaultValue`)
- `defaultValue` (string, optional): Initially selected value

**Checkbox field properties:**

- `defaultValue` (boolean, optional): Initial checked state

#### Field onChange Handler

The `onChange` callback enables dynamic field interactions:

```ts
const targetsById = new Map(targets.map((t) => [t.id, t]));

const result = await manager.showFormDialog({
    title: 'Select Target',
    fields: [
        {
            id: 'target',
            type: 'dropdown',
            label: 'Device Target',
            options: targetOptions,
            required: true,
            default: targetOptions[0]?.value,
            // Update description when target selection changes
            onChange: (targetId, dialog) => {
                const target = targetsById.get(targetId);
                dialog.setFieldValue('description', target?.description || '');
            },
        },
        {
            id: 'description',
            type: 'text',
            label: 'Target Description',
            readonly: true,
            multiline: true,
            value: defaultDescription,
        },
    ],
});
```

The dialog instance passed to `onChange` provides:

- `setFieldValue(fieldId, value)`: Update field value programmatically
- `getFieldValue(fieldId)`: Get current field value
- All other FormDialogView methods

### Low-Level Dialog Handling

For custom dialogs requiring explicit ViewBase instances, use `showModal()`:

```ts
import { ConfirmationDialogView } from '../views/confirmation-dialog-view.js';

const dialog = new ConfirmationDialogView({
    title: this.t('dialog.confirm'),
    message: this.t('dialog.deleteMessage'),
    confirmLabel: this.t('dialog.delete'),
    cancelLabel: this.t('dialog.cancel'),
    i18nService: manager.i18nService,
});

manager.showModal(dialog);
```

**Do not** call private ViewManager members or modify internal modal layers directly. Use `showModal()` and view events (`confirm`, `cancel`, `close`) for lifecycle control.

`ModalDialogView` subclasses accept a shared option set: `title`, `icon`, `confirmLabel`,
`cancelLabel`, `showCancel`, `destructive`, `disableEscape`, `autofocus` and `showDismiss`. The
last three control how the dialog can be left:

- `showDismiss: false` removes the `×` button from the header. Use it for a dialog that reports a
  running, non-cancellable operation; such a dialog must always be closed programmatically with
  `dialog.close()`. The default `true` keeps every existing dialog unchanged.
- `disableEscape: true` stops Escape from cancelling the dialog (the default is `false`).
- `autofocus: false` skips moving focus to the first focusable element on attach.

A dialog with no buttons at all has zero focusable elements; the focus trap treats that as a valid
state and leaves focus where it is.

## Theme Management

```ts
// Set theme
manager.setTheme('dark');

// Listen for theme changes
manager.themeEvents.addEventListener('themechange', (event) => {
    console.log('Theme changed:', event.detail.theme);
});
```

## i18n Integration

```ts
// Access i18n service
manager.i18nService.setLocale('de');

// Listen for language changes
manager.i18nEvents.addEventListener('languagechange', (event) => {
    console.log('Language changed:', event.detail.locale);
});
```

## View Context Management

The ViewManager provides a public API for updating view deserialization context. This allows external code (like Workspace) to provide dependencies without accessing private members:

```ts
// Update context with workspace dependencies
manager.updateViewContext({
    workspace: workspaceInstance,
    viewManager: manager, // Self-reference for views
    deviceRuntime: activeDeviceRuntime,
    workspaceConfig: configInstance,
    collectionManager: collectionManager, // Single-source-of-truth for data access
});

// Context is passed to all views during deserialization
// Views receive context in their static deserialize(data, createChild, context) method
```

### CollectionManager Integration

As of January 2026, CollectionManager has been introduced as the single-source-of-truth for accessing collection and runtime data throughout the application. Views requiring access to node definitions, runtime information, or collection data should receive `collectionManager` through the view context:

```ts
// In view constructor
class MyView extends ViewBase {
    constructor({ collectionManager, ...rest }) {
        super({ ...rest });
        this.collectionManager = collectionManager;
    }

    render(container) {
        // Access runtime-aware data
        const nodePackages = this.collectionManager.getNodePackages();
        // ...
    }
}
```

### Typical Usage Pattern (in Workspace)

```ts
class Workspace {
    constructor() {
        this.viewManager = new ViewManager({
            i18nService: this.i18nService,
            theme: 'standard',
        });

        // Initialize CollectionManager for single-source-of-truth data access
        this.collectionManager = new CollectionManager(this);

        // Provide workspace and collectionManager references early
        this.viewManager.updateViewContext({
            workspace: this,
            viewManager: this.viewManager,
            collectionManager: this.collectionManager,
        });
    }

    async load() {
        // Load runtime and config
        await this.runtimeCollection.load();
        this.config = await this.configStore.getConfig();

        const activeCollection = this.getActiveCollection();
        const activeRuntime = this.runtimeCollection.getRuntime(
            activeCollection.getDeviceRuntimeId()
        );

        // Update context with loaded dependencies BEFORE deserializing views
        this.viewManager.updateViewContext({
            workspaceConfig: this.config,
            deviceRuntime: activeRuntime,
        });

        // Now deserialize - all views have complete context
        if (this.config.viewLayout) {
            this.viewManager.deserialize(this.config.viewLayout);
        }
    }
}
```

## API Reference

See [View API Reference](view-api-reference.md) for complete API documentation.

## Related Documentation

- [View System Overview](view-system-overview.md) - Architecture overview
- [ViewBase Lifecycle](view-api-reference.md) - View lifecycle management
- [Event System](view-events.md) - Communication patterns
- [Serialization](view-serialization.md) - State persistence

# View System Overview

The Micro Otter view system is a component framework that provides lifecycle management, event handling, serialization, and integration with i18n and theming. All UI components extend **ViewBase** and are managed by **ViewManager**.

## Architecture Components

The view system consists of several interconnected components:

- **[ViewBase](view-api-reference.md)** - Abstract base class for all views with lifecycle management
- **[ViewManager](view-manager.md)** - Orchestrates layered containers and manages view lifecycle
- **[Event System](view-events.md)** - Pub/sub communication between views and components
- **[Size Constraints](view-constraints.md)** - Automatic propagation of size requirements through view hierarchy
- **[Serialization](view-serialization.md)** - Save and restore view layouts and state
- **[Integration](view-integration.md)** - i18n, Node UI, and best practices
- **[API Reference](view-api-reference.md)** - Complete API documentation
- **[Specialized Components](view-specialized-components.md)** - MenuView, ToolbarView, CodeView, etc.
- **[Menu System](menu-system.md)** - MenuView entry model, nested menus and overlay ownership

## Class Hierarchy

```
ViewBase (abstract base)
  ├── SplitView (container)
  ├── TabbedView (container)
  ├── CollapsibleView (container with collapsible header)
  ├── StackView (vertical/horizontal layout container)
  ├── MessageView (short tone-aware text)
  ├── TextView
  ├── DataTableView (themed tabular data)
  ├── ProgressBarView (text-only readout for one long-running operation: stage, elapsed, optional Cancel)
  ├── ProgressDetailView (two determinate progress tiers with labels and messages; pure content)
  ├── CodeView (specialized text with syntax highlighting)
  ├── MarkdownView (safe Markdown → allowlisted HTML)
  ├── MenuView (context menu with keyboard navigation and click-away)
  ├── ToolbarView (configurable action buttons; can host self-rendering controls via `addControl()`)
  ├── GraphPanelView
  ├── TranspilerView (code generation and deployment)
  ├── WorkspaceView
  ├── LanguagePickerView
  ├── ConsoleLogView (message display with type icons)
  ├── DeviceConnectionView (composite: collapsible runtime controls, runtime settings, and device log)
  ├── GeneralSettingsView (workspace-wide settings)
  ├── CollectionSettingsView (collection-specific settings)
  ├── GraphSettingsView (graph-specific settings)
  ├── AllSettingsView (unified settings container)
  ├── IconProvider (utility)
  ├── OverlayWindow (windowed)
  │   └── MenuWindow (hosts a MenuView; opens `menuview` rows as side windows)
  └── ModalDialogView (abstract modal base)
      ├── ConfirmationDialogView
      ├── ErrorDialogView
      ├── TextDialogView
      ├── FormDialogView
      └── FileImportDialogView
```

## View Categories

**Container Views**: SplitView, StackView, and TabbedView can compose arbitrary child views. TabbedView also supports opt-in tab reordering with pinned tabs, persisted graph order, and pointer/`Alt+Arrow` gestures.<br>
**Collapsible Containers**: CollapsibleView provides collapsible sections with header and content panel; `collapsible: false` renders a static, always-open section header.<br>
**Settings Views**: GeneralSettingsView, CollectionSettingsView, GraphSettingsView, and AllSettingsView for configuration management  
**Standalone Views**: TextView, GraphPanelView, WorkspaceView, etc. for specific features  
**Specialized Views**: CodeView (syntax-highlighted code), MarkdownView (safe Markdown rendering), MenuView (context menus), ToolbarView (action buttons), ConsoleLogView (message display), DataTableView (themed tabular data), ProgressBarView (text-only progress readout for one running operation), ProgressDetailView (two determinate progress tiers with labels and messages)  
**Composite Views**: TranspilerView (ToolbarView + CodeView), DeviceConnectionView (ToolbarView + CustomRuntimeView + ConsoleLogView, each in a CollapsibleView pane)<br>
**Overlay System**: OverlayWindow provides draggable, resizable floating windows  
**Menu System**: MenuView (content) + OverlayWindow (container) = MenuWindow (convenience wrapper); `menuview` entries open nested menus as side windows whose lifetime belongs to the parent window — see [Menu System](menu-system.md)
**Modal System**: Hierarchy of dialog views for user interactions; ConfirmationDialogView supports an optional checkbox row via `checkboxLabel`/`checkboxChecked` and exposes `checkboxChecked`, surfaced to callers through `ViewManager.showConfirmationWithCheckbox`
**Device Communication**: ConsoleLogView and DeviceConnectionView provide serial communication UI

## Key Concepts

### Lifecycle Management

ViewBase provides a standardized lifecycle with `attachTo()` and `detach()` methods. See [ViewBase Lifecycle](view-api-reference.md) for details.

**CRITICAL**: `attachTo()` and `detach()` are **CREATE/DESTROY** operations, not show/hide operations. For temporary visibility changes, use CSS `display: none`.

### Layer System

ViewManager organizes views into three layers:

- **Root Layer** (z-index: 0) - Main view tree
- **Overlay Layer** (z-index: 10) - Floating windows
- **Modal Layer** (z-index: 20) - Dialogs

See [ViewManager](view-manager.md) for layer management details.

### Data Flow

- **Top-Down**: Dependencies injected via constructor (i18nService, logger, etc.)
- **Bottom-Up**: Events bubble from children to parents
- **Cross-Panel**: Messages sent via SplitView message channel

See [Event System](view-events.md) and [Data Flow](view-integration.md#data-flow) for details.

## Quick Start

### Creating a Simple View

```ts
import { ViewBase } from './views/view-base.js';

class MyView extends ViewBase {
    constructor(options) {
        super(options);
        this._count = 0;
    }

    render(container) {
        const button = document.createElement('button');
        button.textContent = this.t('myView.increment');
        button.onclick = () => {
            this._count++;
            this.render(container);
        };

        const label = document.createElement('div');
        label.textContent = `Count: ${this._count}`;

        container.replaceChildren(button, label);
    }

    afterAttach() {
        // Subscribe to language changes for i18n
        this._subscribeToLanguageChanges(() => {
            this.render(this.container);
        });
    }

    serialize() {
        return {
            type: 'MyView',
            count: this._count,
        };
    }

    static deserialize(data, createChild, context) {
        return new MyView({
            count: data.count,
            ...context,
        });
    }
}
```

### Using ViewManager

```ts
import { ViewManager } from './views/view-manager.js';
import { SplitView } from './views/split-view.js';

const manager = new ViewManager({
    rootElement: document.getElementById('app'),
    i18nService: i18nService,
    theme: 'standard',
});

const layout = new SplitView({
    orientation: 'horizontal',
    views: [new MyView(), new TextView({ text: 'Hello World' })],
});

manager.attachRoot(layout);

// Show a confirmation dialog
const confirmed = await manager.showConfirmation({
    title: 'Confirm Action',
    message: 'Are you sure?',
});

if (confirmed) {
    // Proceed with action
}
```

## Related Documentation

### Core View System

- **[ViewBase Lifecycle](view-api-reference.md)** - Lifecycle management and hooks
- **[ViewManager](view-manager.md)** - Layer management and dialogs
- **[Event System](view-events.md)** - Communication patterns
- **[Size Constraints](view-constraints.md)** - Constraint propagation
- **[Serialization](view-serialization.md)** - State persistence
- **[Integration](view-integration.md)** - i18n, Node UI, best practices
- **[API Reference](view-api-reference.md)** - Complete API docs
- **[Specialized Components](view-specialized-components.md)** - Component catalog

### Specialized Features

- [ViewBase Resize Observer Guide](viewbase-resize-observer-guide.md) - ResizeObserver integration
- [ViewBase Desired Size Guide](viewbase-desired-size-guide.md) - Size preferences
- [Collapsible View](collapsible-view.md) - Collapsible containers
- [Stack View](stack-view.md) - Vertical/horizontal layout container
- [Message View](message-view.md) - Tone-aware short text
- [Settings Views Guide](settings-views-guide.md) - Settings system
- [TabbedView Hooks Guide](tabbed-view-hooks.md) - Lazy loading hooks
- [TabbedView Reordering](tabbed-view-reordering.md) - Drag, keyboard, pinned tabs and persisted graph order
- [Collection View Architecture](collection-view-architecture.md) - Collection management
- [Graph Panel View Architecture](graph-panel-view-architecture.md) - Node graph editor
- [Device Deployment View Architecture](device-deployment-view-architecture.md) - Device deployment
- [Custom View Architecture](custom-view-architecture.md) - Custom view format

### Integration

- [Data Backbone Architecture](../core/data-backbone-architecture.md) - Data model
- [I18n Architecture](../core/i18n-architecture.md) - Translation system
- [Standard Theme Styling Guide](standard-theme-styling-guide.md) - CSS customization
- [WebSerial Architecture](../device-communication/webserial-architecture.md) - Device communication

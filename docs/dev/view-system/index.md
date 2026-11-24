# View System Documentation

This folder contains documentation about the view system architecture and UI components.

## Getting Started

**Start here**: [View System Overview](view-system-overview.md)

**Navigation Guide**: [View System Architecture](view-system-architecture.md)

**This file**: [index.md](index.md)

## Files

### Core Architecture

- **[view-system-overview.md](view-system-overview.md)** - Architecture overview, class hierarchy, view categories, and quick start examples. **Start here for new developers.**

- **[view-system-architecture.md](view-system-architecture.md)** - Navigation guide and table of contents for all view system documentation.

- **[view-manager.md](view-manager.md)** - ViewManager layer management, modal dialogs, theme/i18n context, and CollectionManager integration.

- **[view-reuse-rules.md](view-reuse-rules.md)** - Mandatory reuse rules for any UI change: name the exact shared component to reuse, never hand-roll dialogs/overlays/tables/toolbars, and when a new `js/views/*` component is genuinely required.

- **[view-events.md](view-events.md)** - Event system, communication patterns, and data flow between views.

- **[view-constraints.md](view-constraints.md)** - Size constraint propagation and enforcement patterns.

- **[view-serialization.md](view-serialization.md)** - State persistence and layout saving/loading.

- **[view-integration.md](view-integration.md)** - i18n integration, Node UI integration, and best practices.

- **[view-api-reference.md](view-api-reference.md)** - Complete ViewBase and ViewManager API documentation.

- **[view-specialized-components.md](view-specialized-components.md)** - Catalog of specialized view components.

- **[markdown-view.md](markdown-view.md)** - `MarkdownView`, the reusable Markdown renderer that displays safe, allowlisted HTML from Markdown source (headings, lists, emphasis, code, links).

- **[file-picker-dialog.md](file-picker-dialog.md)** - `FilePickerDialogView`, the server-side path picker (file and folder-only modes) that returns a server path for `addon.install` / `firmware.import` / `firmware.export`.

- **[mdi-icon-picker-control.md](mdi-icon-picker-control.md)** - `MdiIconPickerControl`, the reusable searchable MDI icon picker (labelled field + anchored glyph grid, `body`/`inline` portals, paged search, never-rejecting free text) and the shared `mdiGlyphFromCodepoint`/`resolveMdiGlyph` helpers.

- **[markdown-editor-control.md](markdown-editor-control.md)** - `MarkdownEditorControl`, the reusable editable-Markdown control (rendered allowlisted preview + *Edit*/*Done*, textarea edit mode; commit on Done/blur/Ctrl/Cmd+Enter, Escape cancels) used for the function-graph description and per-port documentation.

- **[device-connection-dialog.md](device-connection-dialog.md)** - `DeviceConnectionDialogView`, the one provider/port chooser and `Connect`/`Disconnect` action, and its "close before you connect" `open()` sequencer.

- **[connecting-progress-dialog.md](connecting-progress-dialog.md)** - `ConnectingProgressDialogView`, the progress surface between the closed configuration dialog and `connect()`, its five close rules and the cancel/Close split.

- **[deployment-progress-dialog.md](deployment-progress-dialog.md)** - `DeploymentProgressDialogView`, the one progress surface for device write operations (deploy/sync/remove/runtime), its setters, and the repaint-from-state rule the controller depends on.

- **[progress-detail-view.md](progress-detail-view.md)** - `ProgressDetailView`, the reusable two-tier determinate progress display (overall + detail) with owner-supplied labels and messages, its clamping contract, plain-content styling and the `ProgressBarView` boundary.

### ViewBase Features

- **[viewbase-resize-observer-guide.md](viewbase-resize-observer-guide.md)** - ResizeObserver integration in ViewBase with onInitialSize() and onResized() hooks for size-dependent rendering logic.

- **[viewbase-desired-size-guide.md](viewbase-desired-size-guide.md)** - Desired size feature for views to communicate size preferences to hosting containers like SplitView.

### Container Views

- **[collapsible-view.md](collapsible-view.md)** - CollapsibleView container with collapsible header and content panel for building expandable/collapsible UI sections.

- **[split-view-sizing.md](split-view-sizing.md)** - The DOM-free pane-size solver behind SplitView: splitter thickness, equal distribution, and fair vs authoritative sizing requests.

- **[tabbed-view-hooks.md](tabbed-view-hooks.md)** - TabbedView extensibility hooks for lazy loading and custom view lifecycle.

- **[tabbed-view-reordering.md](tabbed-view-reordering.md)** - Opt-in drag and `Alt+Arrow` tab reordering, pinned tabs, and persisted `Collection` graph order.

- **[tabbed-view-tab-variants.md](tabbed-view-tab-variants.md)** - The opaque `tabVariant` entry hook, its `data-tab-variant` DOM contract, graph execution-type providers, and theme-token styling.

### Specialized Views

- **[settings-views-guide.md](settings-views-guide.md)** - Settings view system architecture including GeneralSettingsView, CollectionSettingsView, GraphSettingsView, and AllSettingsView for configuration management.

- **[menu-system.md](menu-system.md)** - `MenuView` entry model (separator / action / `menuview`), nested menus, overlay ownership and keyboard map.

- **[collection-view-architecture.md](collection-view-architecture.md)** - CollectionView component for managing projects and graphs with lazy-loaded tab views.

- **[graph-panel-view-architecture.md](graph-panel-view-architecture.md)** - GraphPanelView modular architecture with viewport, rendering, selection, interaction, and clipboard modules for canvas-based node graph editing, plus the flex layout skeleton and the panel toolbar (align-to-grid, execution type, interval).

- **[graph-panel-documentation-areas.md](graph-panel-documentation-areas.md)** - Documentation areas ("group boxes"): the two-canvas plus DOM layer stack, the Markdown/math rendering, the translucency invariant, interaction and clipboard integration.

- **[graph-panel-view-modularization-guide.md](graph-panel-view-modularization-guide.md)** - Implementation guide for integrating GraphPanelView modules with step-by-step migration patterns and code examples.

- **[node-ui-module-structure.md](node-ui-module-structure.md)** - NodeUi modular architecture split into constants, helpers, hit-testing, editors, and rendering modules for maintainability and testability.

- **[device-deployment-view-architecture.md](device-deployment-view-architecture.md)** - DeviceDeploymentView component for managing runtime and collection deployment with one collapsible split shell (five panes connected, a single Help pane disconnected), status display, and progress tracking.

- **[firmware-build-view-architecture.md](firmware-build-view-architecture.md)** - FirmwareBuildView (Firmware tab): the renderer of the `GET /api/server-capabilities` + `WS /firmware` contract — probing/ready/unavailable states, target info table, stageable package checklist, and the single-flight build/deploy/scan flows with capability gating, composed from the registered stylesheet, `CollapsibleView`/`ContentView` sections, and the shared data/control views.

- **[custom-view-architecture.md](custom-view-architecture.md)** - Custom view JSON definition format, control types, device function execution with parameter substitution, and structured JSON response protocol for updating UI controls.

### Styling

- **[standard-theme-styling-guide.md](standard-theme-styling-guide.md)** - CSS customization guide for the Standard Compact Dark theme including view borders, padding, spacing, and CSS variable usage.

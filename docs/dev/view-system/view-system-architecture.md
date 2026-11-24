# View System Architecture

> **Note**: This documentation has been split into focused guides for better readability.
>
> **Start here**: [View System Overview](view-system-overview.md)

## Documentation Structure

The View System documentation is now organized as follows:

### Core Documentation

- **[View System Overview](view-system-overview.md)** - Start here for architecture overview, class hierarchy, and quick start
- **[ViewBase Lifecycle](viewbase-lifecycle.md)** - Lifecycle management, attachment flow, and hooks
- **[ViewManager](view-manager.md)** - Layer management, dialogs, themes, and context
- **[Event System](view-events.md)** - Communication patterns and data flow
- **[Size Constraints](view-constraints.md)** - Constraint propagation and enforcement
- **[Serialization](view-serialization.md)** - State persistence and layout saving
- **[Integration](view-integration.md)** - i18n, Node UI, and best practices
- **[API Reference](view-api-reference.md)** - Complete API documentation

### Specialized Features

- **[ViewBase Resize Observer Guide](viewbase-resize-observer-guide.md)** - ResizeObserver integration
- **[ViewBase Desired Size Guide](viewbase-desired-size-guide.md)** - Size preference system
- **[Collapsible View](collapsible-view.md)** - Collapsible container component
- **[Settings Views Guide](settings-views-guide.md)** - Settings system architecture
- **[TabbedView Hooks Guide](tabbed-view-hooks.md)** - Lazy loading and hooks
- **[Collection View Architecture](collection-view-architecture.md)** - Collection management
- **[Graph Panel View Architecture](graph-panel-view-architecture.md)** - Node graph editor
- **[Device Deployment View Architecture](device-deployment-view-architecture.md)** - Device deployment
- **[Custom View Architecture](custom-view-architecture.md)** - Custom view format

### Function Graphs (Feature Note)

The `function` execution type adds **no view and no control**. `GraphSettingsView` composes its
signature editor from the existing `CollapsibleView`, `ToolbarView`, `TextControl` and the
multi-select `DropdownControl` (see
[Settings Views Guide → Function block](settings-views-guide.md#function-block)), and
`NodePaletteView` lists generated `function_graph.<id>` entries as ordinary node types. The model and
transpiler contract live in [Function Graphs](../nodes/function-graphs.md).

### Cross-System Integration

- [Data Backbone Architecture](../core/data-backbone-architecture.md) - Data model
- [I18n Architecture](../core/i18n-architecture.md) - Translation system
- [Standard Theme Styling Guide](standard-theme-styling-guide.md) - CSS customization
- [WebSerial Architecture](../device-communication/webserial-architecture.md) - Device communication

## Migration Guide

If you're looking for specific content from the old unified document:

| Old Section                 | New Location                                                                |
| --------------------------- | --------------------------------------------------------------------------- |
| Overview & Class Hierarchy  | [View System Overview](view-system-overview.md)                             |
| ViewBase Lifecycle          | [ViewBase Lifecycle](viewbase-lifecycle.md)                                 |
| ViewManager                 | [ViewManager](view-manager.md)                                              |
| Event System                | [Event System](view-events.md)                                              |
| Size Constraint Propagation | [Size Constraints](view-constraints.md)                                     |
| Data Flow                   | [Event System](view-events.md#data-flow-patterns)                           |
| Serialization Pipeline      | [Serialization](view-serialization.md)                                      |
| Integration with i18n       | [Integration](view-integration.md)                                          |
| Node UI Integration Points  | [Integration](view-integration.md)                                          |
| Best Practices              | [Integration](view-integration.md)                                          |
| ViewBase API Reference      | [API Reference](view-api-reference.md)                                      |
| ViewManager API Reference   | [API Reference](view-api-reference.md)                                      |
| Specialized View Components | [View System Overview](view-system-overview.md) & individual component docs |

## Quick Navigation

**Getting Started?** Start with [View System Overview](view-system-overview.md)

**Building a Custom View?** See [ViewBase Lifecycle](viewbase-lifecycle.md) and [Serialization](view-serialization.md)

**Managing Layouts?** See [ViewManager](view-manager.md)

**Need API Docs?** See [API Reference](view-api-reference.md)

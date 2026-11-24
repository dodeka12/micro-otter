# View Serialization and Persistence

The view system provides comprehensive serialization support for saving and restoring view layouts and state.

## Saving Layouts

```ts
// Serialize entire view tree
const layoutData = manager.serializeRoot();

// Save to IndexedDB via ViewStore
await manager.saveLayout('workspace-main');

// Manual save with ViewStore
await manager.viewStore.put('layout-id', layoutData);
```

## Loading Layouts

```ts
// Load from IndexedDB
const rootView = await manager.loadLayout('workspace-main');

// Manual load with ViewFactory
const data = await manager.viewStore.get('layout-id');
const view = manager.viewFactory.create(data.type, data, context);
manager.attachRoot(view);
```

## Serialization Format

```ts
{
  type: 'SplitView',
  orientation: 'horizontal',
  ratio: 0.5,
  views: [
    {
      type: 'TabbedView',
      activeIndex: 0,
      tabs: [
        {
          type: 'GraphPanelView',
          graphId: 'graph-1',
          viewport: { scale: 1, translateX: 0, translateY: 0 },
          grid: { enabled: true, visible: true },
          selection: { /* selected item ids */ }
        }
      ]
    },
    {
      type: 'TextView',
      text: 'Output log'
    }
  ]
}
```

### TabbedView Reordering Fields

`TabbedView.serialize()` includes two reorder-specific fields:

```ts
{
  type: 'TabbedView',
  reorderable: true,
  tabMovability: [
    { id: 'graph-1', movable: true },
    { id: 'special', movable: false }
  ],
  // ...views, tabClosers, controls, activeId
}
```

- `reorderable` defaults to `false` when absent, so layouts saved before the feature keep today's
  behaviour.
- `tabMovability` is a parallel array keyed by view id. The `movable` flag is deliberately not added
  to each child view payload, so child `serialize()` shapes stay unchanged.
- Unknown ids are pruned during `deserialize()`; re-adding a tab without a pin makes it movable.
- For `CollectionView`, persisted **graph order** is not read from this tab list. `Collection` owns
  graph order and re-applies it through `Collection.GraphMoved.v1`; see
  [TabbedView Tab Reordering](tabbed-view-reordering.md).

## ViewFactory Registration

```ts
// ViewFactory maintains type registry
viewFactory.register('GraphPanelView', GraphPanelView);
viewFactory.register('NodePaletteView', NodePaletteView);
viewFactory.register('CodeView', CodeView);
viewFactory.register('ToolbarView', ToolbarView);
viewFactory.register('TranspilerView', TranspilerView);

// During deserialization
const view = viewFactory.create('GraphPanelView', data, context);
```

## Implementing Serialization in Custom Views

### serialize() Method

Return a JSON-serializable object representing view state:

```ts
serialize() {
    return {
        type: 'GraphPanelView',
        graphId: this._graphId,
        viewport: {
            pan: { x: this._pan.x, y: this._pan.y },
            zoom: this._zoom
        }
    };
}
```

**Guidelines:**

- **Always include `type`**: Required for ViewFactory to reconstruct the view
- **Serialize only view state**: Don't serialize data (data is saved separately by data backbone)
- **Store viewport settings**: Pan, zoom, scroll positions — unless the model owns them. The graph
  panel persists its live viewport on the graph document (`viewportConfig`); its layout record keeps
  a snapshot, but the panel resolves the opening viewport from the graph. See
  [graph-panel-view-architecture.md](./graph-panel-view-architecture.md) (*Initial Viewport*).
- **Store UI preferences**: Collapsed panels, selected tabs, etc.
- **Use JSON-serializable types**: Primitives, objects, arrays (no functions, DOM elements, etc.)

### static deserialize() Method

Restore view state from serialized data:

```ts
static deserialize(data, createChild, context) {
    // createChild is a function for deserializing nested views
    // context provides services (i18nService, logger, workspace, etc.)

    const view = new GraphPanelView({
        graph,
        collection,
        i18nService,
        // ...remaining services from the context
    });
    // Layout-only state (grid toggles, selection). The opening viewport comes from the graph
    // document (`viewportConfig`), not from this snapshot.
    view.deserialize(data);
    return view;
}
```

**Parameters:**

- `data`: Serialized state from `serialize()`
- `createChild`: Function for deserializing nested views (used by containers)
- `context`: Services and dependencies from ViewManager

**Guidelines:**

- **Provide defaults**: Handle missing or invalid data gracefully
- **Validate data**: Check that required fields exist
- **Use createChild for nested views**: Container views should use this for children
- **Spread context**: Pass services to constructor via `...context`

### Container View Serialization

Containers must serialize their children:

```ts
// SplitView serialization
serialize() {
    return {
        type: 'SplitView',
        orientation: this._orientation,
        ratio: this._ratio,
        views: this._views.map(v => v.serialize())  // Serialize children
    };
}

static deserialize(data, createChild, context) {
    const views = data.views?.map(childData =>
        createChild(childData)  // Use createChild to deserialize
    ) || [];

    return new SplitView({
        orientation: data.orientation,
        ratio: data.ratio,
        views,
        ...context
    });
}
```

## Best Practices

### What to Serialize

✅ **DO serialize:**

- Viewport state (pan, zoom, scroll)
- UI preferences (collapsed panels, active tabs)
- Layout configuration (split ratios, window positions)
- View-specific settings (code language, display options)
- References to data (IDs, not actual data objects)

❌ **DON'T serialize:**

- Actual data objects (use IDs and load from data backbone)
- Functions or closures
- DOM elements or references
- Service instances (i18nService, logger, etc.)
- Circular references

### Error Handling

```ts
static deserialize(data, createChild, context) {
    try {
        // Validate required fields
        if (!data.graphId) {
            throw new Error('GraphPanelView requires graphId');
        }

        // Provide sensible defaults
        const viewport = data.viewport || { pan: { x: 0, y: 0 }, zoom: 1.0 };

        return new GraphPanelView({
            graphId: data.graphId,
            viewport,
            ...context
        });
    } catch (error) {
        context.logger?.error('Failed to deserialize GraphPanelView:', error);
        // Return a fallback view or null
        return null;
    }
}
```

### Versioning

Consider versioning your serialization format for future compatibility:

```ts
serialize() {
    return {
        type: 'GraphPanelView',
        version: 2,  // Increment when format changes
        graphId: this._graphId,
        viewport: this._viewport,
        // New fields in v2
        gridVisible: this._gridVisible
    };
}

static deserialize(data, createChild, context) {
    const version = data.version || 1;

    if (version === 1) {
        // Migrate prior-version data
        return this._migrateFromVersion1(data, context);
    }

    // Handle current version
    return new GraphPanelView({
        graphId: data.graphId,
        viewport: data.viewport,
        gridVisible: data.gridVisible ?? true,
        ...context
    });
}
```

## Related Documentation

- [View System Overview](view-system-overview.md) - Architecture overview
- [ViewManager](view-manager.md) - Layout management
- [ViewBase Lifecycle](view-api-reference.md) - Lifecycle methods
- [API Reference](view-api-reference.md) - Serialization API details

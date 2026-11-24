# View Event System

The View System provides a standardized event-driven communication model for views and components to interact without tight coupling.

## AppEvent Envelope (`.v1` in the current codebase)

For internal emitter-based events, the standard payload contract is the `AppEvent` envelope:

- `name`
- `detail` (dedicated payload class instance with `payloadTypeId`)

Use versioned `payloadTypeId` values with the format `<EmitterClass>.<EventSemantic>.v<major>`.
Every emitter in the current codebase uses `.v1`; `.v2` identifiers in older examples are
illustrative only.

Example emission:

```ts
this._emit('tab-changed', new TabbedViewTabChangedPayload({ activeId, previousId, activeIndex, previousIndex, view }));
```

Example listener:

```ts
view.on('tab-changed', (event) => {
    if (event?.detail?.payloadTypeId !== 'TabbedView.TabChanged.v1') {
        return;
    }

    const payload = event.detail;
    console.log('Tab changed:', payload.activeId, payload.previousId);
});
```

For boundary APIs that use DOM events (`CustomEvent`), keep existing contracts and use equivalent structure in `event.detail` where practical.

For internal view emitters, `_emit(eventName, payloadInstance)` wraps `AppPayload` instances into `AppEvent` internally. Do not pass `new AppEvent(...)` to `_emit`.

## Standard ViewBase Events

All views emit these events:

- **attach**: Fired when view attached to container
- **afterAttach**: Fired after render() completes
- **beforeDetach**: Fired before detachment
- **detach**: Fired after detachment
- **resize**: Fired on ResizeObserver changes (alias for backwards compatibility)
- **initialSize**: Fired on first size measurement
- **resized**: Fired on subsequent size changes
- **focus**: Fired when view gains focus

## Subscribing to Events

```ts
// From outside the view
view.on('resize', (event) => {
    const { width, height } = event.detail;
    console.log('View resized:', width, height);
});

// From inside the view
this._emit('customEvent', new MyViewCustomEventPayload({ data: 'value' }));
```

## Container-Specific Events

### SplitView Events

SplitView emits **layoutChange** (`SplitView.LayoutChange.v1`) as an `AppEvent` whenever ratios,
pane count, or constraints change:

```ts
splitView.on('layoutChange', (event) => {
    const { source, viewId, ratios, count, orientation } = event.detail;
    // source: 'render' | 'drag' | 'constraints' | 'relative' | 'previous' | 'solo' | 'desiredSize'
});
```

A direct pane child never reaches into the host. It calls the `ViewBase` request helpers, which
dispatch a `CustomEvent` on the pane's `EventTarget` channel (`getSplitViewChannel()`) and let the
host fill in the mutable `event.detail`:

| Event | Requester | Response detail |
|-------|-----------|-----------------|
| `splitview:query-host` | `querySplitViewHost()` | `{ handled, hosted, hostId, viewId, paneIndex, orientation, count }` |
| `splitview:resize-request` | `requestSplitViewResize(action)` | `{ handled, reason?, hostId, viewId, paneIndex }` plus updated ratios |
| `splitview:size-constraints` | `setMinHeight()`, `setMaxHeight()`, `setHeightConstraints()` | applied pane constraints |
| `splitview:solo-request` | `requestSplitViewSolo()` | `{ handled, hosted, hostId, viewId, paneIndex, collapsedViewIds }` |

The names are exported as `SPLIT_VIEW_EVENTS` from `views/split-view.ts`. `view-base.ts` keeps the
`solo-request` literal inline because importing the constant there would create a module cycle.

These are boundary DOM events, so they keep the `CustomEvent` shape rather than an `AppPayload`
class; `layoutChange` remains the `AppEvent` a listener subscribes to on the SplitView itself.

### TabbedView Events

- **tab-changed** (`TabbedView.TabChanged.v1`): Fired when the active tab switches.
- **tab-renamed** (`TabbedView.TabRenamed.v1`): Fired when a tab rename is committed or rejected.
- **tab-moved** (`TabbedView.TabMoved.v1`): Fired once after a successful reorder.
- **tab-context-menu** (`TabbedView.TabContextMenu.v1`): Fired for `contextmenu` or
  `Shift+F10`/`ContextMenu` on a tab when the TabbedView was constructed with
  `tabContextMenu: true`. The payload carries `viewId`, `view`, `clientX`, `clientY` and the
  `nativeEvent`; opening the menu must not change the active tab.
- **control** (`TabbedView.Control.v1`): Fired when a control tab is activated.

```ts
// React to tab changes
tabbedView.on('tab-changed', (event) => {
    const { activeId, previousId, activeIndex, previousIndex } = event.detail;
    console.log(`Switched from ${previousId} (${previousIndex}) to ${activeId} (${activeIndex})`);
});

// React to a successful reorder
tabbedView.on('tab-moved', (event) => {
    const { viewId, fromIndex, toIndex } = event.detail;
    console.log(`Moved ${viewId} from ${fromIndex} to ${toIndex}`);
});

// Open a consumer-owned menu for the clicked tab
tabbedView.on('tab-context-menu', (event) => {
    const { viewId, clientX, clientY, nativeEvent } = event.detail;
    openMyTabMenu(viewId, { x: clientX, y: clientY, trigger: nativeEvent });
});
```

`CollectionView` opts in and owns the graph-specific entries:
`collection.tabContextMenu.rename` (opens the same inline editor as a tab double-click through
`TabbedView.beginTabRename()`), `collection.tabContextMenu.enabled` (a checked enable toggle routed
through `graph.setEnabled()`) and `menu.item.deleteGraph` (routed through
`requestGraphDeletion()`, which keeps the confirmation dialog and the
`CollectionManager.removeGraph()` path). The TabbedView itself stays domain-agnostic.

### CollectionView and `Collection.GraphMoved.v1`

`CollectionView` enables `reorderable: true` for graph tabs. A user move follows this path:

```text
tab-moved -> CollectionManager.moveGraph -> Collection.moveGraph
          -> Collection.GraphMoved.v1 -> CollectionView.moveView (sync)
```

The view sets `_syncingGraphOrder` around the sync `moveView()` so the resulting `tab-moved` is not
forwarded back to the data layer. `Collection.GraphMoved.v1` carries `graphId`, `fromIndex` and
`toIndex`. See [TabbedView Tab Reordering](tabbed-view-reordering.md) for the full flow.

### OverlayWindow Events

- **minimize**: Overlay minimized
- **restore**: Overlay restored from minimized
- **move**: Overlay moved
- **resize**: Overlay resized
- **close**: Overlay closed

```ts
// Track overlay lifecycle
overlay.on('close', () => {
    console.log('Overlay closed by user');
});

overlay.on('move', (event) => {
    const { x, y } = event.detail;
    console.log(`Overlay moved to (${x}, ${y})`);
});
```

## Data Flow Patterns

### Top-Down (Dependency Injection)

```
ViewManager
  ↓ (creates)
ViewFactory (with i18nService, logger)
  ↓ (creates views with context)
ViewBase subclasses
  ↓ (access services via this._i18nService, this._logger)
```

Dependencies are injected via constructor options and propagated through the view hierarchy.

### Bottom-Up (Events)

```
Child View
    ↓ emit('custom-event', payloadInstance)
Parent Container
  ↓ (processes event, emits up if needed)
ViewManager
  ↓ (application-level handlers)
```

Events bubble from children to parents, allowing parent containers to react to child actions without tight coupling.

### Sibling Coordination (SplitView)

SplitView has no sibling-to-sibling message bus and no `sendMessage()` API. A pane can only ask its
host for layout changes (`splitview:resize-request`, `splitview:solo-request`,
`splitview:size-constraints`), and the host performs the mutation through the documented child API.
Any other cross-panel state belongs to an application-level service or the shared data backbone, not
to pane events.

**Best Practice**: Keep pane channel traffic limited to layout intent; use app services for domain
state so a pane stays usable outside a SplitView.

## Custom Events

Views can emit custom events for domain-specific interactions:

```ts
class GraphPanelView extends ViewBase {
    _handleNodeClick(node) {
        // Emit custom event for external listeners
        this._emit('node-selected', new GraphPanelNodeSelectedPayload({
            nodeId: node.id,
            nodeType: node.type,
            position: node.position,
        }));
    }
}

// External listener
graphPanel.on('node-selected', (event) => {
    const { nodeId, nodeType } = event.detail;
    console.log(`Node ${nodeId} of type ${nodeType} selected`);
    nodeInspector.showNode(nodeId);
});
```

## Event Handling Best Practices

### Namespace Custom Events

Use namespaces to avoid conflicts with standard events:

```ts
// ✅ GOOD: Namespaced custom events
this._emit('graph:node-selected', new GraphNodeSelectedPayload({ nodeId }));
this._emit('graph:edge-created', new GraphEdgeCreatedPayload({ edgeId }));
this._emit('transpiler:code-generated', new TranspilerCodeGeneratedPayload({ code }));

// ❌ AVOID: Generic names that might conflict
this._emit('selected', new SelectedPayload({ nodeId }));
this._emit('created', new CreatedPayload({ edgeId }));
```

### Clean Up Listeners

Most event listeners are automatically cleaned up during `detach()`, but manually added listeners on external objects must be cleaned up in `beforeDetach()`:

```ts
class MyView extends ViewBase {
    afterAttach() {
        // ViewBase events - auto cleanup
        this._subscribeToLanguageChanges(() => this.render(this.container));

        // External object - requires manual cleanup
        this._nodeDataListener = (event) => this._onNodeChanged(event);
        this._nodeData.on('changed', this._nodeDataListener);
    }

    beforeDetach() {
        // Clean up external listener
        if (this._nodeDataListener) {
            this._nodeData.off('changed', this._nodeDataListener);
            this._nodeDataListener = null;
        }
    }
}
```

### Use Consistent Event Shapes

Provide structured event data with consistent shapes:

```ts
// ✅ GOOD: Structured, consistent event data
this._emit('node-updated', new NodeUpdatedPayload({
    nodeId: 'node-123',
    changes: { x: 100, y: 200 },
    timestamp: Date.now(),
}));

// ❌ AVOID: Inconsistent or primitive event data
this._emit('node-updated', new NodeUpdatedPayload({ id: 'node-123' })); // Inconsistent key names
```

## Related Documentation

- [View System Overview](view-system-overview.md) - Architecture overview
- [ViewBase Lifecycle](view-api-reference.md) - Lifecycle event sequence
- [Integration Guide](view-integration.md) - Integration patterns
- [API Reference](view-api-reference.md) - Event API details

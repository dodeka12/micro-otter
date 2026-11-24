# CollectionView Architecture

## Overview

CollectionView is a TabbedView-based container that renders the graphs inside a single Collection. It provides a tab per NodeGraph, lazily instantiates GraphPanelView, and integrates with workspace-level changes to keep the UI in sync with the data backbone.

## Responsibilities

- Render one tab per NodeGraph in the active Collection
- Provide a “+” control tab to add graphs
- Lazily create GraphPanelView only when a tab becomes active
- Keep tab labels in sync with graph names
- Provide graph enable/delete actions through the tab context menu
- Ensure at least one graph exists
- React to workspace active-collection changes without full re-attach

## Key Flows

### 1) Initial Load

1. CollectionView subscribes to Collection change events.
2. `_loadGraphs()` creates placeholders for all graphs.
3. The active graph is converted into a GraphPanelView and selected.
4. The view is attached via TabbedView’s lifecycle.

### 2) Lazy GraphPanelView Creation

- Tabs for non-active graphs are lightweight placeholders.
- When a tab is activated, `_onViewRequested()` resolves the graph from the Collection and creates a GraphPanelView.
- The placeholder is replaced in-place in the `views` array.

### 3) Add Graph

- The “+” control tab emits a `control` event.
- `_onAddGraph()` creates a NodeGraph and calls `Collection.addGraph()`.
- Collection change events update tabs automatically.

### 4) Active Collection Switch (Workspace)

- CollectionView subscribes to workspace change events.
- On `activeCollectionChanged`, CollectionView rebuilds tabs using public APIs:
    - `setViews([])` to replace the content views
    - `setControls([])` to reset control tabs
    - `_loadGraphs()` to populate placeholders and the active graph
- No direct access to TabbedView internals is allowed.

### 5) Delete Graph

Graph tabs carry **no close button**: `_createTabPlaceholder()` registers every graph tab with
`closable: false` (`addView(placeholder, index, false, false)`), so the tab strip of the graph area
has no "x" affordance. (The `CollectionView`'s own `closable: true` default only applies when the
collection view itself is placed in a tab strip.) Deleting a graph has **one UI entry point**:

**Graph-tab context menu** — right-click or `Shift+F10` on a graph tab emits
`TabbedView.TabContextMenu.v1`. `CollectionView` opens a `MenuWindow` with **Rename Graph**, the
enable toggle and `delete-graph`. The delete row is disabled while the collection holds only one
graph; selecting it calls `requestGraphDeletion(graphId)`, which confirms through
`ConfirmationDialogView` and then reaches `CollectionManager.removeGraph(collectionId, graphId)`.
The hamburger menu no longer offers graph deletion.

The data command owns the "a collection always has at least one graph" invariant: when the removed
graph is the last one it inserts a replacement first (`Collection.getUniqueGraphId()` /
`getUniqueGraphName()`), so the collection is never observed without a graph.
`Collection.removeGraph()` emits `Collection.GraphRemoved.v1` and marks the collection dirty;
autosave persists it.

`CollectionView._onCollectionChange()` reacts to `graphRemoved` by removing the tab
(`TabbedView.prototype.removeView`) and immediately re-publishing the selection
(`_onGraphSelected(this.activeId)`), because both the model (`#activeGraphIdx` clamping) and
`TabbedView.removeView()` change the active entry **without** emitting an event.

`CollectionView` keeps `removeView()` / `_onGraphCloseRequested()` as programmatic entry points (they
run the same `ConfirmationDialogView` dialog) and exposes `canDeleteActiveGraph()` /
`requestGraphDeletion(graphId)`; neither mutates the model directly.

### 6) Graph Tab Context Menu

`CollectionView` constructs its `TabbedView` base with `tabContextMenu: true`. The base class only
reports intent; it never knows about graphs:

1. `contextmenu` (or `Shift+F10` / the dedicated `ContextMenu` key) on a tab emits
   `TabbedView.TabContextMenu.v1` with `viewId`, `view`, `clientX`, `clientY` and `nativeEvent`.
   Right-click does **not** select the tab.
2. `CollectionView._onTabContextMenu()` validates the payload, resolves the graph and opens a
   `MenuWindow` through `viewManager.addOverlay()` (falling back to `document.body` in tests or
   lightweight hosts without an overlay manager).
3. The menu contains **Rename Graph** (`collection.tabContextMenu.rename`), a checked
   `collection.tabContextMenu.enabled` row and `menu.item.deleteGraph`. The enable row calls
   `graph.setEnabled()`; `GraphPanelView` repaints its canvas from the graph's existing `enabled`
   event, so the panel toolbar no longer needs a checkbox.
4. Rename calls `TabbedView.beginTabRename(viewId)`, which opens the same inline editor as the tab
   double-click. The active tab does not change; the rename is validated by `_onTabRenamed()`
   (non-empty, unique, resolved through `Collection.getGraphById()`) before `graph.setName()`.
5. Delete is disabled while the collection has a single graph; otherwise it delegates to
   `requestGraphDeletion(graphId)` and follows the flow above.

### 7) Delete Last Collection Flow

When the last collection is deleted, the system must create a replacement before deleting the old one.

**Rules:**

- Always create a new collection first (data backbone).
- Always activate the new collection via `Workspace.setActiveCollectionId()` (persists config).
- Only then delete the original collection.
- UI refresh happens through workspace events (no manual DOM patching).

**Flow (Workspace + View):**

1. WorkspaceView requests delete.
2. Workspace ensures a new collection exists if deleting the last one.
3. Workspace sets the new collection active and persists config.
4. Workspace deletes the original collection.
5. Workspace emits `activeCollectionChanged` and `collectionDeleted` events.
6. CollectionView switches to the active collection and rebuilds tabs.

## Graph Tab Order

`Collection.#graphs` is the authoritative graph order. `CollectionView` mirrors it and never stores a
competing tab order.

- Graph tabs are created with `movable: true`; special tabs can be pinned with
  `addView(special, index, false, false, false)`.
- New graphs insert **before the first `movable: false` tab**, keeping the graph block contiguous and
  leading.
- A user drag emits `TabbedView.TabMoved.v1`; `_onTabMoved()` forwards it to
  `CollectionManager.moveGraph(collectionId, graphId, toIndex)`.
- `Collection.GraphMoved.v1` re-syncs tabs through `moveView()` under the `_syncingGraphOrder` flag,
  so the resulting `tab-moved` is not forwarded back.
- Removing the active graph selects the collection's active graph, never a pinned special tab.

`CollectionManagerLike.moveGraph` is optional so lightweight test doubles and older hosts keep
working; when it is missing the view logs and leaves the tab order unchanged.

See [TabbedView Tab Reordering](tabbed-view-reordering.md) for the drag and persistence details.

## Graph Tab Execution Tints

Every graph tab carries its normalized execution type as `data-tab-variant` on the existing
`.tabbed-view__tab` element. Active graphs expose the value through `GraphPanelView.tabVariant`;
inactive placeholders expose the same getter over their captured graph. Both use
`normalizeExecutionType()`, so missing or unknown stored values fall back to `continuous`.

An `executionType` graph event repaints the strip through the existing per-graph wildcard listener,
so a settings edit updates the tab immediately whether that graph is active or not. The tint is
supplementary to the execution type shown in the graph toolbar and settings; tab labels, ids, and
accessibility attributes are unchanged.

See [TabbedView Tab Variants](tabbed-view-tab-variants.md) for the entry contract, providers, and
theme tokens.

## Integrity Rules

- **Data Backbone First**: All graph and collection changes go through `Collection` and `Workspace` APIs.
- **No Private Access**: CollectionView never mutates private members of other classes.
- **ViewBase Lifecycle**: Never detach/attach for temporary view switching; use TabbedView/CollectionView APIs.

## Failure Recovery

- If a saved layout references a missing graph, CollectionView selects the first available graph.
- If a saved layout references a missing collection, Workspace rebuilds the view layout using available collections.

## UI Event Diagrams

### Graph Tab Actions (UI)

```
Graph tab: right-click / Shift+F10
  ↓
TabbedView emits TabbedView.TabContextMenu.v1 (viewId, view, clientX/Y)
  ↓
CollectionView._onTabContextMenu() → MenuWindow(addOverlay)
  ↓ select rename-graph                 ↓ select delete-graph
TabbedView.beginTabRename(viewId)       CollectionView.requestGraphDeletion(graphId)
  ↓ inline editor (also dblclick)         ↓ ConfirmationDialogView → confirm
graph.setName(newName)                  CollectionManager.removeGraph(collectionId, graphId)

CollectionManager.removeGraph()
  ↓ (last graph) Collection.getUniqueGraphId() / getUniqueGraphName() + Collection.addGraph(replacement)
  ↓
Collection.removeGraph(graphId) → emits Collection.GraphRemoved.v1, marks dirty
  ↓ autosave
CollectionView._onCollectionChange()
  ↓ TabbedView.prototype.removeView(tab) → removes the view wrapper too
  ↓ _onGraphSelected(activeId) → Collection.setActiveGraphIdx(...)
```

### Delete Last Collection (UI)

```
WorkspaceView.delete → ConfirmationDialogView
  ↓ confirm
Workspace.deleteCollection(lastId)
  ↓
Workspace.createCollection()
  ↓
Workspace.setActiveCollectionId(newId) → persist config
  ↓
Workspace.deleteCollection(oldId)
  ↓
Workspace emits:
  - activeCollectionChanged
  - collectionDeleted
  ↓
CollectionView switches active collection
  ↓
TabbedView rebuilds tabs + attaches active GraphPanelView
```

### Switch Active Collection (UI)

```
WorkspaceView selection change
  ↓
Workspace.setActiveCollectionId(id) → persist config
  ↓
Workspace emits activeCollectionChanged
  ↓
CollectionView._switchCollection()
  ↓
setViews([]) + setControls([])
  ↓
_loadGraphs() → placeholders + active GraphPanelView
```

### Create Graph (UI)

```
TabbedView control “+” clicked
  ↓
CollectionView._onAddGraph()
  ↓
Collection.addGraph(newGraph)
  ↓
Collection emits graphAdded
  ↓
CollectionView._onCollectionChange()
  ↓
Create tab placeholder + select active graph
```

## Related Files

- [src/micro_otter/nodes/html/js/views/collection-view.ts](../../../src/micro_otter/nodes/html/js/views/collection-view.ts)
- [view-system-architecture.md](view-system-architecture.md)
- [data-backbone-architecture.md](../core/data-backbone-architecture.md)

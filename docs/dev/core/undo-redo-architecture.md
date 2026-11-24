# Undo/Redo Architecture - Developer Documentation

## Overview

The undo/redo system provides history tracking for all graph-editing operations in Micro-Otter. It uses a delta-based, event-driven approach: instead of snapshotting the entire graph state on every change, each operation stores only the data needed to reverse or replay that specific change.

History is scoped per `Collection`, persists with the collection via `toData()`/`fromData()`, and is surfaced to the user through toolbar buttons and keyboard shortcuts in `WorkspaceView`.

**Key design goals:**

- **Delta-based** — operations store only changed data (forward + inverse payloads), not full state snapshots
- **Event-driven capture** — `HistoryManager` listens to existing `Collection` and `NodeGraph` events; no extra plumbing needed in the data layer
- **Infinite-loop prevention** — a `#isApplying` guard stops undo/redo from re-triggering capture
- **Grouped operations** — related atomic changes (e.g., delete node + remove its connections) are wrapped in a single undoable group
- **Persistent** — history is serialized as part of the collection and restored on reload

---

## Architecture

### Component Overview

```
┌──────────────────────────────────────────────────────────────┐
│  User interaction (WorkspaceView toolbar / keyboard)         │
│    Ctrl+Z → historyManager.undo()                           │
│    Ctrl+Y / Ctrl+Shift+Z → historyManager.redo()            │
└─────────────────────────┬────────────────────────────────────┘
                          │  undo() / redo()
                          ▼
┌──────────────────────────────────────────────────────────────┐
│  HistoryManager                                              │
│    - operations[] stack  + currentIndex                      │
│    - #isApplying guard                                       │
│    - #applyInverse() / #applyForward()                       │
│    - serialize() / static deserialize()                      │
└──────┬─────────────────────────────────────┬─────────────────┘
       │ listens to                          │ calls
       │  Collection.onChange()              │  graph.updateNode()
       │  Collection.onGraphChange()         │  graph.addNode() / removeNode()
       │                                     │  graph.addConnection() / removeConnection()
       ▼                                     ▼
┌─────────────────────┐         ┌────────────────────────────┐
│  Collection         │         │  NodeGraph                 │
│  NodeGraph          │         │  (data model)              │
└─────────────────────┘         └────────────────────────────┘
```

### Key Files

| File | Role |
|------|------|
| [`src/.../data/history-manager.ts`](../../../src/micro_otter/nodes/html/js/data/history-manager.ts) | Core undo/redo logic |
| [`src/.../data/node-graph.ts`](../../../src/micro_otter/nodes/html/js/data/node-graph.ts) | `updateNode(id, updates, explicitPrevious)` — carries pre/post snapshot in `node-updated` event |
| [`src/.../nodes/node-ui.ts`](../../../src/micro_otter/nodes/html/js/nodes/node-ui.ts) | Captures `oldValue` before control mutation; snapshots connections; passes `explicitPrevious` |
| [`src/.../nodes/controls/node-control-ui.ts`](../../../src/micro_otter/nodes/html/js/nodes/controls/node-control-ui.ts) | Captures `oldValue` before mutating `nodeData.controlValues`; passes it to `onControlChanged` |
| [`src/.../views/graph-panel-view.ts`](../../../src/micro_otter/nodes/html/js/views/graph-panel-view.ts) | On `node-updated` with `controlValues` patch: invalidates visibility cache + recalculates node height |
| [`src/.../views/workspace-view.ts`](../../../src/micro_otter/nodes/html/js/views/workspace-view.ts) | Toolbar buttons, keyboard shortcuts, button enabled/disabled state |
| [`tests/data/history-manager.test.js`](../../../tests/data/history-manager.test.js) | Unit tests (57 tests) |

---

## HistoryManager Public API

```ts
import { HistoryManager } from './data/history-manager.js';

const manager = new HistoryManager(collection, { maxDepth: 50 });

// Query state
manager.canUndo()            // → boolean
manager.canRedo()            // → boolean
manager.getHistoryDepth()    // → number
manager.getUndoDescription() // → string|null  (label of next undo op)
manager.getRedoDescription() // → string|null  (label of next redo op)

// Apply
manager.undo()               // → boolean (true = success)
manager.redo()               // → boolean (true = success)

// Management
manager.clear()
manager.setMaxDepth(depth)
manager.getMaxDepth()        // → number
manager.dispose()            // unsubscribes all listeners

// Pre-operation hooks (must be called BEFORE the triggering action)
manager.beforeNodeRemove(nodeId)
manager.beforeGraphRemove(graphId)
manager.beforeGraphRename(graphId)

// Atomic grouping
manager.beginGroup('description')
// ... multiple data model changes ...
manager.endGroup()

// Persistence
manager.serialize()                          // → plain object
HistoryManager.deserialize(data, collection) // → HistoryManager
```

---

## Operation Types

All operations stored in the history stack share the same envelope:

```ts
{
    id: string,          // UUID
    type: string,        // Operation type (see below)
    timestamp: number,   // Date.now() at capture time
    description: string, // Human-readable label for toolbar tooltips
    forward: object,     // Data to re-apply (redo)
    inverse: object,     // Data to reverse (undo)
}
```

### Node Operations

#### `node-added`

Captured from `node-added` graph event.

| | Payload |
|-|---------|
| `forward` | `{ nodeId }` |
| `inverse` | `{ nodeData }` (full `NodeData.toData()` snapshot) |

- **Undo**: `graph.removeNode(nodeId)`
- **Redo**: `graph.restoreNode(nodeData)` (or `addNode` + `setId`)

#### `node-removed`

Captured from `node-removed` graph event. Requires `beforeNodeRemove(nodeId)` to be called first — this caches the full node data and its connections before they disappear.

| | Payload |
|-|---------|
| `forward` | `{ nodeId }` |
| `inverse` | `{ nodeData, connections[] }` |

- **Undo**: `graph.restoreNode(nodeData)`, then re-add each connection
- **Redo**: `graph.removeNode(nodeId)`

#### `node-pos-changed`

Captured on `node-drag-ended`. During drag, `node-drag-started` caches the start position and `node-pos-changed` events update it incrementally.

| | Payload |
|-|---------|
| `forward` | `{ nodeId, newPosition: {x, y} }` |
| `inverse` | `{ nodeId, oldPosition: {x, y} }` |

- **Undo/Redo**: `graph.updateNodePosition(nodeId, x, y)`

#### `control-value-changed`

Captured from `node-updated` graph event when the patch contains `controlValues`. This operation also snapshots all connections touching the node before and after the change, because dropdown controls can hide/show inputs and outputs — changing which connector indices are valid.

| | Payload |
|-|---------|
| `forward` | `{ nodeId, controlValues, connections[] }` (state after change) |
| `inverse` | `{ nodeId, controlValues, connections[] }` (state before change) |

- **Undo/Redo**: `graph.updateNode(nodeId, { controlValues })`, then `#restoreConnections()`

See [Control Value Change Flow](#control-value-change-flow) for how the pre-mutation `oldValue` and connection snapshot reach the history manager.

### Connection Operations

#### `connection-added`

| | Payload |
|-|---------|
| `forward` / `inverse` | `{ fromNode, fromIndex, toNode, toIndex }` |

- **Undo**: `graph.removeConnection(...)`
- **Redo**: `graph.addConnection(...)`

#### `connection-removed`

Same payload shape as `connection-added`.

- **Undo**: `graph.addConnection(...)`
- **Redo**: `graph.removeConnection(...)`

### Graph Operations

#### `graph-added`

| | Payload |
|-|---------|
| `forward` | `{ graphData }` |
| `inverse` | `{ graphId }` |

#### `graph-removed`

Requires `beforeGraphRemove(graphId)`.

| | Payload |
|-|---------|
| `forward` | `{ graphId }` |
| `inverse` | `{ graphData, graphIndex }` |

#### `graph-renamed`

Requires `beforeGraphRename(graphId)`.

| | Payload |
|-|---------|
| `forward` / `inverse` | `{ graphId, oldName, newName }` |

### Documentation Area Operations

Documentation areas ("group boxes") get four operation types. Geometry is **one** type with a
descriptive label, because a drag and a resize share the whole capture path and only differ in the
gesture kind.

#### `documentation-area-added`

| | Payload |
|-|---------|
| `forward` | `{ areaData }` |
| `inverse` | `{ areaId }` |

Undo removes the area, redo restores it through `restoreDocumentationArea()`, which keeps the
original id.

#### `documentation-area-removed`

Requires `beforeDocumentationAreaRemove(areaId)`.

| | Payload |
|-|---------|
| `forward` | `{ areaId }` |
| `inverse` | `{ areaData, index }` |

The pre-hook caches `area.toData()` plus `getDocumentationAreaIndex(areaId)`; the inverse therefore
restores **the same id at the same array index**, including the colour, alignment and font-size
preset. Without the pre-hook nothing is recorded — the current geometry and position are gone by the
time the removal event arrives, and an operation with half a payload would undo into a different
document.

#### `documentation-area-updated`

| | Payload |
|-|---------|
| `forward` | `{ areaId, patch }` |
| `inverse` | `{ areaId, patch: previous }` |

`patch` and `previous` contain only the keys that actually changed (`title`, `markdown`, `color`,
`contentAlign`, `fontSize`), so undoing a rename never touches the body or the colour. Both directions
call `updateDocumentationArea()`; a stale operation for an area that was deleted in the meantime logs
`apply-documentation-area-update-failed` and is skipped.

#### `documentation-area-bounds-changed`

| | Payload |
|-|---------|
| `forward` / `inverse` | `{ areaId, oldBounds, newBounds }` |

Forward applies `newBounds`, inverse applies `oldBounds` through `setDocumentationAreaBounds()`
(which re-normalizes and clamps).

**One gesture = one operation.** A move or resize streams `documentation-area-bounds-changed` events
on every pointer move, and *none* of them pushes an operation. The capture is:

1. `documentation-area-drag-started` → `#cacheDocumentationAreaBounds()` stores
   `{ mode, startBounds, currentBounds }` in `#stateCache` under `documentation-area-drag-${id}`;
2. every `documentation-area-bounds-changed` → `#updateCachedDocumentationAreaBounds()` only replaces
   `currentBounds`;
3. `documentation-area-drag-ended` → `#captureDocumentationAreaBounds()` compares start and current
   and pushes a single operation, or logs `capture-documentation-area-bounds-skipped` when they are
   equal (the Escape-to-cancel and click-without-moving cases).

Geometry is cached rather than streamed for the same reason nodes cache their drag state: the
pointer rate must never translate into history entries.

Grouping: area operations are **not** grouped by default — one gesture already equals one entry. The
clipboard uses the existing `beginGroup()`/`endGroup()` around a mixed cut so that removing nodes and
areas together still undoes as one step.

History UI descriptions (keep this list in sync if a label changes):

| Operation | Description |
| --- | --- |
| create | `Create documentation area` |
| edit | `Edit documentation area` |
| move | `Move documentation area` |
| resize | `Resize documentation area` |
| delete | `Delete documentation area` |

### Operation Groups

Multiple operations can be wrapped as a single atomic undo/redo unit:

```ts
manager.beginGroup('Delete node with connections');
// UI calls graph.removeConnection(...) for each connection — each fires an event, each is captured
graph.removeNode(nodeId);  // also captured
manager.endGroup();
// → stored as a single 'operation-group' operation
```

`endGroup()` will unwrap single-operation groups (stores the op directly) and drop empty groups.

---

## Event Integration

`HistoryManager` subscribes to two event streams on construction:

```ts
// Collection-level events (graph add/remove/rename, collection title, etc.)
collection.onChange(listener, 'HistoryManager')

// NodeGraph-level events (node add/remove/move, connections, control changes)
collection.onGraphChange(listener)
```

The `#isApplying` flag is set to `true` during `undo()` / `redo()` execution. Every capture method checks `if (this.#isApplying) return` at the top of the subscription, so data model changes made during apply do not recurse into the history stack.

### Events that are deliberately not recorded

The graph-event switch records node, connection, position and rename changes only. The following
graph events are ignored on purpose, so nobody assumes undo restores them:

- `color` — the highlight color is a presentation choice.
- `enabled` (`NodeGraph.EnabledChanged.v1`) — the per-graph "Enabled" flag is a transpilation switch,
  not an edit. Toggling it in the graph panel toolbar or the graph settings view leaves the history
  stack untouched; toggle it again to revert. It still marks the collection `dirtyPatch` (see
  [collection-version-policy.md](./collection-version-policy.md)).
- `graphMoved` (`Collection.GraphMoved.v1`) — graph reordering is persisted immediately but is **not
  recorded** by `HistoryManager`, so `Ctrl+Z` does not restore the previous graph order. A future
  `graph-moved` operation would carry `{ graphId, fromIndex, toIndex }` and apply the inverse as
  `moveGraph(graphId, fromIndex)`; it is not implemented in this version.

---

## Control Value Change Flow

Tracking control value changes requires careful coordination across three layers because `NodeData.controlValues` is mutated *before* `updateNode()` is called (the control UI directly mutates the shared data object). Without extra care the auto-snapshot inside `updateNode()` would see the already-new value, producing a zero-delta that gets discarded.

```
NodeControlUi._notifyChange(newValue)
  │
  ├─ oldValue = nodeData.controlValues[id]   // capture BEFORE mutation
  ├─ nodeData.controlValues[id] = newValue   // mutation
  └─ nodeUi.onControlChanged(id, newValue, oldValue)
       │
       └─ NodeUi._updateControlValue(controlId, value, oldValue)
            │
            ├─ _invalidateVisibilityCache()
            ├─ prevConnections = graph.getConnectionsForNode(nodeId)  // snapshot
            ├─ explicitPrevious = { controlValues: {...current, [id]: oldValue},
            │                       connections: prevConnections }
            └─ graph.updateNode(nodeId, { controlValues: ... }, explicitPrevious)
                 │
                 └─ emits 'node-updated' event with { patch, previous: explicitPrevious }
                      │
                      └─ HistoryManager.#captureNodeControlChanged(event)
                           │
                           ├─ oldValues = event.data.previous.controlValues
                           ├─ connectionsBefore = event.data.previous.connections
                           ├─ connectionsAfter = graph.getConnectionsForNode(nodeId) (now)
                           └─ pushOperation({ type: 'control-value-changed', ... })
```

### Visibility and Height After Undo/Redo

Restoring `controlValues` alone is not enough when a dropdown controls which other controls and connectors are shown. `GraphPanelView._subscribeToGraphChanges()` handles this:

```ts
case 'node-updated':
    syncNodeUisFromGraph();
    if (event.data?.patch?.controlValues && event.data.node_id) {
        const nodeUi = nodeUiMap.get(event.data.node_id);
        if (nodeUi) {
            nodeUi._invalidateVisibilityCache(); // clears stale cached visible controls/inputs/outputs
            nodeUi.ensureNodeHeight();           // recalculates height from fresh visibility
        }
    }
    renderPanel();
```

### Connection Restoration

Because connector indices are assigned over the *visible* input/output lists (not the full list), hiding a connector can make previously valid connection indices invalid. `#restoreConnections()` handles this by:

1. Removing all connections currently touching the node
2. Re-adding the exact snapshot that was valid for the restored `controlValues` state

Failures during re-add are logged as warnings but do not abort the restore.

---

## Pre-Operation Hook Pattern

Some operations need state that is only available *before* the mutation fires. The `beforeXxx()` methods capture this into a transient `#stateCache` Map, keyed by node/graph ID:

| Hook | When to call | Caches |
|------|-------------|--------|
| `beforeNodeRemove(nodeId)` | Before any `removeNode()` call in the UI | Full `NodeData.toData()` + connections |
| `beforeGraphRemove(graphId)` | Before `collection.removeGraph()` | Full `graph.toData()` + index in collection |
| `beforeGraphRename(graphId)` | Before `graph.setName()` | Current graph name |
| `beforeDocumentationAreaRemove(areaId)` | Immediately before `graph.removeDocumentationArea(areaId)` | Full `DocumentationArea.toData()` + array index |

The corresponding capture method (`#captureNodeRemoved`, etc.) consumes and removes the cached entry. If no cache entry is found, the operation is not recorded and a `debug` log entry is emitted.

---

## Memory Management

The stack is bounded by `maxDepth` (default **50**). When a new operation would exceed the limit, the oldest entry is dropped from the front of `#operations` and `#currentIndex` is decremented. Adding a new operation also discards any "future" operations above the current index (standard undo stack semantics).

History is cleared when:
- `manager.clear()` is called explicitly
- The collection is deleted

History is **not** cleared when switching between graphs or collections — each collection retains its own independent history.

---

## Serialization

`HistoryManager.serialize()` returns a plain object that is embedded in the `Collection.toData()` output and written to IndexedDB alongside the rest of the collection:

```ts
{
    version: 1,
    maxDepth: 50,
    currentIndex: 3,
    operations: [ /* array of operation objects */ ]
}
```

`HistoryManager.deserialize(data, collection)` reconstructs the manager and reattaches it to the collection's event streams. If `data` is missing or malformed, a fresh empty manager is returned.

---

## UI Integration

### Toolbar (WorkspaceView)

`WorkspaceView` owns the undo/redo buttons. It subscribes to `HistoryManager` state changes and updates button `disabled` state after every undo/redo call and after every graph-change event:

```ts
undoButton.disabled = !historyManager.canUndo();
redoButton.disabled = !historyManager.canRedo();
undoButton.title    = historyManager.getUndoDescription() ?? 'Undo';
redoButton.title    = historyManager.getRedoDescription() ?? 'Redo';
```

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Ctrl+Shift+Z` | Redo (alternative) |

Shortcuts are registered as `keydown` listeners in `WorkspaceView` and call `historyManager.undo()` / `historyManager.redo()` directly.

---

## Testing

Unit tests live in [`tests/data/history-manager.test.js`](../../../tests/data/history-manager.test.js). The test suite uses Node.js's built-in `node:test` runner with a lightweight `Collection` / `NodeGraph` stub.

Coverage summary:
- Phase 1 — node add/remove/move: 36 tests
- Phase 2 — connections, graph operations: 47 tests
- Phase 3 — persistence (serialize/deserialize, depth limits): 57 tests

UI integration is exercised through the view test suites; there is no dedicated browser
undo/redo test file.

Run all history-manager tests:

```bash
node --test tests/data/history-manager.test.js
```

---

## Adding a New Operation Type

1. **Decide on the capture point.** Is the required "before" state available in the event payload, or does it need a `beforeXxx()` pre-hook?

2. **Add the capture method.**
   ```ts
   #captureMyChange(event) {
       if (this.#isApplying) return;  // guard is already in the listener, but be explicit
       const operation = {
           id: generateUuidV4(),
           type: 'my-change',
           timestamp: Date.now(),
           description: '...',
           forward: { /* data to redo */ },
           inverse: { /* data to undo */ },
       };
       this.#pushOperation(operation);
   }
   ```

3. **Wire it to the appropriate event** in `#setupEventListeners()`.

4. **Add the `case` to both `#applyInverse()` and `#applyForward()`.**

5. **Update `serialize()` / `deserialize()`** if the new payload requires any special handling (most plain-object payloads work automatically).

6. **Write unit tests** covering at minimum: capture, undo, redo, and edge cases (missing data, empty payloads).

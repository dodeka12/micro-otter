# Data Backbone Architecture

## Overview

The Micro Otter data backbone implements a hierarchical, event-driven architecture for managing ESP32 firmware node graphs. This document provides a comprehensive overview of the data structure, event flow, and serialization pipeline.

## Hierarchy

```
Workspace (root)
  ├── Collection 1
  │   ├── NodeGraph 1
  │   │   ├── NodeData 1
  │   │   │   ├── NodeControl 1
  │   │   │   ├── NodeControl 2
  │   │   │   └── NodeControl N
  │   │   ├── NodeData 2
  │   │   └── NodeData N
  │   ├── NodeGraph 2
  │   └── NodeGraph N
  ├── Collection 2
  └── Collection N
```

### Level Descriptions

1. **Workspace**: Top-level container persisted to IndexedDB
    - Contains multiple collections
    - Stores global configuration
    - Manages persistence layer

2. **Collection**: Group of related node graphs
    - Represents a project or firmware bundle
    - Contains versioning information
    - Tracks collection-level metadata

3. **NodeGraph**: Single executable node graph
    - Represents one firmware configuration
    - Contains nodes and connections
    - Manages graph-level state

4. **NodeData**: Single node instance
    - Represents a firmware component (sensor, actuator, etc.)
    - Contains node-specific properties
    - Owns control values

5. **NodeControl**: Single control/parameter
    - Input field, slider, dropdown, etc.
    - Stores user-configured values
    - Validates constraints

## Event Structure

The system uses an observer pattern with bubbling events:

```
NodeControl value changes
  ↓ (emit change event)
NodeData processes control change
  ↓ (emit node-changed)
NodeGraph validates connections
  ↓ (emit graph-changed)
Collection tracks modifications
  ↓ (emit collection-changed)
Workspace triggers persistence
  ↓ (debounced 500ms)
IndexedDB save
```

### Event Types

- **control-value-changed**: Control value modified
- **node-changed**: Node property or control changed
- **node-added**: New node added to graph
- **node-removed**: Node deleted from graph
- **connection-changed**: Connector added/removed/modified
- **graph-changed**: Graph structure modified
- **graph-moved**: Graph order changed (`Collection.GraphMoved.v1`)
- **collection-changed**: Collection content changed
- **workspace-changed**: Workspace-level change

### Runtime collection reloads

`DeviceRuntimeCollection` sits beside the data backbone: it owns the per-runtime node packages and
reloads them whenever an add-on is installed or uninstalled. It is an `AppEventEmitter` and announces
a completed reload with `RuntimeCollection.RuntimesLoaded.v1` under the `runtimesLoaded` event name.

- **Reload in place** — a runtime whose id and root survive a reload is refilled through its own
  `load()`, so the palette and the graph panel keep valid `DeviceRuntime` references instead of
  holding a copy of the package list from start-up. The reload also clears the runtime's cached
  package variants, so an uninstalled package stops answering variant queries.
- **Emitted only on success** — a failed reload throws and emits nothing, so no view rebuilds from a
  half-loaded package list.
- **Consumers** — `NodePaletteView` re-renders its node list, and `GraphPanelView` re-validates every
  node; a node whose package disappeared gains the unknown-type issue described in
  [graph-panel-view-architecture.md](../view-system/graph-panel-view-architecture.md#unknown-node-types).

## Serialization Pipeline

### Serialization Flow (Top-Down)

```
Workspace.serialize()
  → { collections: [...] }
    → Collection.serialize()
      → { version: X, graphs: [...] }
        → NodeGraph.serialize()
          → { nodes: [...], connections: [...] }
            → NodeData.serialize()
              → { id, type, properties, controls: [...] }
                → NodeControl.serialize()
                  → { type, value, constraints }
```

### Deserialization Flow (Bottom-Up)

```
Workspace.deserialize(data)
  → Parse JSON from IndexedDB
    → Collection.deserialize(collectionData)
      → Restore version information
        → NodeGraph.deserialize(graphData)
          → Restore connections metadata
            → NodeData.deserialize(nodeData)
              → Restore node properties
                → NodeControl.deserialize(controlData)
                  → Restore value with validation
```

## Key Properties per Level

### Workspace

```ts
{
  collections: Collection[],
  config: {
    theme: string,
    autoSave: boolean,
    // ... global settings
  }
}
```

### Collection

```ts
{
  id: string,
  name: string,
  version: number,  // Auto-incrementing
  graphs: NodeGraph[],
  metadata: {
    created: timestamp,
    modified: timestamp
  }
}
```

#### Graph order and `moveGraph()`

Graph order is the array order of `#graphs`; there is no separate order field.

```ts
collection.moveGraph(graphId: string, toIndex: number): boolean
collectionManager.moveGraph(collectionId: string, graphId: string, toIndex: number): boolean
```

- `toIndex` is the **final index** in the resulting array, not an insertion gap.
- Out-of-range integers are clamped to `[0, length - 1]`.
- Unknown ids, non-integer indices, single-graph collections and no-op moves return `false` and emit
  nothing.
- The active graph is preserved **by identity**: `#activeGraphIdx` is remapped, and
  `Collection.ActiveGraphIndexChanged.v1` is emitted only when the numeric index changed.
- The id → index mapping is rebuilt after the splice, so `getGraphById()` and `updateGraph()` stay
  correct.
- A successful move emits `Collection.GraphMoved.v1` (`collectionId`, `graphId`, `fromIndex`,
  `toIndex`) before any `activeGraphIdx` event and calls `markMajorVersionDirty()`.
- `CollectionManager.moveGraph()` is a pure delegation guard: it never mutates collection internals
  and relies on the existing autosave listener for persistence.
- `toData()` already writes `graphs` in array order, so reload/export keep the new order without a
  schema change.

### NodeGraph

```ts
{
  id: string,
  name: string,
  nodes: NodeData[],
  connections: Connection[],
  documentationAreas: DocumentationArea[],
  viewportConfig: {
    translateX: number,
    translateY: number,
    scale: number
  }
}
```

#### Viewport persistence ownership

`viewportConfig` is a `ViewportConfig` instance (`js/data/viewport-config.ts`);
`NodeGraph.getViewportConfig()` returns the live object and
`NodeGraph.setViewportConfig(config)` throws `TypeError` for anything that is not a `ViewportConfig`,
stores a clone, and emits `viewport` with `NodeGraph.ViewportChanged.v1`.

`GraphPanelView` is the only writer. After a pan or wheel gesture settles it calls
`graph.setViewportConfig(new ViewportConfig(...))` (debounced 250 ms, flushed on detach/dispose/
graph switch). It writes **only** interactive changes: opening a graph resolves the view from the
stored config and suppresses the write path, so merely looking at a graph never bumps a version.

`Collection.#graphChanged()` turns that `viewport` event into a patch-version dirty mark and
persistence. Do not call `Collection.setViewportConfig()` from a view: it forwards to the graph *and*
marks the collection dirty itself, producing a double event and a double dirty mark.

`NodeGraph.canConnect(fromNodeId, fromIndex, toNodeId, toIndex, options)` accepts an
`options.excludeConnections` array. Connection-editing operations (splicing a node into a
connection, bypassing a node) use it to validate a replacement edge as if the edges about to be
removed were already gone — so `connectionPolicy` input/output cardinality and duplicate checks
ignore those edges. It does not affect cycle detection, and the option has no effect when omitted.

Execution settings are stored on the graph as `executionType` (`'startup' | 'continuous' | 'irq' |
'event' | 'function'`) and
`triggerIntervalMs`, plus the interrupt `triggerName` used only by the `irq` mode. All mutators
normalize their input through the shared rules in
`js/data/graph-execution-settings.ts` (`normalizeExecutionType()`, `clampSleepDuration()`,
`normalizeTriggerName()`), which is
also imported by `GraphSettingsView`, by the graph panel toolbar and by the transpiler:
`setExecutionType()` falls back to `'continuous'` for unknown values, and `setTriggerInterval()`
floors and clamps into `0–60000 ms`. `0` is valid and means a yield-only cadence (the loop yields
once per iteration); blank or invalid input falls back to `DEFAULT_SLEEP_MS` (`500`), never to `0`.
Because the transpiler resolves the interval through the same function, a graph without a usable
value transpiles with `500` ms instead of a private fallback, and the value is the period between
iteration starts (see
[transpiler-architecture.md](../nodes/transpiler-architecture.md#graph-cadence-and-interval)).
`setExecutionType()` emits `executionType`, `setTriggerInterval()` emits `interval`, and the two UI
surfaces mirror each other purely through those events.

An `irq` graph waits on a named interrupt channel instead of the cadence interval: it runs its loop
body once per interrupt and ignores `triggerIntervalMs` entirely, so the interval field is hidden for
that mode. The channel is bound by `triggerName` (`setTriggerName()` / `getTriggerName()`), a
case-sensitive, whitespace-trimmed string that names an `interrupt-input` node's trigger name. It is
not validated in the model: the IRQ graph rules report missing, duplicate and dangling names, and
the transpiler relies on the same rules. `setTriggerName()` emits `triggerName` with
`NodeGraph.TriggerNameChanged.v1` (payload: `graphId`, `triggerName`) and skips the event when the
normalized value does not change. `''` is the unset value, so collections saved before this field
existed load with `''` and only become invalid once a graph selects the `irq` mode.

The same graph carries an `enabled` flag (`setEnabled()` / `getEnabled()`), normalized through
`normalizeGraphEnabled()` from the same module: **anything except the literal `false` (or its string
form) means enabled**, so legacy collections without the key load as enabled and keep transpiling
exactly as before. `setEnabled()` emits `enabled` with `NodeGraph.EnabledChanged.v1` (payload:
`graphId`, `enabled`) and skips the event when the normalized value does not change. Like
`executionType` / `interval`, the graph-tab context-menu toggle and the settings view checkbox never
talk to each other — they mirror through the event. A disabled graph is still part of the collection
and of the deployment payload; it is only excluded from transpilation (see
[transpiler-architecture.md](../nodes/transpiler-architecture.md)).

A function graph carries a `functionSignature` next to its execution settings:
`{ category: string, inputs: FunctionPort[], outputs: FunctionPort[] }` with
`FunctionPort = { id, name, types: string[] }`. `id` is index-derived (`in_0`, `out_0`, …), names are
unique per list, and `types` is a non-empty union whose `'any'` member accepts everything. The graph
normalizes every write (`setFunctionCategory()`, `setFunctionPorts()`, plus the port-level
`addFunctionPort()` / `updateFunctionPort()` / `removeFunctionPort()` / `moveFunctionPort()`), skips
no-op updates and emits `functionSignature` with `NodeGraph.FunctionSignatureChanged.v1` (payload:
`graphId`, `functionSignature`). The field is serialized only when the graph is a function graph or
the signature is not empty, so every other graph round-trips byte-identically. Port edits repair the
structural nodes' wiring in the model, not in a view — see
[function-graphs.md](../nodes/function-graphs.md#signature-model).

#### Documentation areas

A graph also owns a list of **documentation areas** — the user-visible "group boxes" drawn behind
the nodes. They are graph items, not nodes: they never enter transpilation, capability validation,
connection routing, node culling or deployment payloads. They are serialized with their graph, so a
box travels with the collection document and with graph updates:

```ts
{
  id: string,          // numeric string, assigned by the graph ('1', '2', …)
  title: string,       // may be empty; the DOM renders an "Untitled area" fallback
  markdown: string,    // body, rendered through core/markdown-renderer.ts
  color: string,       // '#rrggbb' only — never an alpha channel
  contentAlign: 'top' | 'bottom', // Markdown body placement; default 'top'
  fontSize: 'small' | 'normal' | 'large', // body/heading preset; default 'normal'
  bounds: { x: number, y: number, width: number, height: number }
}
```

Type and normalizers live in `js/data/documentation-area.ts`:

| Export | Meaning |
| --- | --- |
| `DOCUMENTATION_AREA_DEFAULT_COLOR` | `'#4a90d9'`, used whenever a colour is missing or invalid |
| `DOCUMENTATION_AREA_DEFAULT_CONTENT_ALIGN` | `'top'`, used whenever an alignment is missing or invalid |
| `DOCUMENTATION_AREA_DEFAULT_FONT_SIZE` | `'normal'`, used whenever a font-size preset is missing or invalid |
| `DOCUMENTATION_AREA_DEFAULT_SIZE` | `{ width: 320, height: 200 }`, used for a missing/zero size |
| `DOCUMENTATION_AREA_MIN_SIZE` | `{ width: 120, height: 80 }`, the resize floor |
| `DOCUMENTATION_AREA_FILL_ALPHA` | `0.16`, the only fill translucency |
| `DOCUMENTATION_AREA_BORDER_ALPHA` | `0.65`, the only border translucency |
| `normalizeAreaColor(value)` | accepts `#rgb`/`#rrggbb` (case-insensitive, short form expanded), else the default |
| `normalizeAreaContentAlign(value)` | accepts `'bottom'`, else the `'top'` default |
| `normalizeAreaFontSize(value)` | accepts `'small'`/`'large'`, else the `'normal'` default |
| `normalizeAreaBounds(value)` | coerces to finite numbers, clamps up to the minimum, replaces a zero size with the default |
| `areaBoundsEqual(a, b)` | field-wise comparison used to skip no-op geometry events |

**Translucency is a render-time invariant, not data.** Storing `#rrggbb` plus two global alpha
constants means neither a colour picker nor a clipboard payload pasted from another document can
make a box opaque.

Ownership and id strategy:

- `addDocumentationArea(data)` clones the input, assigns the next counter id and returns the clone;
- `restoreDocumentationArea(data, index?)` keeps the original id (undo of a delete), inserts at the
  clamped index and bumps the counter — it throws on an invalid or duplicate id;
- `getDocumentationAreas()` returns detached data, `getDocumentationArea(id)` returns the live
  instance, `getDocumentationAreaIndex(id)` returns `-1` for an unknown id;
- `updateDocumentationArea(id, patch)` patches only
  `title`/`markdown`/`color`/`contentAlign`/`fontSize`, normalizes the colour/alignment/preset and
  emits nothing when no field changes;
- `setDocumentationAreaBounds(id, bounds)` normalizes, and emits nothing when the normalized result
  equals the current bounds;
- `removeDocumentationArea(id)` returns `false` for an unknown id and never touches nodes or
  connections.

Events (all emitted through `#emitChange()`, so `disableEvents()` still suppresses them during bulk
loads):

| Event | Payload type | Fields |
| --- | --- | --- |
| `documentation-area-added` | `NodeGraph.DocumentationAreaAdded.v1` | `graphId`, `areaId` |
| `documentation-area-updated` | `NodeGraph.DocumentationAreaUpdated.v1` | `graphId`, `areaId`, `patch`, `previous` |
| `documentation-area-bounds-changed` | `NodeGraph.DocumentationAreaBoundsChanged.v1` | `graphId`, `areaId`, `bounds`, `previousBounds` |
| `documentation-area-removed` | `NodeGraph.DocumentationAreaRemoved.v1` | `graphId`, `areaId` |
| `documentation-area-drag-started` | `NodeGraph.DocumentationAreaDragStarted.v1` | `graphId`, `areaId`, `mode` (`'move' \| 'resize'`) |
| `documentation-area-drag-ended` | `NodeGraph.DocumentationAreaDragEnded.v1` | `graphId`, `areaId` |

`patch`/`previous` contain **only the keys that changed**, and `bounds`/`previousBounds` are fresh
objects, so a listener can cache a snapshot without aliasing the graph.

`toData()`/`fromData()` tolerance: `toData()` serializes `documentationAreas` as a deep copy;
`fromData()` treats a missing, `null` or non-array value as an empty list and drops entries without
a usable id instead of throwing, so a corrupted document cannot brick a collection load. The field is
additive and optional, so it needs no schema bump (see
[collection-version-policy.md](collection-version-policy.md)). Each area is
`{ id, title, markdown, color, contentAlign, fontSize, bounds }`; `contentAlign` (`'top' | 'bottom'`)
and `fontSize` (`'small' | 'normal' | 'large'`) were added later and are also additive — an entry
written by an older build has no key and normalizes to `'top'` / `'normal'` respectively.

### NodeData

```ts
{
  id: string,
  type: string,  // "gpio-input", "timer", etc.
  typeName: {
    // Localized node-type display name from node definition title
    [localeCode: string]: string
  },
  userName: {
    // Optional per-locale user override (null when no overrides exist)
    [localeCode: string]: string
  } | null,
  title: string,  // Compatibility field: resolved display name for default/legacy paths
  position: {x, y},
  collapsed: boolean,
  properties: {
    // Node-specific properties
  },
  inputs: Array<{
    id: string,
    name: string,
    icon?: string,
    defaultControl?: NodeControlBase  // Optional control shown when input disconnected
  }>,
  outputs: Array<{
    id: string,
    name: string,
    icon?: string
  }>,
  controls: NodeControl[],
  controlValues: {
    // Current values for controls (keyed by control ID)
  }
}
```

### Node Naming Model (I18n-Aware)

Node display names use split semantics in `NodeData`:

- `typeName`: localized type-provided name (usually from `NodeType.title`)
- `userName`: optional per-locale user override map
- `title`: compatibility string kept synchronized to the resolved display name

Canonical resolution contract:

```text
displayName(locale) = userName[locale] (trimmed, if non-empty)
                   ?? localized(typeName, locale)
                   ?? type
```

Behavior notes:

- Rename edits update only `userName[currentLocale]`.
- Clearing a rename removes only the current locale entry.
- If a locale has no user entry, rendering/history labels fall back to localized `typeName`.
- Locale changes do not mutate per-node naming state; names are resolved at read/render time.

**Note on inputs.defaultControl**: When present, this is a `NodeControlBase` instance (e.g., `NodeControlNumber`) that renders as a scaled-down control next to disconnected input connectors. During serialization, it's converted to a plain object; during deserialization, it's enriched back to a `NodeControlBase` instance. See [Node UI Module Structure](../view-system/node-ui-module-structure.md#input-default-controls-architecture) for details.

### NodeControl

```ts
{
  id: string,
  type: "number"|"slider"|"text"|"dropdown"|"checkbox"|"color",
  value: any,
  constraints: {
    min?: number,
    max?: number,
    step?: number,
    options?: string[],
    // ... type-specific constraints
  }
}
```

## View State vs Logical Data

**Important**: View state and logical data are serialized separately.

### Logical Data (Data Backbone)

- Node properties and control values
- Graph structure and connections
- Collection organization
- Serialized via data backbone classes
- Stored in workspace data

### View State (View Manager)

- UI component positions and sizes
- Panel collapse states
- Scroll positions
- Active tab selections
- Serialized via view manager
- Stored in view configuration

## Persistence Strategy

### Auto-Save (Q6.1)

- **Trigger**: Any change in node, graph, or collection
- **Debouncing**: Maximum 500ms interval between saves
- **Implementation**: Debounced workspace.save() method
- **No indicator**: Changes are always saved, no "unsaved changes" UI

### Active Collection Persistence (Q6.4)

- **Source of truth**: `WorkspaceConfig.activeCollectionId`
- **Update path**: Always use `Workspace.setActiveCollectionId()` to update the active collection.
- **Delete flow**: `Workspace.deleteCollection()` must ensure an active collection exists by selecting an existing collection or creating a new one before removing the active collection.
- **Fallback**: If a saved view layout references a missing collection or graph, rebuild the layout using the available collection(s) and persist the updated config.

### Versioning (Q6.2)

- **Auto-increment**: Version number increases on each save
- **Conflict detection**: Check version on import/load
- **User confirmation**: Ask before overwriting existing data
- **Format**: Simple integer counter per collection

### Data Integrity (Q6.3)

- **Current**: Basic JSON validation
- **Future**: Schema validation, constraint checking, reference validation
- See [Future Ideas](../../../ldev/todos/_done/ideas/future-ideas.md)

## Connection to UI

### CollectionManager: Single-Source-of-Truth

As of January 2026, **CollectionManager** serves as the single-source-of-truth for accessing collection and runtime data throughout the application. It provides:

- **Runtime-aware node type lookups**: Prioritizes runtime-specific packages over global packages
- **Consistent API**: All views and tools use CollectionManager for data access
- **Encapsulation**: Hides complexity of NodePackageRegistry and RuntimeCollection

**Usage Pattern**:
```ts
// In views and tools
class MyView extends ViewBase {
    constructor({ collectionManager, ...rest }) {
        super({ ...rest });
        this.collectionManager = collectionManager;
    }
    
    render(container) {
        // Access active collection
        const collection = this.collectionManager.getActiveCollection();
        
        // Access node packages (runtime-aware)
        const nodePackages = this.collectionManager.getNodePackages();
        
        // Get specific node type
        const nodeType = this.collectionManager.getNodeType('gpio-input');
    }
}
```

**Key Methods**:
- `getActiveCollection()`: Returns current active Collection instance
- `getActiveDeviceRuntime()`: Returns current device runtime
- `getNodePackages()`: Returns runtime-aware node packages
- `getNodeType(typeId)`: Resolves node type from packages

### UI Event → Data Change

```
User edits control in NodeUi
  → NodeControlUi.setValue()
    → NodeControl.value = newValue
      → emit("control-value-changed")
        → NodeData._onControlChanged()
          → emit("node-changed")
            → NodeGraph._onNodeChanged()
              → emit("graph-changed")
                → Collection._onGraphChanged()
                  → emit("collection-changed")
                    → Workspace._onCollectionChanged()
                      → Workspace._debouncedSave() [500ms]
```

### Data Change → UI Update

```
Workspace loads from IndexedDB
  → Workspace.deserialize(data)
    → Collection.deserialize()
      → NodeGraph.deserialize()
        → emit("graph-loaded")
          → GraphPanelView._onGraphLoaded()
            → Create NodeUi instances via CollectionManager
              → NodeUi.render()
                → Create NodeControlUi instances
                  → NodeControlUi.render()
```

## Error Handling

### Serialization Errors

- Catch at each level
- Log to console with context
- Return partial data when possible
- Emit error events for UI notification

### Deserialization Errors

- Validate JSON structure at each level
- Fall back to defaults for missing properties
- Skip invalid nodes/controls
- Emit warning events for UI notification

### Persistence Errors

- Catch IndexedDB errors
- Retry with exponential backoff
- Show error toast to user
- Maintain in-memory state

## Node Type Resolution Architecture

### NodeData and NodeType Dependencies

**NodeData** and **NodeType** classes now depend on **CollectionManager** for runtime-aware node type resolution:

```ts
// NodeType constructor
constructor(nodeTypeDef, { collectionManager }) {
    this.collectionManager = collectionManager;
    // Use collectionManager for resolving nested types
    this.#resolveTypes(nodeTypeDef);
}

// NodeData constructor
constructor(payload = {}) {
    // Resolve node type via CollectionManager
    const collectionManager = payload.collectionManager;
    if (collectionManager && payload.type) {
        const nodeType = collectionManager.getNodeType(payload.type);
        if (nodeType) {
            // Enrich from node type definition
            this.#enrichFromNodeType(nodeType);
        }
    }
}
```

**Benefits**:
- NodeData creation automatically resolves type definitions
- Runtime-specific implementations are prioritized
- Clear dependency injection pattern
- Testable with mock CollectionManager

**Migration from Direct Registry Access**:

```ts
// Old approach (pre-CollectionManager)
const nodeType = NodePackageRegistry.getType(typeId);

// New approach (with CollectionManager)
const nodeType = collectionManager.getNodeType(typeId);
```

---

## Common Issues and Solutions

### Collection.getGraphs() Returns Undefined

**Issue**: The `getGraphs()` method was calling `forEach` with Map semantics on an array, causing it to return `undefined`.

**Root Cause**: Internal `#graphs` field is stored as an array, but the method was using `forEach((graph, graphId) => ...)` which is the Map signature. For arrays, the second parameter is the index, not the key.

**Fix**: Changed to `forEach((graph) => { result[graph.getId()] = graph; })` to properly iterate over the array and use `graph.getId()` for keys.

**Impact**: Without this fix, collections fail to serialize/deserialize properly, causing data loss on page refresh.

### Active Collection Change Handler Not Firing

**Issue**: When switching collections via dropdown, graph changes weren't being saved to IndexedDB.

**Root Cause**: In `Workspace.setActiveCollectionId()`, the change handler was registered on `getActiveCollection()` BEFORE updating `config.activeCollectionId`, so it was registering on the old collection instead of the new one.

**Fix**: Reordered the logic to:
1. Unregister old handler
2. Update `config.activeCollectionId`
3. Register handler on NEW active collection (via `getActiveCollection()`)

**Impact**: Graph changes in newly-selected collections now persist correctly.

### Stale Collection/Graph on Page Refresh

**Issue**: After switching collections/graphs and refreshing, the workspace dropdown showed the correct collection name, but the view displayed a different collection (from stale saved view layout).

**Root Cause**: View deserialization prioritized saved `collectionId` and `activeGraphId` from view layout over the workspace's authoritative `activeCollectionId` and collection's `activeGraphIdx`.

**Fix**: Updated `CollectionView.deserialize()` to:
1. **Collection**: Prioritize `workspace.getActiveCollection()` over saved `data.collectionId`
2. **Graph**: Prioritize `collection.getActiveGraph()` over saved `data.activeGraphId`

**Impact**: Views now always display the collection and graph that the data backbone considers active, ensuring UI and data consistency.

## Implementation References

- **Data Classes**: `src/micro_otter/nodes/html/js/data/`
- **Event System**: `src/micro_otter/nodes/html/js/core/event-emitter.ts`
- **Persistence**: `src/micro_otter/nodes/html/js/data/workspace-store.ts`
- **View Integration**: `src/micro_otter/nodes/html/js/views/view-manager.ts`

## Related Documentation

- [Node UI Implementation Plan](../../../ldev/todos/_done/node-ui-plan/00-overview.md)
- [Serialization Details](../../../ldev/todos/_done/node-ui-plan/08-serialization.md)
- [Undo/Redo Planning](../../../ldev/todos/_done/undo-redo-planning.md)
- [Future Ideas](../../../ldev/todos/_done/ideas/future-ideas.md)

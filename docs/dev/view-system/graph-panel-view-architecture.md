# GraphPanelView Architecture

## Overview

GraphPanelView is a ViewBase-derived component that provides interactive canvas-based node graph editing. It renders nodes, connections, handles user interactions (drag, pan, zoom), and manages selection state. As of Phase 4-5 refactoring (January 2026), the view has been modularized into specialized components for maintainability and testability.

## Architecture

### DOM Layout

The panel owns a small flex-column skeleton that is created once and reused across
`render()` calls:

```
div.graph-panel-view                  (position: relative; flex column)
  ├── div.graph-panel-view__toolbar   (flex: 0 0 auto — host for a ToolbarView)
  └── div.graph-panel-view__canvas    (flex: 1 1 auto; position: relative; overflow: hidden)
        ├── canvas.graph-panel-view__canvas-bg     (background: grid + documentation shading)
        ├── div.graph-panel-view__documentation    (DOM text layer, documentation areas)
        ├── canvas.graph-panel-view__canvas-node   (connections + nodes)
        ├── div.graph-panel-view__documentation-chrome (DOM chrome: burger, inline editors)
        ├── canvas (readability, optional)
        └── div.graph-panel-capability-tooltip
```

`#ensureLayout()` builds the skeleton lazily, stores the hosts in private fields
(`#rootEl`, `#toolbarHost`, `#canvasHost`) and `render()` mounts the *same* root element on
every attach (`mountContent(this.#rootEl)` → `container.replaceChildren(root)`). Keeping the
root alive across detach/attach cycles preserves the `<canvas>` element and therefore its 2D
context; `#createCanvas()` early-returns once a canvas exists, and `#ensureCapabilityTooltipAttached()`
re-inserts a tooltip that survived a detach. `resizeCanvas()` measures the `__canvas` host
(falling back to `canvas.parentElement`, then `this.container`), so the toolbar row is never
counted into the drawing surface.

A `SplitView` was deliberately **not** used: the toolbar row never resizes (a `ToolbarView`
locks its own height via `setHeightConstraints({ minHeight, maxHeight })`), so the splitter
would be inert chrome, and the canvas would have to be wrapped in an additional `ViewBase`
child. The flex column is cheaper, has no pane borders/padding, and is trivially testable.

### Canvas Layers

The canvas area is a stack of four surfaces. DOM order gives the paint order, and the
stylesheet pins it with `z-index` in case a host reorders children:

| Layer | Element | Paints |
| --- | --- | --- |
| 0 | `.graph-panel-view__canvas-bg` | Background grid, then the translucent documentation-area shading |
| 1 | `.graph-panel-view__documentation` | Area titles and rendered Markdown (DOM, below the canvas so text never covers a node) |
| 2 | `.graph-panel-view__canvas-node` | Connections, nodes, selection box, temp connection |
| 3 | `.graph-panel-view__documentation-chrome` | Burger button and the inline editors (DOM, above the canvas so they can be clicked and typed into) |

Layer 3 exists because a DOM control *below* a `<canvas>` never receives pointer or keyboard events.
It is `pointer-events: none` except for the controls themselves, so nodes inside a box stay clickable.

Why the grid left the node canvas: a documentation area must sit **in front of the grid and
behind every node**. With one canvas the only way to get that is to draw grid → shading →
connections → nodes in a single pass, which couples the shading to every node-drawing path
(and to the readability-canvas blit). Two canvases keep the passes independent: the background
canvas is cleared and repainted with only the grid and the shading, the node canvas keeps
everything it already drew.

Invariants every layer shares:

- **One resize path.** `resizeCanvas()` sizes the node canvas, the background canvas and the
  readability canvas in the same call, in CSS pixels (`style.width/height`) and device pixels
  (`width/height = css * dpr`). There is no second `ResizeObserver` and no second
  `window.resize` listener.
- **Same transform.** `_doRender()` applies `setTransform(1, 0, 0, 1, 0, 0)` + `clearRect()` in
  screen space to both canvases, then `setTransform(dpr, 0, 0, dpr, 0, 0)` and the shared
  `applyViewport()` to both, so world coordinates are identical on every layer.
- **Same frame.** One RAF-coalesced `renderPanel()` paints both canvases. A separate
  `requestAnimationFrame` loop for the background would make the shading lag behind panning and
  zooming.
- **Ownership.** `ownsCanvas`, `ownsBackgroundCanvas` and `ownsReadabilityCanvas` decide what
  `dispose()` removes, so a borrowed canvas is never torn down.

`GraphPanelRendering` mirrors the split: `renderBackground(ctx, width, height, { showGrid,
documentationAreas, activeAreaId })` draws the grid plus the shading, while `render()` keeps
drawing connections, nodes and overlays. `render()` still honours its `showGrid` flag for
callers that use a single canvas; `_doRender()` passes `showGrid: false` to it once a
background canvas exists and the real flag to `renderBackground()`. Because of that, every
existing rendering test keeps working unchanged.

### Canvas Background

The `__canvas` host paints the graph background itself
(`background-color: var(--mo-graph-canvas-bg, #0e141f)`); the `<canvas>` on top stays fully
transparent because the render loop only ever calls `ctx.clearRect()` and then draws. That is what
makes the disabled state a pure CSS concern:

| State | Rule | Theme variable |
|---|---|---|
| Enabled | `.graph-panel-view__canvas` | `--mo-graph-canvas-bg` (`#0e141f`) |
| Disabled | `.graph-panel-view__canvas--disabled` | `--mo-graph-canvas-bg-disabled` (`#232830`) |

`_applyEnabledVisualState(graph)` toggles the modifier class from
`normalizeGraphEnabled(graph?.getEnabled?.())` and is called from `_syncToolbarControls()` (so
`setGraph()` and the graph's `enabled` event repaint) — no toolbar checkbox, scrim element, filter
on the panel root or render-loop change. The enabled flag itself is edited from the graph-tab
context menu.

### Modular Design

GraphPanelView delegates specialized functionality to six focused modules:

```
GraphPanelView (main orchestrator)
  ├── GraphPanelViewport (viewport management)
  ├── GraphPanelRendering (canvas drawing)
  ├── GraphPanelSelection (selection state)
  ├── GraphPanelInteraction (mouse/keyboard handling)
  ├── GraphPanelClipboard (copy/cut/paste operations)
  └── ConnectionsUi (connection rendering)
```

### Module Responsibilities

#### 1. **GraphPanelViewport** (`graph-panel-viewport.ts`)

Manages coordinate systems, transformations, and viewport constraints.

**Key Responsibilities:**

- Screen ↔ world coordinate conversion
- Pan and zoom state management
- Viewport clamping to grid bounds
- Zoom-at-point calculations

**API Highlights:**

```ts
viewport.screenToWorld(screenPoint); // → {x, y}
viewport.worldToScreen(worldPoint); // → {x, y}
viewport.zoomAt(screenPos, factor, canvasSize);
viewport.setViewport({ scale, translateX, translateY }, canvasSize);
viewport.centerOnWorldPoint(worldPoint, canvasSize); // clamps like any other viewport change
viewport.getDefaultScale(); // → workspace viewport.defaultZoom, clamped to [minScale, maxScale]
viewport.serialize(); // → {scale, translateX, translateY} snapshot (persistence, change listener)
```

`onViewportChange(state)` (constructor option) fires on every interactive `setViewport()` /
`zoomAt()` / `centerOnWorldPoint()` call. It is deliberately **not** called from `deserialize()`:
restoring layout state must never mark the collection dirty.

**Usage Example:**

```ts
// Convert mouse click to world coordinates
const worldPos = viewport.screenToWorld({ x: event.clientX, y: event.clientY });

// Zoom in at mouse position (WHEEL_ZOOM_STEP is the per-notch wheel factor, 1.05)
viewport.zoomAt({ x: event.clientX, y: event.clientY }, WHEEL_ZOOM_STEP, canvasSize);
```

The wheel handler in `GraphPanelView` owns the per-notch step (`WHEEL_ZOOM_STEP`); the viewport
module owns clamping and anchor-point math, so every caller gets the same limits.

---

#### 2. **GraphPanelRendering** (`graph-panel-rendering.ts`)

Handles all canvas drawing operations.

**Key Responsibilities:**

- Grid rendering (minor and major lines)
- Node rendering via NodeUi instances
- Connection line rendering via ConnectionsUi
- Temporary connection drawing (during drag)
- Selection box rendering
- Crosshair/debug visualization

**API Highlights:**

```ts
rendering.render(ctx, width, height, {
    showGrid,
    nodeUiMap,
    nodeOrderList,
    selectedNodeIds,
    hoverConnector,
    tempConnection,
    selectionBox,
    onRenderExternal,
});

rendering.drawGrid(ctx, width, height);
rendering.drawNodes(ctx, { selectedNodeIds, hoverConnector, nodeUiMap, nodeOrderList });
rendering.drawSelectionBox(ctx, selectionBox);
```

**Usage Example:**

```ts
// Main render call
rendering.render(ctx, canvas.width, canvas.height, {
    showGrid: this.showGrid,
    nodeUiMap: this.nodeUiMap,
    nodeOrderList: this.nodeOrderList,
    selectedNodeIds: this.selection.selectedNodes,
    hoverConnector: this.interaction.hoverConnector,
    tempConnection: this.interaction.interaction.draggingConnection,
    selectionBox: this.selection.selectionBox,
});
```

---

#### 3. **GraphPanelSelection** (`graph-panel-selection.ts`)

Manages single selection, multi-selection, and box selection state.

**Key Responsibilities:**

- Single-node selection
- Multi-node selection (Ctrl+click, Shift+click)
- Box selection (drag to select multiple)
- Selection state queries

**API Highlights:**

```ts
selection.selectSingleNode(nodeId);
selection.addToSelection(nodeId);
selection.toggleSelection(nodeId);
selection.clearSelection();
selection.selectAll(nodeIds);

selection.startBoxSelection(worldPos);
selection.updateBoxSelection(worldPos);
selection.finishBoxSelection(nodeUiMap); // → nodeIds[]

selection.getSelectedNodeIds(); // → string[]
selection.isSelected(nodeId); // → boolean
```

**Usage Example:**

```ts
// Start box selection on mouse down
if (event.shiftKey && !hitNode) {
    selection.startBoxSelection(worldPos);
}

// Update on mouse move
if (selection.isBoxSelecting()) {
    selection.updateBoxSelection(worldPos);
}

// Finish on mouse up
if (selection.isBoxSelecting()) {
    const nodesInBox = selection.finishBoxSelection(nodeUiMap);
    nodesInBox.forEach((id) => selection.addToSelection(id));
}
```

---

#### 4. **GraphPanelInteraction** (`graph-panel-interaction.ts`)

Handles mouse and keyboard interactions, drag operations, and panning.

**Key Responsibilities:**

- Node drag (single and multi-node)
- Connection drag (create connections)
- Panning (middle-click or Space+drag)
- Hover state management
- Interaction state queries

**Connection editing:**

- **Drop-insert:** dragging an unconnected, type-compatible node over a connection shows a hover
  preview and, on release, splices it in (`source → inserted → target`). Compatibility is validated
  via `canConnect(..., { excludeConnections: [hitConnection] })` so a target input limited to one
  connection does not block the replacement edge. The hit test probes the pointer's world position
  (falling back to the last recorded pointer) instead of the dragged node's centre, so a node
  grabbed by its edge still previews and splices while the cursor is over the connection. Both the
  hover preview and the release use that pointer position, and insertion requires actual drag
  movement — a plain click never splices. The hover preview is suppressed for multi-node drags
  because those releases never insert. The drop uses a dedicated
  `INSERT_DROP_THRESHOLD_WORLD = 18` hit distance (wider than the 12 px hover threshold).
- **Alt+drag bypass:** holding Alt while dragging a pass-through node out of a connection wires its
  upstream directly to its downstream (using the original downstream input index), then leaves the
  node free. The rewire is deferred until the pointer moves more than 4 px so an Alt+Click without
  movement still toggles selection, and Alt+drag on a node without connections pans the canvas.
- **Ctrl+drag copy:** holding Ctrl/⌘ while dragging a node duplicates the node (or the whole
  selection when a selected node is pressed) and drags the copies, leaving the originals untouched.
  Copies are created at their original positions via
  `ClipboardManager.duplicate(..., { exactPositions: true })` so the grab offset is preserved, then
  `_beginNodeDrag()` moves them. The duplication is recorded as its own undo group
  (`Ctrl+Drag copy nodes`); the follow-up move is a separate undo step. Ctrl+Click without movement
  still toggles selection.

**API Highlights:**

```ts
interaction.startNodeDrag(nodeId, dragOffset, selectedNodeIds, nodeUiMap);
interaction.updateNodeDrag(worldPos, selectedNodeIds, graph, gridEnabled, gridSpacing);
interaction.endNodeDrag();

interaction.startConnectionDrag(connector);
interaction.updateConnectionDrag(worldPos);
interaction.endConnectionDrag(graph);

interaction.startPanning(screenPos);
interaction.updatePanning(screenPos, canvasSize);
interaction.endPanning();

interaction.updateHover(worldPos);
interaction.isInteracting(); // → boolean
```

**Usage Example:**

```ts
// Handle mouse down on node
const hit = hitTestNode(worldPos);
if (hit) {
    const dragOffset = { x: worldPos.x - hit.x, y: worldPos.y - hit.y };
    interaction.startNodeDrag(hit.nodeId, dragOffset, selection.selectedNodes, nodeUiMap);
}

// Update on mouse move
if (interaction.interaction.draggingNodeId) {
    interaction.updateNodeDrag(worldPos, selection.selectedNodes, graph, gridEnabled, GRID_SPACING);
}

// End on mouse up
interaction.endNodeDrag();
```

---

#### 5. **GraphPanelClipboard** (`graph-panel-clipboard.ts`)

Manages clipboard operations for nodes.

**Key Responsibilities:**

- Copy selected nodes
- Cut selected nodes (copy + immediate delete)
- Paste nodes at cursor or center
- Duplicate selected nodes
- Position calculation and offset

**API Highlights:**

```ts
clipboard.copySelected(); // → boolean (success)
clipboard.cutSelected(); // → boolean (success); also removes the source nodes
clipboard.pasteAtCenter(canvasSize); // → Promise<nodeIds[]>
clipboard.pasteAt(worldPos); // → Promise<nodeIds[]>
clipboard.duplicateSelected(); // → nodeIds[]

clipboard.updateLastPointerPosition(worldPos); // For paste-at-cursor
```

`cutSelected()` removes the source nodes immediately — it does not wait for a paste. The panel
supplies a `removeNodes` callback that clears the selection and records the removal as one undoable
history group, while `ClipboardManager.cut()` only serializes the payload. This keeps the clipboard
module free of history and selection wiring.

**Usage Example:**

```ts
// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'c') {
        clipboard.copySelected();
    }
    if (e.ctrlKey && e.key === 'v') {
        const newIds = await clipboard.pasteAtCenter(canvasSize);
        selection.selectSingleNode(newIds[0]);
    }
    if (e.ctrlKey && e.key === 'd') {
        const newIds = clipboard.duplicateSelected();
        selection.selectSingleNode(newIds[0]);
    }
});
```

---

#### 6. **ConnectionsUi** (existing module)

Handles connection line rendering and management.

**Key Responsibilities:**

- Connection path calculation (bezier curves)
- Connection hit testing
- Connection highlighting
- Connection invalidation

Connection curves use cubic bezier control points offset horizontally from the
connectors (see `connection-geometry.ts`). Forward links use a proportional bend
bounded to 60–120 px. Backward links (an output feeding an input to its left)
grow the offset just enough to keep a fixed loop past each connector, so the
line never swings far out as nodes get further apart.

`ConnectionsUi.setHighlightedNodes(nodeIds)` marks the connections to draw with a selection halo.
Connection style precedence is **hovered > highlighted > normal**: a connection touching a selected
node gets a translucent glow pass underneath its normal gradient stroke (disabled in interaction
quality mode).

**API:**

```ts
connectionsUi.drawConnections(ctx);
connectionsUi.setHighlightedNodes(selectedNodeIds);
connectionsUi.dispose();
```

---

## Main Class: GraphPanelView

GraphPanelView orchestrates all modules and integrates with ViewBase lifecycle.

### Constructor

```ts
const graphPanel = new GraphPanelView({
    graph, // NodeGraph instance (data backbone)
    collection, // Collection instance (parent)
    workspace, // Workspace instance (configuration)
    viewManager, // ViewManager instance (overlay management)
    onSelect, // Callback for selection changes
    i18nService, // I18nService instance
    logger, // Logger function
});
```

### Lifecycle Integration (ViewBase)

GraphPanelView extends ViewBase and implements lifecycle hooks:

```ts
// Called when attached to container
render(container) {
    this.#createCanvas();
    container.appendChild(this.canvas);
    this.syncNodeUisFromGraph();
    this.#bindEvents();
    this.resizeCanvas();
    this.renderPanel();
}

// Called after render completes
afterAttach() {
    super.afterAttach();
    this.registerVisibilityHandler();
    this._subscribeToLanguageChanges(() => this.renderPanel());
}

// Called before detachment
beforeDetach() {
    this.#detachDocumentDragListeners();
    if (this._graphChangeUnsubscribe) {
        this._graphChangeUnsubscribe();
    }
    this.unregisterResizeHandlers();
    // ... cleanup event listeners
    super.beforeDetach();
}

// Resize handling
onInitialSize(size) {
    super.onInitialSize(size);
    this.resizeCanvas();
    this.#ensureInitialViewport(size); // one-time opening viewport (see "Initial Viewport")
}

onResized(size) {
    super.onResized(size);
    this.resizeCanvas();
}
```

### Initial Viewport

Opening a panel resolves the viewport exactly once per bound graph through
`#ensureInitialViewport()`. It is a no-op when the resolution already ran, when no graph is bound, or
when the canvas has no measurable size, so a hidden tab simply retries on the next hook:

| Situation | Result |
|---|---|
| `graph.getViewportConfig()` differs from `{ translateX: 0, translateY: 0, scale: 1 }` | restore those values (clamped) |
| No stored view, graph has nodes or documentation areas | center their union bounds at `getDefaultScale()` |
| No stored view, empty graph | center the grid world center `(gridSizeWorld.width / 2, gridSizeWorld.height / 2)` |

Hooks that call it (all idempotent): `render()`, `onInitialSize(size)`, the debounced callback in
`onResized(size)`, the visible branch of `applyVisibilityState()`, and `setGraph()` — which also
resets `_initialViewportApplied` so the new graph gets its own opening view (and flushes a pending
write to the outgoing graph first). The measured canvas size wins over the hook-provided container
size because the canvas sits below the toolbar.

Clamping still belongs to `GraphPanelViewport`, and it is asymmetric: `maxX` / `maxY` are half a
major grid interval (`80` px at scale 1 with the panel defaults), so content near the world origin
centers only as far as the clamp allows. The resolution never relaxes that clamp.

Opening a graph never writes to the model: the whole resolution runs inside the private
`#applyingInitialViewport` flag, which suppresses the `onViewportChange` handler.

Interactive pan/zoom is persisted back through the graph document, debounced by 250 ms
(`VIEWPORT_PERSIST_DEBOUNCE_MS`) and flushed by `beforeDetach()`, `dispose()`, and `setGraph()`:

```ts
// GraphPanelView — after a pan/zoom gesture settles
#persistViewport() {
    const next = this.viewportModule.serialize();
    const current = this.graph.getViewportConfig();          // live ViewportConfig
    if (current.scale === next.scale && /* translate equal */ ...) return;
    this.graph.setViewportConfig(new ViewportConfig(next));  // emits `viewport`, marks dirty once
}
```

Use `graph.setViewportConfig()` directly. `Collection.setViewportConfig()` forwards to the graph *and*
marks the collection dirty itself, which would double the `viewport` event and the dirty mark.

### Serialization

The live viewport travels on the graph document (`viewportConfig` → `viewport` event → collection
save). `GraphPanelView.serialize()` / `deserialize()` carry layout state only, and the running app
rebuilds panels from live models, so those hooks never decide where a graph opens.

GraphPanelView serializes its layout record (viewport snapshot, grid toggles, selection):

```ts
serialize() {
    return {
        type: 'GraphPanelView',
        graphId: this.graph.id,
        viewport: this.viewportModule.serialize(),
        grid: {
            enabled: this.gridEnabled,
            visible: this.showGrid,
        },
        selection: this.selection.serialize(),
    };
}

deserialize(data, context) {
    this.viewportModule.deserialize(data);
    this.gridEnabled = data.grid?.enabled ?? this.gridEnabled;
    this.showGrid = data.grid?.visible ?? this.showGrid;
    this.selection.deserialize(data.selection || {});
}
```

---

## Panel Toolbar

The panel mounts a real `ToolbarView` (`toolbar-view.ts`) in `div.graph-panel-view__toolbar`.
The toolbar is created lazily and attached exactly once per toolbar instance:

| Method | Responsibility |
|---|---|
| `#ensureToolbar()` | Creates the `ToolbarView` (`height: 36`, `layoutMode: 'scroll'`), attaches it to `#toolbarHost` when `this.#toolbarView.container` is unset, and delegates to `#createToolbarControls()`. |
| `#createToolbarControls()` | Idempotent (`#toolbarControlsCreated`). Adds the controls, calls `renderControls()` once, caches `#alignButton`, then runs `_updateToolbarLabels()`, `_refreshToolbarControlLabels()` and `_syncToolbarControls()`. |
| `_updateToolbarLabels()` | Re-applies `title` / `aria-label` (and the icon `alt`) from `graph.toolbar.alignToGrid`, then refreshes the enabled state. |
| `_refreshToolbarControlLabels()` | Applies the `aria-label` of the untitled dropdown and updates the interval `.custom-control__label` text plus both `<option>` texts in place — `BaseControl` has no label setter, and rebuilding would drop focus during a language switch. |
| `_updateToolbarEnabledState()` | The align button is enabled only when a graph with at least one node is attached. |
| `dispose()` | `#toolbarView.detach()` plus resetting `#toolbarView`, `#alignButton`, `#toolbarControlsCreated` and both control references, so a later `attachTo()` rebuilds the toolbar from scratch. |

Control set (left to right):

1. **Align to grid** — icon button (`IconProvider.alignToGrid`, inlined as a `data:` URI), `onClick: () => this._alignNodesToGrid()`.
2. **Separator** (`addSeparator()`) — visually closes the action group.
3. **Execution type** — `DropdownControl` with the model values `startup` / `continuous`, labelled
   `Startup` / `Loop` (`graph.toolbar.executionType.startup` / `.loop`), `onChange` →
   `_handleToolbarExecutionTypeChanged()`. The dropdown renders **without a visible title**: the
   compact row is too tight for a second label, so the option text carries the meaning and
   `graph.toolbar.executionType.label` is applied as the `aria-label` of the `<select>` instead.
   `DropdownControl` still emits an empty `.custom-control__label`, which the panel stylesheet
   collapses (`:empty`).
4. **Interval** — `NumberControl` (`min: 0`, `max: 60000`, `step: 1`), labelled
   `graph.toolbar.sleepDuration.label` ("Interval (ms)"). The value is a cadence period between
   iteration starts and any value in range commits, including `0`, which means yield-only.
   `NumberControl` emits on every `input` event, so the panel never uses `onChange`; it commits on
   `change` + `blur` via `_handleToolbarSleepCommit()`. A blank field makes **no**
   `setTriggerInterval()` call: the panel restores the input from the graph. Non-blank input is
   clamped with the shared `clampSleepDuration()` before the panel compares it with the graph value
   and writes, so no redundant `interval` event is emitted.

The graph **enabled** flag is not in this toolbar. It is edited from the graph-tab context menu
(`collection.tabContextMenu.enabled` → `graph.setEnabled()`), so the toolbar stays focused on
content actions. A disabled graph is excluded from transpilation and its canvas drops to the muted
canvas background (see [Canvas Background](#canvas-background)).

The inline controls live in panel-owned wrapper elements with the class
`graph-panel-view__toolbar-control`, which the stylesheet compacts into a single row that fits the
locked 36 px height. `#createToolbarControls()` creates these hosts and adds them with
`toolbarView.addElement()` because the dropdown and number controls need explicit host elements
(the panel renders them itself to control the missing visible title). The interval control is hidden
(`hidden` attribute) while the graph runs once (`startup`). Its input is sized
`calc(5ch + 34px)` so that the full five-digit range (`60000`) stays visible next to the native
number spinner.

`_syncToolbarControls()` is the single pull path: it disables the execution-type and interval
controls when no graph is attached, pushes `executionType` and `interval` into the controls, and ends
with `_applyEnabledVisualState()` so a tab switch to a disabled graph repaints immediately. The graph
wildcard listener routes the `executionType`, `interval` and `enabled` events into
`_syncToolbarControls()`, which is how a change made in the settings view or the graph-tab context
menu reaches this panel.

---

## Event Flow

### Data Changes (NodeGraph → View)

```
NodeGraph emits change event
  ↓
GraphPanelView._subscribeToGraphChanges() listener fires
  ↓
syncNodeUisFromGraph() updates NodeUi instances
  ↓
renderPanel() re-renders canvas
```

Execution settings take a cheaper path: `executionType` and `interval` only call
`_syncToolbarControls()`, which writes the new values into the dropdown/number controls and
toggles the interval host — no canvas repaint, because nothing on the canvas depends on them.
`node-added` / `node-removed` additionally refresh `_updateToolbarEnabledState()`.

`GraphSettingsView` subscribes to the same `NodeGraph` with `graph.on('*')`, so an edit in either
surface reaches the other through the model alone — there is no direct view-to-view wiring.

### Unknown node types

A node outlives its package: an add-on can be uninstalled, or a workspace can be opened on a machine
that never installed it. `revalidateNodeCapabilities()` and `revalidateNodeCapability()` therefore
treat "the runtime has no such type" as an issue instead of clearing the node's issues.
`core/missing-node-type-issue.ts` builds the `NodeCapabilityIssue` — scope `node`, message from
`graph.nodeTypeMissing` with the type id and the package id (the first segment of
`<packageId>.<typeId>`) filled in, and an English fallback for a workspace whose locale lacks the key.

The issue travels the existing capability-issue channel, so the node is painted with the
`CAPABILITY_ISSUE_BORDER_COLOR` border and the hover tooltip lists the sentence naming the add-on that
has to be installed. `NodeData.setCapabilityIssues()` normalizes every issue to
`source: 'capabilityCheck'`, which is why the builder uses that source as well.

### Runtime collection reloads

`GraphPanelView` subscribes to the workspace runtime collection (`runtimesLoaded` /
`RuntimeCollection.RuntimesLoaded.v1`) and re-validates every node when an add-on install or
uninstall reloads the packages: a node whose package reappeared loses the unknown-type issue, and a
node whose package vanished gains it. `beforeDetach()` drops that subscription together with the graph
and collection listeners.

### User Interactions (View → Data)

```
User clicks canvas
  ↓
handleMouseDown() processes event
  ↓
Delegates to interaction module (startNodeDrag, startConnectionDrag, etc.)
  ↓
Mouse move updates interaction state
  ↓
Mouse up commits changes to NodeGraph
  ↓
NodeGraph emits change event → view updates
```

### Selection Changes

```
User clicks node
  ↓
selection.selectSingleNode(nodeId)
  ↓
onSelect callback invoked
  ↓
renderPanel() re-renders with selection highlight
```

Ctrl+Click still toggles a node in the selection. Ctrl/⌘+drag on a node is a copy gesture: the node
(or the whole selection when a selected node is pressed) is duplicated underneath itself and the
copies follow the pointer while the originals stay in place. Alt+drag on a pass-through node is the
bypass gesture: the node is detached and its upstream/downstream are wired directly once the pointer
moves past the 4 px drag threshold.

The active node (the last interacted/selected node) is always drawn on top and hit-tested first.
`orderNodeIdsForDrawing()` moves it to the end of the paint order, while
`orderNodeIdsForHitTesting()` checks it first, so what you see on top is what you pick.

Control hit-testing follows the same front-to-back order. `GraphPanelInteraction` walks the node
IDs from front to back, and a node whose body or header covers the point stops the search even when
that node has no control there. A higher node therefore blocks controls on every node below it,
including controls that spill outside their own node body. A control that spills outside its own
node remains clickable only while no higher node covers that point, because the control check for
that node runs before its body check.

`GraphPanelView` supplies that order through `getNodeHitTestOrder()`, which delegates to
`orderNodeIdsForHitTesting(nodeOrderList, activeNodeId)`. Pressing a control also promotes its
owning node to active before the control handler runs, matching the behaviour of pressing the node
body.

Selecting a node also computes the related-node set (`collectRelatedNodeIds`): the selection plus its
one-hop neighbours. Connections touching a selected node render a highlight halo, and neighbouring
nodes render a blue glow ring/outline (`RELATED_NODE_BORDER_COLOR` and `RELATED_NODE_GLOW_COLOR`),
while the selected node keeps its yellow `selectedBorderColor` glow and its normal body fill.
Neighbouring nodes additionally brighten their own body fill (`brightenColor()`), keeping each
node's hue.

---

## Key Methods

### Node Management

```ts
syncNodeUisFromGraph(); // Sync NodeUi instances with NodeGraph
hitTestNode(worldPos); // → { nodeId, x, y, hit: {...} }
hitTestConnector(worldPos); // → { nodeId, kind, index }
```

### Rendering

```ts
renderPanel(); // Main render orchestrator
resizeCanvas(); // Adjust canvas to the __canvas host size
applyViewport(ctx); // Apply viewport transform to context
#ensureLayout(); // Create (once) the toolbar/canvas skeleton
```

### Panel Toolbar

```ts
#ensureToolbar(); // Create + attach the ToolbarView (once per instance)
#createToolbarControls(); // Build the align button, dropdown and number control
_alignNodesToGrid(); // Snap all nodes in one history group
_syncToolbarControls(); // Pull graph execution settings into the controls
_handleToolbarExecutionTypeChanged(value); // Push the dropdown value into the graph
_handleToolbarSleepCommit(); // Clamp + push the interval (change/blur)
_updateToolbarLabels(); // Re-apply the align button label
_refreshToolbarControlLabels(); // Re-apply control/option labels on language change
_updateToolbarEnabledState(); // Disable the align button for empty graphs
```

`_alignNodesToGrid()` snaps every node through `viewportModule.snapToGrid()` (used directly, so
the action also works while the grid overlay is hidden), skips nodes that are already aligned,
brackets each move with `startNodeDrag()` / `endNodeDrag()`, and runs the whole batch inside one
`beginGroup()` / `endGroup()` pair (label: `graph.toolbar.alignToGridUndo`) so undo restores the
old positions in a single step.

### Coordinate Conversion

```ts
screenToWorld(point); // Screen → world coordinates
worldToScreen(point); // World → screen coordinates
canvasToScreen(point); // Canvas → screen coordinates
screenToCanvas(point); // Screen → canvas coordinates
```

### Grid & Snapping

Node placement is grid-aware via two `GraphPanelViewport` methods:

```ts
clampToGrid(x, y, width, height); // Clamp to the grid world bounds only
snapToGrid(x, y, width, height, spacing?); // Snap to GRID_SPACING, then clamp to bounds
```

The interaction module receives an optional `snapNodePosition(x, y, width, height)` hook. The
view supplies it as `gridEnabled ? viewportModule.snapToGrid(...) : { x, y }`, so the "Snap to
Grid" toggle controls whether drag, palette drop, and paste positions are quantized.

Palette drops carry either a node type or a **graph item**: `NodeTypeUi` sends
`{ type: 'node-type', nodeTypeId, nodeTypeName }` for node types and
`{ type: 'graph-item', graphItemId, nodeTypeName }` for entries of the Organizational section (today
only `documentation-area`). `handleDrop()` branches on that discriminator before the runtime lookup, so
a graph item never reaches `runtime.getNodeType()` and never becomes a node — it creates a
documentation area instead. See
[graph-panel-documentation-areas.md](graph-panel-documentation-areas.md#palette-entry).

- **Single-node drag:** the position is resolved through `snapNodePosition` (or falls back to
  `clampToGrid`).
- **Multi-node drag:** only the *primary* dragged node is snapped; the resulting delta is applied
  to every selected node (each bounds-clamped) so relative spacing is preserved.

Grid snapping and grid visibility are independent toggles: `gridEnabled` only controls whether node
positions are quantized, while `showGrid` only controls whether `GraphPanelRendering` draws the grid
lines (`render()` receives `showGrid` and never sees the snap setting).

---

## Usage Examples

### Creating a Graph Panel

```ts
import { GraphPanelView } from './views/graph-panel-view.ts';

const graphPanel = new GraphPanelView({
    graph: myNodeGraph,
    collection: myCollection,
    workspace: myWorkspace,
    viewManager: myViewManager,
    onSelect: (nodeId) => {
        console.log('Selected node:', nodeId);
    },
    i18nService: myI18nService,
    logger: console,
});

// Attach to container
const container = document.getElementById('graph-container');
graphPanel.attachTo(container);
```

### Handling Selection

```ts
// Select single node
graphPanel.selection.selectSingleNode('node-123');

// Multi-select (Ctrl+click)
graphPanel.selection.addToSelection('node-456');

// Box selection
const nodesInBox = graphPanel.selection.finishBoxSelection(graphPanel.nodeUiMap);
nodesInBox.forEach((id) => graphPanel.selection.addToSelection(id));

// Get selected nodes
const selected = graphPanel.selection.getSelectedNodeIds();
console.log('Selected nodes:', selected);
```

### Clipboard Operations

```ts
// Copy selected nodes
graphPanel.clipboard.copySelected();

// Paste at cursor
const newIds = await graphPanel.clipboard.pasteAt(worldPos);

// Duplicate selected nodes
const duplicatedIds = graphPanel.clipboard.duplicateSelected();
```

### Viewport Control

```ts
// Zoom in at center with the per-notch wheel factor
const center = { x: canvas.width / 2, y: canvas.height / 2 };
graphPanel.viewportModule.zoomAt(center, WHEEL_ZOOM_STEP, canvasSize);

// Pan to position
graphPanel.viewportModule.setViewport(
    {
        scale: 1.0,
        translateX: 100,
        translateY: 50,
    },
    canvasSize
);

// Get world bounds
const bounds = graphPanel.viewportModule.getCanvasBoundsWorld(canvasSize);
console.log('Visible area:', bounds);
```

---

## Integration with Other Systems

### NodeGraph Data Backbone

GraphPanelView listens to NodeGraph change events:

```ts
graph.onChange((event) => {
    if (event.type === 'node-added' || event.type === 'node-removed') {
        this.syncNodeUisFromGraph();
        this.renderPanel();
    }
});
```

### ViewManager Integration

```ts
// Add graph panel to view manager
viewManager.attachRoot(new SplitView({
    views: [
        new NodePaletteView({ ... }),
        new GraphPanelView({ graph, collection, workspace, viewManager }),
    ]
}));
```

### Context Menus

GraphPanelView uses MenuWindow (MenuView + OverlayWindow wrapper) for node and canvas context menus:

```ts
_showNodeContextMenu(event) {
    const menuWindow = new MenuWindow({
        items: [
            { id: 'copy', label: this.t('contextMenu.copy') },
            { id: 'delete', label: this.t('contextMenu.delete') },
        ],
        onSelect: (item) => this._handleNodeContextMenuSelect(item),
        x: event.clientX,
        y: event.clientY,
        i18nService: this._i18nService,
        logger: this._logger,
    });

    // MenuWindow is an OverlayWindow: it has no show() method, it is attached through the manager.
    this._viewManager.addOverlay(menuWindow);
}
```

---

## Performance Considerations

### Rendering Optimization

- **Visibility Tracking**: Only renders when container is visible
- **Render Debouncing**: Pending render flag prevents excessive redraws
- **Viewport Culling**: Only visible nodes are processed (future enhancement)

### Resize Handling Strategy

GraphPanelView implements a **debounced canvas resize** approach to prevent flickering during rapid resize events (e.g., SplitView splitter drag):

**The Problem:**

- Setting `canvas.width` or `canvas.height` **clears the entire canvas content**
- ResizeObserver fires on every container dimension change
- During splitter drag, this causes repeated canvas clearing → flickering/blank frames

**The Solution:**

- **During rapid resize** (< 150ms between events):
    - Update `canvas.style.width` and `canvas.style.height` (CSS dimensions)
    - Canvas content remains visible but slightly stretched/compressed
    - No clearing, no flickering
- **After resize settles** (150ms debounce):
    - Call `resizeCanvas()` which sets actual `canvas.width` and `canvas.height`
    - This clears the canvas, then `renderPanel()` redraws at correct dimensions
    - Result: Crisp rendering at final size

**Implementation:**

```ts
onResized({ width, height }) {
    super.onResized({ width, height });

    // Update CSS dimensions immediately (doesn't clear canvas)
    const newStyleWidth = `${width}px`;
    const newStyleHeight = `${height}px`;

    if (this.canvas.style.width !== newStyleWidth) {
        this.canvas.style.width = newStyleWidth;
    }
    if (this.canvas.style.height !== newStyleHeight) {
        this.canvas.style.height = newStyleHeight;
    }

    // Debounce actual canvas resize (which clears content)
    clearTimeout(this._resizeDebounceTimer);
    this._resizeDebounceTimer = setTimeout(() => {
        this.resizeCanvas(); // Clears canvas
        this.renderPanel();  // Redraws content
    }, 150);
}
```

**Why This Works:**

- Canvas content pixels are stretched by CSS during drag (visually acceptable)
- No canvas clearing during interaction (smooth experience)
- Final render produces crisp, correctly-sized output
- 150ms is imperceptible to users but prevents excessive clearing

**Benefits:**

- ✅ Smooth visual experience during splitter drag
- ✅ No blank frames or flickering
- ✅ Efficient (only one canvas clear per resize sequence)
- ✅ Final output is pixel-perfect

### Memory Management

- **Cleanup**: All event listeners removed in `beforeDetach()`
- **NodeUi Lifecycle**: NodeUi instances cleaned up when nodes removed
- **Canvas Ownership**: Tracks canvas ownership for proper disposal
- **Resize Timer Cleanup**: `clearTimeout(this._resizeDebounceTimer)` in `beforeDetach()` prevents memory leaks

---

## Testing

Each module can be tested independently:

```ts
// Test viewport transformations
import { GraphPanelViewport } from './graph-panel-viewport.ts';

const viewport = new GraphPanelViewport({ constants, workspace, maxGridMajorIntervals });
const world = viewport.screenToWorld({ x: 100, y: 100 });
expect(world).toEqual({ x: 100, y: 100 }); // At scale 1.0

// Test selection
import { GraphPanelSelection } from './graph-panel-selection.ts';

const selection = new GraphPanelSelection();
selection.selectSingleNode('node-1');
expect(selection.isSelected('node-1')).toBe(true);
selection.addToSelection('node-2');
expect(selection.getSelectionCount()).toBe(2);
```

### Panel Tests

| Test file | Coverage |
|---|---|
| `tests/views/graph-panel-layout.test.js` | Layout skeleton (host order, canvas placement, re-attach without duplicates, host-based sizing, `dispose()` teardown) and the `graph-panel-view.css` rules/manifest registration. |
| `tests/views/graph-panel-toolbar.test.js` | Toolbar lifecycle inside the panel, align button label/icon/enabled state, control rendering, sleep commit/clamping, execution-type commits and pull-side sync. |
| `tests/views/tabbed-view-container-lifecycle.test.js` | Removing/replacing views drops the TabbedView-owned `.tabbed-view__view-container` wrapper (the pane-width regression). |
| `tests/views/tabbed-view-context-menu.test.js` | Opt-in `tab-context-menu` payload, right-click without activation, Shift+F10 anchor and native-menu fallback. |
| `tests/views/collection-view-tab-context-menu.test.js` | Graph-tab menu entries, enable toggle, delete routing and unchanged active tab. |
| `tests/views/graph-panel-align-to-grid.test.js` | `_alignNodesToGrid()` (duck-typed view): snapping, no-op when aligned, single history group, missing graph, failing update. |
| `tests/views/graph-panel-toolbar-mirroring.test.js` | Toolbar ↔ `GraphSettingsView` mirroring against a real `NodeGraph` (events, persistence round trip, no redundant writes). |
| `tests/data/graph-execution-settings.test.js` | `normalizeExecutionType()`, `clampSleepDuration()` and the shared constants. |

---

## Migration Notes

### From Monolithic to Modular (Phase 4-5)

**Before:** All functionality in single 3200+ line file  
**After:** Functionality split into 6 focused modules + main orchestrator

**Migration Steps:**

1. Import new modules in GraphPanelView
2. Instantiate modules in constructor
3. Delegate method calls to appropriate modules
4. Update tests to import specific modules

**Backward Compatibility:**

- Public API of GraphPanelView remains unchanged
- Existing code using GraphPanelView continues to work
- Serialization format unchanged

---

## Future Enhancements

### Planned Features

1. **Viewport Culling**: Only render nodes within visible bounds
2. **Connection Routing**: Smart connection paths avoiding node overlaps
3. **Undo/Redo**: Integration with command pattern for history
4. **Touch Support**: Multi-touch gestures for pan/zoom on tablets
5. **Accessibility**: Keyboard navigation and screen reader support

### Potential Module Additions

- **graph-panel-zoom-controls.ts**: UI controls for zoom in/out/fit
- **graph-panel-minimap.ts**: Minimap view for large graphs
- **graph-panel-search.ts**: Node search and highlight
- **graph-panel-history.ts**: Undo/redo command management

---

## Related Documentation

- [View System Architecture](view-system-architecture.md) - ViewBase lifecycle and integration
- [Data Backbone Architecture](../core/data-backbone-architecture.md) - NodeGraph data model
- [Node UI Module Structure](node-ui-module-structure.md) - NodeUi rendering details
- [I18n System Architecture](../core/i18n-architecture.md) - Translation support
- [Settings Views Guide](settings-views-guide.md) - `GraphSettingsView`, the second surface for the same execution settings
- [Standard Theme Styling Guide](standard-theme-styling-guide.md) - `graph-panel-view.css` layout and toolbar rules
- [Graph Panel Documentation Areas](graph-panel-documentation-areas.md) - Documentation areas ("group boxes"): the two-canvas split, the DOM text layer, interaction, menu and clipboard integration

> **Note:** The documentation-area layer is documented in
> [graph-panel-documentation-areas.md](graph-panel-documentation-areas.md). The data side lives in the
> "Documentation areas" subsection of
> [data-backbone-architecture.md](../core/data-backbone-architecture.md).

---

## Summary

GraphPanelView provides a modular, maintainable architecture for canvas-based node graph editing. By delegating to specialized modules, each component has a clear responsibility and can be tested independently. The view integrates seamlessly with the ViewBase lifecycle, NodeGraph data backbone, and i18n system, providing a robust foundation for interactive graph editing.

**Key Takeaways:**

- ✅ Modular design with single-responsibility modules
- ✅ Clean separation of viewport, rendering, interaction, and selection
- ✅ ViewBase integration for lifecycle management
- ✅ Comprehensive serialization for persistence
- ✅ Event-driven architecture for data synchronization
- ✅ Independent testability of each module

# Node UI Module Structure

## Overview

The Node UI codebase is organized into a modular architecture with clear separation of concerns. The **Phase 2 Control Architecture Refactoring** (completed January 2026) consolidated editor functions into control classes, eliminating code duplication and improving maintainability. The functionality remains identical, but the code is now organized into focused, single-responsibility modules.

## Module Organization

### 1. **node-ui.ts** (Main Module) - ~700 lines

The primary class and public API. Coordinates all other modules and manages:

- Node instance lifecycle (construction, graph binding, destruction)
- Public API methods (setPosition, setCollapsed, getBounds, etc.)
- Control instance management via `controlInstances` Map
- Control factory: creates control instances based on type
- Editor lifecycle: show/position/hide editors via `showControlEditor()` and `hideEditor()`
- Click-away handler management for editor cleanup
- Name editor management (show/hide editor for node name)
- Click handling and double-click detection
- Icon loading
- Delegation to specialized modules (rendering, hit-testing, helpers)

**Key additions (Phase 2)**:

- `controlInstances`: Map tracking all control UI instances for this node
- `_createControlInstances()`: Factory method creating controls based on definition
- `_destroyControlInstances()`: Cleanup on node destruction

### 2. **node-ui-constants.ts** - ~30 lines

All layout constants and default styling configuration:

- `DEFAULT_STYLE` - Color scheme
- Layout dimensions (header height, padding, spacing, etc.)
- Connector and control measurements
- Connector row geometry: `CONNECTOR_ROW_INSET` (`CONNECTOR_OVERLAP + CONNECTOR_LABEL_OFFSET`),
  `CONTROLS_CONNECTOR_GAP`, the explicit `CONNECTOR_SPACING` row pitch
- Control metrics: `CONTROL_LABEL_FONT`, `CONTROL_LABEL_CHAR_WIDTH_ESTIMATE`, `CONTROL_LABEL_MARGIN`,
  `CONTROL_VALUE_MIN_WIDTH` and the frozen per-type `CONTROL_VALUE_MIN_WIDTH_BY_TYPE` floors
- Header metrics: `NODE_HEADER_ICON_SIZE`, `NODE_HEADER_ICON_INSET`, `NODE_HEADER_TITLE_PADDING`,
  `NODE_HEADER_TITLE_FONT`
- Separator metrics: `CONTROL_SEPARATOR_COLOR`, `CONTROL_SEPARATOR_THICKNESS`,
  `CONTROL_SEPARATOR_MIN_WIDTH`

**Removed**: the unused `CONTROL_LABEL_WIDTH` constant and the unreferenced `NodeUiGeometryConfig`
type. Control labels now share a dynamically measured column instead of a fixed width.

### 3. **node-ui-helpers.ts** - ~200 lines

Utility functions for calculations and transformations:

- `calculateNodeHeight()` - Dynamic height using control.getLayout()
- `getVisibleControls()` - Filter controls by dropdown-driven visibility (declared membership:
  a dropdown hides only the controls it lists in some option and does not select). The optional
  second argument `extraAffectingDropdowns` lets a dropdown that is *not* part of
  `nodeData.controls` take part in that computation — the input-row default controls need it
  because they live in `data.inputs`; the returned list stays filtered `nodeData.controls`, so a
  synthetic entry can never be rendered as a row
- `extractLocalizedString()` - i18n string extraction
- `formatControlValue()` - Format control values for display
- `pointInRect()` - Geometric helper
- `canvasToScreen()` - Coordinate transformation
- Control metrics: `measureControlLabelWidth()`, `resolveControlLabelText()`,
  `getControlValueMinWidth()`, `fitTextToWidth()`, `measureControlLabelColumnWidth()`

**Dynamic option lists may change while the editor is open.** A control with
`dynamicOptions` gets its option list from a resolver, not from the node definition, and
`graphTopics` (see `docs/dev/nodes/node-definition-reference.md`) changes whenever another node
is added, edited or removed. `NodeUi` therefore subscribes to the graph's `node-added` /
`node-updated` / `node-removed` events in `_bindGraph()` and calls `_refreshDynamicControls()`
(re-entrancy guarded) for nodes that own a cross-node control (`_hasCrossNodeControl()`, i.e.
the `graphTopics`, `availabilityRefs`, `varStores`, `varNames` and `signalNames` sources); the
stale control instances are rebuilt, so rendering, hit-testing and the editor all see the new list
without a reload. `_hasCrossNodeControl()` inspects
`inputs[].defaultControl.dynamicOptions` as well as `data.controls`, and
`_refreshDynamicControls()` rebuilds the input default control instances
together with the control instances — otherwise a node whose only cross-node source is the
store picker would keep a stale list.
`_visibilityNodeData()` resolves dynamic controls before visibility is computed, so
`activeControls` / `activeInputs` on a resolved option reveal their controls exactly like a
static option does.

**A rebuild only happens when a resolved list changed.** Re-creating the instances is not free:
the icon control reloads its webfont glyph, so a rebuild is visible as a flicker of the icon row.
`_refreshDynamicControls()` therefore resolves first (`_dynamicOptionSignature()` — one pass over
every dynamic control and input default that also seeds their values) and compares the result with
`_dynamicControlSignature`, the lists the live instances were built from. Identical lists mean the
call is a no-op, which is what keeps a keystroke in one node from touching the controls of the
others. The signature is recorded after a full build (`constructor`, `setGraph()`), cleared by
`_destroyControlInstances()` / `_destroyInputDefaultControlInstances()`, and left empty while a
rebuild is deferred.

**A picker that mirrors a companion field is updated in place.** A sentinel option may render the
text of a companion control (`newNameControls` / `newStoreControls` / `newTopicControls`, see
`descriptorEchoesControl()`). Those ids are dependencies of the picker even though they are not
listed in `dependsOn`: `onControlChanged()` calls `_refreshCompanionPickers()` first, which
re-resolves the picker and pushes the new list into the **live** instance through
`NodeDropdownControlUi.setOptions()` (options, `controlData.options`, trigger label and a mounted
menu, keeping the open/closed state) and requests a repaint. The rebuild stays deferred until the
editor closes, so typing follows the row without replacing the element the user is typing in.

**Dynamic options on input-row default controls.** A `defaultControl` may carry
`dynamicOptions` too. `NodeUi._resolveInputDefaultOptions()` resolves the list when the input
default instances are built and never writes `controlValues`: the value belongs in
`inputDefaults`, and a stored value is only seeded when the key is `undefined`, `null` or `''`
(an empty namespace input means `default`). For the reveal
to work, `_getVisibleControls()` passes one synthetic dropdown per dynamic input default to
`getVisibleControls()` (`_inputDefaultAffectingDropdowns()`); it carries the resolved options and
`default: inputDefaults[id]`, which is what `getVisibleControls()` reads when the control value
map has no entry. The synthetic entry is never rendered, so it never occupies a row.

**Hit testing walks the drawn rows.** Because the resolved list is the only correct one,
`hitTestControl()` (and its input-default pass) asks `NodeUi._getVisibleControls()` for the row
list instead of calling `getVisibleControls(nodeData)` itself. The raw call sees a dynamic
picker's declared `options` — usually none — so it keeps companions that the selected option
hides, and every row below that picker is then hit one slot off: clicking the drawn
`New variable` field opened the *hidden* `New store` editor (storing the typed name under a
control the user never saw) and clicking a store picker row hit nothing at all.
`visibleControlsOf()` in `node-ui-hit-testing.ts` is that single access point, and it falls back
to the raw helper for a `NodeUiLike` that has no resolver.

**Cross-graph refresh.** The subscriptions above only see *one* graph. Collection-scoped sources
read the whole collection, so `_bindCollection()` additionally subscribes to `node-added` /
`node-updated` / `node-removed` of every other graph returned by `Collection.getGraphArray()`
(`_subscribeForeignGraphs()` / `_subscribeGraphNodes()`), and re-subscribes when the graph set
changes (`Collection.GraphAdded.v1` / `GraphRemoved.v1`, handled in `_onCollectionEvent()`).
Without it a graph tab that was rendered earlier kept the option list it resolved back then, so a
variable created in graph A never appeared in the pickers of graph B. The work is only done for
nodes with a cross-node source (`_hasCrossNodeControl()`), `setGraph()` rebinds the set when the
node moves, and `destroy()` tears every subscription down.

**Collection-scoped option lists.** `_resolveDynamicControlData()` passes `this.graph` *and*
`this._collectionSource()` (the workspace's active collection) to
`resolveDynamicControl()`. Sources that list things other nodes define (`graphTopics`,
`availabilityRefs`, `varStores` / `varNames`, `signalNames`) prefer the collection, so an
availability flag in another graph of the same collection still appears in the entity's dropdown,
a namespace created anywhere in the collection appears in the store picker, and a signal posted in
another graph appears in the `signal-post` picker. `availability-flags.ts` holds the availability
collector and the id sanitisation that mirrors the `hass` runtime; `var-stores.ts` (next to
`graph-topics.ts`) holds `collectVarStores()` / `collectVarNames()`, the `varStores` / `varNames`
source names and the `__new__` sentinel contract for the `vars` pickers; `signal-names.ts` holds
`collectSignalNames()` and the `signalNames` source name.

**Variable consistency.** A variable exists only while exactly one `var-read` / `var-write`
declares it, so the pickers and every referencing node must stay in agreement.
`var-consistency.ts` provides the pure rules — `declaredVarEntries()`, `danglingVarReferences()`
and `varReferencePatchesForChange()` (rename detection from the `node-updated` `previous`
snapshot) — plus a `VarReferenceReconciler` that walks every graph and applies the patches through
each owning graph's `updateNode`. `Collection` owns one reconciler (`reconcileVarReferences()`)
and calls it from its active-graph bridge on `node-updated` / `node-removed`; `CollectionManager`
runs the repair pass once after a collection is loaded. Re-entrant `node-updated` events are
guarded by a `reconciling` flag and the pass is idempotent, so it converges without a loop.

**Interrupt consistency.** The same shape keeps interrupt names coherent. `irq-triggers.ts` holds
`collectIrqTriggerNames()` / `collectIrqTriggerEntries()` (the `irqTriggerNames` dropdown source, one
entry per declaring `interrupt-input`, first declaration wins) and `irq-consistency.ts` mirrors
`var-consistency.ts`: `declaredIrqEntries()`, `danglingIrqReferences()`,
`irqReferencePatchesForChange()` and an `IrqReferenceReconciler` owned by `Collection`
(`reconcileIrqReferences()`). A reference is an `interrupt-enable` node's `triggerName` **or** a
graph's `triggerName`; a rename rewrites every reference that matched the old name (node rewrites via
`updateNode()`, graph rewrites via `setTriggerName()`), and a repair pass clears every reference no
declaration covers. `CollectionManager` runs the repair pass once after a collection is loaded.
Duplicate declarations are left untouched — the `irq-name-duplicate` graph rule badges them.
- Canvas painting: `drawHighlightPill()` — the only code that paints the connector highlight
  pill (dark `CONNECTOR_HIGHLIGHT_LABEL_BACKGROUND_COLOR` fill with a data-type-coloured
  border); shared by the connector-label path and the input default-control path
- Control layout: `computeControlColumnLayout()`, `computeControlsMinWidth()`,
  `getControlsConnectorGap()`

**Key updates (Phase 2)**:

- `calculateNodeHeight()` now uses `control.getLayout()` instead of hard-coded values
- Supports every control type (`number`, `text`, `dropdown`, `multi-dropdown`, `checkbox`,
  `slider`, `color`, `icon`) with proper height calculation

### 4. **node-ui-hit-testing.ts** - ~160 lines

All hit testing logic:

- `hitTestNode()` - Body hit detection
- `hitTestConnector()` - Connector hit detection
- `hitTestHeader()` - Header element detection (name, collapse, drag)
- `hitTestControl()` - Delegates to control instances via `control.hitTest()`

**Key updates (Phase 2)**:

- `hitTestControl()` now delegates to individual control instances
- Removes type switching logic; uses polymorphism
- Computes `computeControlColumnLayout()` from the same inputs as the render path (visible controls +
  locale) and passes `labelWidth` into `getControlGeometry()`, so `ControlHitResult.bounds` is
  exactly the drawn value rectangle
- Takes the row list from `NodeUi._getVisibleControls()` (`visibleControlsOf()`), not from
  `getVisibleControls(nodeData)`: a dynamic picker's `activeControls` only exist after resolution,
  so the raw list would hit the rows below it one slot off. The same list feeds the control
  section height that positions the input-default rows

### 5. **node-ui-rendering.ts** - ~350 lines

All canvas rendering code:

- `drawNode()` - Main rendering orchestration
- `drawCollapseIndicator()` - Chevron drawing
- `drawControls()` - Delegates to control.renderCanvas()
- `drawControlsConnectorSeparator()` - Hairline between controls and connector rows
- `drawConnectors()` - Connector shapes and labels
- `drawConnectorLabel()` - Connector label text plus its optional highlight backdrop
- `computeConnectorPositions()` - Connector position calculations
- Helper: `isConnectorCompatible()` - Connection compatibility checking

`drawNode()` accepts a `relatedHighlight` option (via `NodeUi.setRelatedHighlight`) that draws a
blue ring and halo around nodes connected to the current selection. The ring and body outline use
`RELATED_NODE_BORDER_COLOR`, the halo uses `RELATED_NODE_GLOW_COLOR`, and the selected node itself
keeps its `selectedBorderColor` glow plus its normal body fill. Related nodes additionally blend
their own body fill toward white (`brightenColor()` with `RELATED_NODE_BODY_BRIGHTEN`), so the
neighbour highlight reads on the node surface as well as on the ring.

**Connector drag highlight contract**:

- While a connection is dragged, connectors of the opposite kind that `graph.canConnect()` accepts
  are highlighted; hovering a connector uses the same styling.
- Input sockets and output plugs share one treatment: the stroke scales by
  `CONNECTOR_HIGHLIGHT_STROKE_SCALE` (2 → 3 px for sockets, 4 → 6 px for plugs) and the fill uses
  `CONNECTOR_HIGHLIGHT_FILL_ALPHA`, so an allowed target looks the same on both sides.
- A highlighted connector's label is drawn by `drawConnectorLabel()` on a dark
  `CONNECTOR_HIGHLIGHT_LABEL_BACKGROUND_COLOR` pill. The pill's border uses the connector's
  data-type colour and the text keeps the node's `textColor`: light types such as `any`
  (`#e3e3e3`) must never be used as text colour, because they become invisible on a light node
  body.
- `drawHighlightPill()` (`node-ui-helpers.ts`) is the only code that paints that pill; both the
  connector-label path and the input default-control path call it, so the two cannot drift apart.
- An allowed input whose label is rendered by a `defaultControl` gets the same pill:
  `drawConnectors()` asks the control for `getCanvasLabelBounds(ctx, layout)`, expands the returned
  text rect by `CONNECTOR_HIGHLIGHT_LABEL_PADDING_X`, clamps it to the control width, and calls
  `drawHighlightPill()` *before* `renderCanvas()`, so the control's own label text stays on top.
  The call is optional (`getCanvasLabelBounds?.()`): a control that does not implement it — or that
  reports `null`/a zero-width rect — highlights only its socket. Panel controls
  (`controlInstances`) are not connector targets and never highlight.

**Node header title contract**:

- Header text is resolved at draw-time (not persisted as flattened locale text).
- Rendering uses canonical resolver logic:
    - `userName[currentLocale]` when present and non-empty
    - otherwise localized `typeName`
    - otherwise node `type`
- Locale switches update titles on next render without mutating node data.
- The title is centred inside the free span between the type icon and the collapse chevron and is
  ellipsised with `fitTextToWidth()` when it does not fit (see _Header title clearance_ below).

**Node header icon contract**:

- `NodeUi._loadIcon()` classifies the resolved icon (the runtime node-type icon, else `data.icon`)
  with `IconProvider.describeIcon(value)`. That classifier runs the `mdi:` check **before** any
  image check because `isImageSource()` matches `mdi:` as a generic URI scheme; MDI glyphs are font
  glyphs, not images. A foreign icon set (`ph:`, `hue:`) is classified as `text`, never as an image
  URL.
- `drawNode()` takes a `{ image, mdiGlyph }` descriptor instead of a bare image: it draws the loaded
  image, else the resolved MDI glyph with `MDI_CANVAS_FONT` centred in the icon box, else the
  existing placeholder square. `mdi:` values load asynchronously (index fetch + webfont) and repaint
  through `NodeUi.requestRepaint()`, mirroring the icon control's glyph path.

**Key updates (Phase 2)**:

- `drawControls()` simplified to call `control.renderCanvas(ctx, layout)` for each control
- Removed manual label rendering and type-switching dispatch
- `drawControls()` computes `computeControlColumnLayout()` once per node and passes `labelWidth` to
  every control, matching `hitTestControl()` exactly

### 6. **controls/** - Control classes directory

**Files** (Phase 2 completion):

- **node-control-ui.ts** - Abstract base class with lifecycle hooks
    - `getValue()`: Returns current control value
    - `setValue(value)`: Updates control value
    - `getLayout()`: Returns layout dimensions `{ x, y, width, height }`
    - `renderCanvas(ctx, layout)`: Canvas rendering
    - `getCanvasLabelBounds(ctx, layout)`: Rectangle of the label this control draws (text rect,
      no pill padding), or `null` when nothing is drawn. Derived from the same
      `_resolveCanvasLabelMetrics()` as `_renderLabelAndGetValueLayout()`, so the reported
      rectangle and the drawn text cannot drift apart. The node renderer uses it to highlight an
      input's default control while a connector is dragged, without knowing any control type.
    - `renderDOM(container)`: DOM rendering for editors (creates wrapper with label and background)
    - `_renderDOMControl()`: Abstract method for subclasses to create specific input element
    - `hitTest(point)`: Hit detection for this control

- **number-control-ui.ts** - Number input with min/max/step constraints
- **slider-control-ui.ts** - Range slider with live value display
- **text-control-ui.ts** - Text input field
- **dropdown-control-ui.ts** - Custom dropdown widget (trigger button + scrollable popup menu) with i18n
  option labels and a configurable `maxVisibleItems` cap (default `8`). Also serves the
  `multi-dropdown` control type: a `string[]` value rendered as tick-mark rows
  (`.node-control-ui__dropdown-option-tick`) that toggle without closing the editor
  (`closeOnChange = false`), with `_toggleOption()` + `_refreshMenuSelection()` keeping the
  ticks and the trigger label in sync.
- **checkbox-control-ui.ts** - Checkbox toggle
- **color-control-ui.ts** - Color picker with alpha channel
- **icon-control-ui.ts** - Extends `TextControlUi` for the `icon` control type: the editor is the
  text input (free text always accepted) plus an anchored popover with a searchable MDI grid
  (`.icon-control__popover`, `.icon-control__grid`, `.icon-control__tile`), a match-count footer,
  a Clear action and a soft "not in bundled MDI 7.4.47" hint. The popover, grid, tiles and footer
  are `MdiIconPickerControl` mounted in host-field mode (`_mountPicker()` passes the field via
  `render(wrapper, { input })`); `IconControlUi` keeps the value plumbing and only funnels
  `onChange` → `_applyValue()` and `onDismiss` → `_handlePickerDismiss()`.
  The empty field carries the
  `controls.iconPicker.hint` placeholder, so the search is discoverable before the popover opens.
  Every picker string is read through `_translate()` (`controls.iconPicker.{hint,loading,
  unavailable,noMatches,count,clear,unknown}`); the fallback renders the key itself, so a missing
  locale entry is visible instead of silently English.
  The popover stays **inside** the
  editor wrapper (never a body portal) because `NodeUi.showControlEditor()` hides the editor on
  capture-phase outside mousedowns; picking a tile keeps the editor open (`closeOnChange = false`),
  while `Enter` accepts the typed string and closes the editor — unless the arrow keys were used
  to browse a grid with alternatives, where it takes that tile instead (and closes as well).
  `getLayout()` is inherited unchanged, so node metrics match `text`; the canvas draws the glyph
  of a resolvable value in a column reserved at the left of the value box
  (`TextControlUi._canvasValueLeadingWidth()` / `_drawCanvasValueLeading()` hooks). The glyph needs
  the lazy index *and* the vendored webfont, so `renderCanvas()` kicks both and calls
  `NodeUi.requestRepaint()` (wired to `onRepaintRequest` by the graph panel) when either arrives;
  free text, foreign sets, a missing `FontFaceSet` or a failed font also fall back to the plain
  text box.

**Key features (Phase 2)**:

- Every control type has complete canvas rendering
- All control types have DOM editor rendering via `renderDOM()` (unified pattern)
- Controls handle their own layout calculations
- Controls are polymorphic: no type-switching needed

## Import Structure

```
node-ui.ts
    ├─ imports node-ui-constants.ts
    ├─ imports node-ui-helpers.ts
    ├─ imports node-ui-hit-testing.ts
    ├─ imports node-ui-rendering.ts
    └─ imports controls/*.ts (NumberControlUi, DropdownControlUi, etc.)

node-ui-rendering.ts
    ├─ imports node-ui-constants.ts
    └─ imports node-ui-helpers.ts

node-ui-hit-testing.ts
    ├─ imports node-ui-constants.ts
    └─ imports node-ui-helpers.ts

node-ui-helpers.ts
    └─ imports node-ui-constants.ts

controls/node-control-ui.ts
  └─ (base class, no dependencies)

controls/*.ts (specific control types)
    └─ imports controls/node-control-ui.ts
```

## Benefits of Modular Architecture

### 1. **Improved Maintainability**

- Each module has a single, clear responsibility
- Easier to locate and modify specific functionality
- Control classes eliminate code duplication (editor functions now in control methods)
- Reduced cognitive load when working on features

### 2. **Better Testability**

- Pure functions in helpers/rendering/hit-testing can be unit tested independently
- Control classes can be tested in isolation
- No need to instantiate full NodeUi class to test individual controls
- Easier to mock dependencies and data

### 3. **Polymorphic Design (Phase 2)**

- All control types implement common interface (getValue, setValue, renderCanvas, hitTest)
- No type-switching logic needed (no switch/case statements)
- Adding new control type only requires one file in controls/
- Simplifies NodeUi orchestration logic

### 4. **Code Reusability**

- Helper functions can be used by other components
- Control classes encapsulate logic that was previously scattered
- Rendering logic and editor creation unified in control classes
- Hit testing logic could be shared with other UI elements

### 5. **Clearer Architecture**

- Separation of concerns is explicit
- Data flow is obvious (NodeUi → controls → canvas/editors)
- Dependencies are clearly defined through imports
- Phase 2 refactoring eliminated implicit dependencies

### 6. **Easier Onboarding**

- New developers can understand one module at a time
- Clear module names indicate what each file contains
- Control classes show how to implement a new control type
- Documentation provides navigation guide

### 7. **Future-Proof**

- Easy to add new control types (single file in controls/)
- Easy to add alternative renderers (e.g., WebGL)
- Easy to create theme system by extracting constants
- Easy to add custom editors without modifying core logic

## Control Value Management Architecture

### Single Source of Truth

The control architecture implements a **single source of truth** pattern for all control values, ensuring data consistency across rendering, serialization, and external updates.

**Key Principle**: `NodeData.controlValues` is the **authoritative source** for all control state.

### Architecture Components

#### 1. **Control Definitions** (`NodeData.controls`)

- **Purpose**: Immutable metadata describing control structure
- **Contains**: Type, label, constraints, default values, options
- **Never Contains**: Current state/values (remains pure definition)

#### 2. **Control Values** (`NodeData.controlValues`)

- **Purpose**: Single source of truth for all control state
- **Contains**: Current values keyed by control ID
- **Serialized**: Always persisted to storage
- **Reactive**: Changes automatically reflect in canvas rendering

#### 3. **Control Instances** (`NodeControlUi` subclasses)

- **Purpose**: UI representation and interaction handling
- **References**: Stores `nodeData` reference (not copies of values)
- **Reads**: Via `getValue()` from `nodeData.controlValues[controlId]`
- **Writes**: Via `setValue()` and `_notifyChange()` to `nodeData.controlValues[controlId]`

### Data Flow

```
User Interaction (DOM Editor)
    ↓
Control._notifyChange(newValue)
    ↓
NodeData.controlValues[id] = newValue  ← SINGLE SOURCE OF TRUTH
    ↓
NodeUi.onControlChanged(id, value)
    ↓
NodeGraph.updateNode(...)  ← Persistence/Events
    ↓
Canvas Render ← getValue() reads from NodeData.controlValues
```

### Implementation Details

#### Control Construction

```ts
// Pass NodeData reference (source of truth)
const instance = new ControlClass(
    controlData, // Definition (immutable)
    nodeData, // Source of truth for values
    nodeUi, // Parent context
    options // i18n, logger, etc.
);
```

#### Reading Values

```ts
getValue() {
    const value = this.nodeData.controlValues[this.controlData.id];
    return value !== undefined ? value : this.controlData.default;
}
// Always reads from NodeData.controlValues
// Falls back to default from definition if undefined
```

#### Writing Values

```ts
setValue(value) {
    // Update source of truth
    this.nodeData.controlValues[this.controlData.id] = value;

    // Update DOM if editor is open
    if (this.inputElement) {
        this._updateDOMInputValue(value);
    }
}

_notifyChange(newValue) {
    // Update source of truth
    this.nodeData.controlValues[this.controlData.id] = newValue;

    // Notify NodeUi for graph propagation
    if (this.nodeUi && typeof this.nodeUi.onControlChanged === 'function') {
        this.nodeUi.onControlChanged(this.controlData.id, newValue);
    }
}
```

### Benefits of This Architecture

✅ **Automatic Synchronization**: External updates to `NodeData.controlValues` immediately reflect in control renders  
✅ **Correct Serialization**: Always saves current values from the source of truth  
✅ **Clean Separation**: Definitions (`controls`) vs. State (`controlValues`)  
✅ **Reactive Updates**: Canvas re-renders automatically show current values  
✅ **Predictable Data Flow**: Single direction - no dual sources of truth  
✅ **External Update Support**: Any code can modify `NodeData.controlValues` and changes propagate automatically

### Example: External Updates

```ts
// External code updates NodeData directly
nodeData.controlValues.myControl = 42;

// Next canvas render automatically shows 42 because:
// control.getValue() → nodeData.controlValues.myControl → 42 ✓

// No manual synchronization needed!
```

### Anti-Pattern: What We Avoid

❌ **Don't Pollute Definitions**:

```ts
// WRONG - storing state in definition
controlData.value = newValue; // Pollutes immutable definition!
```

❌ **Don't Create Dual Sources**:

```ts
// WRONG - values in two places
this.localValue = newValue;
nodeData.controlValues[id] = newValue; // Which one is correct?
```

✅ **Correct - Single Source**:

```ts
// RIGHT - only one place for state
nodeData.controlValues[id] = newValue; // Always consistent!
```

### Serialization Flow

When a workspace is saved:

1. `NodeData.serialize()` captures `controlValues` object
2. `NodeGraph.serialize()` includes all node data
3. `Collection.serialize()` persists to IndexedDB

When a workspace is loaded:

1. `Collection.deserialize()` restores node data
2. `NodeData` constructor populates `controlValues`
3. Control instances created with `nodeData` reference
4. `getValue()` reads from restored `controlValues` ✓

## Editor Lifecycle Management

### Overview

Control editors are managed by NodeUi through a unified lifecycle pattern using `renderDOM()`. The editor system ensures proper cleanup on user interaction and click-away events.

### Node Name Editor (Locale-Specific)

The node-name editor follows the same lifecycle as control editors, but writes to the naming model instead of mutating a single title string.

Name editing rules:

- Editor default value reads `userName[currentLocale]`.
- Confirming a non-empty value updates only `userName[currentLocale]`.
- Clearing the value removes only `userName[currentLocale]`.
- Display then falls back to localized `typeName` for that locale.

Propagation path:

```text
Name editor change
    → NodeGraph.updateNode({ userNameByLocale: { locale, value } })
    → NodeData.setUserNameForLocale(locale, value)
    → NodeGraph emits node-updated
    → GraphPanelView re-renders (title resolved at draw-time)
```

### Editor Display Flow

```
User clicks control on canvas
  ↓
NodeUi.handleClick() detects control hit
  ↓
NodeUi.showControlEditor(controlId, ...)
  ↓
1. Call hideEditor() to clean up any existing editor
2. Get control instance from controlInstances Map
3. Call controlUi.renderDOM() to create editor element
4. Position editor at click location (absolute positioning)
5. Append editor to document.body
6. Focus input element
7. Attach click-away handler to document
  ↓
Editor visible and interactive
```

### Editor Cleanup Flow

**On User Interaction (e.g., dropdown selection, Enter key):**

```
User changes value in DOM editor
  ↓
Control's event handler fires (change/input)
  ↓
Control._notifyChange(newValue)
  ↓
1. Update nodeData.controlValues[id] = newValue
2. Call nodeUi.onControlChanged(controlId, newValue)
  ↓
NodeUi.onControlChanged()
  ↓
1. Call _updateControlValue() to propagate to graph
2. Call hideEditor() to remove editor from DOM
  ↓
Editor removed, click handler cleaned up
```

**On Click-Away:**

```
User clicks outside editor
  ↓
Click-away handler detects click outside editor element
  ↓
NodeUi.hideEditor()
  ↓
1. Remove editor from DOM (editor.remove())
2. Clear _activeEditor reference
3. Remove click-away listener from document
4. Clear _activeEditorClickHandler reference
  ↓
Editor removed, resources cleaned up
```

### Key Methods

#### NodeUi.showControlEditor()

```ts
showControlEditor(controlId, canvasPoint, canvasElement, viewport, bounds) {
    // 1. Clean up existing editor
    this.hideEditor();

    // 2. Get control instance
    const controlUi = this.controlInstances.get(controlId);

    // 3. Create editor via renderDOM()
    const editor = controlUi.renderDOM();

    // 4. Position and attach
    editor.style.position = 'absolute';
    editor.style.left = `${screenPoint.x}px`;
    editor.style.top = `${screenPoint.y}px`;
    editor.style.zIndex = '1000';
    document.body.appendChild(editor);

    // 5. Focus input
    controlUi.inputElement?.focus();

    // 6. Attach click-away handler
    const clickAwayHandler = (event) => {
        if (!editor.contains(event.target)) {
            this.hideEditor();
        }
    };
    document.addEventListener('mousedown', clickAwayHandler, true);
    this._activeEditorClickHandler = clickAwayHandler;
}
```

#### NodeUi.hideEditor()

```ts
hideEditor() {
    // Remove editor from DOM
    if (this._activeEditor) {
        this._activeEditor.remove();
        this._activeEditor = null;
    }

    // Remove click-away handler
    if (this._activeEditorClickHandler) {
        document.removeEventListener('mousedown', this._activeEditorClickHandler, true);
        this._activeEditorClickHandler = null;
    }
}
```

#### NodeUi.onControlChanged()

```ts
onControlChanged(controlId, newValue) {
    // Propagate to graph for persistence/events
    this._updateControlValue(controlId, newValue);

    // Hide editor (removes from DOM and cleans up handler)
    this.hideEditor();
}
```

### Control Integration

Controls integrate with the editor lifecycle through their `renderDOM()` method:

```ts
// In NumberControlUi (example)
_renderDOMControl() {
    const control = document.createElement('input');
    control.type = 'number';
    control.value = this.getValue();

    // Attach event handlers that trigger cleanup
    control.addEventListener('change', (e) => {
        const value = parseFloat(e.target.value);
        this._notifyChange(value); // → Triggers hideEditor()
    });

    control.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const value = parseFloat(e.target.value);
            this._notifyChange(value); // → Triggers hideEditor()
        }
    });

    this.inputElement = control;
    return control;
}
```

### Design Decisions

**Why renderDOM() with wrapper + \_renderDOMControl() pattern?**

- **Separation of Concerns**: Base class handles wrapper/label/background, subclass creates input
- **Consistency**: All controls use the same pattern (renderCanvas + renderDOM)
- **Simplicity**: Single method call creates complete editor with proper styling
- **Lifecycle**: NodeUi manages positioning and cleanup; controls manage content and behavior

**Why hideEditor() in onControlChanged()?**

- **Immediate Feedback**: Editor disappears as soon as value changes
- **Clean State**: No lingering editors when navigating between controls
- **Consistent Behavior**: Same cleanup for user interaction and click-away

**Why Click-Away on Document?**

- **Global Coverage**: Catches clicks anywhere outside the editor
- **Clean Scope**: Handler attached/removed with editor lifecycle
- **Performance**: Single handler for one editor at a time

### Testing This Architecture

```ts
// Create a node with controls
const nodeData = new NodeData({
    id: 'test',
    controls: [{ id: 'value', type: 'number', default: 10 }],
    controlValues: { value: 42 },
});

// Create control instance
const control = new NumberControlUi(
    nodeData.controls[0], // Definition
    nodeData, // Source of truth
    nodeUi,
    options
);

// Verify reading
expect(control.getValue()).toBe(42); // From controlValues

// Verify writing
control.setValue(100);
expect(nodeData.controlValues.value).toBe(100); // Updated source

// Verify external updates
nodeData.controlValues.value = 200;
expect(control.getValue()).toBe(200); // Automatically reflects ✓
```

## Connector Identity vs Visible Row

Connector entries carry two separate numbers:

- **`index`** — the connector's original position in the node's full `inputs`/`outputs` list. This is the connector _identity_ used for wiring (`fromIndex`/`toIndex`), connection validation, and code generation.
- **`row`** — the connector's position in the currently visible connector list. This is only used for layout (vertical spacing, aligning an input row with its opposing output row).

This separation matters because dropdown-driven visibility (`affectsInputs`/`affectsOutputs` + `activeInputs`/`activeOutputs`) can hide arbitrary connectors, not just a trailing suffix. The index-aware helpers `getVisibleInputEntries()` / `getVisibleOutputEntries()` return `{ entry, index }` for the visible subset while preserving each connector's full-list index, and `computeConnectorPositions()` emits both `index` and `row` per entry. Consequently, `activeInputs`/`activeOutputs` are **not** restricted to prefix subsets of the full connector list.

## Input Default Controls Architecture

### Overview

Input default controls are a specialized feature that renders scaled-down controls directly next to disconnected input connectors. This provides visual inline editing for input values when no connection is present, automatically hiding when the input is connected.

**Visual Behavior**:

- **Disconnected + has defaultControl**: Shows control widget (scaled to 75%) next to connector
- **Connected OR no defaultControl**: Shows standard label text
- **Collapsed node**: No labels or controls shown

### Data Flow Architecture

```
NodeType.inputs[].defaultControl (NodeControlBase instance)
    ↓ (copied during node creation)
NodeData.inputs[].defaultControl (NodeControlBase instance)
    ↓ (accessed by NodeUi)
NodeUi.inputDefaultControlInstances Map<inputId, NodeControlUi>
    ↓ (rendered on canvas)
Canvas: Scaled control rendering next to input connector
```

### Key Components

#### 1. **NodeType Input Definition (node-type.ts)**

NodeType enriches input definitions during construction:

```ts
#normalizeInput(input = {}) {
    const normalized = this.#cloneIO(input);
    if (normalized.defaultControl) {
        // Convert plain object to NodeControlBase instance
        normalized.defaultControl = this.#createControl(normalized.defaultControl);
    }
    return normalized;
}
```

**Input with defaultControl**:

```ts
{
    id: 'in0',
    name: 'Value',
    defaultControl: NodeControlNumber {  // NodeControlBase instance
        id: 'in0',
        type: 'number',
        label: 'Value',
        defaultValue: 42,
        min: 0,
        max: 100
    }
}
```

#### 2. **NodeData Input Enrichment (node-data.ts)**

NodeData constructor enriches inputs, converting plain defaultControl objects to NodeControlBase instances:

```ts
constructor(payload = {}) {
    // Enrich inputs: convert plain defaultControl objects to NodeControlBase instances
    this.inputs = Array.isArray(payload.inputs)
        ? payload.inputs.map((inp) => this.#enrichInput(inp))
        : [];
}

#enrichInput(input) {
    if (!input || typeof input !== 'object') {
        return input;
    }

    const enriched = { ...input };

    // If defaultControl exists and is NOT already a NodeControlBase instance
    if (enriched.defaultControl && !(enriched.defaultControl instanceof NodeControlBase)) {
        const controlDef = enriched.defaultControl;
        const ControlClass = CONTROL_CLASS_BY_TYPE[controlDef.type] ?? NodeControlBase;
        enriched.defaultControl = new ControlClass(controlDef);
    }

    return enriched;
}
```

**Benefits**:

- Works for nodes created from palette (NodeType → NodeData)
- Works for nodes loaded from storage (plain object → NodeData)
- Automatic conversion ensures consistency

#### 3. **Serialization and Deserialization**

When saving/loading:

```ts
toData() {
    return {
        inputs: this.inputs.map((inp) => this.#serializeInput(inp)),
        // ... other properties
    };
}

#serializeInput(input) {
    const serialized = { ...input };

    // Convert NodeControlBase instance to plain object for storage
    if (serialized.defaultControl instanceof NodeControlBase) {
        serialized.defaultControl = serialized.defaultControl.getDefinition();
    }

    return serialized;
}
```

**Flow**:

1. **Save**: NodeControlBase instances → plain objects (JSON-compatible)
2. **Load**: Plain objects → NodeControlBase instances (via #enrichInput)

#### 4. **NodeUi Control Instance Management (node-ui.ts)**

NodeUi creates a separate Map for input default control UI instances:

```ts
constructor(graph, nodeId, options = {}) {
    // ... existing setup

    // Map for input default control UI instances (separate from node panel controls)
    this.inputDefaultControlInstances = new Map();

    // Initialize after node data is available
    this._initializeInputDefaultControls();
}

_initializeInputDefaultControls() {
    this.inputDefaultControlInstances.clear();

    const nodeData = this.graph.getNode(this.nodeId);
    if (!nodeData || !Array.isArray(nodeData.inputs)) return;

    for (const input of nodeData.inputs) {
        if (!input.defaultControl) continue;

        // Extract control definition from NodeControlBase instance
        const controlDef = input.defaultControl.getDefinition();

        // Create wrapper that links input value to controlValues
        const wrappedDef = { ...controlDef };

        // Create control UI instance
        const ControlClass = this._getControlClassForType(controlDef.type);
        const controlUi = new ControlClass(wrappedDef, nodeData, this, {
            i18nService: this._i18nService,
            logger: this._logger
        });

        this.inputDefaultControlInstances.set(input.id, controlUi);
    }
}
```

**Key Design**:

- Separate Map from `controlInstances` (panel controls)
- Uses existing control UI classes (NumberControlUi, etc.)
- Each input default control reads/writes to its own value storage

#### 5. **Rendering (node-ui-rendering.ts)**

Input rendering logic checks connection state and renders accordingly:

```ts
if (kind === 'input') {
    // Check if this input is connected
    let isConnected = false;
    if (nodeUi && nodeUi.graph && entry.inputData) {
        isConnected = isInputConnected(data.id, entry.index, nodeUi.graph);
    }

    if (!isCollapsed) {
        ctx.fillStyle = style.textColor;
        ctx.textAlign = 'left';
        const label = entry.label || entry.id || '';

        // Draw default control for disconnected inputs, or label for connected inputs
        if (nodeUi && nodeUi.graph && entry.inputData) {
            if (!isConnected && entry.inputData.defaultControl) {
                // Disconnected with default control: draw control
                const controlUi = nodeUi.inputDefaultControlInstances.get(entry.inputData.id);
                if (controlUi) {
                    ctx.save();
                    // Scale down font for smaller rendering (75%)
                    ctx.scale(INPUT_DEFAULT_CONTROL_FONT_SCALE, INPUT_DEFAULT_CONTROL_FONT_SCALE);

                    // Position directly to the right of the connector
                    const controlX =
                        (entry.x + CONNECTOR_LABEL_OFFSET) / INPUT_DEFAULT_CONTROL_FONT_SCALE;
                    const controlY = entry.y / INPUT_DEFAULT_CONTROL_FONT_SCALE;
                    const controlWidth = 80;
                    const controlHeight = CONTROL_HEIGHT;

                    controlUi.renderCanvas(ctx, {
                        x: controlX,
                        y: controlY - controlHeight / 2,
                        width: controlWidth,
                        height: controlHeight,
                    });
                    ctx.restore();
                }
            } else {
                // Connected OR no default control: draw label
                ctx.fillText(label, entry.x + CONNECTOR_LABEL_OFFSET, entry.y);
            }
        }
    }
}
```

**Layout**:

- `INPUT_DEFAULT_CONTROL_FONT_SCALE = 0.75` (75% size)
- Positioned at `entry.x + CONNECTOR_LABEL_OFFSET` (directly after connector)
- Uses same rendering as panel controls, just scaled

#### 6. **Hit Testing (node-ui-hit-testing.ts)**

Hit testing checks for clicks on input default controls:

```ts
// Check input default controls (rendered next to disconnected input labels)
if (!data.collapsed && nodeUi.graph && nodeUi.inputDefaultControlInstances) {
    const visibleInputs = getVisibleInputs(data);

    for (let i = 0; i < visibleInputs.length; i++) {
        const input = visibleInputs[i];
        if (!input.defaultControl) continue;

        const isConnected = isInputConnected(data.id, i, nodeUi.graph);
        if (isConnected) continue;

        const controlUi = nodeUi.inputDefaultControlInstances.get(input.id);
        if (!controlUi) continue;

        // Calculate bounds with font scaling
        const inputY = baseY + i * CONNECTOR_SPACING;
        const baseX = data.x - 5;
        const controlX = baseX + CONNECTOR_LABEL_OFFSET;
        const controlWidth = 80 * INPUT_DEFAULT_CONTROL_FONT_SCALE;
        const controlHeight = CONTROL_HEIGHT * INPUT_DEFAULT_CONTROL_FONT_SCALE;

        const controlBounds = {
            x: controlX,
            y: inputY - controlHeight / 2,
            width: controlWidth,
            height: controlHeight,
        };

        if (pointInRect(point, controlBounds)) {
            const localPoint = {
                x: (point.x - controlBounds.x) / INPUT_DEFAULT_CONTROL_FONT_SCALE,
                y: (point.y - controlBounds.y) / INPUT_DEFAULT_CONTROL_FONT_SCALE,
            };

            return {
                type: 'input-default-control',
                controlId: input.id,
                inputIndex: i,
                localPoint,
            };
        }
    }
}
```

**Returns**: `{ type: 'input-default-control', controlId, inputIndex, localPoint }`

#### 7. **Editor Interaction (node-ui.ts)**

When user clicks an input default control:

```ts
handleClick(event, canvas, viewport) {
    const hit = this.hitTest(point, viewport);

    if (hit.type === 'input-default-control') {
        // Show editor for input default control
        this.showControlEditor(
            hit.controlId,
            { x: event.clientX, y: event.clientY },
            canvas,
            viewport,
            this.getBounds(viewport)
        );
        return true;
    }
}
```

**Editor flow** (same as panel controls):

1. Click detected → `showControlEditor()` called
2. Control UI's `renderDOM()` creates editor overlay
3. User edits value → `_notifyChange()` updates NodeData
4. Editor hidden automatically → canvas re-renders with new value

### Value Storage Strategy

Input default controls store their values in a **separate location** from node panel controls:

- **Panel controls**: `NodeData.controlValues[controlId]`
- **Input default controls**: Currently stored in control definition itself (may evolve)

**Rationale**:

- Input default controls are ephemeral (only visible when disconnected)
- Values represent "default" or "fallback" when no connection exists
- Separate storage avoids namespace conflicts with panel controls

### Constants and Layout

```ts
// node-ui-constants.ts
export const CONNECTOR_SPACING = 21; // Row pitch: CONTROL_HEIGHT (18) + 3 px gap
export const CONNECTOR_LABEL_OFFSET = 14; // Connector anchor → label / control start
export const CONNECTOR_OVERLAP = 2; // How far a connector sticks out of the node border
export const CONNECTOR_ROW_INSET = 16; // CONNECTOR_OVERLAP + CONNECTOR_LABEL_OFFSET
export const NODE_BODY_PADDING = 6; // Inner padding of the node body
export const CONNECTOR_ROW_RESERVED_GAP = 6; // Control end → opposing output label start
export const CONTROLS_CONNECTOR_GAP = 12; // Controls section → first connector row
export const INPUT_DEFAULT_CONTROL_MIN_WIDTH = 64; // Smallest operable control width
export const INPUT_DEFAULT_CONTROL_FONT_SCALE = 1; // Render controls at panel size
export const CONNECTOR_LABEL_FONT = '11px "Segoe UI", Arial, sans-serif'; // Draw + measure
export const INPUT_CONNECTOR_STROKE_WIDTH = 2; // Input socket, unhighlighted
export const OUTPUT_CONNECTOR_STROKE_WIDTH = 4; // Output plug, unhighlighted
export const CONNECTOR_HIGHLIGHT_STROKE_SCALE = 1.5; // Shared stroke boost (socket → 3, plug → 6)
export const CONNECTOR_HIGHLIGHT_FILL_ALPHA = 0.45; // Shared fill opacity while highlighted
export const CONNECTOR_HIGHLIGHT_LABEL_BACKGROUND_COLOR = 'rgba(31, 41, 55, 0.95)'; // Label pill
export const CONNECTOR_HIGHLIGHT_LABEL_BORDER_WIDTH = 1; // Pill border (data-type colour)
export const CONNECTOR_HIGHLIGHT_LABEL_PADDING_X = 4;
export const CONNECTOR_HIGHLIGHT_LABEL_HEIGHT = 16;
export const CONNECTOR_HIGHLIGHT_LABEL_RADIUS = 4;
export const OUTPUT_LABEL_CHAR_WIDTH_ESTIMATE = 7; // Per-character fallback (no canvas)
export const OUTPUT_LABEL_RESERVED_WIDTH = 84; // Fallback reservation only (see below)
export const CONTROL_LABEL_FONT = '500 11px system-ui, …'; // Draw + measure control labels
export const CONTROL_LABEL_CHAR_WIDTH_ESTIMATE = 7; // Per-character fallback (no canvas)
export const CONTROL_LABEL_MARGIN = 4; // Label column → value column
export const CONTROL_VALUE_MIN_WIDTH = 80; // Default value-column floor
export const CONTROL_VALUE_MIN_WIDTH_BY_TYPE = Object.freeze({
    number: 80,
    dropdown: 96,
    text: 96,
    checkbox: 24,
    color: 40,
    slider: 120,
});
export const NODE_HEADER_ICON_SIZE = 16;
export const NODE_HEADER_ICON_INSET = 6;
export const NODE_HEADER_TITLE_PADDING = 4;
export const CONTROL_SEPARATOR_COLOR = 'rgba(255, 255, 255, 0.18)';
export const CONTROL_SEPARATOR_THICKNESS = 1;
export const CONTROL_SEPARATOR_MIN_WIDTH = 8;
```

**Value floors**: the table above lists _floors for the value column_, not preferred widths.
`getLayout().width` (24 for checkbox, 180 for color, 200 for slider, …) is intentionally **not** used
for layout: checkbox and color keep their intrinsic drawings inside whatever column they are given,
and the node grows until `label column + CONTROL_LABEL_MARGIN + floor` fits.

#### Row width model

A connector row starts `CONNECTOR_OVERLAP + CONNECTOR_LABEL_OFFSET` (= 16 px) from the node
edge. On a row that pairs an input with an output:

```
control start            control end                                   label start
nodeX + 16   ────────────────►│  ◄── CONNECTOR_ROW_RESERVED_GAP (6) ──►│◄── measured ──►│
                              │                                        output label text
                              └── width ≥ INPUT_DEFAULT_CONTROL_MIN_WIDTH
```

`getInputDefaultControlBounds()` therefore needs the _rendered_ width of the opposing output
label (`opposingOutputLabelWidth`). Rendering (`node-ui-rendering.ts`) and hit-testing
(`node-ui-hit-testing.ts`) must pass the same value — both compute it as
`measureConnectorLabelWidth(resolveConnectorLabelText(opposingOutput, locale))` — otherwise clicks
land next to the drawn control. When the width is omitted or invalid, the helper falls back to the
fixed `OUTPUT_LABEL_RESERVED_WIDTH` (84 px, roughly 14 characters). Input-only rows ignore the
output reservation and end at `nodeWidth - NODE_BODY_PADDING`.

#### Label measurement

- `resolveConnectorLabelText(entry, locale)` is the single label rule (`name` → `label` → `id`,
  localized through `extractLocalizedString()`). Never derive label text inline.
- `measureConnectorLabelWidth(text)` measures with an offscreen 2D context using
  `CONNECTOR_LABEL_FONT` and memoises per string. Without a canvas (headless tests, SSR) it falls
  back to `text.length * OUTPUT_LABEL_CHAR_WIDTH_ESTIMATE`, which keeps the layout maths
  deterministic in tests.

#### Control column model

Every inline control of a node shares one label column and one value column, computed once per node
by `computeControlColumnLayout()` (`node-ui-helpers.ts`):

```
inset          = CONNECTOR_ROW_INSET (16)
availableWidth = nodeWidth − 2 · inset
labelWidth     = max(measured(labels))          // ceiled, inline controls only
labelWidth    <= availableWidth − CONTROL_LABEL_MARGIN − min(CONTROL_VALUE_MIN_WIDTH, availableWidth)
valueX         = nodeX + inset + labelWidth + CONTROL_LABEL_MARGIN
valueWidth     = availableWidth − labelWidth − CONTROL_LABEL_MARGIN
```

- `labelWidth` comes from `measureControlLabelColumnWidth()`, which measures
  `resolveControlLabelText()` output with `measureControlLabelWidth()` — the same primitives the
  renderer uses, so measurement and drawing cannot disagree.
- The clamp keeps a drawable value box in pathological widths; labels then shrink (ellipsised with
  `fitTextToWidth()`) instead of the node overflowing.
- `stacked` controls are excluded: their label gets its own full-width row above the value.
- The clamped column is passed to every renderer as `layout.labelWidth` and to
  `getControlGeometry({ labelWidth })`. `NodeUi.getControlColumnLayout()` exposes the same numbers
  for editor overlays.
- Labels are ellipsised only when the node is narrower than the column; the block itself is inset by
  `CONNECTOR_ROW_INSET`, so control labels line up with the connector labels below them.
- `NodeControlUi.getCanvasLabelBounds(ctx, layout)` reports the label rectangle a control draws
  (`{ x, y, width, height: CONTROL_HEIGHT }`, or `null` when empty). It shares
  `_resolveCanvasLabelMetrics()` with `_renderLabelAndGetValueLayout()`, so it returns the
  ellipsised text width, the stacked label row (`y = layout.y`) for `stacked` controls and the
  vertically centred inline row otherwise. Callers expand the rect into a pill; the base class
  never paints one.

#### Content-derived minimum node width

`computeNodeMinContentWidth(nodeData, options)` returns the ceiled maximum of three requirements:

```
connectorRowRequirement = max over visible rows of
    inset + max(inputLabelWidth, controlMinWidth) + gap + outputLabelWidth + inset
inlineRequirement       = 2 · inset + labelWidth + CONTROL_LABEL_MARGIN + max(value floor)
stackedRequirement      = max over stacked controls of 2 · inset + max(labelWidth, value floor)
```

The control width of a row is always reserved in its worst case, so connecting or disconnecting an
input never changes the node width. `inlineRequirement` and `stackedRequirement` come from
`computeControlsMinWidth()`; they are the width at which the label column stops truncating.

The contract is `0` when the node is collapsed **or** has neither connector rows nor visible
controls; a node with only panel controls therefore sizes itself instead of squeezing its dropdowns.

`NodeUi` turns that number into behaviour:

- `NodeUi.getMinContentWidth()` — content minimum for the current locale, visible controls and
  control instances (`0` for collapsed nodes and nodes without content).
- `NodeUi.ensureNodeWidth()` — one-way auto-grow, called from `NodeUi.draw()` and from the
  `node-updated` handler in `GraphPanelView` (beside the existing `ensureNodeHeight()`). It writes
  `{ width }` through `graph.updateNode()` and only ever widens: shrinking would fight the user's
  manual resize and retrigger graph updates on every label/locale change. Repeat requests for the
  same width are throttled so a rejecting graph cannot cause a render/patch loop.
- `GraphPanelView._applyNodeWidthUpdate()` clamps pointer and keyboard resizes with
  `resolveEffectiveMinWidth(metadata.minWidth, contentMinWidth)`, so a resize can never go below
  the content minimum either.

**Known limitation**: a node type that declares a `maxWidth` below its content minimum is still
clamped by `clampNodeWidth()`; in that case the label column is clamped and labels are ellipsised.

#### Header title clearance

```
safeLeft  = x + NODE_HEADER_ICON_INSET + NODE_HEADER_ICON_SIZE + NODE_HEADER_TITLE_PADDING  // x + 26
safeRight = x + width − COLLAPSE_BUTTON_SIZE + NODE_HEADER_TITLE_PADDING                    // x + width − 20
```

The title is drawn with `NODE_HEADER_TITLE_FONT`, centred inside that span
(`safeLeft + safeWidth / 2`), and ellipsised with `fitTextToWidth()` when it does not fit. If the
span is narrower than 1 px the title is skipped entirely. Icon and chevron are unaffected, and header
hit-testing (`hitTestHeader()`) still uses the whole header band.

#### Controls/connector spacing and separator

- `CONNECTOR_SPACING = 21` (18 px control + 3 px gap) is the vertical pitch between connector rows.
- `CONTROLS_CONNECTOR_GAP = 12` separates the controls block from the first connector row. The
  controls section already ends with one trailing `CONTROL_SPACING`, so the visible clearance from
  the last control's bottom to the first connector control's top is
  `CONTROL_SPACING + CONTROLS_CONNECTOR_GAP + CONNECTOR_RADIUS − CONTROL_HEIGHT / 2` = **15 px**.
- `getControlsConnectorGap(controls, rowCount)` is the single source of that gap: it returns `12`
  only when both sections have visible content and `0` otherwise, and is used by
  `calculateNodeHeight()`, `computeConnectorPositions()` and `hitTestControl()`.
- `drawControlsConnectorSeparator()` draws one hairline (1 px, `CONTROL_SEPARATOR_COLOR`) at the
  midpoint of that gap, from `x + 16` to `x + width − 16`. It is drawn only when the node has both
  visible controls and connector rows and the line is at least `CONTROL_SEPARATOR_MIN_WIDTH` wide.
  It contributes nothing to height, minimum width or hit-testing.

### Testing

Test files: `tests/data/node-data-input-enrichment.test.js`,
`tests/nodes/node-ui-connector-row-layout.test.js` (row width reservation) and
`tests/nodes/node-ui-controls-layout.test.js` (shared control column, content minimum, title
clearance, spacing and separator).

**Coverage**:

- ✅ Enrichment from plain objects
- ✅ Preservation of existing NodeControlBase instances
- ✅ Serialization to plain objects
- ✅ Round-trip (serialize → deserialize)
- ✅ Handles missing defaultControl gracefully
- ✅ Handles empty/missing inputs array
- ✅ Render/hit-test parity: rendered value rectangles, `ControlHitResult.bounds` and
  `getInputDefaultControlBounds()` all agree, including the controls→connectors gap
- ✅ Clearance: the first connector row never comes closer than 6 px (15 px expected) to the last
  panel control

### Design Decisions

**Why separate Map for inputDefaultControlInstances?**

- Clear separation: panel controls vs. input controls
- Different lifecycle: input controls tied to connection state
- Avoid namespace conflicts in control IDs

**Why enrich in NodeData constructor?**

- Works for all node creation paths (palette, storage, cloning)
- Automatic conversion ensures consistency
- Single source of truth for enrichment logic

**Why match panel control size (scale 1)?**

- One control size across the node keeps hit targets consistent
- Input default controls are interactive, not decorative — shrinking them made them unusable
- The connector row is widened by `NodeUi.ensureNodeWidth()` instead of shrinking the control

**Why hide when connected?**

- Input value comes from connection, not local control
- Avoids confusion about which value is active
- Standard label shows input name instead

### Future Enhancements

Potential improvements:

1. **Persistent Storage**: Store input default values in `NodeData.inputDefaults` map
2. **Value Sync**: Sync control value when connection is added/removed
3. **Custom Scaling**: Per-control scale factors for different control types
4. **Tooltips**: Show full control details on hover

## Migration Notes (Phase 2 Refactoring)

### What Changed

- **Removed**: `node-ui-editors.ts` (all functions consolidated into control classes)
- **Removed**: Obsolete `createEditor()`, `_createEditor()`, `getEditorWidth()`, `getEditorHeight()`, `_onEditorCommit()`, `_onEditorBlur()`, `_onEditorCancel()` from all controls
- **Unified**: All controls now use only `renderDOM()` (inherited) + `_renderDOMControl()` (implemented) pattern
- **Updated**: NodeUi now creates control instances and uses polymorphic dispatch
- **Updated**: Helpers use `control.getLayout()` instead of hard-coded calculations

### Backward Compatibility

✅ The public API of `NodeUi` remains **100% unchanged**  
✅ All existing code using NodeUi continues to work without modifications  
✅ Visual appearance and behavior are identical  
✅ All tests pass without modification

### File Backup

The original editor functions are preserved in control class implementations. No manual backup needed.

### Why This Refactoring

**Problem**: Two incompatible control systems with significant code duplication

- System 1: Incomplete NodeControlUi classes (DOM only)
- System 2: Editor functions in node-ui-editors.ts (duplicating control logic)
- System 3: NodeUi using switch/case dispatch (tight coupling)

**Solution**: Complete control classes to have both canvas rendering and editor creation, delete node-ui-editors.ts, use polymorphic dispatch.

**Result**: Single source of truth for each control type, easier to maintain and extend.

## Usage Example

```ts
import { NodeUi } from './nodes/node-ui.js';

// Usage remains identical to before refactoring
const nodeUi = new NodeUi(graph, nodeId, {
    selected: false,
    style: { bodyColor: '#5b7fc7' },
});

nodeUi.draw(ctx, { hoverConnector: null });
const hit = nodeUi.hitTestNode(point);

// Internal: NodeUi automatically creates control instances
// nodeUi.controlInstances.forEach((control) => {
//     control.renderCanvas(ctx, layout);
//     control.hitTest(point);
// });
```

## Future Enhancements

With this modular structure, future improvements are easier:

1. **New Control Types** - Add one file in controls/ with renderCanvas() and \_renderDOMControl()
2. **Alternative Renderers** - Could create `node-ui-rendering-webgl.ts` for GPU acceleration
3. **Theme System** - Extract `node-ui-constants.ts` into theme files
4. **Custom Editor Styles** - Extend control.renderDOM() with theme variants
5. **Hit Testing Optimizations** - Replace geometric tests with spatial indexing
6. **Accessibility** - Add screen reader support to controls without touching NodeUi
7. **Undo/Redo** - Add value history to control classes
8. **Editor Positioning** - Smart positioning to keep editors in viewport bounds

## Development Guidelines

### Adding New Control Type (Phase 2+)

1. Create `controls/my-control-ui.ts` extending `NodeControlUi`
2. Implement `getValue()` and `setValue()`
3. Implement `getLayout()` returning `{ width, height }`
4. Implement `renderCanvas(ctx, layout)` for canvas rendering
5. Implement `_renderDOMControl()` returning input element with event handlers
    - Attach 'change' or 'input' listeners that call `_notifyChange(newValue)`
    - Set `this.inputElement` for focus management
    - Apply styling via `_styleEditor(element)` for consistent appearance
6. Implement `hitTest(point)` if custom hit testing needed
7. Register in NodeUi `_getControlClassForType()`
8. Add unit tests to tests/nodes/phase2-node-ui.test.js
9. Done! No changes to NodeUi orchestration or rendering pipeline needed

**Note**: The base class `renderDOM()` automatically creates the wrapper with label and semi-opaque background. Your `_renderDOMControl()` only needs to create the input element itself.

**Before Phase 2**: Would require changes to 4-5 files plus node-ui-editors.ts

### Adding New Rendering Feature

1. Update `node-ui-rendering.ts` drawNode() or helper function
2. All control types automatically use `control.renderCanvas()`
3. No need to update individual control files unless behavior is type-specific
4. Test with all 6 control types

### Adding New Calculation Helper

1. Add function to `node-ui-helpers.ts`
2. If it depends on control layout, use `control.getLayout()`
3. Avoid type-switching; use polymorphic methods instead

### Modifying Existing Code

1. Locate the relevant module using the structure above
2. Make changes within that module
3. Update dependencies if function signatures change
4. Test affected functionality (canvas rendering, hit testing, editors)

### Code Style

- Keep functions pure where possible (no side effects)
- Use clear, descriptive function names
- Document parameters and return values with JSDoc
- Export only functions that should be public
- Keep internal helpers private (don't export)
- Control classes: implement all abstract methods from base class

## Phase 2 Architecture Improvements Summary

| Aspect              | Before                                  | After                | Benefit                            |
| ------------------- | --------------------------------------- | -------------------- | ---------------------------------- |
| Control Logic       | Scattered in 3 files                    | Single control class | DRY principle, easier to maintain  |
| Adding Control Type | 4-5 file changes                        | 1 new file           | 75% less work                      |
| Type Switching      | Multiple switch/case                    | Polymorphic dispatch | Cleaner code, easier to test       |
| Code Duplication    | Dropdown options in 3 places            | Single control class | Single source of truth             |
| Canvas Rendering    | Unified in node-ui-rendering.ts         | Per-control methods  | Encapsulation, easier to extend    |
| Editors             | No unified pattern (scattered code)     | Unified renderDOM()  | Single pattern, consistent cleanup |
| Editor Lifecycle    | Manual cleanup in multiple places       | hideEditor() method  | Centralized, reliable cleanup      |
| Hit Testing         | Type-switched in node-ui-hit-testing.ts | Control methods      | Polymorphism, cleaner dispatch     |

## Dynamic Control Resolution

Dropdown controls can declare a `dynamicOptions` descriptor in the node definition. NodeUi resolves
the descriptor into a concrete `{ options, disabled, value }` result at render time via
`node-control-dynamic-resolver.ts`.

- **Registry** — `registerDynamicControlResolver(source, fn)` / `getDynamicControlResolver(source)`
  / `resolveDynamicControl({ control, nodeData, deviceTarget })`. Unknown sources resolve to `null`
  and the control keeps its static options. `nodeData` carries `controlValues` and, since the
  `vars` pickers exist, also `inputDefaults` — a resolver that reads an input-row default must use
  `inputDefaults` first (see `controlValue()` in the resolver module).
- **Sources** —
    - `targetPinPull` — pull-resistor directions for the selected `pin` (`dependsOn: ["pin"]`,
      optional `includeUndefined`); disables to a single fixed option when the pin has `fixedPull`.
    - `targetPinsForCapability` — pins supporting `capabilityKey`, labeled by pin label. An empty
      pin list resolves to `{ options: [], disabled: true, value: null }`, and that resolved
      `disabled` replaces the control's own state, so no per-control special case is needed.
    - `targetResourceValues` — ids `0..n-1` from `resources[resourceGroup][resourceKey]`; disables
      when the count is `0`/absent.
    - `varStores` — the collection's store namespaces plus a "new store" sentinel
      (`newStoreControls`), collector in `var-stores.ts`. An unset or empty store resolves to
      `default`, not to the sentinel.
    - `varNames` — the variables of the namespace named by `dependsOn[0]`, plus a "new variable"
      sentinel (`newNameControls`).
    - `signalNames` — the collection's signal names, starting with `(not set)` (a disabled
      `signal-post` node) and ending with a "Define signal…" sentinel (`newNameControls`).
- **Sentinel display labels** — a resolved option may carry `displayLabel`, which the dropdown
  draws on the canvas and on the trigger while the menu keeps the regular `label`
  (`NodeDropdownControlUi._optionDisplayText()`). `varStores` / `varNames` / `graphTopics` /
  `signalNames` use it to echo the text typed into the sentinel's companion control, so the row the
  user picked shows the name they just created instead of `New store…`.
- **Target provider** — NodeUi accepts a `resolveDeviceTarget?: () => DeviceTargetInfoLike | null`
  option, wired by `GraphPanelView` from the active collection's target id via the runtime's
  `getDeviceTarget()`.
- **Lifecycle** — `_initializeControls` resolves dynamic controls before constructing instances;
  it defers itself (sets `_pendingControlRefresh`) while a control editor is open, because the
  editor *is* one of those instances' elements — re-creating the instances would remove the field
  the user is typing in. `_initializeInputDefaultControls` follows the same rule (the store picker is
  an input default, so it can be the open editor). `hideEditor` runs the deferred rebuild and
  requests a repaint, so the row cannot keep the frame that was painted before the flush;
  `setGraph`/`destroy` drop the pending rebuild. `showControlEditor` closes any open editor
  (flushing the rebuild) before refreshing dynamic controls and rendering the editor; and
  `onControlChanged` updates a mirroring picker in place (`_refreshCompanionPickers()`) and otherwise
  goes through the signature-guarded `_refreshDynamicControls()` when the changed control id appears
  in another control's `dynamicOptions.dependsOn`.
- **Disabled rendering** — `DropdownControlUi` renders a muted canvas style and a disabled trigger
  button for disabled controls; disabled controls do not emit change events. The popup menu is
  capped at `maxVisibleItems` rows with `overflow-y: auto` so long option lists scroll.

See [Node Definition Reference](../nodes/node-definition-reference.md#dynamic-options-target-derived) for the
descriptor schema.

## Related Documentation

- **[Node Definition Reference](../nodes/node-definition-reference.md)** - JSON schema for control definitions
- **[View System Architecture](view-system-architecture.md)** - View lifecycle and integration
- **[Data Backbone Architecture](../core/data-backbone-architecture.md)** - Data model and events
- **Phase 2 Control Architecture Plan** - Detailed implementation plan

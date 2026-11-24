# Function Graphs

This document describes the `function` graph execution type: how a graph declares an interface,
how the interface is mirrored on the canvas, how the palette publishes the graph as a callable node,
how the transpiler emits it, and how graphs are copied between collections.

Related documents: [signal-triggered-graphs.md](signal-triggered-graphs.md) (the `event` execution
type and its reconciliation precedent), [transpiler-architecture.md](transpiler-architecture.md)
(code generation), [node-definition-reference.md](node-definition-reference.md) (node definition
schema), [../core/data-backbone-architecture.md](../core/data-backbone-architecture.md) (graph
model and events), [../view-system/settings-views-guide.md](../view-system/settings-views-guide.md)
(`GraphSettingsView`).

## Scope

A function graph does not run on a schedule: it is emitted as an ordinary Python `async def` and is
called by other graphs through a generated palette node. The interface lives on the graph
(`functionSignature`), is edited in the graph settings, is mirrored onto the canvas by two optional
structural nodes, and is published to the palette as `function_graph.<graphId>`.

Out of scope: function libraries, add-on-provided functions, default parameter values,
`*args`/`**kwargs`, exporting a graph as standalone source, and triggering a function graph by
signal, interrupt or startup. A function graph is call-only.

## Execution type

`'function'` is a first-class `ExecutionType` next to `startup`, `continuous`, `irq` and `event`.
The type union, the ordered `GRAPH_EXECUTION_TYPES` list and the normalizers live in
`js/data/graph-execution-settings.ts`; `NodeGraph`, `GraphSettingsView`, the graph-panel toolbar and
the transpiler all import from there, so the copies cannot drift apart.

`GraphSettingsView` derives its per-type field visibility from the same contract:

```ts
const EXECUTION_FIELD_VISIBILITY: Record<ExecutionType, readonly string[]> = {
    startup: [],
    continuous: ['sleep'],
    irq: ['trigger'],
    event: ['signals'],
    function: ['functionPorts'],
};
```

A function graph therefore hides the interval, interrupt, signal and run-on-start fields and shows
the function block instead.

## Signature model

`js/data/graph-function-signature.ts` is the single owner of the signature shape and its rules:

```ts
type FunctionPortDefault = { type: string; value: unknown; min?: number; max?: number; step?: number };
type FunctionPort = { id: string; name: string; types: string[]; default?: FunctionPortDefault; documentation?: string };
type FunctionSignature = { category: string; icon: string; description?: string; inputs: FunctionPort[]; outputs: FunctionPort[] };
```

- **Limits:** `MAX_FUNCTION_PORTS = 32` per side, `MAX_FUNCTION_PORT_NAME_LENGTH = 64`,
  `DEFAULT_FUNCTION_CATEGORY = 'function'`, `DEFAULT_FUNCTION_ICON = 'mdi:function'`.
- **Icon:** `icon` is the header icon of the generated call node in semantic `<set>:<name>` form
  (`mdi:function`), never a resolved `data:` URI, so the stored value stays stable and editable.
  `normalizeFunctionIcon()` trims it and keeps every non-empty string, including foreign sets such
  as `ph:` or `hue:`; only blank or missing values fall back to `DEFAULT_FUNCTION_ICON`.
- **Color:** `FUNCTION_NODE_COLOR = '#837e73'` — the function-graph tab's broken-white ramp darker
  stop — is the color of generated call nodes **and** the structural input/output nodes, so both
  are tinted alike while white node text stays readable.
- **Ids are index-derived** (`in_0`, `in_1`, … / `out_0`, …) because connections address connectors
  by index; a rename therefore never moves a connector.
- **Types** are connector data types; an empty selection normalizes to `['any']`, and `'any'` is
  exclusive because it already accepts every concrete type.
- **Defaults** are input-only: every input carries a `default` (`type`, `value`, and — for
  `int`/`float`/`double` — `min`/`max`/`step`), which the generated call node mirrors as an inline
  `defaultControl`. The control kind follows the data type (`number` / `checkbox` / `text`), and the
  default type leads the connector's `allowedTypes`.
- **Documentation** — the signature carries an optional Markdown `description` and each port an
  optional Markdown `documentation`. Both are trimmed (`normalizeFunctionDescription()` — trim only,
  inner line breaks preserved) and omitted when empty; a non-empty `description` alone makes the
  signature non-empty, so it serializes like a customized icon. The description is edited in the
  settings and surfaced as the generated node's `info`; a port's documentation becomes the connector's
  `description` in the palette node-info window.
- **Names** are required, unique within their list and trimmed. `buildFunctionParameterNames()`
  turns them into the emitted parameters (`_in0_<sanitized>`, `_in1_…`) — the one algorithm the
  settings preview and the transpiler share.
- **`buildFunctionNodeTypeId(graphId)`** produces `function_graph.<graphId>`;
  `FUNCTION_NODE_TYPE_PREFIX` is the prefix every consumer tests against.

### Persistence

`NodeGraph` stores the signature and serializes it only when it can mean something — the graph is a
function graph, or the signature is not empty — so existing serialized graphs stay byte-identical.
`setFunctionCategory()`, `setFunctionIcon()`, `setFunctionDescription()` and `setFunctionPorts()`
normalize their input, skip no-op updates and emit `functionSignature` with
`NodeGraph.FunctionSignatureChanged.v1` (payload: `graphId`, `functionSignature`, `previousSignature`,
`indexMapping`). A customized icon or a non-empty description alone counts as a non-empty signature.
Every consumer re-reads the signature from the graph instead of caching it. `getFunctionDescription()`
/ `setFunctionDescription()` mirror the icon accessors; port documentation is written through the
existing `updateFunctionPort(kind, portId, { documentation })`.

`previousSignature` and `indexMapping` exist for the cross-graph sync described below: port ids are
re-derived from the index, so "where did connector 2 go" cannot be recovered from the two signatures
alone. `indexMapping` is `{ kind, fromOldToNew }` — one entry per old connector, `null` where the port
was removed — and is `null` for edits that keep every index (category, rename, type, append).

### Port editing APIs

`NodeGraph` owns the port mutations; the settings view only calls them:

| Method | Behaviour |
| --- | --- |
| `getFunctionPortIndex(kind, portId)` | Index of a port, `-1` when unknown. |
| `addFunctionPort(kind, port)` | Appends a normalized port; `null` at the 32-port cap. |
| `updateFunctionPort(kind, portId, patch)` | Patches name/types/documentation in place; never touches wiring. |
| `removeFunctionPort(kind, portId)` | Removes the port and repairs the structural node's wiring. |
| `moveFunctionPort(kind, from, to)` | Reorders ports and re-points the structural wiring. |

Removal drops the connections on the removed connector and decrements every higher index; a move
re-points connections with the old→new permutation, so the moved port keeps its wiring. Both use the
public `removeConnection()`/`addConnection()` pair, because a connection stores connector indices.
Both also publish that permutation in the `functionSignature` payload, so the placed call nodes in
every other graph follow the same edit (see [Placed call nodes](#placed-call-nodes-cross-graph-sync)).

## Structural nodes

`js/data/graph-function-nodes.ts` defines the two structural node types:

- `graph.function.input` — its **output** connectors are the declared inputs (the parameters);
- `graph.function.output` — its **input** connectors are the declared outputs (the results).

They are **not runtime node types**: they never reach `DeviceRuntime.getNodeType`, the transpiler's
runtime lookup or the capability validators. The graph panel's capability pass therefore treats the
structural type ids (and the generated `function_graph.<graphId>` call nodes) as **app-provided**
rather than package-provided: an unresolved lookup clears the node's issues instead of reporting
`graph.function.input` as an uninstalled package. Their connectors are ordinary `NodeData.inputs` /
`NodeData.outputs` descriptors `{ id, name, allowedTypes }` derived from the signature, with the port
id as the connector id.

`isFunctionGraphManagedNodeType(typeId)` in the same module is the single predicate for both id
families, consulted wherever a type id is resolved without a runtime. The deploy gates
(`DeviceDeployment.validateCollectionCompatibility()`, `DeviceDeployment.validateNodePackages()` and
`CollectionDeployment._validateNodePackages()`) skip the id instead of reporting
`Node type not found`, because the transpiler generates the call body and the structural nodes from
the owning collection and the callee graph is validated on its own; `collectUsedPackageIds()` in
`js/data/node-package-usage.ts` skips it too, so the firmware *Minimal* selection and the inventory
compatibility context never demand the phantom packages `graph` or `function_graph`.

- **Optional and palette-placed.** A function graph may contain one of each, dragged from the
  organizational palette section, which only lists them while the active graph is a function graph.
  Nothing is auto-created: the signature stays authoritative, and a function graph is valid without
  either node.
- **Dropped where the pointer is.** The graph panel routes the drop through the shared
  `_resolveNodeDropPosition()` placement, so a structural node snaps/clamps exactly like every other
  node drop; `NodeGraph.ensureFunctionStructuralNode(kind, position)` takes that position and only
  falls back to `resolveFunctionStructuralNodePosition()` when a caller omits one.
- **Icons.** Both the palette cards and the node cards use the Material Symbols *input* / *output*
  glyphs through the `IconProvider` keys `input` / `output`.
- **At most one of each.** A second drop selects the existing node instead of adding a copy; the
  node clipboard skips structural nodes on every path (`function-structural-node-skipped`), and the
  graph panel rejects a palette drop outside a function graph
  (`function-structural-node-drop-rejected`).
- **Stale payloads.** A pasted non-function graph drops structural nodes it might carry; the
  transpiler rejects a structural node inside a non-function graph with
  `function-graph-structural-in-non-function-graph`.

## Placed call nodes (cross-graph sync)

A call node dragged from the palette is a **snapshot** of the signature at drop time: its
`inputs`/`outputs` are ordinary connector descriptors copied from the generated definition.
Connections address connectors by index, so a stale snapshot wires the wrong parameter after a
reorder and keeps a connector that no longer exists after a removal.

`js/nodes/function-consistency.ts` closes that gap. `Collection` forwards every `functionSignature`
event to `FunctionCallNodeReconciler`, which walks **all** graphs of the collection (the callers live
in other graphs than the function they call), finds the nodes whose type is
`function_graph.<graphId>` and, per node:

1. builds the connector descriptors with `buildFunctionConnectorDescriptors()` — the same builder the
   structural nodes use, so call node and structural node can never disagree;
2. patches only the fields that actually changed (`updateNode`) — the sides whose descriptor list
   differs plus the header `icon` — which keeps the pass idempotent and avoids churn on unrelated
   events;
3. re-points the node's wiring: `toIndex` follows the input mapping, `fromIndex` the output mapping,
   and a wire whose connector was removed is dropped. Wires are detached **before** the connector
   patch, because `updateNode()` prunes connections that point at connectors it is about to drop;
4. re-keys `inputDefaults` (`in_<old>` → `in_<new>`) so a default value travels with its parameter.

Rules worth knowing:

- **The mapping is the identity.** Names are not unique and ids always renumber, so only
  `moveFunctionPort()` / `removeFunctionPort()` can say where a connector went; both pass the mapping
  into `setFunctionPorts()`. Without a mapping (rename, type edit, append, direct `setFunctionPorts`
  call) every wire keeps its index — correct for those edits, and the only safe reading otherwise.
- **Ambiguity degrades to positional.** Two ports with the same name and types produce an unchanged
  connector list, so nothing moves; there is no information to distinguish them.
- **Best effort.** A wire the new interface rejects is dropped with a
  `function-call-wire-reattach-failed` log entry instead of failing the edit.
- **Structural nodes are not touched.** They are a different type and `NodeGraph` already re-mirrors
  them synchronously before the event is emitted.
- **Defaults travel with their connector.** A default or bounds edit rebuilds the call node's
  `defaultControl` (the reconciler compares it like ids, names and types), and a stored
  `inputDefaults['in_n']` is clamped into the new bounds or dropped when it no longer matches the new
  control kind.
- **The header icon follows too.** The reconciler copies `signature.icon` onto a placed node whenever
  the stored icon differs, so an icon edit keeps the call node's tint and glyph in step with its
  source graph (and a legacy node without an icon gains the default). An icon-only edit produces a
  bare `{ icon }` patch, so no wire moves.
- **Not undoable.** `functionSignature` is not recorded by `HistoryManager`, so a port edit (and the
  wiring it moved) is not an undo step; this matches the rest of the signature editing.
- **Known gap.** A signature edit made while the function graph is not the active graph never reaches
  `Collection`, because only the active graph's events are bridged. The settings UI always edits the
  active graph, so this only affects programmatic edits.

## Function settings block

The signature is edited in `GraphSettingsView` (`js/views/graph-settings-view.ts`), not on the
canvas. The settings pane is a vertical `SplitView` of three panes — a leading content pane with the
general parameters, then the **Inputs** and **Outputs** sections. The section panes are mounted only
while a supported function graph is active; every other execution type keeps the general pane alone,
and no new view or control is introduced:

- **Category** — a `TextControl` (same row shape as the graph name) writing
  `graph.setFunctionCategory()`; the phase-1 normalizer trims and falls back to `function`. It lives
  in the general pane after the execution-type row and is hidden for other execution types.
- **Icon** — a `MdiIconPickerControl` (`js/views/controls/mdi-icon-picker-control.ts`, `portal:
  'body'`) seeded with `DEFAULT_FUNCTION_ICON` and writing `graph.setFunctionIcon()`. It renders in
  a plain `view-graph-settings__group` row right after the category row, is hidden together with the
  category row for other execution types, and refreshes its value from any `functionSignature`
  event. The picker's `onChange` only fires for user commits; undo/external refreshes use
  `setValue()`.
- **Description** — a reusable `MarkdownEditorControl`
  (`js/views/controls/markdown-editor-control.ts`) in a `view-graph-settings__group` row right after
  the icon row, writing `graph.setFunctionDescription()`. It shows a rendered allowlisted preview
  (via `renderAreaMarkdown()`) with an **Edit** button that swaps in a `<textarea>` + **Done**;
  commit on Done/blur/Ctrl/Cmd+Enter, Escape cancels. Hidden together with the category/icon rows for
  other execution types.
- **Inputs / Outputs** — one `CollapsibleView` per list (`sizeToContent`, `ContentView` body) whose
  body holds a vertical `SplitView`: one content-sized pane per port row, then a trailing pane with
  the add `ToolbarView`, or an empty-state pane above it while the list is empty. The split's
  `contentInsetStart` indents the panes under the section header, `contentInsetTop` separates the
  first pane from it, and `contentInsetGuide` draws a vertical line in the inset gutter so the rows
  read as children of the section above.
- **Add** — a `ToolbarView` with one icon-only `ButtonControl` per section in the trailing split
  pane, disabled at `MAX_FUNCTION_PORTS` with the limit in its tooltip.
- **A port row** — a nested `CollapsibleView` with a compact `headerHeight` (one step below the
  section header's default), whose body contains:
  - a `ToolbarView` with move-up / move-down / delete `ButtonControl`s (disabled at the list edges),
  - a `TextControl` for the name plus an inline message,
  - the multi-select `DropdownControl` (`multiSelect: true`, `showIcons: false`) whose options are
    the active collection's data types, labelled through
    `resolveLocalizedName(definition.name, locale, id)` and sorted by label,
  - an `any` hint,
  - a `MarkdownEditorControl` for the port's Markdown `documentation`, writing
    `graph.updateFunctionPort(kind, portId, { documentation })`.

Validation rules of the block: a required and unique (trimmed, case-sensitive, per list) name is
reported inline and never written to the model — the last valid name stays; `any` is exclusive in
both directions; removing the last port is allowed (zero-argument and no-result functions are legal).

In-form edits refresh row titles, type values and hints without recreating controls, so focus and
caret survive typing. Any `functionSignature` event from another surface rebuilds the whole block.

## Generated node definitions and palette

`js/data/function-node-definition.ts` turns every **enabled** function graph of a collection into an
ordinary node definition:

```ts
buildFunctionNodeDefinition(graph, { pythonFunctionName })
// → { type: 'function_graph.<graphId>', packageId: 'function', category, title: { en: name },
//     icon, color, inputs, outputs, implementations, info? }
```

- Connectors mirror the signature: `allowedTypes` keeps every declared type with the default type
  leading, and each **input** additionally carries the port's `defaultControl`
  (`{ type, label, default, min?, max?, step? }`), so an unwired call-node input shows the same
  inline editor a node-package input would. Outputs stay plain. A port's Markdown `documentation`
  becomes the connector's `description`, and the signature's `description` becomes the definition's
  `info` — both are plain strings that `buildNodeInfoContent()` (`views/node-info-content.ts`)
  already renders in the palette node-info window.
- `implementations.python` exists **only** when `pythonFunctionName` is supplied:
  `{ type: 'regex', value: 'await <fn>({{in0}}, {{in1}})' }` (`await <fn>()` without inputs). The
  palette therefore never holds a call expression pointing at a name it cannot resolve.
- `listFunctionNodeDefinitions(collection, { excludeGraphId })` lists only that collection's enabled
  function graphs, skips graphs without a usable id, dedupes by type id and never lists the graph
  being edited.
- `resolveFunctionNodeDefinition(collection, typeId)` resolves one id (used by the canvas).
- The `icon` is stored in semantic `<set>:<name>` form (`mdi:function` by default) and rendered by
  the node header, which classifies it with `IconProvider.describeIcon()`: `mdi:` values are painted
  as webfont glyphs (the MDI index + `nodes/mdi-glyph-font.ts`, loaded lazily and repainted once
  ready), while image sources and plain text keep the existing image/text paths. The icon is never
  resolved to a `data:` URI at storage time.

### Input defaults

Every input port declares a default value in the signature; the generated definition turns it into
the node's `defaultControl`, exactly like a node package:

- The control **kind** is derived from the default's data type — `int`/`float`/`double` → `number`
  (with `min`/`max`/`step`), `bool` → `checkbox`, everything else (`string`, `any`, namespaced) →
  `text`.
- The default **value** is coerced to that type (`int` truncates, numerics clamp into `min`/`max`,
  `bool` coerces, strings stringify); a missing default synthesizes the type's zero value (`0`,
  `false`, `''`).
- **`min`/`max` are hard constraints** and `step` is not: the settings editor clamps a typed number
  into `min`/`max` (the field snaps to the clamped value on blur, like the canvas editor) and
  `NodeUi` clamps the stored `inputDefaults['in_n']` into the same bounds when a node is prepared, so
  the stored value, the editor and the emitted firmware always agree. `step` is only the input's
  increment/decrement hint (labelled *Step (UI)*) and never rejects or quantizes a value, so an
  off-lattice default is kept as-is.
- The **`allowedTypes` order** puts the default type first, so it is the connector's representative
  type without narrowing which types may be wired (the app deliberately avoids `initialTypes`, whose
  re-application overwrites `allowedTypes`).
- When a call node is dropped, `NodeUi` seeds `inputDefaults['in_n']` from `defaultControl.default`
  (clamped into the declared bounds), and the transpiler emits that literal for an unwired input
  (`''` still becomes `None`).

The node palette appends these entries after the runtime and organizational entries: they are plain
node types with a `packageId`, `category` and `title`, so alphabetical, category and package grouping
all work unchanged; in package mode they appear under `nodePalette.functionPackage`. A runtime type
with the same id always wins, and the palette follows collection (`activeGraphIdx`, `graphAdded`,
`graphRemoved`, `graphUpdated`) and graph (`executionType`, `functionSignature`, `name`, `enabled`)
events, so a renamed, edited, disabled or re-typed function updates without a reload.

Dropping a function entry creates a `NodeData` **snapshot** (`typeName`, `icon`, `color`, `inputs`,
`outputs`), so the canvas keeps rendering the call node — with its connectors — even after the
function graph is gone. Dropping the edited graph's own entry is refused
(`function-node-drop-self`); a stale id degrades to the existing unknown-type path.

## Transpiler contract

The transpiler resolves definitions through one seam, `#resolveNodeDefinition(typeId)`, used by both
validation and emission: structural nodes are generated from the current graph's signature, function
nodes from their callee graph with the pre-pass name, everything else comes from the runtime.

### Names and scheduling

A pre-pass over the enabled graphs assigns `graphId → { functionName, initName }` with
`sanitizeGraphFunctionName(name, 'fn', usedGraphNames)` and prefixes them (`_fn_<name>`,
`_init__fn_<name>`), so a call site and its definition always agree and two graphs named `Foo` and
`foo` stay distinct. Function graphs are excluded from the startup and looping block lists and from
`asyncio.gather`, because they are never scheduled.

### Emitted shape

```python
# Function init: _init__fn_sensor_read
async def _init__fn_sensor_read():
    global sensor
    sensor = make_sensor()

# Function: _fn_sensor_read
async def _fn_sensor_read(_in0_channel):
    # sensor [sensor]
    node_sensor0_out0 = sensor.read(_in0_channel)
    return node_sensor0_out0

# Function init: _init__fn_accumulate
async def _init__fn_accumulate():
    global node_5_out0
    node_5_out0 = None

# Function: _fn_accumulate
async def _fn_accumulate(_in0_length):
    global node_5_out0
    node_5_out0 = _arr.generate(node_5_out0, _in0_length)
    return node_5_out0

# Graph: read_sensors
async def read_sensors():
    while True:
        node_call_out0 = await _fn_sensor_read(3)
        ...

async def run():
    await _init__fn_sensor_read()
    await read_sensors()
```

- Parameters are `buildFunctionParameterNames(signature.inputs)`; no ports emit `()`.
- The body never receives `while True`, a cadence sleep or the startup/signal scaffolding.
- The output node contributes the `return`: `return None` without declared outputs, `return <expr>`
  for one, `return (<expr>, <expr>)` for several; a declared output without an incoming connection
  contributes `None`.
- Declared outputs without an output node are rejected (`function-graph-missing-output-node`);
  declared inputs without an input node are legal (the parameters are simply unused).
- A function graph with no nodes still emits a body (`return None`), because the palette publishes it.
- Initialization (`initStatements` plus per-node `preLoopStatements`) is hoisted into
  `_init__fn_<name>` and awaited by `run()` before any graph task starts, so hardware is set up once
  instead of on every call. Only function graphs reachable from a scheduled graph hoist an init.
- **Hoisted state is module scope.** The init assigns its names as module globals, so a body that
  assigns the same name — `x = _arr.generate(x, …)`, how every stateful node carries its buffer
  across calls — declares it `global` too. Without that declaration Python binds `x` as a body local
  and the read part of `x = f(x)` raises `local variable referenced before assignment` on the first
  call. A read-only use (`sensor.read(...)`) already resolves to the module global and is left
  undeclared.
- Call nodes run through the `regex` implementation above, with `{{in<index>}}` filled from the
  regular template context.

### The `structural` implementation type

Structural nodes contribute variable mappings, never code:
`implementations.python = { type: 'structural', outputs?: string[], statement?: string }`.

- `outputs[index]` maps a connector onto an expression — the input node maps its connectors onto the
  generated parameter names.
- `statement` is the output node's `return …`, emitted after the body; returning nothing is legal.
- `graph.function.*` nodes never register a device import.

### Validation messages

Every failure is a `GraphValidationError` with `messageId`, `details` and a message prefixed with the
id (`[function-graph-self-call] …`):

| Message id | Trigger |
| --- | --- |
| `function-graph-self-call` | A function graph contains a call node of itself. |
| `function-graph-cycle` | Two or more function graphs call each other in a cycle. |
| `function-graph-callee-disabled` | A call node targets a disabled function graph. |
| `function-graph-callee-unknown` | A call node targets a graph id the collection does not have. |
| `function-graph-port-count-mismatch` | A call node's connector count differs from the callee's inputs. |
| `function-graph-missing-output-node` | Outputs are declared but the graph has no output node. |
| `function-graph-structural-in-non-function-graph` | A structural node lives in another graph kind. |

Call validation runs before the per-graph definition check so these specific messages win over the
generic "missing node definition" error.

## Copying graphs between collections

`js/core/graph-clipboard.ts` holds one `NodeGraph.toData()` snapshot app-wide (in-memory only; both
`setGraphClipboard()` and `getGraphClipboard()` deep-copy). The graph-tab context menu offers
**Copy Graph** and **Paste Graph** (`collection.tabContextMenu.copy` / `.paste`); paste is disabled
while the slot is empty.

`buildPastedGraphData(payload, { graphId, name })` produces a detached copy:

- new graph id and name (`getUniqueGraphId()` / `getUniqueGraphName(<copied name>)`),
- node and documentation-area ids renumbered `1…n` in data order, with connection endpoints remapped
  (a connection whose endpoint disappeared disappears with it),
- `viewportConfig` reset to the origin, so the copy is visible,
- the copied graph's own type id remapped inside self-call nodes,
- `functionSignature` and structural nodes kept for a function graph, structural nodes dropped for a
  non-function graph.

Callees that exist only in the source collection stay as node data — the canvas keeps rendering them
from their snapshot — and the paste logs `graph-paste-missing-callees` with the ids; the transpiler
then reports `function-graph-callee-unknown` until the function is re-created.

## Usage walkthrough

1. **Create the function**: set a graph's execution type to *Provide as callable function*. The
   function block appears in the graph settings.
2. **Declare the interface**: pick a category, add inputs and outputs, name them, and select one or
   more data types (`any` for a value of any type).
3. **Build the body**: drop the *Function Input* and *Function Output* nodes from the Organizational
   palette section (optional, but they are how the body reads parameters and returns results).
4. **Call it**: switch to another graph of the same collection; the function appears in the palette
   under its category (and under *Functions* in package order). Drag it in and wire its inputs.
5. **Deploy**: the transpiler emits one `async def` per function, a hoisted init per reachable
   function, and `await`ed call sites. The pre-deploy gates skip the app-provided
   `function_graph.*` / `graph.function.*` ids (see [Structural nodes](#structural-nodes)), so a
   collection that uses a function graph uploads like any other collection.

## Limits

- 32 inputs and 32 outputs per function; 64 characters per name.
- Names are unique per list; a rename never changes wiring, a reorder keeps it attached.
- A function graph is visible only inside its own collection; pasting a caller into another
  collection keeps its nodes but not its callees.
- Recursion (direct or transitive) and calls to disabled functions fail transpilation.

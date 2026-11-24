# Web View Node System

This document describes how the Web View node package is modeled, transpiled, and executed at runtime.

## Scope

The Web View node package lives under:

- `src/micro_otter/nodes/device/node_pkgs/webview/`

Key implementation files:

- Node definitions: `node_definitions.json`
- Generators: `node_generators.js` plus the per-kind `generator_*.js` modules (the line graph uses
  `generator_graph_display.js`)
- Display runtime helpers: `otter_webview/radar.py`, `otter_webview/joystick.py`,
  `otter_webview/graph.py`, `otter_webview/utils.py`
- Runtime data registry: `otter_webview/data_registry.py`
- Connector type metadata: `data_types.json`

## Node Set

The package currently defines 21 node types: 17 category `webview` nodes and 4 category `data`
value-store nodes.

Layout and structure:

1. `web-root`
2. `web-page`
3. `row`
4. `column`
5. `content`
6. `title-content`

Displays:

7. `value-table`
8. `radar-display`
9. `joystick-display`
10. `graph-display`

Controls:

11. `web-view-tile`
12. `web-view-number-input`
13. `web-view-string-input`
14. `web-view-slider`
15. `web-view-checkbox`
16. `web-view-select`
17. `web-view-button`

Persistence (category `data`, see [Value-store nodes](#value-store-nodes)):

18. `web-store-read`
19. `web-store-write`
20. `web-store-save`
21. `web-store-load`

All nodes except the value-store nodes are category `webview` and use generator-backed Python
implementations.

## Type and Phase Model

### Connector type

- Web layout connectors use `web.element`.
- The type metadata and color are declared in `data_types.json`.
- `web.element` connection cardinality is declared in `data_types.json` via `connectionPolicy` with `input.maxConnections = 1` and `output.maxConnections = 1`.
- Cardinality semantics are integer-based: `0` means multiple, `1` means single, and values `>1` are fixed limits.

### Execution phases

- Structural nodes (`web-root`, `web-page`, `row`, `column`) run in `init` phase.
- `content` runs in `both` phases:
  - init: register element and bindings
  - loop: push value updates

This keeps layout/registration one-time and limits loop work to data updates.

## Generator Contract

`node_generators.js` maps each node to two generators:

- `NodeInitGenerators.*` for one-time runtime registration.
- `NodeCodeGenerators.*` for loop behavior.

Shared init helper lines ensure runtime bootstrap:

- create `WEBVIEW_RUNTIME` if missing
- `ensure_mount('otter-dom-root')`
- `ensure_http_topics()`

### Node behavior summary

- `web-root`
  - registers root/page ids
  - registers `/` route
  - sets root title
- `web-page`
  - registers explicit page and route
  - creates page element under root
- `row` / `column`
  - register structural elements
  - mirror one generated element id to active dynamic outputs
- `content`
  - init: register content element + bind data key
  - loop: call `update_content_element(...)`
- `title-content`
  - init: register title element + bind title key
  - loop: call `update_centered_title_element(...)`
  - heading level is selected by node control (`H1`..`H6`)

### Structural constraints

- At most one `web-root` per graph — the badge `Only one Web Root node is allowed per graph.`
  (graph rule `webview-page-contract`) and the transpiler both enforce it.
- A graph that contains page/root nodes needs a `web-root` somewhere in the collection — graph
  rule `webview-root-ownership` reports
  `Missing root ownership: multi-page contracts require a Web Root node.` on the first page/root
  node.
- These two checks are graph rules (see
  `docs/dev/nodes/node-validation-architecture.md` for the mechanism and
  `docs/dev/nodes/graph-resource-validation.md` for the registry), so they report on every
  target, including open-pin ones. Before they lived on the per-node capability path and were
  skipped for the default `generic_micropython` target.
- Any number of `web-page` nodes are allowed; each one registers an additional page and route.

### Row layout — equal-width columns

Columns lay out as flex columns. Inside a row, every direct column child gets an equal share of
the row width:

```css
.wv-col { display: flex; flex-direction: column; gap: 10px; flex: 1 1 auto; }
.wv-row > .wv-col { flex: 1 1 0; min-width: 0; }
```

The equal-width rule is emitted by `generator_column.js` (`ColumnWebviewNode.renderClientStyleRules`)
and scoped to **direct** row children with the child combinator, so a column nested deeper inside a
control or a page keeps the `flex: 1 1 auto` fallback. `min-width: 0` lets a wide control shrink
instead of forcing the row to overflow. Markup and the `wv-row` / `wv-col` class names are unchanged.

## Input Control Bounds and Change Outputs

### Number input bounds

`web-view-number-input` exposes three extra controls next to the value:

| Control | Default | Meaning |
|---------|---------|---------|
| `Min Value` (`minValue`) | `0` | Inclusive lower bound; smaller values are clamped to it. |
| `Max Value` (`maxValue`) | `100` | Inclusive upper bound; larger values are clamped to it. |
| `Step` (`step`) | `1` | Spinner increment; the node schema floors it at `0.001`. |

- `generator_number_input.js` normalizes the controls (`normalizeNumberBounds`): non-finite
  values fall back to the defaults, inverted bounds are swapped, and `step` is floored at `0.001`.
- The configured `value` default, connector values and user-typed values are all clamped to
  `[minValue, maxValue]` — in the generator for the default, in `DualInputControl` for the runtime
  values, and in the generated browser helper before it posts back to the device.
- Generated markup carries the bounds twice: as `data-wv-min` / `data-wv-max` / `data-wv-step` on
  the `.wv-number-input` container and as native `min` / `max` / `step` attributes on the
  `<input type="number">`, so the browser spinner honours them.
- The publish payload gains `min`, `max` and `step` keys
  (`{'kind': 'number-input', 'value': …, 'title': …, 'min': …, 'max': …, 'step': …}`) and the client
  helper applies them to both the input element and the container data attributes on update.
- `step` does **not** snap typed values: a value that is off-step is accepted as typed (and still
  clamped), and no runtime code rounds to the step.

### `changed` outputs

Six value-bearing controls expose a boolean `changed` output that is `True` for exactly one tick
when the resolved value changes:

| Node type | Output layout (index) |
|-----------|-----------------------|
| `web-view-number-input` | element `0`, value `1`, changed `2` |
| `web-view-string-input` | element `0`, value `1`, changed `2` |
| `web-view-slider` | element `0`, value `1`, changed `2` |
| `web-view-checkbox` | element `0`, value `1`, changed `2` |
| `web-view-select` | element `0`, value `1`, label `2`, changed `3` |
| `joystick-display` | element `0`, axis1 `1`, axis2 `2`, changed `3` |

`changed` is always appended after the existing outputs, so previously wired slots keep their
index. `web-view-button` has no `changed` output: a press is already an edge-triggered bool.

Semantics (implemented by `DualInputControl.output_changed`; see
[`webview-dual-input-resolver.md`](./webview-dual-input-resolver.md)):

- One tick only — the flag is reset at the start of every loop tick.
- `False` on the first tick of a control and on a forced sync-epoch publish; those re-send the
  current value rather than report a change.
- Select compares the selected **value**, not the label, so duplicate-valued options do not
  toggle the flag.
- Joystick reports a single flag for either axis: moving one axis sets it for that tick.
- Generated loop code assigns it as `<ctrl>.output_changed`, or
  `_wv_joystick_state.get('outputChanged', False)` for the joystick.

## Dynamic Node-Kind Registry

`generator_webview_shared.js` owns the single registry that maps a node kind to its layout binding,
refresh payload key, and generated client handler. A kind that can appear in a page must be listed
in `WEBVIEW_SUPPORTED_NODE_KINDS`; a kind that publishes a runtime payload must also be listed in
`WEBVIEW_DYNAMIC_NODE_KINDS`.

| Kind | Type code | `resolveLayoutElementKind` |
|------|-----------|----------------------------|
| `content` | `content` | `content` |
| `value-table` | `vtable` | `content` |
| `radar-display` | `radar` | `content` |
| `joystick-display` | `joystick` | `content` |
| `graph-display` | `graph` | `content` |
| `title-content` | `title` | `title` |
| `web-view-tile` | `tile` | `container` |
| `web-view-number-input` | `numinput` | `container` |
| `web-view-string-input` | `strinput` | `container` |
| `web-view-slider` | `slider` | `container` |
| `web-view-checkbox` | `checkbox` | `container` |
| `web-view-select` | `select` | `container` |
| `web-view-button` | `button` | `container` |

The type code feeds the deterministic binding ids `wv_el_<code>_<node>` and
`wv_bind_<code>_<node>`, with a `_s<slot>` suffix when the parent output index is known, so a
`graph-display` node bound to parent output `5` becomes `wv_bind_graph_<node>_s5`. Dynamic kinds are
whitelisted in `buildRefreshBindingSpecs`, which is what keeps their payload keys in the generated
refresh bindings, and every contributor's client update handler is emitted into
`NODE_KIND_UPDATE_HANDLERS`, so the generated client dispatches by kind
(`"graph-display": applyGraphDisplayUpdate,`) instead of a hard-coded `if` branch.

## Graph Runtime

`otter_webview/graph.py` prepares the line-graph series on the device:

```python
build_series(x_values, y_values, max_points=DEFAULT_MAX_POINTS)
```

- `DEFAULT_MAX_POINTS = 256`; `MAX_POINTS_LIMIT = 2048`.
- An absent or empty `y` series returns two empty lists.
- An absent or empty `x` series falls back to the original zero-based `y` indices, so a tail-capped
  series keeps x values `start..n-1` instead of restarting at `0`.
- When both series exist they are paired only up to the shorter length; values are never padded or
  repeated.
- Pairs whose `x` or `y` value is not finite are dropped together, after the pairing window is
  fixed, so fewer than `max_points` pairs may remain.
- `max_points` is converted through `utils.to_float` (fallback `256`), truncated to an integer, and
  clamped to `1..2048`; only the last `max_points` positions of the pairing window are returned.
- The result is two ordinary `list` objects of floats, which keeps the generated
  `publish_webview_values` payload JSON-safe.

Packaging: a collection that contains a `graph-display` node ships `otter_webview/graph.py` plus the
shared `otter_webview/utils.py` through the `variants.py.mpAssets["graph-display"]` entry in
`manifest.json`. The wildcard asset list is unchanged — `utils.py` is intentionally duplicated across
the display variants, exactly like `radar-display` and `joystick-display`.

## Line Graph Node

`graph-display` (**Line Graph** / *Liniendiagramm*) is the single-series line graph. It is a
`webview` node with `executionPhase: "both"` that renders one `otter_webview/graph.py` series into a
canvas inside the page region.

Connectors, in fixed index order:

| Index | Direction | Connector | Type |
|-------|-----------|-----------|------|
| `0` | input | `parent` | `web.element` |
| `1` | input | `title` | `string` |
| `2` | input | `x` | `vars.array` |
| `3` | input | `y` | `vars.array` |
| `0` | output | `element` | `web.element` |

`title` is an ordinary string connector with an inline `text` default control, matching the
`title-content` pattern: a wired `title` expression is published verbatim, while an unconnected
`title` falls back to the normalized `title` control value. The graph itself is read-only — it has
no `changed` output, no store writes, and no editor view.

Controls, in this fixed order:

| id | Type | Default | Bounds / options |
|----|------|---------|------------------|
| `yRangeMode` | dropdown | `auto` | `auto` / `manual`; `affectsControls: true`, manual gates `minY`, `maxY` |
| `minY` | number | `-1` | `-100000`..`100000`, step `0.1` |
| `maxY` | number | `1` | `-100000`..`100000`, step `0.1` |
| `xRangeMode` | dropdown | `auto` | `auto` / `manual`; `affectsControls: true`, manual gates `minX`, `maxX` |
| `minX` | number | `0` | `-100000`..`100000`, step `0.1` |
| `maxX` | number | `1` | `-100000`..`100000`, step `0.1` |
| `heightPx` | number | `240` | `80`..`1200`, step `10` |
| `xLabel` | text | `""` | Axis caption; units belong in the text |
| `yLabel` | text | `""` | Axis caption; units belong in the text |
| `lineColor` | color | `#70d6ff` | Line and point colour |
| `tickCount` | number | `5` | `2`..`12`, step `1` |
| `maxPoints` | number | `256` | `2`..`2048`, step `1`; tail cap for `build_series` |

The four manual bounds stay hidden until their axis range mode is `manual`, because each dropdown
declares `activeControls` per option (`[]` for `auto`, the two bound ids for `manual`).

The loop generator emits the parent passthrough plus one publish call:

```python
_wv_graph_x, _wv_graph_y = _wv_graph.build_series(<x>, <y>, <max_points>)
web_interface_module.WEB_INTERFACE.publish_webview_values({
    <payload_key>: {
        'kind': 'graph-display',
        'title': <title expression>,
        'xValues': _wv_graph_x,
        'yValues': _wv_graph_y,
        'heightPx': ...,
        'xRangeMode': ...,
        'yRangeMode': ...,
        'minX': ...,
        'maxX': ...,
        'minY': ...,
        'maxY': ...,
        'xLabel': ...,
        'yLabel': ...,
        'lineColor': ...,
        'tickCount': ...,
        'maxPoints': ...,
    }
})
```

Unconnected `x`/`y` inputs are emitted as `None`, so `build_series` performs the index fallback and
empty-series handling on the device. The client receives `xValues`/`yValues` as equal-length lists
because the helper already dropped non-finite pairs and applied the tail cap.

Generated markup uses the standard dynamic content container:

```html
<div class="wv-content wv-graph-display" data-node-kind="graph-display" data-wv-*="…">
  <div class="wv-graph-title">…</div>
  <canvas class="wv-graph-canvas" role="img" aria-label="Line graph"></canvas>
</div>
```

Every control is mirrored onto `data-wv-*` attributes (`title`, `heightPx`, both range modes, four
manual bounds, both axis labels, `lineColor`, `tickCount`), and `applyGraphDisplayUpdate` rewrites
that full configuration on every refresh, sets the visible title through `textContent`, stores the
entry on the element, and redraws. The handler returns `false` when the container or its canvas is
missing.

Rendering and redraw behaviour:

- `drawGraphDisplay(targetElement)` reads the 2D context with `canvas.getContext("2d")`, sizes the
  backing store from the canvas's own CSS box (`graphCanvasCssWidth`) times
  `window.devicePixelRatio`, scales the context with `setTransform` (fallback `scale`), and writes
  only `canvas.style.height`; the canvas keeps its `.wv-graph-canvas { width: 100% }` layout width, so
  it can never paint outside the card's content box. `heightPx` is the canvas height, not the card
  height.
- `graphCanvasCssWidth(canvas, targetElement)` resolves the CSS width in this order:
  `canvas.getBoundingClientRect().width`, `canvas.clientWidth`, `targetElement.clientWidth` minus the
  computed horizontal padding from `graphElementInsets(element)`, then `320`. There is no minimum
  beyond 1 px, so a narrow card produces a correspondingly narrow graph.
- `graphElementInsets(element)` returns `{ horizontal }` only when both computed paddings parse as
  finite non-negative numbers, otherwise `null` (no guessed inset).
- `graphMeasureLabel(context, text)` returns the measured text width in CSS pixels, or `0` when the
  context, `measureText`, or `metrics.width` is unavailable. It is called after `context.font` is set.
- Axis gutters are measured, not fixed: `top: 14` and `bottom: 34` stay constant; `left` is the
  y-caption band (`16` when a `yLabel` exists) plus the widest y tick plus an 8 px gap, raised to the
  first x label's half width plus 4 px, and clamped to 45 % of the canvas width; `right` is the last x
  label's half width plus 4 px, clamped to 25 %.
- Y ticks are right-aligned at `padding.left - 8` and drawn with `maxWidth = padding.left - 8`; x ticks
  are centred and drawn with `maxWidth = 2 * min(x, cssWidth - x)`; the rotated y caption is
  translated to half the caption band. Tick texts are formatted once per draw and reused.
- `resolveGraphRange(values, mode, minValue, maxValue)` uses the manual bounds only when the mode is
  `manual` **and** both bounds are finite with `max > min`; otherwise it pads the data range by 5 %,
  expands a degenerate range by `±0.5`, and falls back to `-1..1` for no finite data.
- `formatGraphTick(value, span)` keeps tick labels short and returns `"0"` for a zero-span or
  non-finite value.
- `ensureGraphResizeObserver(targetElement)` keeps one `ResizeObserver` per element in a `WeakMap`,
  is skipped when the constructor is unavailable, and redraws on resize.
- Style rules are limited to `.wv-graph-display`, `.wv-graph-title`, and `.wv-graph-canvas`.

## Runtime Execution Model

`WebPageRuntime` owns route/page metadata, element registration, updates, and refresh payloads.

Core responsibilities:

- mount id tracking (`ensure_mount`)
- route/page registration (`register_page`, `register_route`)
- element graph registration (`register_element`)
- key-to-element binding (`bind_value`)
- active-page delta refresh (`refresh_active_page`)

### Refresh endpoint integration

`ensure_http_topics()` integrates with `app.web_interface.WEB_INTERFACE` via public API only:

- registers `POST /api/webview/refresh` (configurable via the `postRefreshRoute` runtime flag)
- registers DOM mount renderer callback

The refresh handler is delta-first to reduce heap pressure:

- full fragment rendering is opt-in (`fragment=true`)
- memory diagnostics are opt-in (`debug_mem=true`) and include largest allocatable block

### Initial-state sync

Input controls publish their current value once at startup, and the generated frontend client
sends `initialSync: true` on its first poll. The refresh handler bumps the web interface sync
epoch (`request_webview_sync()`), causing each input control's loop `update()` to re-publish its
current value on the next tick via `sync_epoch=get_webview_sync_epoch()`. This keeps a
freshly-connected frontend in sync with the device's current state instead of stale or embedded
values.

### Button press feedback

The `web-view-button` client helper registers pointer handlers that add a `wv-button-pressed`
class on `pointerdown` and remove it on `pointerup` / `pointerleave` / `pointercancel`. Combined
with the `.wv-button:active, .wv-button.wv-button-pressed` style rule (`transform: scale(0.96)`
plus active background/border/shadow), the button gives immediate visual press feedback without
calling `preventDefault()`, so the existing `click → POST` payload still fires.

## Persistence

Web View input controls can keep their device-side value in the collection-wide value store
(`otter_vars.store`) under the reserved namespace `_webcontrol`. Persistence is opt-in per node via
the `persist` checkbox control (default `false`). It exists on exactly five node types:
`web-view-number-input`, `web-view-string-input`, `web-view-slider`, `web-view-checkbox` and
`web-view-select`. Layout nodes and `web-view-button` have no `persist` control.

### Generated shape

`persist` off (default) — byte-identical to the pre-persist generators:

```python
(out, push) = ctrl.update(<fallback>, consume, frontend_key, sync_epoch=…)
```

`persist` on — the update value becomes a store read and the resolved value is written back:

```python
(out, push) = ctrl.update(_store.get('_webcontrol', '<graphId>:<nodeId>', <fallback>), …)
_store.set('_webcontrol', '<graphId>:<nodeId>', out)
```

`import otter_vars.store as _store` is registered only when `persist` is on, and the transpiler
deduplicates it to one import per program.

`init_webview()` is unchanged: it still constructs the controls with their literal defaults and
never touches the store. The browser therefore shows the configured default until the first loop
tick — or until the next forced publish after a page reload — pushes the persisted value.

### Fallback semantics

The third argument of `_store.get` is exactly the expression the generator already passed to
`update()` before persistence existed:

- a connected `value` input expression wins (`_store.get('_webcontrol', '<key>', node_7_out0)`);
- otherwise the node's configured literal default is used (`…, 0)` / `…, 'abc')` / `…, True)`).

Slider keeps its clamp around the read (`min(max, max(min, _store.get(…)))`) and writes back the
clamped output, so a persisted value outside a changed `minValue`/`maxValue` range is still clamped.

### Select specifics

Select persists the option **index**, not the option value: the browser reports a selected index,
and option values may repeat or change between builds. The loop body resolves the index against the
current per-tick option list:

```python
_wv_select_vals_<id> = ['a', 'b', 'c']
...
_wv_select_persistidx_<id> = _store.get('_webcontrol', '<graphId>:<nodeId>', <defaultIndex>)
_wv_select_backend_<id> = <backend value expression>
if isinstance(_wv_select_persistidx_<id>, int) and 0 <= _wv_select_persistidx_<id> < len(_wv_select_vals_<id>):
    _wv_select_backend_<id> = _wv_select_vals_<id>[_wv_select_persistidx_<id>]
(out, out_label, push) = ctrl.update(_wv_select_backend_<id>, …)
_store.set('_webcontrol', '<graphId>:<nodeId>', ctrl._selected_index)
```

The `isinstance(..., int)` guard matters: the entry can hold a non-integer value if another node
wrote the same key, and `0 <= '<str>'` raises `TypeError` in MicroPython. An index outside the
current option list falls through to the normal backend value. The write-back reads
`_selected_index` directly, matching the existing publish payload; deriving the index from the
output value with `vals.index(...)` would break on duplicate option values.

### Key stability

The store key is the scoped node id (`<graphId>:<nodeId>`, or just `<nodeId>` when the graph has no
id). Re-adding a control (new node id) or renaming the graph id orphans the stored entry. That is
deliberate: unrelated controls never inherit each other's values.

### In-memory versus flash

`_store` is the in-memory store described in
[`vars-node-system.md`](./vars-node-system.md#reserved-namespaces). `persist` therefore survives
webview reloads and control re-creation, **not** a reboot. For flash persistence, use the
`web-store-save` and `web-store-load` nodes (see below): they write and read the reserved
`_webcontrol` namespace, so a graph can save the control values on demand and restore them after a
reboot without typing the reserved store name. The generic `var-store-save` / `var-store-load` nodes
with `name = "_webcontrol"` remain equivalent.

### Restoring on startup

For `persist` values to survive a reboot, pair a save with a load that runs **before** the controls
write their values back:

- **Save** — place `web-store-save` in the graph that owns the controls and edge-trigger it after
  the values have changed (e.g. on a button press or a periodic pulse). It writes the reserved
  `_webcontrol` namespace to `var_store/_webcontrol.json`.
- **Load** — place `web-store-load` in a **separate Init graph** (`executionType: "startup"`; the
  default collection's `Init` graph). Its `Load` input defaults to `true`, so it fires on the first
  tick; keep it enabled. Startup graphs run before continuous graphs, so the namespace is restored
  before any control reads it.
- A Load node in the same loop graph runs too late: each input control writes its resolved value
  back to the store on every tick, so a late `_store.load()` is immediately overwritten by the
  controls' first writes (or replaces already-updated values with stale flash data).

### Value-store nodes

| Node type | Category | Inputs | Controls | Emitted statement |
|-----------|----------|--------|----------|-------------------|
| `web-store-read` | `data` | `value` (loop, fallback default) | `name` (text, required) | `out = _store.get('_webcontrol', '<name>', <fallback>)` |
| `web-store-write` | `data` | `value` (loop) | `name` (text, required) | `_store.set('_webcontrol', '<name>', <value>)` |
| `web-store-save` | `data` | `save` (loop, bool) | — | `if _store.edge_trigger('save:<graphId>:<nodeId>', <save>):`<br>`    _store.save('_webcontrol')` |
| `web-store-load` | `data` | `load` (loop, bool, default `true`) | — | `if _store.edge_trigger('load:<graphId>:<nodeId>', <load>):`<br>`    _store.load('_webcontrol')` |

All four nodes hard-code the reserved store name, so users never type `_webcontrol`. They are data
nodes: they declare no `helperImplementations`, `initImplementations` or `initFunction`, generate no
markup and no client JavaScript, and are not part of the webview node-kind registry — only the loop
statement above is emitted. They live in `generator_value_store.js`. Their palette color `#837faf`
is the midpoint between the webview node color `#bc8fb9` and the vars node color `#4a6fa5`, marking
them as web nodes that operate on the vars value store.

`web-store-save` and `web-store-load` mirror `var-store-save` / `var-store-load`: they run in the
`loop` phase and fire once per rising edge of their bool input, using `_store.edge_trigger` keyed by
the scoped node id. They take no `name` input, so the persisted file is always
`var_store/_webcontrol.json`. Both are error-tolerant: `_store.load` leaves the namespace untouched
when the file is missing or invalid.

### Package dependency

The webview package declares `requiredPackages: ["vars"]` in `manifest.json`. Any collection that
uses a webview node therefore ships `otter_vars/__init__.py`, `otter_vars/store.py` and
`otter_vars/arrays.py` in dynamic deployment mode, even when the graph contains no vars node. See
`docs/dev/device-communication/device-folder-structure.md` for the manifest field.

## Minimal Graph Walkthrough

This section shows the smallest practical Web View flow and what happens in transpiled/runtime code.

### Graph shape

Use this chain in one graph:

1. `web-root`
2. `row` (connected to `web-root` output)
3. `content` (connected to one `row` output)

Optional inputs on `content`:

- `title` from text/default control
- `value` from number/default control or another node output

### Init phase effects

During init, generated code ensures runtime setup once:

- create `WEBVIEW_RUNTIME` if absent
- set mount id to `otter-dom-root`
- ensure HTTP topics (`/api/webview/refresh`) are registered

Then node-specific init registration runs:

- `web-root`
  - creates root/page ids
  - registers `/` route
  - sets page title
- `row`
  - registers one row element under the root page
- `content`
  - registers one content element under the row
  - binds a stable data key (for refresh delta payloads)

### Loop phase effects

Only `content` emits loop updates:

- `update_content_element(...)` computes current HTML/text value
- changed content is queued as element update
- bound key values are updated in registry

### Browser result

At first page load:

- shell `index.html` is served
- mounted fragment for active page is injected into `#otter-dom-root`

During polling (`POST /api/webview/refresh`):

- only deltas are returned by default
- browser applies element updates and key/value updates
- full fragment replacement happens only when explicitly requested

### Client polling contract

The generated `webview_client.js` enforces a few client-side behaviours so a slow or backgrounded
device link cannot wedge the UI:

- **Clamped interval** — the web-root node's `refreshIntervalMs` is clamped to **100–60000 ms** on
  every path: the control definition carries the same `min`/`max`, the shared
  `normalizeRefreshIntervalMs()` applies them, and `generator_web_root.js` clamps again in its
  no-helpers fallback. A sub-100 ms interval would only queue requests the device cannot answer.
- **5 s request deadline** — every refresh and control `POST /api/webview/refresh` runs through
  `postRefreshWithTimeout`, which starts an `AbortController` deadline before `fetch` and reads the
  response body *inside* that deadline. `fetch` resolves on the response headers, so a body read left
  outside the timer can hang forever and leave `refreshInFlight` stuck.
- **Completion-chained scheduling** — `pollRefresh()` is the only pump. Its `finally` block clears
  `refreshInFlight`, records the measured poll duration, and calls `scheduleNextRefresh()`. A refresh
  is never started while another one is in flight, and no timer tick is spent on an in-flight skip.
  `REFRESH_INTERVAL_MS` is a floor on the period between poll *starts*
  (`delay = max(0, period - lastDuration)`), so the effective cadence is
  `max(interval, device round trip)`.
- **No polling while hidden** — `pollRefresh()` returns immediately when `document.hidden` is true
  and does not re-arm, so a hidden tab stops requesting. A `visibilitychange` listener resets the
  backoff and starts a poll when the tab becomes visible again.
- **Transport-aware backoff** — `refreshPeriodMs()` ramps the period as
  `min(REFRESH_INTERVAL_MS * (refreshSlowStreak + 1), 5000)` after a poll longer than
  `REFRESH_SLOW_THRESHOLD_MS = max(2 * REFRESH_INTERVAL_MS, 1000)`, or after a failure. The 1000 ms
  floor is deliberate: an ESP32 HTTP round trip is commonly 40–200 ms on a local AP link, so a threshold
  derived only from a short interval would treat every normal response as slow and pin the cadence at
  the backed-off delay (measured at ~500 ms for `refreshIntervalMs = 100`). Because
  `MAX_REFRESH_BACKOFF_MS` equals `REFRESH_TIMEOUT_MS` (5 s), the ramp only *spaces* retries that fail
  fast: an aborted poll already consumes the whole 5 s, so `max(0, period - duration)` is 0 and the
  client re-arms immediately. That is the expected device-off behaviour — one attempt per 5 s plus the
  `wv-refresh-error-banner` banner — and it clears on the first successful poll after the device returns.
- **Guarded control POSTs** — every generated control POST uses `postRefreshWithTimeout` and a
  rejection handler instead of a bare, unhandled `fetch`.

Any new generated `fetch(POST_REFRESH_ROUTE, …)` must carry an abort signal and a rejection handler;
prefer `postRefreshWithTimeout` from the shared scheduler block. That helper resolves to
`{ ok, status, bodyText }`; the body is already drained, so callers must not await `response.text()`.

### Client perf instrumentation

The generated client ships a `[wv-perf]` measurement harness (`buildClientDiagnosticsLines()` in
`generator_webview_shared.js`) so refresh cadence and render cost can be measured on the device
without rebuilding. The counters always accumulate, but **console output is opt-in**: enable it per
browser with `localStorage.setItem("wvPerf", "1")` plus a reload (or flip `WV_PERF_LOG`), and it stays
silent everywhere else — a deployed device keeps a clean console.

Every successful refresh emits one `recv #<n>` line: gap since the previous poll start, request /
body / apply durations, payload bytes, update count, configured `REFRESH_INTERVAL_MS`, the current
`refreshSlowStreak` computed for this poll, and the delay until the next poll start. Failures emit
`recv #<n> ERROR …`. `skip #<n> … still in-flight` only fires when a second poll is attempted while
one is pending (a visibilitychange landing mid-request); with completion-chained scheduling it should
not appear, and a flood of skips means a request is wedged. Every 50 receives, a `summary` line is
logged, followed by a `console.table` of the phase buckets ordered by total time.

Comparing `meanGapMs` with `poll:request` shows what bounds the cadence. The round trip is the floor, and
it depends on the link rather than on the client: a 177-poll run at `refreshIntervalMs = 100` on a local
AP link measured `poll:request` at 42–183 ms (mean ~80 ms) and held **~10 Hz** (gaps 99–102 ms, plus
occasional 110–156 ms whenever a single request ran long), while a congested or remote link measured
110–270 ms and can only deliver ~3–5 Hz. `poll:body` and `poll:apply` stayed in the sub-millisecond range
in both runs, and so did the render work (`graph:draw:update` ≈ 0.14 ms). Lowering the interval below the
round trip cannot raise the update rate.

Phase buckets recorded through `wvPerfRecord()`:

| Bucket | Covers |
|--------|--------|
| `poll:request` | `fetch` start → response headers (device work + network) |
| `poll:body` | `response.text()` |
| `poll:apply` | `applyRefreshPayload()` + node poll-success hooks |
| `poll:total` | whole poll |
| `apply:html` | full-fragment `innerHTML` swap + node init hooks |
| `apply:list` | the update-list loop |
| `apply:<kind>` | one update handler, e.g. `apply:graph-display` |
| `graph:draw:update` | canvas redraw triggered by an update |
| `graph:draw:init` | canvas redraw from the node init hooks (re-run on every refresh) |
| `graph:draw:resize` | canvas redraw from the `ResizeObserver` |

DevTools helpers exposed by the harness: `__wvPerfSummary()` returns a snapshot (`receiveHz`,
`pollHz`, `meanGapMs`/`minGapMs`/`maxGapMs`, `parts`, counters), `__wvPerfReport()` logs one snapshot
and returns it even when logging is off (it is the on-demand path), and `__wvPerfStats` is the raw
counter object. Graph updates additionally log `graph draw #<n> took=… points=…` (first five draws,
then every tenth) while logging is enabled, so a single graph element can be attributed.

## Shell Mount Contract

Web View content is mounted into runtime shell id `otter-dom-root`.

See:

- `docs/dev/device-communication/runtime-web-shell-requirements.md`

## Memory and Logging Notes

Recent runtime hardening focuses on constrained MicroPython heaps:

- avoid full-page fragment regeneration per poll
- reduce temporary allocation churn in refresh/data-delta paths
- prevent overlapping client polls
- support runtime toggling of frequent web-server logs (`/api/web-logs`)

For diagnostics, use otter logs and optional refresh memory debug payload fields.

## Related Documentation

- `docs/dev/nodes/node-definition-reference.md`
- `docs/dev/nodes/transpiler-architecture.md`
- `docs/dev/nodes/webview-node-contribution-contract.md`
- `docs/dev/device-communication/runtime-web-shell-requirements.md`
# Graph Panel Documentation Areas

Documentation areas — the user calls them **group boxes** — are coloured, always partially
transparent regions drawn in front of the grid and behind the connections and nodes. Each area has a
title, an optional Markdown body (with KaTeX math), a burger menu and full mouse interaction. This
document describes how the feature is built.

## Four layers, one z-order

| Layer | Element | Paints | Owner |
| --- | --- | --- | --- |
| 0 | `canvas.graph-panel-view__canvas-bg` | Background grid, then the area shading | `GraphPanelRendering.renderBackground()` |
| 1 | `div.graph-panel-view__documentation` | Area titles, rendered Markdown | `GraphPanelDocumentationLayer` |
| 2 | `canvas.graph-panel-view__canvas-node` | Connections, nodes, selection box, temp connection | `GraphPanelRendering.render()` |
| 3 | `div.graph-panel-view__documentation-chrome` | Burger button, resize affordance, inline editors | `GraphPanelDocumentationLayer` |

The stack is produced twice over: DOM order inserts each layer in the right place, and
`graph-panel-documentation-areas.css` pins the order with `z-index` 0/1/2/3 in case a host reorders
children. Because every node paints on layer 2, readable text (layer 1) can never cover a node;
because the shading is on its own canvas, the node canvas keeps its existing draw path untouched (see
[graph-panel-view-architecture.md](graph-panel-view-architecture.md)).

The split between layers 1 and 3 is not cosmetic. A DOM control underneath a `<canvas>` **never
receives a pointer or keyboard event** — the canvas is hit first and the click never reaches the
element below it. Everything the user reads therefore sits on layer 1 with `pointer-events: none`
(clicks fall through to the canvas, which owns hit testing), and everything the user *clicks or types
into* sits on layer 3: the burger button, the Markdown `<textarea>` and the title `<input>`. Layer 3
is `pointer-events: none` as a whole, so only those few controls are interactive and nodes inside a
box stay clickable.

## Data flow

```
NodeGraph (data/documentation-area.ts)
   │  getDocumentationAreas() → DocumentationAreaData[]     (detached copies)
   │  documentation-area-* events
   ▼
GraphPanelView  ──(one RAF-coalesced renderPanel())──┬─→ GraphPanelRendering.renderBackground()  (layer 0)
   │                                                ├─→ GraphPanelDocumentationLayer.render()   (layer 1)
   │                                                └─→ GraphPanelRendering.render()           (layer 2)
   │
   └─→ HistoryManager (one operation per gesture)

NodeGraph.updateDocumentationArea() ←── layer.onAreaMarkdownCommit / onAreaTitleCommit
```

The panel is the only component that talks to both sides: the layer never mutates the graph itself.
It reports an editor commit through a callback, the panel calls the graph, the graph emits
`documentation-area-updated`, and the next render diff updates the element.

## Module map

| File | Responsibility |
| --- | --- |
| `js/data/documentation-area.ts` | `DocumentationArea` value type, bounds/colour normalizers, the alpha constants and `rgbaFromHex()` |
| `js/data/node-graph.ts` | Per-graph storage, id assignment, the six area events, `toData()`/`fromData()` |
| `js/views/graph-panel-view.ts` | Owns the layer, the background canvas, `activeDocumentationAreaId`, and the repaint switch for area events |
| `js/views/graph-panel-rendering.ts` | `renderBackground()` (grid + shading), `drawDocumentationAreas()` (rounded rectangles) |
| `js/views/graph-panel-documentation-layer.ts` | DOM diffing per area id, viewport sync, editors, colour preview accessors |
| `js/core/markdown-renderer.ts` | Allowlisted Markdown → HTML, math sentinel extraction |
| `js/core/katex-loader.ts` | Lazy KaTeX CDN loader with a never-rejecting promise |
| `js/core/render-documentation-markdown.ts` | `renderAreaMarkdown()` facade used by the layer |

## The translucency invariant

A documentation area stores **only** `#rrggbb`. The two alphas are module constants:

```ts
export const DOCUMENTATION_AREA_FILL_ALPHA = 0.16;
export const DOCUMENTATION_AREA_BORDER_ALPHA = 0.65;
```

Both consumers derive their colour through the same helper, `rgbaFromHex(hex, alpha)`:

- the canvas sets `fillStyle`/`strokeStyle` to `rgba(r, g, b, 0.16)` / `rgba(r, g, b, 0.65)`;
- the DOM layer writes `--doc-area-fill`/`--doc-area-border` from the same strings and
  `--doc-area-color` for the title and links.

`normalizeAreaColor()` rejects anything that is not `#rgb`/`#rrggbb`, so a colour picker, a paste from
another document or a hand-edited collection file can never introduce `rgba(...)` — and therefore
never make a box opaque.

## Display mode and edit mode

| | Display | Edit |
| --- | --- | --- |
| Body | Rendered HTML from the allowlisted renderer, `pointer-events: none` (clicks fall through to the canvas) | `<textarea>` in the chrome layer, absolutely placed over the body and `pointer-events: auto`, so it can take a caret, a selection and keystrokes |
| Title | `<h3>` written with `textContent`; an empty title shows the untitled fallback **without** writing it into the data | `<input>` in the chrome layer, placed over the title by measuring its own offset box |
| Mutation | none | `Enter`/`Ctrl+Enter` commits one `updateDocumentationArea()` call, `Escape` cancels without touching the graph; losing focus commits (title and body alike) |

The editors are positioned by `#placeOver(element, reference)`, which copies `offsetLeft`,
`offsetTop`, `offsetWidth` and `offsetHeight` of the content element they cover. Both layers share the
same origin and the same viewport transform, so the numbers transfer one-to-one and CSS padding
changes move the editors automatically.

While a mode is active, the covered content is hidden (`data-editing` → `content.hidden`, `data-renaming`
→ `visibility: hidden`) so the old text cannot shine through the input.

An area element carries `data-editing`, `data-renaming`, `data-empty`, `data-untitled`, `data-align`
and `data-font-size` attributes so the stylesheet can switch modes without extra classes, and the
`title` attribute holds the raw Markdown so a clipped box is still inspectable.

Outside clicks are a separate path from `blur`: the canvas calls `preventDefault()` on every
`mousedown`, so focus may stay in the editor and `blur` may never fire. `GraphPanelDocumentationLayer`
therefore registers a capture-phase `mousedown` listener on `document` in `mount()` and removes it in
`destroy()`. It commits every open editor whose element does not contain the event target; a click
inside the editor leaves it open. This is why clicking the canvas, another area or the burger always
leaves edit mode, even though the canvas suppresses the default focus change.

## Content alignment

`contentAlign` (`'top' | 'bottom'`, default `'top'`) decides where the Markdown body sits inside the
box; the title always stays in the header row. The layer writes it as `data-align` on the area, and the
stylesheet pushes the content block down with `margin-top: auto` inside a flex column:

```css
.graph-panel-doc-area[data-align='bottom'] .graph-panel-doc-area__content { margin-top: auto; }
```

When the text is taller than the box the free space is negative, the auto margin resolves to `0` and
the body scrolls from the top instead of clipping the first lines. The menu exposes the two states as
`Align Text Top` / `Align Text Bottom`, and the currently active one is disabled so it doubles as the
"current value" indicator. Both route through `updateDocumentationArea({ contentAlign })`, so an
alignment change is one ordinary `documentation-area-updated` history step.

## Font size

`fontSize` (`'small' | 'normal' | 'large'`, default `'normal'`) is an additive area field that scales
the Markdown body and its headings. The title and the title editor do **not** use it: both stay at
16px/600. The layer writes the normalized value as `data-font-size` on both the content root and the
chrome root; the chrome root carries it because the textarea is a sibling of the content layer.

The stylesheet maps the presets to one variable:

| Preset | `--doc-area-font-size` |
| --- | --- |
| `small` | `9px` |
| `normal` | `11px` |
| `large` | `14px` |

Body text and the inline Markdown textarea use `var(--doc-area-font-size, 11px)`. Heading sizes are
relative to the same variable, which preserves the original Normal sizes:

| Heading | Size | Normal result |
| --- | --- | --- |
| `h1` | `calc(var(--doc-area-font-size) + 4px)` | 15px |
| `h2` | `calc(var(--doc-area-font-size) + 3px)` | 14px |
| `h3` | `calc(var(--doc-area-font-size) + 2px)` | 13px |
| `h4`–`h6` | `var(--doc-area-font-size)` | 11px |

The menu row opens the reusable `MenuView` submenu (the same `menuview` pattern as
`WorkspaceView._buildMenuGroup()`), labelled `Small` / `Normal` / `Large`. The active preset is
disabled and therefore doubles as the current-value indicator, exactly like the alignment rows. A
selection calls `updateDocumentationArea({ fontSize })`, so it is one ordinary
`documentation-area-updated` history step; the field is also carried by clipboard area data,
duplication and delete restoration.

## Stylesheet

`styles/standard/graph-panel-documentation-areas.css`, registered in `styles/themes.json` immediately
after `graph-panel-view` (theme entry files concatenate the array in order). It defines the two layer
containers, the area box, header/title, the body with its Markdown element styles, the chrome root with
the burger and the inline editors, and the resize-handle grip. The title is the only large type in a
box (16px/600); body text follows `--doc-area-font-size` (9/11/14px). Colours come from the three
`--doc-area-*` variables or from existing theme variables; the hard-coded values are fallbacks only.
The colour variables are written on both the content root and the chrome root, because the chrome
layer is a sibling of the content layer.

The header uses symmetric `4px 32px` padding and a centred title. The burger is absolutely positioned
in the left gutter; because the chrome root spans the whole box, its `4px` top offset centres the
24px button in the 32px header row. Its glyph is 20px. The title editor mirrors the title with
centred text and 32px side insets; `#placeOver()` still overrides those fallbacks with measured
offsets.

## KaTeX load and fallback

The first paint never waits for the network: `renderAreaMarkdown()` renders with whatever KaTeX
instance exists (usually none) and starts `loadKaTeX()` the first time a body reports `hasMath`. The
layer subscribes to `onKatexStateChange` and re-renders only the bodies whose previous result had
`hasMath: true` and `mathRendered: false`, so the upgrade happens without a rebuild. When the CDN is
unreachable the fallback stays: `$…$` in a muted monospace code span that can be read and copied. See
[markdown-and-math-rendering.md](../core/markdown-and-math-rendering.md).

## Interaction

Hit testing is a pure function (`views/documentation-area-hit-test.ts`):

| Zone | Extent |
| --- | --- |
| `resize` | `14 / scale` world-unit square in the bottom-right corner |
| `header` | top `32 / scale` world units (matches the 32px header row) |
| `body` | everything else inside the bounds |

Both zone sizes are divided by the viewport scale, so the header and the handle keep their on-screen
size at every zoom level. The array is walked in reverse, so the topmost area (the last one painted)
wins — matching the canvas paint order and the DOM stacking order.

`handleMouseDown` keeps this precedence chain (first match wins):

1. node control (input, dropdown, button)
2. connector
3. node resize handle
4. **documentation area** (header → move, corner → resize, body → activate, `event.detail > 1` → edit)
5. Shift+drag box selection, Alt+drag/middle-button panning, plain panning

Areas sit after nodes and connectors on purpose: a node drawn on top of a box must stay clickable.
Shift and Alt are also bypassed so box selection and panning still work over a box.

Gesture math, applied in `_handleDocumentationAreaPointerMove()`:

| Mode | Formula |
| --- | --- |
| move | `x = start.x + Δx`, `y = start.y + Δy`, size unchanged |
| resize | `width = max(MIN.width, start.width + Δx)`, `height = max(MIN.height, start.height + Δy)`, top-left fixed |

With snap enabled the move position (or the resize's bottom-right corner) is rounded to
`GRID_SPACING`; with snap disabled the bounds follow the pointer exactly. Snapping happens on the
computed bounds, never inside `NodeGraph`, so undo still sees the values the user actually produced.
The result is then clamped so the box stays inside the graph's world extent and keeps at least 40
world units reachable.

One gesture, one undo step:

1. mouse down → `graph.startDocumentationAreaDrag(id, mode)` (history caches the start bounds);
2. every pointer move → `graph.setDocumentationAreaBounds(id, bounds)` (history only refreshes its
   cached end bounds — 60 updates per second cost nothing);
3. mouse up → `graph.endDocumentationAreaDrag(id)` → exactly one history operation.

`Escape` during a gesture restores the start bounds first and *then* ends the gesture, so the capture
sees no delta and the undo stack stays untouched.

Keyboard (handled by the interaction module before every node shortcut, and only while no input or
textarea has focus):

| Key | Effect |
| --- | --- |
| `Delete` / `Backspace` | Delete the active area — but only when no nodes are selected; nodes win |
| `Escape` | Cancel a gesture, else close the editor, else deactivate the area |
| `F2` | Rename the active area (inline title input) |
| `Ctrl`/`Cmd`+`Enter` (in the textarea) | Commit the Markdown editor |

Mouse only affordances: double-click on the body opens the inline Markdown editor, double-click on the
header is a move gesture (no editor), and the **burger button at the area's top-left corner** opens the
menu on a plain **left click** (see "Menu and colour"). The burger is the only always-visible control,
which is why it lives in the chrome layer: a left click on it has to reach the button instead of the
canvas underneath.

Activation model: `activeDocumentationAreaId` is **view state**. It is set on mouse down, cleared on an
empty-canvas click, on a node press, on a graph switch and when the area disappears; it is neither
persisted nor recorded in history.

## Menu and colour

Two surfaces open the same menu: the burger button in the area header and a right-click anywhere on
the area. Both go through `createDocumentationAreaMenuItems()` in
`views/documentation-area-menu.ts`, so the item order, the shortcuts and the enabled states can never
drift apart.

| id | icon | enabled when |
| --- | --- | --- |
| `edit` | `IconProvider.edit` | always; the label flips between `Edit` and `Done` while editing |
| `color` | `IconProvider.palette` | always |
| `rename` | `IconProvider.edit` | always |
| `alignTop` | `arrowUpward` | while the body is *not* already top-aligned (the active state is disabled) |
| `alignBottom` | `arrowDownward` | while the body is *not* already bottom-aligned |
| `fontSize` | `formatSize` | always; opens a `MenuView` submenu with `fontSizeSmall` / `fontSizeNormal` / `fontSizeLarge`, disabling the active preset |
| `cut` / `copy` | `contentCut` / `contentCopy` | always |
| `paste` | `contentPaste` | the clipboard holds nodes or areas |
| `duplicate` | `fileCopy` | always |
| `fit` | `selectAll` | at least one node is selected |
| `delete` | `delete` | always |

Separators sit between the edit block, the clipboard block and the destructive block. Every item
carries `action: () => actions.<fn>(area.id)`, and the panel supplies the action table, so both
surfaces dispatch through one place. The builder takes the current state as data and returns a fresh
array (and a fresh child `MenuView` for the font-size row) — which is why the enabled states are
always current: the menu is rebuilt on every open instead of being cached. The `menuview` child is
opened by `MenuWindow._openChildMenu()`; its labels are already resolved through the injected
translator, and the active preset uses the same disabled-means-current convention as the alignment
rows.

Anchoring: the layer reports the burger button's `getBoundingClientRect()`; a right-click passes
`new DOMRect(event.clientX, event.clientY, 0, 0)`. The panel hands that rect to
`new MenuWindow({ items, anchor })`, registers the window through `viewManager.addOverlay()` and
keeps it in `_activeContextMenu` until the `OverlayWindow.Close.v1` event clears the reference.

Colour picker contract:

1. the native `<input type="color">` is seeded with `normalizeAreaColor(area.color)` and `.click()`ed;
2. `input` events only call `layer.previewAreaColor(id, hex)`, which rewrites `--doc-area-color`,
   `--doc-area-fill` and `--doc-area-border` on that element — **nothing** is written to the graph, so
   dragging through the picker cannot create history entries;
3. `change` calls `graph.updateDocumentationArea(id, { color })` exactly once (one undo step), then
   `layer.clearAreaColorPreview(id)` and a repaint;
4. `blur` without `change` (cancelled picker) restores the stored colour and removes the input after a
   short timeout.

**Store RGB, paint RGBA.** The picker writes `#rrggbb`; translucency stays in the two constants and is
applied by `rgbaFromHex()` on both layers. A picked colour therefore cannot change a box's opacity —
that is a property of the feature, not of the picker.

Other actions: `Duplicate` creates a copy offset by (24, 24) with a fresh id in one history step and
activates it; `Fit to Selection` computes the padded bounding box of the selected nodes
(+40 world units on every side, clamped to the minimum size) and applies it as a single resize step;
`Delete` routes through the same `beforeDocumentationAreaRemove()` + `removeDocumentationArea()` pair
as the `Delete` key.

i18n: the `documentationArea` namespace (`untitled`, `menuButton`, `placeholder`, `duplicateTitle`,
`menu.*` — including `menu.alignTop` / `menu.alignBottom`) exists in both `locales/en.json` and
`locales/de.json`; labels are resolved through the panel's `_tWithFallback()` so a missing key degrades
to English instead of showing the raw key.

## Clipboard (cross-graph)

Documentation areas travel through the same app-level `clipboardManager` singleton as nodes, so a box
copied in one graph can be pasted into another graph or another collection tab.

Payload shape (`core/clipboard-manager.ts`):

```ts
{
    nodes: Array<{ data, _originalId }>,
    connections: Array<{ fromNode, fromIndex, toNode, toIndex }>,
    documentationAreas: Array<{ data: DocumentationAreaData, _originalId: string }>,
}
```

- **Why a singleton.** The manager lives in module scope, so switching tabs or graphs never loses the
  payload, and nothing is cached per panel.
- **Fresh ids, never `_originalId`.** `NodeGraph` assigns the pasted area's id from its own counter.
  `_originalId` belongs to the source graph and may already exist in the target with a different
  meaning, so it is never looked up.
- **Bounding-box translation.** The paste computes the combined bbox of the clipboard areas, treats
  the paste position as its top-left, keeps the relative offsets of multiple areas and preserves the
  stored width/height — only `x`/`y` move. Without a paste position it offsets by `(20, 20)`; with
  `exactPositions` it keeps the stored coordinates.
- **Collision nudge.** `resolveOriginCollision()` pushes the bbox away from every occupied area origin
  (seeded from the target graph's existing areas and extended with each pasted one), so two pastes in a
  row cascade instead of stacking, and pasting into the same graph never reuses an id.
- **`getLastPastedAreaIds()`** reports the ids the last `paste()`/`pasteAreas()` created, in insertion
  order, so the panel can activate the new box. `hasData()` and `getAreaCount()` account for area-only
  payloads, which keeps the canvas "Paste" item enabled for them.

Facade contract (`views/graph-panel-clipboard.ts`):

| Method | Behaviour |
| --- | --- |
| `copySelection()` | one payload with the selected nodes **and** the active area |
| `cutSelection()` | copies, then removes nodes through `removeNodes()` and the area through `removeDocumentationArea()`; a mixed cut runs inside `beginGroup('Cut selection')` |
| `pasteAt()` / `pasteAtCenter()` | `paste()`; selects the new node ids and activates the reported area id |
| `copyArea(areaId)` / `cutArea(areaId)` | area-only paths used by the box menu; `cutArea` copies then removes undoably |
| `pasteAreaAt(areaId, worldPos)` | pastes only the areas; the `areaId` is a logging anchor, the payload decides what is created |

Cut ownership: the **manager** only serializes; the **panel** performs the removal, because only it
knows the history manager. That split is why `cutSelection()` takes `removeNodes`/`removeDocumentationArea`
callbacks instead of deleting anything itself.

Undo granularity: a paste of *n* elements creates *n* operations (`documentation-area-added` per area),
like node paste; a cut is one operation per removed element, and a mixed cut is one group.

## Palette entry

The palette lists a documentation area under a new **Organizational** section. The entry is a
*virtual* palette item, not a node type: a node type would drag the feature into transpilation,
capability validation, connection routing and the node packages shipped by device runtimes. Instead
`nodes/organizational-palette.ts` declares the entry and `NodePaletteView` merges it into
`_nodeTypes` after the package loop, marked with `type: 'graph-item'`:

```ts
{ id: 'documentation-area', type: 'graph-item', category: 'Organizational',
  title: { en: 'Documentation Area', de: 'Dokumentationsbereich' }, icon: 'nodeCategory',
  description: { … }, i18n: { title: 'nodePalette.graphItems.documentationArea.title',
                              info:  'nodePalette.graphItems.documentationArea.info' } }
```

- `type: 'graph-item'` is the single marker every node-only path checks. Favorites, the
  recently-used list, the node-info window and the click handler all skip it (a click only logs
  `palette-graph-item-clicked`), so the entry can never pollute node history or open a node panel.
- The graph items get their **own section pinned above Favorites**, in every organization mode. The
  `Organizational` heading is not a collapsible node group: `_renderOrganizationalSection()` fills it
  from `_searchState.filteredTypes.filter(isGraphItem)` and hides the section when the search matches
  none, while `_renderNodeTypes()` filters the same items out of the alphabetical grid and out of the
  package/category groups — so "Alphabetical" keeps the pinned section *and* a grid that contains only
  node types. Search finds the entry like any other ("doc" → Documentation Area).
- Labels come from the `nodePalette.organizational` and `nodePalette.graphItems.*` keys when the locale
  has them; otherwise the `{ en, de }` map is used. The registry name in `icon` is resolved to a URL
  through `IconProvider.get()` so `NodeTypeUi` classifies it as an image (`IconProvider.describeIcon`)
  and paints an `<img>`. Semantic `<set>:<name>` icons (`mdi:…`) paint a webfont glyph instead.

Drag payload: `NodeTypeUi._onDragStart()` emits a discriminated union —

```ts
{ type: 'node-type';  nodeTypeId:  string; nodeTypeName: string }
{ type: 'graph-item'; graphItemId: string; nodeTypeName: string }
```

`GraphPanelView.handleDrop()` branches on `dragData.type` **before** the runtime lookup:

```js
if (dragData.type === 'graph-item') {
    this._createDocumentationAreaAtDrop(dragData.graphItemId, event);
    return;
}
```

`_createDocumentationAreaAtDrop()` maps the id (`documentation-area` is the only handler today, unknown
ids log `graph-item-drop-ignored` and change nothing), converts the drop position to world coordinates,
centres the default size on it, clamps into the graph extent and calls `addDocumentationArea()` — one
history step. It deliberately does *not* call `setDocumentationAreaBounds()` afterwards, which would
add a second operation, and it never calls `runtime.getNodeType()`.

## Related

- [Data backbone — documentation areas](../core/data-backbone-architecture.md)
- [Undo/redo — documentation area operations](../core/undo-redo-architecture.md)
- [Markdown and math rendering](../core/markdown-and-math-rendering.md)
- [Graph panel view architecture](graph-panel-view-architecture.md)

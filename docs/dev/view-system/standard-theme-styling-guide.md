# Standard Theme Styling Guide

Comprehensive guide to customizing the Standard Compact Dark theme for the Micro-Otter view system.

## Overview

The Standard theme is designed for minimal space usage with tight spacing, small fonts, and compact padding. All CSS files are located in `src/micro_otter/nodes/html/styles/standard/`.

---

## View Borders, Padding & Margins

### SplitView Container (`split-view.css`)

**Main container borders and spacing:**

```css
.split-view {
    border: 1px solid var(--mo-border, rgba(255, 255, 255, 0.08)); /* Outer border */
    border-radius: var(--mo-radius, 8px); /* Rounded corners */
    gap: var(--split-gap, var(--mo-gap, 0px)); /* Space between panes */
    padding: var(--mo-padding, 0px); /* Inner padding */
}
```

**Individual pane styling:**

```css
.split-view__pane {
    border-radius: calc(var(--mo-radius, 8px) - 2px); /* Slightly smaller radius than container */
    background: var(--mo-surface-2, #172133); /* Pane fill separates panes without a border */
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.02); /* Faint inner hairline */
    padding: 0px; /* Content padding inside pane */
}
```

Panes intentionally have **no border**; they are separated from the container and from each
other by their darker fill (`--mo-surface-2`) and the faint inset hairline. Splitters
(`.split-view__splitter`, 4px wide, 2px when inert) provide the draggable divider.

**To customize:** Adjust CSS variables in `view-system.css`:

- `--mo-border`: Border color (default: `rgba(255, 255, 255, 0.08)`)
- `--mo-radius`: Corner radius (default: `5px`)
- `--mo-gap`: Gap between elements (default: `1px`)
- `--mo-padding`: Base padding (default: `1px`)

### TabbedView Container (`tabbed-view.css`)

**Tab strip spacing:**

```css
.tabbed-view__tabs-row {
    gap: 6px; /* Space between tabs */
    padding: 0 6px; /* Horizontal padding around tab strip */
}

.tabbed-view__tabs-rail {
    gap: 6px; /* Space between tabs in the scrollable area */
}
```

**Content area:**

```css
.tabbed-view__content {
    border: 1px solid var(--mo-border, rgba(255, 255, 255, 0.12)); /* Content border */
    border-radius: var(--mo-radius, 8px); /* Rounded corners */
    padding: 8px; /* Content padding */
}
```

**Individual tabs:**

```css
.tabbed-view__tab {
    gap: 6px; /* Space between tab icon and label */
    padding: 5px 6px; /* Tab padding (vertical horizontal) */
    border: 1px solid var(--mo-border, rgba(255, 255, 255, 0.12)); /* Tab border */
    border-radius: 8px 8px 0 0; /* Top-left and top-right corners rounded */
}

.tabbed-view__tab.is-active {
    padding: 5px 7px; /* Slightly more horizontal padding when active */
}
```

**Drag and drop reordering:**

```css
.tabbed-view__tab--draggable {
    cursor: grab;
    touch-action: pan-y; /* horizontal strip; use pan-x on vertical strips */
}

.tabbed-view--dragging,
.tabbed-view--dragging .tabbed-view__tab {
    user-select: none;
}

.tabbed-view__tab.is-dragging { /* source tab */ }
.tabbed-view__tab.is-drop-before::before { /* insertion before a tab */ }
.tabbed-view__tab.is-drop-after::after { /* insertion after the block */ }

:root {
    --mo-tab-drop-indicator: var(--mo-accent, #63b5ff);
}
```

The indicator is a 2 px bar drawn inside the 4 px tab gap, so it never reflows the strip. Themes can
override `--mo-tab-drop-indicator`; `prefers-reduced-motion: reduce` disables the dragged tab's
transition. See [TabbedView Tab Reordering](tabbed-view-reordering.md) for the lifecycle.

**Execution-type variants:**

A tab entry can expose an opaque `tabVariant`, which `TabbedView` writes to `data-tab-variant`.
`CollectionView` supplies the normalized graph execution type, so the standard theme can tint the
tab. The variant blocks map attribute values to local aliases, and the state rules consume them:

```css
.tabbed-view__tab[data-tab-variant='startup'] {
    --tab-variant-bg: var(--mo-tab-execution-startup-bg);
    --tab-variant-bg-hover: var(--mo-tab-execution-startup-bg-hover);
    --tab-variant-bg-active: var(--mo-tab-execution-startup-bg-active);
    --tab-variant-border: var(--mo-tab-execution-startup-border);
}

.tabbed-view__tab[data-tab-variant] {
    background: var(--tab-variant-bg);
    border-color: var(--tab-variant-border);
}

.tabbed-view__tab[data-tab-variant]:hover,
.tabbed-view__tab[data-tab-variant]:focus-visible {
    background: var(--tab-variant-bg-hover);
    border-color: var(--tab-variant-border);
}

.tabbed-view__tab[data-tab-variant].is-active {
    background: var(--tab-variant-bg-active);
    border-color: var(--tab-variant-border);
}
```

Repeat the first block for `continuous`, `irq`, `event`, and `function`. The standard theme defines
twenty tokens in `view-system.css`:
`--mo-tab-execution-<type>-bg`, `-bg-hover`, `-bg-active`, and `-border`, where `<type>` is
`startup`, `continuous`, `irq`, `event`, or `function`. The active rule deliberately leaves `color`
alone so the existing dark active label stays readable.

Theme overrides belong in that theme's own `view-system.css` by redefining the
`--mo-tab-execution-*` tokens; do not hard-code execution colors in `tabbed-view.css`. See
[TabbedView Tab Variants](tabbed-view-tab-variants.md) for the full token ramp and contract.

### CollapsibleView Header Surfaces (`collapsible-view.css`)

Every `CollapsibleView` header is 28 px tall by default (`headerHeight`, 24 px floor) and the height
stays inline: the stylesheet declares no `height`, only the surface, padding, border, and cursor.

```css
.collapsible-view__header {
    background: var(--mo-surface-2); /* Base header: one step above the pane fill */
}

.collapsible-view--nested .collapsible-view__header {
    background: var(--mo-surface-3, #1c2a40); /* Sub-section header: one step above the base */
}
```

`--mo-surface-3` is **not** a `:root` token today, so `#1c2a40` is the component contract and the
fallback keeps the nested header visibly stronger than its parent. A theme that defines
`--mo-surface-3` later automatically wins; do not add the token globally just to restyle one
component.

---

### OverlayWindow (Floating Windows) (`overlay-window.css`)

**Main container:**

```css
.overlay-window {
    border: 1px solid var(--mo-border, rgba(255, 255, 255, 0.12)); /* Outer border */
    border-radius: 10px; /* Rounded corners */
}
```

**Header (contains title and controls):**

```css
.overlay-window__header {
    gap: 6px; /* Space between header elements */
    padding: 6px 8px; /* Header padding (vertical horizontal) */
    border-bottom: 1px solid var(--mo-border, rgba(255, 255, 255, 0.12)); /* Separator */
}
```

**Body content:**

```css
.overlay-window__body {
    padding: 8px; /* Content padding */
}
```

---

## Splitter Handle Appearance

Located in `split-view.css`:

### Inactive (Default) State

```css
.split-view__splitter {
    border-radius: 6px;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02));
    border: 1px solid var(--mo-border, rgba(255, 255, 255, 0.08));
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
    transition:
        background 120ms ease,
        border-color 120ms ease;
}
```

**Key properties:**

- `background`: Gradient from semi-transparent white (top: 8% opacity) to lighter (bottom: 2% opacity)
- `border`: Thin border using theme border color
- `box-shadow`: Subtle inner highlight for depth

### Active (Hover/Focus) State

```css
.split-view__splitter:hover,
.split-view__splitter:focus-visible {
    background: rgba(99, 181, 255, 0.18); /* Accent color highlight */
    border-color: var(--mo-border-strong, rgba(118, 188, 255, 0.6)); /* Stronger border */
    outline: none;
}
```

**Key properties:**

- `background`: Solid blue tint (18% opacity) replaces gradient
- `border-color`: Uses stronger accent color (`--mo-border-strong`)

### Orientation-Specific Sizing

**Vertical splitter (between horizontal panes):**

```css
.split-view__splitter[data-orientation='row'] {
    cursor: col-resize;
    width: 6px;
    min-width: 6px;
}
```

**Horizontal splitter (between vertical panes):**

```css
.split-view__splitter[data-orientation='column'] {
    cursor: row-resize;
    height: 6px;
    min-height: 6px;
}
```

**To customize:**

- Change `width`/`height` to adjust splitter thickness
- Modify `background` colors for different inactive appearance
- Update hover colors to match your theme accent
- Adjust `transition` duration for faster/slower hover effects

---

## Floating Window Header Height

Located in `overlay-window.css`:

### Header Height Calculation

The header height is determined by:

```css
.overlay-window__header {
    padding: 6px 8px; /* Top/bottom padding: 6px each = 12px total */
}

.overlay-window__title {
    font-size: 12px; /* Title font size */
    font-weight: 700;
}

.overlay-window__icon {
    width: 16px;
    height: 16px; /* Icon dimensions */
}

.overlay-window__btn {
    width: 22px;
    height: 20px; /* Button dimensions (minimize, close, etc.) */
}
```

**Total height calculation:**

- Top padding: `6px`
- Bottom padding: `6px`
- Content height: Tallest element (buttons at `20px` or icon at `16px`)
- **Approximate total:** ~32px

**To increase header height:**

1. Increase vertical padding: `padding: 8px 8px;` (would add 4px)
2. Increase icon size: `height: 18px;`
3. Increase button size: `height: 24px;`

**To decrease header height:**

1. Reduce padding: `padding: 4px 8px;` (would remove 4px)
2. Reduce font size: `font-size: 11px;`
3. Reduce icon/button sizes proportionally

---

## Control Tab Icons

Located in `tabbed-view.css`:

### Control Tab Icon Configuration

**Icon size and appearance:**

```css
.tabbed-view__control-icon {
    width: 14px; /* Icon width */
    height: 14px; /* Icon height */
    object-fit: contain; /* Maintain aspect ratio */
    opacity: 0.9; /* Slightly transparent */
}
```

**Control tab container:**

```css
.tabbed-view__tab--control {
    min-width: 24px; /* Minimum width to accommodate icon */
    padding: 5px; /* Padding around icon */
    gap: 4px; /* Space between icon and label (if present) */
}
```

### Special Control: Tabs-Only Toggle

The built-in tabs-only toggle (arrow icon that minimizes view) uses a different class:

```css
.tabbed-view__tabs-toggle-icon {
    width: 30px; /* Larger than regular control icons */
    height: 30px;
    object-fit: contain;
    transform: rotate(var(--tabs-toggle-rotation, 0deg)); /* Rotation based on position */
    transition: transform 160ms ease;
    filter: brightness(1.05); /* Slight brightness boost */
}
```

**Parent button:**

```css
.tabbed-view__tabs-toggle {
    width: 22px; /* Button dimensions */
    height: 22px;
    padding: 3px; /* Tight padding */
    color: var(--mo-text, #e5eaf3);
}

.tabbed-view__tabs-toggle:hover {
    color: var(--mo-accent, #63b5ff); /* Accent color on hover */
}

.tabbed-view__tabs-toggle.is-toggled {
    color: var(--mo-accent, #63b5ff); /* Accent color when active */
}
```

### Where Icons Are Defined

Icons themselves are **not defined in CSS**—they come from:

1. **SVG/image files** in `src/micro_otter/nodes/html/icons/`
2. **TypeScript** sets the icon via:
    - `TabbedView.setControls([{ icon: '+', ... }])` (text or HTML)
    - `TabbedView` internally uses `arrow-drop-up` icon for tabs-only control

**To change control tab icons:**

1. **In TypeScript:** Pass different `icon` values when calling `.setControls()`
2. **CSS sizing:** Adjust `.tabbed-view__control-icon` dimensions
3. **Special toggle:** Icon file is loaded by `TabbedView` class implementation

---

## Custom Runtime Views

Custom runtime views are composed from standard view-system components. There is no
renderer-specific stylesheet: `CustomViewRenderer` builds a `StackView` tree, uses
`ToolbarView`, `SplitView`, and `CollapsibleView` for structure, and renders text in
`MessageView`.

Files: `stack-view.css`, `message-view.css`, `collapsible-view.css`, `split-view.css`,
`toolbar-view.css`, and `custom-runtime-controls.css`.

### Renderer Layout

```
StackView (content, fill)
└─ CollapsibleView (optional top-level showHeader)
   └─ StackView (body)
      ├─ MessageView (description)
      ├─ MessageView (setup state)
      ├─ ToolbarView
      └─ SplitView (vertical sections)
         └─ CollapsibleView (section)
            └─ StackView (form, striped)
               └─ StackItem / row StackView
```

`row` entries render as a horizontal `StackView` with `align: flex-end`; `stack`
entries map directly to `StackView` orientation, gap, wrap, and alignment.

**Sizing patterns:**

- `grow: true` in JSON → `StackItem` grow → `.stack-view__item--grow`
- `width: "100px"` in JSON → fixed item width → `.stack-view__item--fixed`
- Neither → natural control width

`StackView` owns the flex container, so controls only need `box-sizing: border-box` and
`min-width: 0`; no row-specific wrapper classes are involved.

### Control Styling (`custom-runtime-controls.css`)

**Checkbox with label-right layout:**

```css
.custom-control--checkbox {
    display: inline-flex;
    align-items: center;
    gap: 6px; /* Space between checkbox and label */
}

.custom-control--checkbox input[type='checkbox'] {
    order: -1; /* Positions checkbox before label */
}
```

**Button with icon support:**

```css
.custom-control--button {
    display: inline-flex;
    align-items: center;
    gap: 4px; /* Space between icon and text */
}

.custom-control--button .material-icons {
    font-size: 16px; /* Icon size */
}
```

**Icon-only button (compact mode):**

```css
.custom-control--button.icon-only {
    width: 24px;
    height: 24px;
    padding: 2px; /* Minimal padding */
}

.custom-control--button.icon-only .button-text {
    display: none; /* Hide text, show only icon */
}
```

Icon-only buttons use the translated `label` as tooltip and `aria-label` for accessibility.

**Input sizing in rows:**

```css
input[type='text'],
input[type='number'],
select {
    box-sizing: border-box; /* Include padding/border in width calculation */
    min-width: 0; /* Allow flex shrink below content size */
}
```

Without these properties, inputs can overflow their flex containers when the row width changes.

### Section Alternating Background

A section form `StackView` sets `striped: true`. The background alternates on direct item
hosts, and row/stack groups are themselves one direct item, so row children never receive
the zebra pattern:

```css
.stack-view--striped > .stack-view__item:nth-child(even) {
    background: rgba(255, 255, 255, 0.02);
}
```

**Visual hierarchy:**

- Toolbar: compact `ToolbarView` at the top of the content stack
- Sections: `CollapsibleView` panes inside a vertical `SplitView`
- Controls: `StackView` items, striped at the section level
- Rows: horizontal `StackView`, transparent background

---

## Graph Panel Layout & Toolbar

File: `graph-panel-view.css` (registered in `styles/themes.json` as `graph-panel-view`).

### Flex column skeleton

The graph panel does not use `SplitView`. It is a plain flex column with a fixed-height toolbar
row above the canvas area:

```css
.graph-panel-view {
    display: flex;
    flex-direction: column;
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
}

.graph-panel-view__toolbar {
    flex: 0 0 auto;
    min-width: 0;
}

.graph-panel-view__toolbar:empty {
    display: none;
}

.graph-panel-view__canvas {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}

.graph-panel-view__canvas > canvas {
    display: block;
}
```

Why these properties:

- `__canvas` is `position: relative` so the absolutely positioned `<canvas>` (inline
  `position: absolute; top: 0; left: 0`) has an explicit containing block instead of relying on
  the tab pane being positioned.
- `overflow: hidden` keeps the transient overlays (rubber band, capability tooltip) from pushing
  the panel's scroll into the tab strip.
- `min-width`/`min-height: 0` allow the canvas host to shrink inside a flex container — without
  them a flex item refuses to go below its content size and the canvas would overflow.
- `__toolbar:empty` hides the row entirely for panels that never mount a toolbar.

### Toolbar row

`ToolbarView` draws its own border/background (`toolbar-view.css`) and locks its height inline via
`setHeightConstraints({ minHeight: 36, maxHeight: 36 })`. The panel only adds scoping rules, never
a `height` (that would fight the inline height):

```css
.graph-panel-view__toolbar .view-toolbar {
    width: 100%;
}

.graph-panel-view__toolbar .view-toolbar__controls {
    padding: 0 4px;
    gap: 4px;
    align-items: center;
}

.graph-panel-view__toolbar .view-toolbar__separator {
    /* The shared rule uses --mo-border (8 % white), which is invisible on the panel toolbar. */
    width: 1px;
    height: 20px;
    margin: 0 4px;
    background: currentColor;
    opacity: 0.25;
}
```

### Compact inline controls

The shared runtime control styling (`custom-runtime-controls.css`) stacks the label above the
input (~43 px tall), which does not fit the 36 px toolbar row. The panel overrides that only
inside its own control wrappers:

```css
.graph-panel-view__toolbar-control {
    display: flex;
    align-items: center;
}

.graph-panel-view__toolbar-control[hidden] {
    display: none;
}

.graph-panel-view__toolbar-control .custom-control {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 4px;
    margin: 0;
    padding: 0;
}

.graph-panel-view__toolbar-control .custom-control__label {
    display: inline;
    margin: 0;
    white-space: nowrap;
    font-size: 0.7rem;
    opacity: 0.85;
}

/* The execution-type dropdown is untitled; drop its empty label so it adds no gap. */
.graph-panel-view__toolbar-control .custom-control__label:empty {
    display: none;
}

.graph-panel-view__toolbar-control .custom-control__input {
    height: 24px;
    padding: 0 4px;
    font-size: 0.7rem;
}

.graph-panel-view__toolbar-control .custom-control--number .custom-control__input {
    /* Five digits (60000) plus the native number spinner; box-sizing is border-box. */
    width: calc(5ch + 34px);
}
```

Notes:

- `[hidden]` must be re-declared because the parent rule sets `display: flex`, which would
  otherwise win over the UA default for `[hidden]`. The graph panel uses this to hide the sleep
  control for `startup` graphs.
- `:empty` is what removes the phantom label of the untitled execution-type dropdown — the shared
  `DropdownControl` always renders `.custom-control__label`, even for an empty label string.
- The enabled checkbox is not part of this toolbar; graph enablement lives in the graph-tab context
  menu, so the panel only keeps the execution-type and sleep controls compact.
- The number input is sized in `ch` so it keeps fitting five digits when the theme or the browser
  zoom changes the font size; the `+ 34px` covers padding, border and the native spinner
  (`box-sizing: border-box`).
- All rules stay scoped under `.graph-panel-view__toolbar` / `.graph-panel-view__toolbar-control`,
  so `custom-runtime-controls.css` and `toolbar-view.css` remain unchanged for every other view.
- `tests/views/graph-panel-layout.test.js` asserts these selectors exist, that the canvas rules
  reference the canvas theme variables, and that the stylesheet never sets a `height` on
  `.view-toolbar`.

### Canvas background (enabled vs. disabled)

The canvas host paints the background; the `<canvas>` itself is only ever cleared, so it stays
transparent and the host colour shows through:

```css
.graph-panel-view__canvas {
    /* The canvas is only ever cleared, never painted opaque, so this shows through. */
    background-color: var(--mo-graph-canvas-bg, #0e141f);
}

/* Disabled graphs are excluded from transpilation: the canvas drops to a neutral gray. */
.graph-panel-view__canvas--disabled {
    background-color: var(--mo-graph-canvas-bg-disabled, #232830);
}
```

Why dedicated variables instead of `--mo-surface-*`: the graph canvas is the only place that needs
to distinguish "actively transpiled" from "parked", and a dedicated pair lets another theme mute the
canvas without touching panels, splits or overlays. `GraphPanelView._applyEnabledVisualState()`
toggles the modifier class.

`ToolbarView` also ships a generic host rule for controls added with
`toolbarView.addControl(control, options)`:

```css
/* toolbar-view.css — wrapper created by ToolbarView.addControl() */
.view-toolbar__control {
    display: flex;
    align-items: center;
    min-width: 0;
}
```

A `CheckboxControl` has no horizontal padding of its own, unlike a toolbar button (`padding: 6px 10px`)
or a text input (`padding: 6px 8px`). Placed right after a button in a row it would therefore be
separated only by the row gap (`--mo-gap`, `1px` by default) and look glued to its neighbour. One
shared rule gives every toolbar checkbox the same optical margin a button's own padding provides:

```css
/* toolbar-view.css — checkbox controls inside a toolbar row */
.view-toolbar__controls .custom-control--checkbox {
    padding: 0 6px;
}
```

Why it lives here and not in `firmware-build-view.css`: the spacing belongs to the toolbar context,
so the build and deploy rows (and any future toolbar checkbox) share it instead of each view
inventing its own offset. Why only horizontal padding: the row keeps its 36px height, and the rule is
scoped to `.view-toolbar__controls`, so the same control inside a settings group or a node UI panel
keeps its zero padding. `tests/views/toolbar-view.test.js` asserts the rule keeps a non-zero
horizontal padding while the vertical value stays `0`.

---

## Icon Control Picker (`controls/icon-control.css`)

Imported at the top of `graph-panel-view.css` (`@import './controls/icon-control.css';`), because
the icon control editor is rendered into the graph panel's node editor surface. The stylesheet is
self-contained and does not leak into other views.

```css
@font-face {
    font-family: 'micro-otter-mdi';
    src: url('/html/vendor/mdi/materialdesignicons-webfont.woff2') format('woff2');
    font-display: block;
}

.icon-control__glyph {
    font-family: 'micro-otter-mdi';
    font-size: 24px;
    line-height: 1;
    color: inherit;
}
```

Notes:

- The WOFF2 is the vendored `@mdi/font` file served from `/html/vendor/mdi/`; there is no CDN
  request, and the font-family name is quoted everywhere it is used (the hyphen would otherwise
  read as an identifier separator). The same `@font-face` feeds the node canvas: the icon control
  calls `document.fonts.load('14px "micro-otter-mdi"')` once an `mdi:` value needs a glyph, then
  asks `NodeUi.requestRepaint()` for a redraw — a canvas glyph never triggers the font load on its
  own, so without that call it would stay a tofu box.
- `color: inherit` is the reason for shipping a font instead of per-icon SVGs: the glyph follows
  the theme text colour (and any future accent/hover colour) with no extra rules.
- `.icon-control__popover` is absolutely positioned **inside** the control wrapper (the wrapper is
  forced to `position: relative` by the control when needed) and uses the same
  background/border/shadow variables as the dropdown menu (`.node-control-ui__dropdown-menu`), so
  it stays below the modal layer. `.icon-control__grid` is an auto-fill 36 px grid with a max
  height and scroll; `.icon-control__tile[aria-selected='true']` marks the active tile.
- The stylesheet is asserted only by class name in `tests/nodes/node-controls-dom.test.js` and
  `tests/nodes/node-ui-controls-integration.test.js` (the repo does not assert computed CSS), so
  renaming a class means updating those tests.

---

## Context Menu (`menu.css`)

The menu rows rendered by `MenuView` are styled in `menu.css` (see
[Menu System](menu-system.md#styling-hooks) for the markup contract):

```css
/* Row states */
.menu__item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    white-space: nowrap;
}
.menu__item:hover:not(.menu__item--disabled),
.menu__item--selected,
.menu__item:focus {
    background: var(--mo-accent, #63b5ff);
    color: var(--mo-bg, #0c0f16);
    outline: none;
}
.menu__item--disabled {
    opacity: 0.4;
    cursor: not-allowed;
}
```

```css
/* Nested-menu affordances: a `menuview` row and its child state */
.menu__submenu-arrow {
    margin-left: auto; /* trailing chevron ▸ */
    padding-left: 16px;
    flex: 0 0 auto;
    font-size: 10px;
    line-height: 1;
    opacity: 0.7;
}
.menu__item--submenu[aria-expanded='true'] {
    background: var(--mo-accent, #63b5ff);
    color: var(--mo-bg, #0c0f16);
}
.menu__item--submenu[aria-expanded='true'] .menu__submenu-arrow {
    opacity: 1; /* chevron at full strength while the child is open */
}
```

- The expanded state is keyed on `aria-expanded`, not on a modifier class: `MenuView` has to set the
  ARIA attribute for screen readers, so one source drives both.
- `.menu__submenu-arrow` and `.menu__shortcut` both sit at the right edge; a `menuview` row with a
  `shortcut` renders chevron first, then the shortcut.
- Row internals (`.menu__icon`, `.menu__icon-img`, `.menu__label`, `.menu__shortcut`,
  `.menu__checkbox`, `.menu__separator`) are unchanged by nesting; the child menu is a separate
  `.menu` on the overlay layer, so it needs no submenu-specific container rules.

---

## Theme Variables Reference

All spacing/color values reference CSS variables defined in `view-system.css`:

```css
:root {
    --mo-bg: #0c0f16; /* Background color */
    --mo-surface-0: #0f141f; /* Deepest surface */
    --mo-surface-1: #121927; /* Mid-level surface */
    --mo-surface-2: #172133; /* Brightest base surface; nested headers use a component fallback */
    --mo-graph-canvas-bg: #0e141f; /* Graph canvas background (enabled graph) */
    --mo-graph-canvas-bg-disabled: #232830; /* Graph canvas background (disabled graph) */
    --mo-border: rgba(255, 255, 255, 0.08); /* Default border */
    --mo-border-strong: rgba(118, 188, 255, 0.6); /* Accent border */
    --mo-text: #e5eaf3; /* Text color */
    --mo-muted: rgba(229, 234, 243, 0.75); /* Muted text */
    --mo-accent: #63b5ff; /* Accent color */
    --mo-accent-boost: #8bf0d2; /* Bright accent */
    --mo-shadow: 0 8px 28px rgba(0, 0, 0, 0.32); /* Drop shadow */
    --mo-radius: 8px; /* Border radius */
    --mo-gap: 6px; /* Gap between elements */
    --mo-padding: 8px; /* Base padding */
}
```

**To globally adjust spacing:** Modify these variables in `view-system.css` and all components will update automatically.

---

## Quick Reference: Common Customizations

### Make Everything More Compact

1. Reduce base variables in `view-system.css`:

    ```css
    --mo-radius: 6px;
    --mo-gap: 4px;
    --mo-padding: 6px;
    ```

2. Reduce font sizes in component files:
    ```css
    .overlay-window__title {
        font-size: 11px;
    }
    .tabbed-view__tab-label {
        font-size: 10px;
    }
    ```

### Make Splitters Thicker/More Visible

In `split-view.css`:

```css
.split-view__splitter[data-orientation='row'] {
    width: 10px;
    min-width: 10px;
}

.split-view__splitter[data-orientation='column'] {
    height: 10px;
    min-height: 10px;
}

.split-view__splitter {
    background: rgba(255, 255, 255, 0.12); /* More opaque */
}
```

### Increase Floating Window Header

In `overlay-window.css`:

```css
.overlay-window__header {
    padding: 10px 12px; /* Was 6px 8px */
}

.overlay-window__icon {
    width: 20px;
    height: 20px; /* Was 16px */
}

.overlay-window__title {
    font-size: 14px; /* Was 12px */
}
```

### Make Control Icons Larger

In `tabbed-view.css`:

```css
.tabbed-view__control-icon {
    width: 18px; /* Was 14px */
    height: 18px;
}

.tabbed-view__tab--control {
    min-width: 28px; /* Was 24px */
    padding: 6px; /* Was 5px */
}
```

---

## Activity Pulse (`activity-pulse.css`)

A layout-neutral "something is happening" cue any view can switch on. The stylesheet is loaded
globally through the theme manifest (`styles/themes.json`) and the `DEFAULT_THEME_STYLES` fallback in
`js/views/view-theme-registry.ts`.

```css
@keyframes mo-activity-pulse {
    0%,
    100% {
        box-shadow: inset 0 0 0 0 rgba(99, 181, 255, 0);
    }
    50% {
        box-shadow: inset 0 0 18px 1px rgba(99, 181, 255, 0.32);
    }
}

.mo-activity-pulse {
    animation: mo-activity-pulse 1.7s ease-in-out infinite;
}
```

`ActivityPulse` (`js/views/activity-pulse.ts`) toggles the class through named reasons
(`start(reason)`, `stop(reason)`, `stopAll()`); the class is present while at least one reason is
active, so independent activities compose instead of cancelling each other. `WorkspaceView` wraps it
as `setActivityPulse(reason, active)` and uses the reason `'device-connection'` while a device
attempt runs.

**Why `box-shadow`?** Hosts such as the workspace title bar set `background-color` and
`border-bottom` *inline*; animated background or border rules would lose to them. An inset shadow
never reflows and always owns its property.

**Reduced motion.** `@media (prefers-reduced-motion: reduce)` drops the animation and leaves a
static, faint accent ring, so the cue survives without movement.

**Keyframe naming.** Standard-theme keyframes are global to the page; `pulse` and
`button-success-pulse` already exist, which is why this one is namespaced `mo-activity-pulse`.

---

## File Locations Summary

| Component               | CSS File                      | Key Classes                                                                |
| ----------------------- | ----------------------------- | -------------------------------------------------------------------------- |
| Split containers        | `split-view.css`              | `.split-view`, `.split-view__pane`, `.split-view__splitter`                |
| Tabbed views            | `tabbed-view.css`             | `.tabbed-view__tab`, `.tabbed-view__content`, `.tabbed-view__control-icon` |
| Floating windows        | `overlay-window.css`          | `.overlay-window`, `.overlay-window__header`, `.overlay-window__body`      |
| Custom runtime layout   | `stack-view.css`              | `.stack-view`, `.stack-view__item`, `.stack-view--striped`                 |
| Runtime messages        | `message-view.css`            | `.message-view`, `.message-view--info`, `.message-view--error`             |
| Custom runtime controls | `custom-runtime-controls.css` | `.custom-control--button`, `.custom-control--checkbox`, `.custom-control.is-invalid` |
| Graph panel layout      | `graph-panel-view.css`        | `.graph-panel-view`, `.graph-panel-view__toolbar`, `.graph-panel-view__canvas`, `.graph-panel-view__toolbar-control` |
| Documentation areas     | `graph-panel-documentation-areas.css` | `.graph-panel-view__documentation`, `.graph-panel-doc-area`, `.graph-panel-doc-area__header`, `.graph-panel-doc-area__title`, `.graph-panel-doc-area__menu`, `.graph-panel-doc-area__body`, `.graph-panel-doc-area__editor`, `.graph-panel-doc-area__resize` |
| Data tables             | `data-table-view.css`         | `.data-table-view`, `.data-table-view--dense`, `.data-table-view--striped`, `.data-table-view__cell--label` |
| Icon control picker     | `controls/icon-control.css`   | `.icon-control`, `.icon-control__popover`, `.icon-control__grid`, `.icon-control__tile`, `.icon-control__glyph` |
| Firmware build view     | `firmware-build-view.css`     | `.firmware-build-view`, `.firmware-build-view__content`, `.firmware-build-view__offline`, `.firmware-build-view__diagnostics`, `.firmware-build-view__*-host` |
| Workspace view          | `workspace-view.css`          | `.workspace-server-badge`, `.workspace-device-badge`, `.workspace-device-badge__label`, `.workspace-device-badge__percent`, `.workspace-device-badge__ring` |
| Activity pulse          | `activity-pulse.css`          | `.mo-activity-pulse`                                                       |
| Device connection dialog | `device-connection-dialog.css` | `.device-connection-dialog`, `.device-connection-dialog__row`, `.device-connection-dialog__status`, `.device-connection-dialog__hint` |
| Determinate progress detail | `progress-detail-view.css` | `.progress-detail-view`, `.progress-detail-view__tier`, `.progress-detail-view__bar-wrapper`, `.progress-detail-view__bar` |
| Deployment progress dialog | `deployment-progress-dialog.css` | `.deployment-progress-dialog`, `.deployment-progress-dialog__phase`, `.deployment-progress-dialog__detail` |
| Connecting progress dialog | `connecting-progress-dialog.css` | `.connecting-progress-dialog`, `.connecting-progress-dialog__status`, `.connecting-progress-dialog__detail` |
| Theme variables         | `view-system.css`             | `:root` CSS custom properties                                              |
| Modal dialogs           | `modal-dialog.css`            | `.modal-dialog__surface`, `.modal-dialog__icon`, `.modal-dialog__icon-img` |
| Text views              | `text-view.css`               | `.view-text`                                                               |
| View manager layers     | `view-manager.css`            | `.view-manager__layer`                                                     |

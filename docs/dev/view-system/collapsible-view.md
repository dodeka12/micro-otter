# CollapsibleView

A container view with a collapsible header and content panel. Extends ViewBase.

## Overview

CollapsibleView provides a header bar with a title and toggle button (chevron icon) that controls visibility of a content panel below. When collapsed, it automatically constrains its height to match the header height, making it ideal for use in SplitView containers.

## Features

- **Header with Title**: Customizable header text
- **Header Click**: Clicking anywhere on the header toggles the view; the chevron button stays the keyboard path
- **Toggle Button**: Chevron icon that rotates when toggled
- **Solo Button**: On a direct SplitView pane, a "+" action expands this section and collapses its sibling collapsible panes
- **Content Panel**: Can host any ViewBase-based view
- **State Management**: Collapsed/expanded state with automatic UI updates
- **SplitView Integration**: Sets min/max height constraints when collapsed to fix splitter position
- **Serialization**: Full support for workspace persistence
- **i18n Support**: Translatable button tooltips and accessible labels

## Usage

### Basic Usage

```ts
import { CollapsibleView } from './views/collapsible-view.ts';
import { TextView } from './views/text-view.ts';

// Create a collapsible section with text content
const contentView = new TextView({ text: 'Hello, world!' });
const collapsible = new CollapsibleView({
    headerTitle: 'My Section',
    collapsed: false,
    contentView: contentView,
});

// Attach to container
collapsible.attachTo(document.getElementById('container'));
```

### With SplitView

```ts
import { SplitView } from './views/split-view.ts';
import { CollapsibleView } from './views/collapsible-view.ts';
import { TextView } from './views/text-view.ts';

// Create collapsible sections
const section1 = new CollapsibleView({
    headerTitle: 'Section 1',
    contentView: new TextView({ text: 'Content 1' }),
});

const section2 = new CollapsibleView({
    headerTitle: 'Section 2',
    collapsed: true,
    contentView: new TextView({ text: 'Content 2' }),
});

// Add to vertical split
const split = new SplitView({
    orientation: 'vertical',
    views: [section1, section2],
});

split.attachTo(document.getElementById('container'));
```

## Constructor Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `headerTitle` | `string` | `'Section'` | Title text displayed in header |
| `collapsed` | `boolean` | `false` | Initial collapsed state |
| `collapsible` | `boolean` | `true` | When `false`, render a static, always-open header with no toggle or solo button |
| `contentView` | `ViewBase\|null` | `null` | Child view for content panel |
| `headerHeight` | `number` | `28` | Height of header in pixels (min: 24) |
| `sizeToContent` | `boolean` | `false` | Measure the content view and cap the expanded pane to its natural height |
| `nested` | `boolean` | `false` | Render the sub-section variant: the header uses `var(--mo-surface-3, #1c2a40)` and the title a lighter weight, so a collapsible nested inside another collapsible reads as one level below it |
| `contentGuide` | `boolean` | `false` | Draw a vertical guide line down the inline-start edge of the content panel (spanning the content height) so the expanded content reads as a child of the header; the inset width is the `--collapsible-guide-inset` CSS variable |
| `title` | `string` | `'Collapsible'` | View title for metadata |
| `icon` | `string\|null` | `null` | Icon identifier |
| `id` | `string\|null` | `null` | Explicit view id (auto-generated if omitted) |
| `logger` | `Function\|null` | `null` | Logger instance |
| `i18nService` | `Object\|null` | `null` | Translation service |

## Properties

### `headerTitle` (string)
Get/set the header title. Updates UI immediately if attached.

```ts
collapsible.headerTitle = 'New Title';
```

### `collapsed` (boolean)
Get/set the collapsed state. Updates UI and height constraints immediately if attached.

```ts
collapsible.collapsed = true; // collapse
collapsible.collapsed = false; // expand
```

### `contentView` (ViewBase|null)
Get/set the content view. Automatically detaches old view and attaches new one if container is ready.

```ts
collapsible.contentView = new TextView({ text: 'New content' });
```

### `sizeToContent` (boolean)
Get/set content-height sizing. When enabled, the expanded view measures its rendered header and
content root and publishes `header + content + content box padding + 2px pane border` as `maxHeight`.
The content box padding is the vertical padding of `.collapsible-view__content`, so a theme that pads
the content container does not get a cap that is one padding short (the Firmware tab pads it 8 px
top and bottom; the Settings panels do not pad it). Enabling the mode clears any height remembered
from a previous collapse/expand cycle.

A capped pane keeps filling as a sibling grows: `SplitView` scales the pane flex factors relative to
the smallest ratio, so the space a capped neighbour releases goes to the panes that can still use it
instead of staying empty below the split (see
[View Size Constraint Propagation](view-constraints.md#ratio-to-flex-conversion)).

```ts
collapsible.sizeToContent = true;
```

### `nested` (boolean)
Get/set the sub-section variant. `true` toggles the `collapsible-view--nested` class on the rendered
root: the header surface moves one step above the base header (base `--mo-surface-2`, nested
`var(--mo-surface-3, #1c2a40)`) and the title uses a lighter weight, so a collapsible nested inside
another collapsible reads as one level below the card that holds it. The option is opt-in; a view
never becomes nested just because its DOM parent is another collapsible. Changing the property after
render updates the class immediately.

```ts
collapsible.nested = true;
```

### `contentGuide` (boolean)
Get/set the content guide line. `true` toggles the `collapsible-view--content-guide` class on the
rendered root: the content panel gains a small inline-start inset and a 1 px vertical line down its
leading edge, so the expanded content reads as a child of the header. The inset width is the
`--collapsible-guide-inset` CSS variable (default 8 px), so a theme can tune it without another
option. The line is part of the content panel, so it hides together with the content while the
section is collapsed.

```ts
collapsible.contentGuide = true;
```

### `isCollapsible` (readonly boolean)

Structural marker for the SplitView solo contract. A direct pane child that exposes this flag plus
the public `collapse()`/`expand()` methods takes part in a sibling's solo request; see
[Header Interaction and Solo Action](#header-interaction-and-solo-action). The value is
`false` when the view was constructed with `collapsible: false`, so a static section never
takes part in solo handling.

### `collapsible` (readonly boolean)
Return whether the header can toggle the content. A static section stays expanded and
renders `.collapsible-view--static`.

## Methods

### `toggle()`
Toggle between collapsed and expanded states.

```ts
collapsible.toggle();
```

### `collapse()`
Collapse the view (hide content panel).

```ts
collapsible.collapse();
```

### `expand()`
Expand the view (show content panel).

```ts
collapsible.expand();
```

## Header Interaction and Solo Action

Clicking anywhere on the header toggles the view. Clicks that land on a header button are left to
that button, so the chevron does not toggle twice. The header is only a pointer shortcut: it has no
`role="button"` and no tab stop, so the chevron button remains the keyboard-accessible control (both
buttons carry a translated `title` and `aria-label`).

When the view is attached as a direct `SplitView` pane, `render()` adds a solo button ("+" icon)
after the title. Clicking it does not toggle locally; it calls
`ViewBase.requestSplitViewSolo()`, which dispatches a `splitview:solo-request` message on the pane
channel. The hosting `SplitView` then:

- expands the requesting pane, and
- collapses every other **direct** child that advertises `isCollapsible`.

The host reports `{ handled, hosted, hostId, viewId, paneIndex, collapsedViewIds }` in the mutable
`event.detail`, and emits a `layoutChange` event with `source: 'solo'`. Collapsibles nested deeper
than the pane, non-collapsible panes (a `DummyView`, a `TabbedView`), and nested `SplitView` hosts
are untouched. The expanded section still honours its `sizeToContent` cap, so a soloed settings
section grows only to its content height.

```ts
const split = new SplitView({ orientation: 'vertical', views: [section1, section2] });
split.attachTo(container);

// Programmatic equivalent of the "+" button:
section1.requestSplitViewSolo();
```

The solo button only appears while a pane channel exists; a standalone or nested collapsible never
renders it.

## Height Constraints

When collapsed:
- Sets `minHeight` = `headerHeight`
- Sets `maxHeight` = `headerHeight`
- Notifies parent SplitView to fix splitter at header height

When expanded without `sizeToContent`:
- Sets `minHeight` = `headerHeight`
- If `contentView.maxHeight` is a positive finite value, sets
  `maxHeight` = `headerHeight + max(contentView.minHeight ?? 0, contentView.maxHeight)` so a
  genuinely fixed-height content view (for example `ToolbarView`, which declares `min == max`) keeps
  its cap
- Otherwise sets `maxHeight` = `null` so free-form content can fill the available space and scroll.
  A content minimum alone is **not** a fixed height: `CustomRuntimeView` declares `minHeight = 72`
  and no maximum, and must be allowed to fill its collapsible pane
- Restores the height remembered from a real collapse (`desiredSize`), so a section the user
  collapsed returns to its previous size. A section that starts collapsed has nothing to remember and
  therefore just grows into its share of the parent space — it never restores a stale header-only
  height.

When expanded with `sizeToContent`:
- Sets `minHeight` = `headerHeight`
- Measures the rendered header (falling back to `headerHeight` when the measurement is unavailable)
  and the content view's rendered root
- With a content measurement, sets
  `maxHeight` = `ceil(measuredHeader + max(measuredContent, contentView.minHeight ?? 0) +
  contentPadding + 2)`; `contentPadding` is the vertical padding of `.collapsible-view__content` and
  the extra `2px` accounts for the pane border
- Without a content measurement, falls back to `headerHeight + contentView.minHeight + contentPadding`
  when that minimum is positive, otherwise leaves `maxHeight` = `null`
- Re-measures when the content root resizes, the content view changes, or `refreshSize()` is called

A collapsed pane keeps its fixed header height, but it does **not** lock the adjacent splitters in a
parent `SplitView`: a splitter remains movable as long as there is a flexible pane on each side of
it. Dragging a splitter next to a collapsed pane resizes the nearest flexible pane on each side and
keeps the collapsed pane at its header height.

## Serialization

CollapsibleView supports full serialization for workspace persistence:

```ts
// Serialize
const data = collapsible.serialize();
// {
//   type: 'CollapsibleView',
//   headerTitle: 'My Section',
//   collapsed: false,
//   headerHeight: 28,
//   sizeToContent: false,
//   nested: false,
//   contentGuide: false,
//   contentView: { type: 'TextView', text: '...' }
// }

// Deserialize
const restored = CollapsibleView.deserialize(data, {
    i18nService: i18n,
    viewFactory: factory,
});
```

A serialized payload without a `nested` (or `contentGuide`) key restores `false`, so workspaces
written before either option existed keep the default header/content variants.

## Styling

CSS classes follow the BEM convention:

- `.collapsible-view` - Root container
- `.collapsible-view__header` - Header bar (pointer shortcut for the toggle)
- `.collapsible-view__toggle` - Toggle button
- `.collapsible-view__toggle-icon` - Chevron icon (rotates 90° when expanded)
- `.collapsible-view__solo` - Solo button, rendered only on a direct SplitView pane
- `.collapsible-view__solo-icon` - "+" icon (does not rotate with the collapsed state)
- `.collapsible-view__title` - Title text
- `.collapsible-view__content` - Content panel container
- `.collapsible-view.is-collapsed` - Applied when collapsed
- `.collapsible-view--fit-content` - Applied when `sizeToContent` is enabled
- `.collapsible-view--nested` - Applied when `nested` is enabled (sub-section header variant)
- `.collapsible-view--content-guide` - Applied when `contentGuide` is enabled (content guide line)

In fit-content mode the content container scrolls vertically when the pane is smaller than the
measured content, and the content view's rendered root switches to natural-height sizing
(`height: auto; max-height: none; min-height: 0; flex: 0 0 auto`) so its height can be measured.

Default theme: `styles/standard/collapsible-view.css`

## i18n Keys

- `collapsibleView.collapse` - "Collapse section" (toggle tooltip and `aria-label` when expanded)
- `collapsibleView.expand` - "Expand section" (toggle tooltip and `aria-label` when collapsed)
- `collapsibleView.solo` - "Expand this section and collapse the others" (solo tooltip and `aria-label`)

## Examples

### Collapsible Settings Panel

```ts
const settingsView = new FormView({ fields: [...] });
const collapsible = new CollapsibleView({
    headerTitle: 'Advanced Settings',
    collapsed: true,
    contentView: settingsView,
    headerHeight: 28,
});
```

### Reacting to Collapse Changes

CollapsibleView does not emit a collapse-state event. The state is readable at any time through the
`collapsed` property, so a container that must persist or forward it (for example
`AllSettingsView`) reads `collapsed` when it saves instead of listening for an event:

```ts
const states = {
    general: generalCollapsible.collapsed,
    collection: collectionCollapsible.collapsed,
    graph: graphCollapsible.collapsed,
};
```

### Nested Collapsibles

```ts
const innerCollapsible = new CollapsibleView({
    headerTitle: 'Subsection',
    contentView: new TextView({ text: 'Nested content' }),
    nested: true,
});

const outerCollapsible = new CollapsibleView({
    headerTitle: 'Main Section',
    contentView: innerCollapsible,
});
```

The inner view opts into the variant explicitly: nesting is a visual decision, not a DOM-depth
side effect, so an inner collapsible that should look like a peer of its host simply leaves `nested`
at `false`.

## Architecture Notes

- Follows ViewBase lifecycle (render, afterAttach, beforeDetach)
- Only uses documented ViewBase APIs (no private member access)
- Content view is properly managed (attached/detached with parent)
- Height constraints communicated via `setHeightConstraints()`
- Header clicks and both header buttons use standard event listeners added in `afterAttach()` and
  removed in `beforeDetach()`; the header click handler defers to any `<button>` it bubbles through
- The solo action is intent-only: the hosting SplitView performs the expand/collapse through the
  public `isCollapsible`, `collapse()`, and `expand()` API of its direct children
- i18n integration via `t()` helper and language change subscription

## See Also

- [View System Architecture](view-system-architecture.md)
- [View Events](view-events.md) - SplitView pane channel and `layoutChange` payload
- [View Size Constraint Propagation](view-constraints.md)
- [Standard Theme Styling Guide](standard-theme-styling-guide.md)

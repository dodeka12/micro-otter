# TabbedView Tab Variants

## Overview

`TabbedView` exposes an optional, entry-level presentation hook named `tabVariant`. The component
does not know what a variant means; it trims the string and writes a non-empty value to the tab's
`data-tab-variant` attribute. Styling, validation, and meaning belong to the consumer.

`CollectionView` uses the hook to tint every graph tab by its execution type, so the tab strip shows
how each graph runs without opening it:

| Execution type | Tab tint |
| --- | --- |
| `startup` | Blue |
| `continuous` (loop) | Green |
| `irq` (interrupt) | Red |
| `event` | Yellow |
| `function` | Broken white |

The tint is supplementary. The execution type remains visible in the graph toolbar and graph
settings, so the tab label, `data-view-id`, ARIA attributes, and tooltips are unchanged.

## `TabbedViewEntry.tabVariant` contract

The hook lives beside the existing per-tab `movable` flag on the internal tab entry:

```ts
interface TabbedViewEntry {
    // ...
    tabVariant?: string | null;
}
```

| Rule | Behavior |
| --- | --- |
| Optional | Missing, `null`, and non-string values render no attribute. |
| Trimmed | Surrounding whitespace is removed before the value reaches the DOM. |
| Non-empty only | `''` and whitespace-only values render no `data-tab-variant` attribute. |
| Opaque | `TabbedView` does not validate or map the token; unknown values pass through unchanged. |
| DOM location | The value is written to the existing `.tabbed-view__tab` element as `data-tab-variant`. |
| Control tabs | `TabbedView` control tabs never receive the attribute. |
| Repaint | `_renderTabs()` replaces the strip, so removing a value also removes a stale attribute. |

Consumers can therefore treat the attribute as a stable styling selector without teaching
`TabbedView` about graph execution types.

## Value providers

### Active graph: `GraphPanelView.tabVariant`

When a graph is selected, `CollectionView` replaces its placeholder with a real `GraphPanelView`.
The view exposes a getter beside `viewport`:

```ts
get tabVariant() {
    return normalizeExecutionType(this.graph?.getExecutionType?.());
}
```

`normalizeExecutionType()` from
[graph-execution-settings.ts](../../../src/micro_otter/nodes/html/js/data/graph-execution-settings.ts)
accepts case-insensitive, whitespace-padded strings and falls back to `continuous` for missing or
unknown values.

### Inactive graph: `CollectionView` placeholder getter

An inactive graph is represented by a `CollectionTabPlaceholder`. Its `tabVariant` getter reads the
captured graph every time the tab strip renders:

```ts
get tabVariant() {
    return normalizeExecutionType(graph.getExecutionType?.());
}
```

The getter must stay live. A graph can be edited while another graph is active, and the next tab
repaint has to show the new type without waiting for that graph to be selected.

### Why the getters own the value

Both providers normalize through the same function, so there is one definition of the valid types
and one fallback (`continuous`). `TabbedView` and the stylesheet never duplicate that list.

## Live updates

`NodeGraph.setExecutionType()` emits the `executionType` event
(`NodeGraph.ExecutionTypeChanged.v1`). `CollectionView._createTabPlaceholder()` already subscribes
to every graph event for rename handling and extends that listener with an `executionType` branch:

```ts
} else if (event?.name === 'executionType') {
    const isKnownView = this.views.some((view) => view.id === graphId);
    if (isKnownView) {
        this._renderTabs();
        this._log('graph-execution-type-changed', { graphId });
    }
}
```

The listener does not read or validate the event detail; the getters remain the source of the value.
The subscription is registered for every graph, including the active graph after its placeholder is
replaced, so active and inactive tabs both repaint immediately. No second graph subscription is
needed.

## Styling

### Theme tokens

The standard theme defines four tokens per execution type in
[view-system.css](../../../src/micro_otter/nodes/html/styles/standard/view-system.css):

```text
--mo-tab-execution-<type>-bg
--mo-tab-execution-<type>-bg-hover
--mo-tab-execution-<type>-bg-active
--mo-tab-execution-<type>-border
```

`<type>` is one of `startup`, `continuous`, `irq`, `event`, or `function`, for twenty tokens total.
The fills use this alpha ramp:

| Token suffix | Fill |
| --- | --- |
| `-bg` | `linear-gradient(145deg, rgba(255, 255, 255, 0.08), rgba(<accent>, 0.12))` |
| `-bg-hover` | `linear-gradient(145deg, rgba(255, 255, 255, 0.12), rgba(<accent>, 0.16))` |
| `-bg-active` | `linear-gradient(120deg, rgba(<accent>, 0.38), rgba(<deep>, 0.48))` |
| `-border` | `rgba(<accent>, 0.6)` |

`function` is the one exception: it uses a neutral broken-white tint, which needs stronger stops to
avoid reading as a disabled tab — `0.22` for `-bg`, `0.28` for `-bg-hover`, `0.48` accent plus
`0.56` deep for `-bg-active`, and `0.72` for `-border`.

The accent and deep values are:

| Type | Accent | Deep |
| --- | --- | --- |
| `startup` | `#63b5ff` (`99, 181, 255`) | `#3378c4` (`51, 120, 196`) |
| `continuous` | `#8ddc86` (`141, 220, 134`) | `#30844c` (`48, 132, 76`) |
| `irq` | `#ff8f8a` (`255, 143, 138`) | `#a63a3a` (`166, 58, 58`) |
| `event` | `#f5d26e` (`245, 210, 110`) | `#9e7c24` (`158, 124, 36`) |
| `function` | `#e6e1d6` (`230, 225, 214`) | `#837e73` (`131, 126, 115`) |

The `startup` gradient values reproduce the standard theme's original blue tab ramp exactly.

### Variant mapping

[tabbed-view.css](../../../src/micro_otter/nodes/html/styles/standard/tabbed-view.css) maps each
attribute value to four local aliases, then applies the aliases to the tab states. The component
stylesheet contains no execution-type colors of its own:

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

The other four types use the same block with their own token names.

### Cascade rules

- The base variant selector adds `[data-tab-variant]`, so it is more specific than the generic
  `.tabbed-view__tab` rule; the hover/focus variant selector likewise beats the generic hover rule.
- The active variant selector (`[data-tab-variant].is-active`, specificity `0,3,0`) beats the
  generic active rule (`0,2,0`). It has the same specificity as the variant hover selector, but
  appears later in the stylesheet, so an active tab keeps its active fill while hovered.
- The variant rules intentionally do not declare `color`. The existing
  `.tabbed-view__tab.is-active { color: #0b1223; }` keeps the active label dark and readable on
  every fill.
- Padding, radius, shadow, transition, drag, close, icon, and control-tab rules are untouched.

### Theme overrides

A theme overrides tab tints in its own `view-system.css` by redefining the twenty
`--mo-tab-execution-*` tokens. It must not edit `tabbed-view.css`, which stays theme-agnostic. A
theme that renders variants must define these tokens, because the variant rules reference them
without hard-coded fallbacks.

## Tests

- [tabbed-view-tab-variants.test.js](../../../tests/views/tabbed-view-tab-variants.test.js)
  covers the DOM contract (exact, independent, empty, unknown, and control-tab values) and the CSS
  contract (all twenty tokens, gradient stops, mapping selectors, and rule order).
- [collection-view-graph-tab-variants.test.js](../../../tests/views/collection-view-graph-tab-variants.test.js)
  covers all five execution types, active and inactive providers, live `executionType` repaints,
  the `continuous` fallback, and unchanged tab ids and labels.

## Related documents

- [CollectionView Architecture](collection-view-architecture.md)
- [TabbedView Hooks](tabbed-view-hooks.md)
- [TabbedView Tab Reordering](tabbed-view-reordering.md)
- [Standard Theme Styling Guide](standard-theme-styling-guide.md)

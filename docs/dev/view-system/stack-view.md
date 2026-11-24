# StackView

A flexible vertical/horizontal flex container for `ViewBase` children and raw elements.
Extends `ViewBase`.

## Overview

`StackView` is the structural primitive used when a feature needs a column or row without
writing feature-specific flex CSS. It owns the flex container and item hosts; child views
keep their own lifecycle and are attached/detached by the stack.

File: `js/views/stack-view.ts`, theme: `styles/standard/stack-view.css`.

## Constructor Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `orientation` | `'vertical'\|'horizontal'` | `'vertical'` | Stack direction |
| `gap` | `string\|number` | `0` | Gap between items; numbers are pixels |
| `padding` | `string\|number` | `0` | Padding around the items |
| `align` | flex alignment | `'stretch'` / `'flex-start'` | Cross-axis alignment |
| `justify` | flex alignment | `'flex-start'` | Main-axis justification |
| `wrap` | `boolean` | `false` | Wrap horizontal items |
| `fill` | `boolean` | `false` | Fill and shrink inside a flex parent |
| `striped` | `boolean` | `false` | Alternate a subtle background on direct items |

## Items

`addView(view, options)` and `addElement(element, options)` return a `StackItem`:

```ts
const item = stack.addView(new MessageView({ text: 'Saved' }), {
    itemId: 'status',
    grow: true,
    width: 240,
});

item.setHidden(true);
item.setGrow(false);
item.setWidth('50%');
```

| `StackItem` member | Description |
|--------------------|-------------|
| `element` | Item host (`<div class="stack-view__item">`) |
| `itemId` | Stable `data-item-id` |
| `setHidden(hidden)` | Native `hidden` on host and raw content |
| `setGrow(grow)` | Toggle `.stack-view__item--grow` and flex growth |
| `setWidth(width)` | Fixed width; toggles `.stack-view__item--fixed` |

A raw element also receives the `hidden` attribute, so selectors such as
`[data-control-id][hidden]` continue to work.

## Notes

- `serialize()` records structural options and item metadata; child views are runtime-owned.
- `beforeDetach()` detaches every child view, so a stack can be used as the root of a
  feature that rebuilds its view tree.

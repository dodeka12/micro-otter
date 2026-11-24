# Title Content

Displays a centered title with selectable heading level.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Parent` | `web.element` | parent element to place this element into |
| `Title` | `string` | title text to display |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Element` | `web.element` | the rendered web element |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Heading Level` | dropdown | `H2` | HTML heading level (H1–H6) |

## Behaviour

- Both phases: init registers the title element and binds its text key, the loop pushes the current
  `Title`.
- `Heading Level` picks the HTML tag (`H1`–`H6`), so the page keeps a real heading hierarchy for
  screen readers.
- The title is centred; use it for section headings above tables and controls.
- With `Title` unwired the inline text control supplies a static heading that costs no runtime work.
- One element per node — a second heading needs its own node in the tree.

## Example

1. Wire a `Column` slot into `Parent` and set `Heading Level` `H2`.
2. Type a static caption into the inline `Title` control.
3. Wire a string when the heading must show a state, for example the active mode.

## See also

- [Web view package](index.md) — phases and the element tree
- [Content](content.md) — a number instead of a heading
- [Tile](web-view-tile.md) — a card with its own static title


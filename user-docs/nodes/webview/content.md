# Content

Defines content within a web element.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Parent` | `web.element` | parent element to place this element into |
| `Title` | `string` | text displayed for the content |
| `Value` | `float` | numeric value displayed for the content |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Element` | `web.element` | the rendered web element |

## Behaviour

- Both phases: init registers the element and binds its data key, the loop pushes `Value` on every
  pass.
- `Title` is text and `Value` is a single number formatted by the browser; there is no unit field, so
  put units in the title.
- The page shows the newest pushed value whenever it polls, so the visible update rate is the root's
  `Refresh (ms)`, not the graph's pass rate.
- `Value` is a `float` port — a string or a boolean belongs in `Title Content` or a text control.
- One element per node; branch the page with `Row` and `Column` instead of wiring one output twice.

## Example

1. Wire a `Column` slot into `Parent`.
2. Wire a `Variable Read` or `ADC Input` into `Value` and set `Title` to `Temperature`.
3. Place a `Value Table` next to it when several values belong together.

## See also

- [Web view package](index.md) — phases and the refresh contract
- [Title Content](title-content.md) — headings instead of values
- [Value Table](value-table.md) — several label/value rows in one element


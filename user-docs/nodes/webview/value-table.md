# Value Table

Displays up to five label/value rows with dynamic row visibility.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Parent` | `web.element` | parent element to place this element into |
| `Label 1` | `string` | label for row 1 |
| `Value 1` | `float` | value for row 1 |
| `Label 2` | `string` | label for row 2 |
| `Value 2` | `float` | value for row 2 |
| `Label 3` | `string` | label for row 3 |
| `Value 3` | `float` | value for row 3 |
| `Label 4` | `string` | label for row 4 |
| `Value 4` | `float` | value for row 4 |
| `Label 5` | `string` | label for row 5 |
| `Value 5` | `float` | value for row 5 |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Element` | `web.element` | the rendered web element |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Rows` | dropdown | `1` | number of visible rows |
| `Decimal Places` | number | `2` | number of decimal places shown for values |

## Behaviour

- Both phases: init registers the table, the loop pushes the visible label/value pairs on every pass.
- `Rows` decides how many pairs are shown; hidden rows keep their index and their wire, so raising the
  count brings the old rows back.
- `Decimal Places` formats the numbers in the browser; the device always sends the full float.
- Labels are `string` inputs with inline text controls, values are `float` — put units in the label.
- One table per node; a second table needs its own element in the tree.

## Example

1. Wire a `Column` slot into `Parent` and set `Rows` 3.
2. Set `Label 1`–`Label 3` to `Temp`, `Humidity` and `Battery` and wire the matching values.
3. Keep `Decimal Places` 1 for sensors and 0 for counters.

## See also

- [Web view package](index.md) — the element tree
- [Content](content.md) — a single value on its own
- [Line Graph](graph-display.md) — the same data as a curve


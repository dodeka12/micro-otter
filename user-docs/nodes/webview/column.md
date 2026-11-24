# Column

Defines a column layout element.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Parent` | `web.element` | parent element to place this element into |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Row 1` | `web.element` | row 1 layout slot |
| `Row 2` | `web.element` | row 2 layout slot |
| `Row 3` | `web.element` | row 3 layout slot |
| `Row 4` | `web.element` | row 4 layout slot |
| `Row 5` | `web.element` | row 5 layout slot |
| `Row 6` | `web.element` | row 6 layout slot |
| `Row 7` | `web.element` | row 7 layout slot |
| `Row 8` | `web.element` | row 8 layout slot |
| `Row 9` | `web.element` | row 9 layout slot |
| `Row 10` | `web.element` | row 10 layout slot |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Rows` | dropdown | `1` | number of visible rows |

## Behaviour

- Init phase only: registers a flex column with up to ten row slots; the loop contributes nothing.
- Rows inside a column stack vertically with a fixed 10 px gap, so spacing needs no extra elements.
- `Rows` only hides slots — indices and wires stay, and raising it brings the hidden subtree back.
- A column that is a direct child of a `Row` takes an equal share of the width; a column nested deeper
  keeps its natural width instead.
- `Parent` accepts one element and each `Row N` output feeds one subtree, so a single column can hold
  ten leaf nodes.

## Example

1. Wire `Web Root` into `Parent` and set `Rows` to the number of items on the page.
2. Put a `Value Table` in `Row 1` and a `Slider` in `Row 2`.
3. Nest a `Row` inside a slot to split one line into two controls.

## See also

- [Web view package](index.md) — the element tree and the equal-width rule
- [Row](row.md) — the horizontal counterpart
- [Value Table](value-table.md) — a display that fits a single slot


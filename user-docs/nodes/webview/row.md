# Row

Defines a row layout element.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Parent` | `web.element` | parent element to place this element into |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Column 1` | `web.element` | column 1 layout slot |
| `Column 2` | `web.element` | column 2 layout slot |
| `Column 3` | `web.element` | column 3 layout slot |
| `Column 4` | `web.element` | column 4 layout slot |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Columns` | dropdown | `1` | number of visible columns |

## Behaviour

- Init phase only: registers a flex row with up to four column slots; the loop contributes nothing.
- `Columns` decides how many slots are visible, and every direct column child gets an equal share of
  the row width; a wide control shrinks instead of forcing the row to overflow.
- Hidden slots keep their index and their wire, so raising `Columns` brings the old tree back.
- `Parent` accepts exactly one element, and each `Column N` output feeds one subtree — branch deeper
  with a `Column` inside a slot.
- The row itself is transparent: spacing and colour come from the elements inside it.

## Example

1. Wire a `Web Root` or `Column` into `Parent` and set `Columns` 2.
2. Put a `Value Table` in `Column 1` and a `Line Graph` in `Column 2`.
3. Raise `Columns` to 3 to add a control column without rebuilding the first two.

## See also

- [Web view package](index.md) — the element tree and equal-width columns
- [Column](column.md) — the vertical counterpart
- [Content](content.md) — the simplest leaf to place in a slot


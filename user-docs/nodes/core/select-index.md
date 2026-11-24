# Select by Index

Forwards one of up to eight values chosen by a zero-based index.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Index` | `int` `float` | zero-based index of the value to forward; fractions are truncated and an index below 0 or at/above the active value count yields None |
| `Value 1` | `any` | value forwarded at index 0; unconnected it forwards its integer default (0 unless changed) |
| `Value 2` | `any` | value forwarded at index 1; unconnected it forwards its integer default (0 unless changed) |
| `Value 3` | `any` | value forwarded at index 2; unconnected it forwards its integer default (0 unless changed) |
| `Value 4` | `any` | value forwarded at index 3; unconnected it forwards its integer default (0 unless changed) |
| `Value 5` | `any` | value forwarded at index 4; unconnected it forwards its integer default (0 unless changed) |
| `Value 6` | `any` | value forwarded at index 5; unconnected it forwards its integer default (0 unless changed) |
| `Value 7` | `any` | value forwarded at index 6; unconnected it forwards its integer default (0 unless changed) |
| `Value 8` | `any` | value forwarded at index 7; unconnected it forwards its integer default (0 unless changed) |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Value` | `any` | value at the selected index; None when the index is out of range and the integer default when that value is unconnected |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Values` | dropdown | `2` |  |

## Behaviour

- Forwards one of up to eight values by a zero-based index: `Index` 0 forwards `Value 1`.
- `Index` is truncated toward zero and must lie inside the active range; anything below 0 or at or
  above `Values` yields `None` — there is no clamp or wrap mode.
- A non-numeric or non-finite index (a string, `None`, `NaN`, `inf`) also yields `None` without
  raising.
- An active but unconnected `Value N` forwards its inline number, which starts at 0.
- `Values` only hides connectors: connector indices stay stable, and the output union counts only the
  active connected values, so lowering `Values` narrows the type and drops wires that no longer fit.

## Example

1. Drive `Index` from a `Variable Read` and wire eight different constants into the values.
2. Leave `Values` at 2 for a cheap two-way mux, then raise it as the graph grows.
3. Feed the output into `Select` when one branch needs a further condition.

## See also

- [Core package](index.md) — logic nodes and union typing
- [Select](select.md) — the two-way variant driven by a boolean
- [Tuple Select](tuple-select.md) — read one position out of a tuple


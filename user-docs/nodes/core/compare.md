# Compare

Compares two numeric inputs with the selected comparison operator.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `A` | `int` `float` `double` | first value to compare |
| `B` | `int` `float` `double` | second value to compare |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Result` | `bool` | true when the comparison is satisfied |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Op.` | dropdown | `Equal` | comparison operator |
| `Epsilon` | number | `0` | tolerance for equality comparisons |

## Behaviour

- Loop: one boolean comparison per pass; `Result` is true when the selected relation holds.
- `Equal` is `|A − B| <= Epsilon`, so raising `Epsilon` turns it into a "close enough" test; with the
  default 0 it is an exact comparison.
- `Epsilon` also widens the ordered comparisons: `Less Than` needs `A < B − Epsilon`, `Greater Than`
  needs `A > B + Epsilon`, so a noisy signal does not flicker around a threshold.
- A negative or non-numeric `Epsilon` falls back to 0.
- An unwired output emits no code.

## Example

1. Compare a temperature against 25 with `Greater Than` to drive a fan.
2. Use `Equal` with `Epsilon` 0.05 to detect a setpoint that was reached within tolerance.
3. Chain two compares through `Logic` `AND` for a window check.

## See also

- [Core package](index.md) — value nodes and inline defaults
- [Logic](logic.md) — combine several comparisons
- [Range Adapt](range-adapt.md) — clamp or wrap a value instead of testing it


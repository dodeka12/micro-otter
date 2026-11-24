# Math

Applies the selected math operation to the provided inputs.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `In 1` | `float` | first operand |
| `In 2` | `float` | second operand |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Out` | `float` | result of the selected operation |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Operation` | dropdown | `Add` | math operation to apply |
| `Angle Unit` | dropdown | `Degrees` | unit for trigonometric operations |
| `Decimal Places` | number | `0` | number of decimal places kept by the Round operation |

## Behaviour

- Binary operations use both inputs; the unary operations from `Square Root` to `atanh` read only
  `In 1` and hide `In 2` — an existing wire is kept but never read.
- `Divide` returns 0 when the divisor is 0 instead of raising, so a graph survives a zero denominator.
- `Logarithm` uses `In 2` as the base; `Natural Log` ignores `In 2`.
- `Angle Unit` converts the trigonometric inputs before the call — `Percent (0-1)` treats 1 as a full
  turn, so `sin` of 0.25 is 1.
- `Round` uses `Decimal Places` (0–6) and falls back to whole numbers; a `Natural Log` or `Logarithm`
  of a non-positive value, or `Nth Root` of a negative one, raises on the device.

## Example

1. `Multiply` an `ADC Input` by a calibration factor.
2. `Round` a computed angle with `Decimal Places` 1 before it goes into a display.
3. `sin` with `Angle Unit` `Degrees` to turn a phase angle into a level.

## See also

- [Core package](index.md) — value nodes and their fallbacks
- [Array Math](../vars/array-math.md) — the same operations over whole arrays
- [Range Convert](range-convert.md) — non-linear mapping without trigonometry


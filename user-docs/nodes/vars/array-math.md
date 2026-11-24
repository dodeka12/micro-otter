# Array Math

Applies an element-wise operation or a reduction to scalar and/or array operands.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `A` | `float` `int` `bool` `vars.array` | first operand (scalar or array) |
| `B` | `float` `int` `bool` `vars.array` | second operand (scalar or array) |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Result` | `vars.array` | result array or scalar reduction |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Operation` | dropdown | `Add` | operation to apply (element-wise or reduction) |
| `Angle Unit` | dropdown | `Degrees` | unit for trigonometric operations |
| `Decimal Places` | number | `0` | number of decimal places kept by the Round operation |
| `Percent` | number | `100` | portion of the array used by Minimum/Maximum; 100 uses the full array and 0 selects one element |
| `Clamp to 0..1` | checkbox | off | clamp the result to 0..1 |

## Behaviour

- Element-wise when either operand is an array; a scalar is broadcast across the whole array, and two
  scalars produce a length-1 array.
- The reductions change the output type: `Length` emits an `int`, `Minimum`, `Maximum`, `Mean` and
  `Median` emit a `float`, and switching back to an element-wise operation restores `vars.array`.
- `Minimum` and `Maximum` read `Percent` as a share: `Maximum` is the highest value among the lowest
  N % of the array, `Minimum` the lowest among the highest N %; 100 is the plain extreme and 0
  selects a single element.
- Unary operations hide `B` — an existing wire stays but is not read — while `Round` uses
  `Decimal Places` (0–6), trigonometry uses `Angle Unit` and `Minimum`/`Maximum` use `Percent`.
- `Clamp` squeezes every result into 0..1. `Divide` and `Modulus` by zero return 0.0 instead of
  raising, but mismatched array lengths, `Logarithm` of a non-positive value and `Square Root` of a
  negative one raise on the device.

## Example

1. Multiply an `ADC Block` array by a gain to scale a sensor curve.
2. Add a `Sine` pass with `Amplitude` 0.5 and `Offset` 0.5 for a breathing pattern in 0..1.
3. Switch to `Maximum` with `Percent` 100 to read the peak of the pass before it goes to a store.

## See also

- [Vars package](index.md) — the operation families and their runtime names
- [Array Set](array-set.md) — write values before doing maths on them
- [Array Select](array-select.md) — read one element back out


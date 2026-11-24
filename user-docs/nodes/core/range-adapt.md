# Range Adapt

Adapts a numeric value to a range using clamp, wrap, ping-pong, or to-default mode.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Value` | `float` `int` | input value to adapt |
| `Default` | `float` `int` | fallback value for To Default mode |
| `Minimum` | `float` `int` | lower bound of the output range |
| `Maximum` | `float` `int` | upper bound of the output range |
| `Invert` | `bool` | mirror the input across the range before applying the mode |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Value` | `float` | adapted output value |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Mode` | dropdown | `Clamp` | how values outside the range are handled |

## Behaviour

- Bounds come from the `Minimum` and `Maximum` inputs and are swapped when reversed, so `100`..`0`
  behaves like `0`..`100`.
- `Invert` mirrors the value across the range (`low + high − value`) before the mode is applied, so
  clamping and wrapping then work on the mirrored value.
- `Clamp`, `Ping-Pong` and `To Default` include both bounds; `Wrap` maps the upper bound back to the
  lower one, so the maximum itself wraps to the minimum.
- `To Default` reads the `Default` input only when the value is outside the range; the other modes
  ignore that input entirely.
- A zero-width range resolves to `Minimum` in every mode instead of dividing by zero.

## Example

1. `Clamp` an `ADC Input` to 0..3.3 before it feeds a percentage calculation.
2. `Wrap` a counter from a `Variable Read` into 0..7 to address eight LEDs.
3. `Ping-Pong` a ramp so it runs forwards and backwards across a strip.

## See also

- [Core package](index.md) — value nodes and their fallbacks
- [Range Convert](range-convert.md) — map a value across a range instead of folding it back
- [Array Set](../vars/array-set.md) — the same modes for whole arrays


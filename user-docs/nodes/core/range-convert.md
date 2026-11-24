# Range Convert

Maps a value from the input range to the output range with a linear, power (gamma), exponential, or stepped transfer.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Value` | `float` `int` | input value to convert |
| `In Min` | `float` `int` | lower bound of the input range |
| `In Max` | `float` `int` | upper bound of the input range |
| `Out Min` | `float` `int` | lower bound of the output range |
| `Out Max` | `float` `int` | upper bound of the output range |
| `Exponent` | `float` `int` | exponent applied to the normalized position, which gives gamma correction |
| `Sigma` | `float` `int` | steepness of the exponential transfer |
| `Steps` | `float` `int` | number of discrete steps between the output bounds |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Value` | `float` | converted output value |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Conversion` | dropdown | `Linear` | transfer function used to map the input range onto the output range |
| `Quantization` | dropdown | `Floor` | level selection for the stepped transfer |

## Behaviour

- The value is normalised from `In Min`..`In Max` and scaled onto `Out Min`..`Out Max`; values outside
  the input range are clamped, so the output never leaves the output range.
- `Linear` is a straight map, `Power` raises the position to `Exponent` (gamma), `Exponential` curves
  it with `Sigma`, and `Stepped` quantizes it into `Steps` levels.
- `Quantization` decides how a stepped value picks its level: `Floor` holds the lower level, `Nearest`
  picks the closest, `Ceiling` switches early.
- Equal input bounds map everything to `Out Min`; reversed output bounds invert the transfer.
- It is a pure loop calculation with no state, so it can sit anywhere in the chain.

## Example

1. Map a 0..3.3 V reading onto 0..100 with `Linear`.
2. Use `Power` with `Exponent` 2.2 to turn a brightness slider into a perceptually even one.
3. Use `Stepped` with `Steps` 4 to drive a four-level display from an analog value.

## See also

- [Core package](index.md) — value nodes and their defaults
- [Range Adapt](range-adapt.md) — clamp or wrap without rescaling
- [Math](math.md) — arithmetic that a conversion cannot express


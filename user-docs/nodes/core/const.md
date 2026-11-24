# Constant

Emits a custom constant of the selected data type, or a built-in special constant such as Pi, Euler's number, or a degrees / radians conversion factor.

## Inputs

None — the node has no inputs.

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Value` | `float` | constant value of the selected data type or the selected special constant |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Mode` | dropdown | `Custom` | emit a custom value or a built-in special constant |
| `Data Type` | dropdown | `Float` | data type of the emitted value |
| `Float Value` | number | `50` | value emitted when Float is selected |
| `Int Value` | number | `50` | value emitted when Int is selected |
| `Bool Value` | checkbox | off | value emitted when Bool is selected |
| `String Value` | text | `Hello` | value emitted when String is selected |
| `Special Value` | dropdown | `Pi (π)` | special constant emitted in Special mode |

## Behaviour

- Init defines the value once as a firmware constant; the loop only assigns it to the output, so the
  value cannot change while the device runs.
- `Mode` `Custom` reads the control that matches `Data Type`; the other three value controls are
  hidden but keep their text.
- `Special` emits `Pi (π)`, `Euler's number (e)`, the degrees → radians factor or the radians →
  degrees factor, always as a float.
- The output type follows `Data Type`, so `String` connects to text inputs and `Bool` to boolean ones.
- An unwired output emits no code at all.

## Example

1. Pick `Data Type` `Float` and type the gain factor into `Float Value`.
2. Use `Special` with `Degrees → Radians` in front of a `Math` `sin` so the angle stays in degrees.
3. Use `Int` for a loop count or `String` for a topic fragment that several nodes share.

## See also

- [Core package](index.md) — constants, types and inline values
- [Math](math.md) — the usual consumer of a numeric constant
- [Range Convert](range-convert.md) — map a value between two ranges


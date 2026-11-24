# Array Set

Writes values, ramps, steps, waves or random samples into an array, in place or on a copy.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Array` | `vars.array` | array to write into |
| `Index` | `float` `int` | start index for the set operation |
| `Value` | `float` `int` `vars.array` | value or array of values to write |
| `Indices` | `vars.array` | array of target indices (floored to integers) |
| `Start` | `float` `int` | first index of the range (floored to an integer) |
| `Width` | `float` `int` | number of indices, or -1 for up to the last index, -2 for the penultimate, etc |
| `Step Width` | `float` `int` | width of each step in indices (floored to an integer) |
| `Steps` | `float` `int` | number of steps (floored to an integer) |
| `Min` | `float` `int` | lower value (ramp start, hat base, steps start or random range/cut) |
| `Max` | `float` `int` | upper value (ramp end, hat top, steps end or random range/cut) |
| `Period` | `float` `int` | length of one period in samples (float, so partial periods are possible) |
| `Period Count` | `float` `int` | number of periods to generate (clamped to the length of the array) |
| `Phase` | `float` `int` | wave phase offset in radians |
| `Amplitude` | `float` `int` | wave amplitude around the offset |
| `Offset` | `float` `int` | wave centre value |
| `Mean` | `float` `int` | mean of the normal distribution |
| `Std. Dev.` | `float` `int` | standard deviation of the normal distribution |
| `Fill Value` | `float` `int` | value written into the slots a multi-place shift vacates |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Array` | `vars.array` | array with values set |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Set Type` | dropdown | `Set` | how values are written into the array |
| `Index Mode` | dropdown | `Clamp` | how an out-of-range index is resolved, and whether an overrunning sub-array wraps to the beginning or stops at the end |
| `In-Place` | checkbox | off | write into the input array instead of modifying a copy |
| `Clamp` | checkbox | off | clamp the result to 0..1 |

## Behaviour

- `Set Type` decides which inputs are read: `Set` uses `Index` and `Value`, `Set at Indices` uses
  `Indices` and `Value`, `Fill`/`Ramp`/`Hat` use `Start`, `Width`, `Min` and `Max`, `Steps` adds
  `Step Width` and `Steps`, the three waves use `Period`, `Period Count`, `Phase`, `Amplitude` and
  `Offset`, and the random modes use `Min`, `Max`, `Mean` and `Std. Dev.`.
- `Width` counts indices from `Start`; negative values count back from the end, so -1 means "up to
  the last index" and -2 "up to the penultimate".
- `Index Mode` resolves an out-of-range `Set`/`Set at Indices` position: `Clamp` snaps to the edge,
  `Wrap` continues at the other end, `Shift` slides the array and fills only the vacated slots with
  `Fill Value`.
- `In-Place` writes into the input array, otherwise a copy is returned; `Clamp` squeezes the written
  values into 0..1.
- Waves write `Period Count` periods of `Period` samples and leave everything outside the span
  unchanged; a period may be fractional.

## Example

1. `Ramp` from 0 to 1 across the whole array for a fade-in.
2. `Sine` with `Period` 30 and `Amplitude` 0.5 to build one scrolling wave in 0..1.
3. `Set at Indices` with an `Indices` array to place single pixels, then `Shift` them each pass.

## See also

- [Vars package](index.md) — every write shape and its runtime call
- [Array Modify](array-modify.md) — move what this node wrote
- [Array Math](array-math.md) — combine two patterns element-wise


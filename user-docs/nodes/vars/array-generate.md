# Array Generate

Provides a float array of the given length and reuses its buffer between loop passes.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Length` | `float` `int` | number of elements to generate |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Array` | `vars.array` | generated array |

## Behaviour

- Allocates an array of `Length` zeros on the first pass and reuses that buffer afterwards while the
  length stays the same; a changed length allocates a fresh zero-filled buffer.
- `Length` is floored and clamped at 0, so a fractional value is truncated and 0 produces an empty
  array.
- Because the buffer is reused, an `In-Place` array node downstream writes into the very array this
  node hands out again next pass — a pattern survives instead of restarting from zeros.
- No init code: the output variable starts as `None`, so nothing is allocated before the first pass.
- An empty array is valid input everywhere: reductions read it as `0` / `[0.0]` and the LED drivers
  treat it as dark.

## Example

1. Set `Length` to the node count of the strip or the size of the pattern you want.
2. Feed `Array` into `Array Modify` to paint a ramp or a wave, or into `Array Set` to place values.
3. Hand the same array to two consumers only when neither of them writes `In-Place`.

## See also

- [Vars package](index.md) — array runtime and buffer reuse
- [Array Set](array-set.md) — fill, ramp, steps and waves in one node
- [Array Modify](array-modify.md) — shift, repeat and interlace it


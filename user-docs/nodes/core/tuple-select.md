# Tuple Select

Returns the value at one zero-based tuple position; the selected index mode decides what an out-of-range position reads.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Tuple` | `core.tuple` | tuple whose position is read |
| `Index` | `int` `float` | zero-based position to read; fractions are truncated and the selected index mode decides how a position outside the tuple is resolved |
| `Default` | `int` | value read instead of the element when the position is out of range in Default Value mode |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Value` | `any` | value at the selected position; Default Value mode falls back to the Default connector when the tuple is missing, not a tuple, or too short |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Index Mode` | dropdown | `Default Value` | how a position outside 0..len-1 is resolved: return the default value, clamp to the first or last position, or wrap around the tuple |

## Behaviour

- Reads one zero-based position chosen at runtime; a fractional index is truncated first, so `2.9`
  reads position 2 and `-0.5` reads position 0.
- `Default Value` returns the `Default` input for any index outside the tuple — including a
  non-numeric index and a missing, empty or non-tuple input.
- `Clamp` returns the first or last element for an out-of-range index; `Wrap` uses modulo, so `-1`
  reads the last position and `len` reads the first.
- `Default` is hidden in `Clamp` and `Wrap`, but a wire on it is kept and simply not read.
- Every mode resolves a missing tuple to `None` (except `Default Value`, which returns the default) —
  nothing raises on the device.

## Example

1. Feed a `Compose` tuple into `Tuple` and drive `Index` from a `Variable Read`.
2. Keep `Default Value` with `Default` 0 so an out-of-range read is recognisable downstream.
3. Use `Wrap` to walk a tuple in a loop without a bounds check.

## See also

- [Core package](index.md) — the index-mode rules and the tuple type
- [Array Select](../vars/array-select.md) — the same idea for a float array
- [Decompose](decompose.md) — read every position at once


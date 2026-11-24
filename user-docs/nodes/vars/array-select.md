# Array Select

Returns one array element, or resolves an out-of-range index through the Index Mode setting.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Array` | `vars.array` | array to read from |
| `Index` | `float` `int` | element position to read; fractions are truncated |
| `Default` | `float` `int` | value returned for an out-of-range index when Index Mode is 'Default Value' |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Value` | `float` | element at the index, resolved according to Index Mode |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Index Mode` | dropdown | `Default Value` | how an index outside 0..len-1 is resolved: read the default value, clamp to the first or last element, or wrap around the array |

## Behaviour

- Loop: reads one element and returns a `float`; it never forwards an array.
- `Index` is truncated, so `2.9` reads element 2 and `-1.9` reads element -1.
- `Index Mode` only matters outside `0 .. len-1`: `Default Value` returns the `Default` input,
  `Clamp` returns the first or last element, `Wrap` continues from the other end (`-1` reads the last
  element and `len` reads the first).
- A `None` or empty array returns `Default` in every mode, because there is no element to clamp or
  wrap to.
- `Default` is hidden for `Clamp` and `Wrap` but stays wired if a mode change hides it.

## Example

1. Feed `Array` from `Array Generate` and drive `Index` from a counter to walk the array.
2. Use `Wrap` for a looping animation and `Clamp` for a value that must stick to the ends.
3. Use `Default Value` with `-1` as `Default` to signal "no sample yet" downstream.

## See also

- [Vars package](index.md) — the index-mode matrix
- [Tuple Select](../core/tuple-select.md) — the same idea for a heterogeneous tuple
- [Array Math](array-math.md) — reduce a whole array instead of reading one element


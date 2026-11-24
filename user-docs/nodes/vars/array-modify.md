# Array Modify

Shifts, repeats, ping-pongs, concatenates, or interlaces an array; shift can wrap or pad with zero, in place or on a copy.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Array` | `vars.array` | array to modify |
| `Amount` | `float` `int` | number of positions to shift (can be negative) |
| `Other Array` | `vars.array` | array concatenated after or interleaved into the first array |
| `Count` | `float` `int` | number of repetitions (repeat) or ping-pong blocks |
| `Step` | `float` `int` | insert one value of the other array every n positions |
| `Offset` | `float` `int` | output index of the first inserted value |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Array` | `vars.array` | modified array |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Modify Type` | dropdown | `Shift` | how the array is modified |
| `Wrap` | checkbox | on | wrap elements around the edges instead of filling with zero |
| `Clamp` | checkbox | off | clamp the result to 0..1 |
| `In-Place` | checkbox | off | write into the input array instead of modifying a copy |

## Behaviour

- Only the inputs of the selected `Modify Type` are read: `Shift` uses `Array` and `Amount`, `Repeat`
  and `Ping-Pong` use `Array` and `Count`, `Concat` uses `Array` and `Other Array`, and `Interlace`
  uses both arrays plus `Step` and `Offset`.
- `Shift` slides the values by `Amount`; with `Wrap` on, the elements pushed out one edge re-enter on
  the other, otherwise the vacated slots are zero.
- `Repeat` writes `Count` consecutive copies, `Ping-Pong` alternates forward and backward blocks and
  repeats the endpoints, `Concat` appends the second array, `Interlace` inserts one value of the
  second array every `Step`-th output index starting at `Offset`.
- `Wrap` and `In-Place` only apply to `Shift`; the length-changing modes always allocate a fresh
  array, so they churn the heap on every pass.
- Switching `Modify Type` hides connectors but deletes no wire, and a hidden wire is never read.

## Example

1. `Shift` an `Array Generate` pattern by 1 with `Wrap` on to make it scroll.
2. `Concat` the same pattern twice for a longer strip than the generator allocates.
3. `Interlace` a marker array into a base pattern to place dots at every fourth LED.

## See also

- [Vars package](index.md) — the mode table and the emitted calls
- [Array Set](array-set.md) — write the values this node moves around
- [Array Generate](array-generate.md) — the buffer that usually feeds it


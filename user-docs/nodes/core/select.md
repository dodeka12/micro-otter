# Select

Chooses one of two values from a boolean condition; unconnected values become None.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Condition` | `bool` | true picks the true value, false picks the false value |
| `True Value` | `any` | value used while the condition is true |
| `False Value` | `any` | value used while the condition is false |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Value` | `any` |  |

## Behaviour

- One boolean picks between `True Value` and `False Value` on every pass; nothing is latched, so the
  output follows the condition immediately.
- The output type is the union of both branches: a float on one side and a string on the other is
  accepted only by an `any` input, and a tuple on either side widens the output the same way.
- Unwired branches use their inline control (`ON` / `OFF`); a branch that resolves to no value at all
  becomes `None`.
- The output type follows the branches: numeric branches narrow to the widest numeric type, and a
  tuple on either side makes the output `any`, which only an `any` input accepts.
- There is one channel per node: the old multi-channel `Select` was reduced to this single-channel
  definition, and extra channels from an old collection are dropped on load.

## Example

1. Drive `Condition` from a `Compare` and pick between two `Constant` values.
2. Leave the branches on `ON` / `OFF` to feed an `MQTT Write` with text.
3. Pick between two tuples and feed the result into `Decompose`.

## See also

- [Core package](index.md) — logic nodes and union typing
- [Select by Index](select-index.md) — more than two branches
- [Compose](compose.md) — build the tuples a branch may carry


# Random Seed

Seeds the random generator all random nodes share, once per enabled/seed change.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Enabled` | `bool` | applies the seed while enabled |
| `Seed` | `float` `int` | seed value for the shared random generator |

## Outputs

None — the node has no outputs.

## Behaviour

- Loop: applies `Seed` to the generator that every random node shares, once per enabled seed change —
  repeating the same seed does not restart the sequence.
- Each seed node has its own identity, so two seed nodes do not overwrite each other's applied state.
- `Enabled` off clears the applied state instead of quietly keeping the old seed in force.
- The node emits no data, so nothing pulls it in front of its consumers: place it earlier in the graph
  and the first pass already draws from the seeded stream.
- It seeds, it does not reset: values drawn before the seed keep the sequence moving.

## Example

1. Wire a constant `Seed` of 42 into a graph that uses `Random Value`.
2. Keep `Enabled` true so the seed is applied once at the start.
3. Change the seed from a `Variable Read` to reroll the sequence from a settings value.

## See also

- [Vars package](index.md) — the shared generator and per-node keys
- [Random Value](random-value.md) — the single-sample consumer
- [Array Set](array-set.md) — the array-level consumer of the same generator


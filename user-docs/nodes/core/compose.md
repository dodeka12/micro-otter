# Compose

Collects connected values into one immutable heterogeneous tuple; unconnected positions become None.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Item 1` | `any` | value placed at tuple position 1; left unconnected it becomes None |
| `Item 2` | `any` | value placed at tuple position 2; left unconnected it becomes None |
| `Item 3` | `any` | value placed at tuple position 3; left unconnected it becomes None |
| `Item 4` | `any` | value placed at tuple position 4; left unconnected it becomes None |
| `Item 5` | `any` | value placed at tuple position 5; left unconnected it becomes None |
| `Item 6` | `any` | value placed at tuple position 6; left unconnected it becomes None |
| `Item 7` | `any` | value placed at tuple position 7; left unconnected it becomes None |
| `Item 8` | `any` | value placed at tuple position 8; left unconnected it becomes None |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Tuple` | `core.tuple` | the composed tuple holding the selected number of positions |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Positions` | dropdown | `2` | number of active tuple positions |

## Behaviour

- Collects its connected inputs into one immutable, ordered tuple; each position keeps its own type,
  so a tuple can hold a float, a string and another tuple at once.
- `Positions` shows 2–8 connectors; an unconnected position composes as `None` and the remaining
  positions never shift.
- A tuple cannot be modified in place — build a new one whenever a value changes.
- `Tuple` only connects to `Decompose`, `Tuple Select` or an `any` input; scalar inputs refuse it.
- The tuple is rebuilt every pass, so a downstream read always sees the current values.

## Example

1. Wire a temperature, a humidity and a timestamp into `Item 1`–`Item 3` and set `Positions` to 3.
2. Feed `Tuple` into `Decompose` next to the consumer, or into `Tuple Select` to read one position by
   index.
3. Carry a tuple through a `Variable Write` when several values must travel together.

## See also

- [Core package](index.md) — the tuple type and union typing
- [Decompose](decompose.md) — read the positions back
- [Tuple Select](tuple-select.md) — read one position by index


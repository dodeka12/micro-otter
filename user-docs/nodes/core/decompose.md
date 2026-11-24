# Decompose

Reads one tuple position by position; positions the tuple does not have become None.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Tuple` | `core.tuple` | tuple whose positions are read |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Item 1` | `any` | position 1 of the tuple, or None when the tuple is shorter |
| `Item 2` | `any` | position 2 of the tuple, or None when the tuple is shorter |
| `Item 3` | `any` | position 3 of the tuple, or None when the tuple is shorter |
| `Item 4` | `any` | position 4 of the tuple, or None when the tuple is shorter |
| `Item 5` | `any` | position 5 of the tuple, or None when the tuple is shorter |
| `Item 6` | `any` | position 6 of the tuple, or None when the tuple is shorter |
| `Item 7` | `any` | position 7 of the tuple, or None when the tuple is shorter |
| `Item 8` | `any` | position 8 of the tuple, or None when the tuple is shorter |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Positions` | dropdown | `2` | number of active tuple positions |

## Behaviour

- Reads each connected position off the tuple; every read is guarded, so a short, empty or non-tuple
  input yields `None` instead of raising.
- Outputs are `any` on purpose: positions can have different types, and one connector cannot describe
  that union.
- `Positions` shows 2–8 outputs and only the connected ones generate code; hidden outputs keep their
  index and their wire.
- A position the tuple does not have reads `None`, which downstream nodes see like any missing value.
- With no connected output the node emits no code at all.

## Example

1. Wire a `Compose` tuple into `Tuple` and connect the two outputs you need.
2. Set `Positions` 4 to open the positions of a four-entry tuple.
3. Feed a read position into `Compare` or `Logic` to branch on it.

## See also

- [Core package](index.md) — the tuple type and guarded reads
- [Compose](compose.md) — build the tuple this node opens
- [Tuple Select](tuple-select.md) — read a position chosen at runtime


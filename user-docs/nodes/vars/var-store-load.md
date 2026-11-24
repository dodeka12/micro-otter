# Store Load

Loads a store namespace from var_store/<name>.json on a rising edge of the load input.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Load` | `bool` | trigger loading on a rising edge |
| `Store` | `string` | name of the store namespace to load |

## Outputs

None — the node has no outputs.

## Behaviour

- Loop: reads `var_store/<name>.json` only on a low → high edge of `Load`, so a signal that stays true
  loads once.
- A successful load **replaces** the whole namespace: entries that are not in the file disappear
  instead of being kept as a merge.
- A missing or invalid file leaves the namespace untouched, so a first boot without a save file keeps
  the values the graph produced.
- Arrays are rebuilt as float arrays, so an array read back after a reboot behaves like a freshly
  generated one.
- There is no `Enabled` input on this node — gate the `Load` signal when a load must be conditional.

## Example

1. Wire a one-shot bool that is true only on the first pass into `Load`.
2. Set the inline `Store` to the namespace that `Store Save` writes.
3. Read the entries afterwards with `Variable Read` — the loaded values are already in place.

## See also

- [Vars package](index.md) — what a load replaces and what it leaves alone
- [Store Save](var-store-save.md) — the matching writer
- [Variable Read](var-read.md) — reading the restored entries


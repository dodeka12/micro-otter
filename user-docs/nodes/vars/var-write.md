# Variable Write

Writes a value to a named store entry, creating it on first write.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Enabled` | `bool` | when off, the variable store is not updated |
| `Store` | `string` | name of the store namespace to write to |
| `Value` | `float` `int` `bool` `string` `vars.array` | value to store |

## Outputs

None — the node has no outputs.

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Name` | dropdown, required | empty | use an existing variable of the selected store, or declare a new one |
| `New store` | text | `empty` | namespace used when “New store…” is selected above |
| `Variable name` | text | `empty` | name of the variable this node declares, used when “Declare variable…” is selected above |

## Behaviour

- Loop: writes `Value` on every pass and creates the entry on the first write; nothing needs to be
  declared beforehand.
- `Enabled` gates the write only: while it is off the entry keeps its old value and the rest of the
  graph keeps running.
- `Store` is a string input — dropdown, wired string or `New store…` — and an empty or unwired value
  falls back to `default`.
- One node per variable declares it; a second declaration in the same store is flagged on both nodes,
  and renaming the declaration rewrites the readers.
- An array is stored by reference, so an `In-Place` array node that mutates it also changes what a
  reader sees.

## Example

1. Pick the store and `Name`, and wire the value that should persist into `Value`.
2. Wire a bool into `Enabled` so the entry is only written when the source is valid.
3. Add `Store Save` on the same namespace if the value must survive a reboot.

## See also

- [Vars package](index.md) — namespaces and the declaration rules
- [Variable Read](var-read.md) — the matching reader with its fallback value
- [Store Save](var-store-save.md) — write the namespace to flash


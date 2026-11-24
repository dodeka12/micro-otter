# Web Value Write

Writes an entry in the web control value store.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Enabled` | `bool` | when off, the web value is not updated |
| `Value` | `float` `int` `bool` `string` `vars.array` | value to store |

## Outputs

None — the node has no outputs.

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Name` | text, required | `empty` | name of the store entry to write |

## Behaviour

- Loop: writes `Value` into the reserved `_webcontrol` namespace under `Name` and creates the entry on
  the first write.
- `Enabled` gates the write only: while it is off the entry keeps its old value and the rest of the
  graph keeps running.
- `Name` is required; an empty name writes the `''` entry, which nothing can address.
- The write is in-memory, so it survives page reloads but not a reboot.
- Values written here are visible to `Web Value Read` and to the persisted input controls that share the
  same key.

## Example

1. Wire the value that the page should remember into `Value` and set `Name` to `selected_mode`.
2. Wire `Changed` from a `Select` into `Enabled` so it only writes on a user action.
3. Pair it with `Web Value Store Save` when the value must survive a reboot.

## See also

- [Web view package](index.md) — the reserved namespace and persistence
- [Web Value Read](web-store-read.md) — the matching reader
- [Web Value Store Save](web-store-save.md) — flush the namespace to flash


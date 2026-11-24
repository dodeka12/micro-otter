# Web Value Read

Reads an entry from the web control value store, or the fallback input when missing.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Default` | `float` `int` `bool` `string` `vars.array` | value used when the store entry does not exist |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Value` | `any` | current value of the store entry |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Name` | text, required | `empty` | name of the store entry to read |

## Behaviour

- Loop: reads the named entry from the reserved `_webcontrol` namespace and emits it; a missing entry
  returns the `Default` input instead of raising.
- `Name` is required and is the entry name you choose — the input controls' own entries are keyed
  `<graphId>:<nodeId>` and are normally not read by hand.
- `Value` is `any`, so an entry can carry a number, a string, a bool or an array.
- The read is plain in-memory state: it survives page reloads, not a reboot.
- An empty `Name` addresses an entry that nothing writes, so always set it.

## Example

1. Write the entry with `Web Value Write` and give both nodes the same `Name`.
2. Set the inline `Default` to the value a fresh boot should report.
3. Feed `Value` into the node that consumes the setting.

## See also

- [Web view package](index.md) — the reserved namespace and its keys
- [Web Value Write](web-store-write.md) — the matching writer
- [Web Value Store Load](web-store-load.md) — fill the namespace from flash at boot


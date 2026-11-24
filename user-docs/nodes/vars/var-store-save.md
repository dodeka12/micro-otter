# Store Save

Saves a store namespace to var_store/<name>.json on a rising edge of the save input.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Enabled` | `bool` | when off, the variable store is not updated |
| `Save` | `bool` | trigger saving on a rising edge |
| `Store` | `string` | name of the store namespace to save |

## Outputs

None — the node has no outputs.

## Behaviour

- Loop: writes `var_store/<name>.json` only on a low → high edge of `Save`, so a signal that stays
  true saves once instead of on every pass.
- The file is written atomically through a temporary file and a rename, so a power cut mid-write
  leaves the previous file intact.
- Arrays survive the round trip: the store tags them and rebuilds them as float arrays when the
  namespace is loaded again.
- `Enabled` off skips the save; the file on flash keeps whatever it had before.
- `Store` is a string input with `default` as its inline value — the node saves one namespace, not
  the whole store.

## Example

1. Wire a bool that turns true on a settings change into `Save`.
2. Give `Store` the same namespace as the `Variable Write` nodes whose entries must persist.
3. Pair it with `Store Load` in an init-phase graph so the device restores the values at boot.

## See also

- [Vars package](index.md) — persistence, atomic writes and array encoding
- [Store Load](var-store-load.md) — the matching reader of the file
- [Variable Write](var-write.md) — the entries this node writes out


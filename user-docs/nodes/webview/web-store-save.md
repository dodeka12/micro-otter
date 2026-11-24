# Web Value Store Save

Writes the reserved `_webcontrol` value store to flash on a rising edge of the Save input.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Enabled` | `bool` | when off, the web value is not updated |
| `Save` | `bool` | trigger saving on a rising edge |

## Outputs

None — the node has no outputs.

## Behaviour

- Loop: on a low → high edge of `Save` it writes the reserved `_webcontrol` namespace to
  `var_store/_webcontrol.json`; a signal that stays true saves once.
- The file is written atomically, so a power cut mid-write leaves the previous file intact.
- `Enabled` gates the save; while it is off the file keeps its previous contents.
- There is no `Name` input: this node always persists the web control namespace, never another store.
- Arrays and numbers survive the round trip; the file is plain JSON on the device filesystem.

## Example

1. Wire a `Button` `Value` into `Save` so the settings are written when the user presses Save.
2. Also wire a periodic pulse into `Save` if the values change without a button.
3. Add `Web Value Store Load` in a startup graph so the file is restored at boot.

## See also

- [Web view package](index.md) — persistence and the load ordering rule
- [Web Value Store Load](web-store-load.md) — the matching reader
- [Store Save](../vars/var-store-save.md) — the generic node for any namespace


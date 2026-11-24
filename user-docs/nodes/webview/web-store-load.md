# Web Value Store Load

Restores the reserved `_webcontrol` value store from flash on a rising edge of the Load input.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Load` | `bool` | trigger loading on a rising edge |

## Outputs

None — the node has no outputs.

## Behaviour

- Loop: on a low → high edge of `Load` it reads `var_store/_webcontrol.json` into the reserved
  namespace; a signal that stays true loads once.
- A successful load **replaces** the whole namespace, so entries that are not in the file disappear.
- A missing or invalid file leaves the namespace untouched, so a first boot without a save file keeps
  the values the graph produced.
- Run it in a startup graph: every input control writes its resolved value back on each pass, so a load
  inside a running loop graph is immediately overwritten.
- It always addresses the web control namespace — there is no `Name` input.

## Example

1. Put the node in the `Init` graph and leave `Load` on its inline `true`, so it fires on the first
   tick.
2. Keep the graph that owns the controls in a continuous graph: startup graphs run first.
3. Check the restored values on the page after a reboot — the controls show them from their first pass.

## See also

- [Web view package](index.md) — why a load belongs in a startup graph
- [Web Value Store Save](web-store-save.md) — the matching writer
- [Store Load](../vars/var-store-load.md) — the generic node for any namespace


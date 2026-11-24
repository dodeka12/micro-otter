# Text Input

Text input field.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Parent` | `web.element` | parent element to place this element into |
| `Title` | `string` | text shown next to the control |
| `Value` | `string` | value shown when the control is created |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Element` | `web.element` | the rendered web element |
| `Value` | `string` | current value of the control |
| `Changed` | `bool` | true for one tick when the resolved value changes |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Max Length` | number | `20` | maximum number of characters the user can enter |
| `Persist` | checkbox | off | keeps the value in the in-memory web control store |

## Behaviour

- `Value` is the device-side text: the connected string, else the inline default; the browser shows it
  until the user types.
- `Max Length` limits how many characters can be entered, so a topic or name field cannot overflow.
- `Changed` is true for exactly one tick when the text changes; it is false on the first tick and on a
  forced republish after a page reload.
- `Persist` keeps the text in the reserved `_webcontrol` store — across page reloads, not across a
  reboot.
- The text is sent as typed: no trimming and no validation, so validate in the graph before it reaches
  a topic or a filename.

## Example

1. Wire a `Column` slot into `Parent` and set `Title` to `Device name`.
2. Set `Max Length` 32 and wire `Value` into a `Variable Write`.
3. Use `Changed` to push the new name to MQTT only when the user edited it.

## See also

- [Web view package](index.md) — the `changed` contract and persistence
- [Select](web-view-select.md) — choose from fixed options instead of typing
- [Web Value Store Save](web-store-save.md) — persist the text across a reboot


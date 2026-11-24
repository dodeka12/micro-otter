# Checkbox

Boolean checkbox.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Parent` | `web.element` | parent element to place this element into |
| `Title` | `string` | text shown next to the control |
| `Value` | `bool` | value shown when the control is created |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Element` | `web.element` | the rendered web element |
| `Value` | `bool` | current value of the control |
| `Changed` | `bool` | true for one tick when the resolved value changes |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Persist` | checkbox | off | keeps the value in the in-memory web control store |

## Behaviour

- `Value` is a boolean: the connected value, else the inline checkbox; a click on the page flips it and
  the next pass reads the new state.
- `Changed` is true for exactly one tick when the value flips; it is false on the first tick and on a
  forced republish after a page reload.
- `Persist` keeps the state in `_webcontrol`: across page reloads, not across a reboot.
- The inline checkbox decides what a page shows before the first push, so set it to the intended
  default rather than leaving it off.
- Both the wired value and the browser can drive the state: the browser wins while the user is
  interacting, and the wired value takes over again as soon as it changes.

## Example

1. Wire a `Column` slot into `Parent` and set `Title` to `Enabled`.
2. Wire `Value` into the `Enabled` input of the node it should gate.
3. Turn `Persist` on for a setting that must survive a page reload.

## See also

- [Web view package](index.md) — the `changed` contract and persistence
- [Select](web-view-select.md) — more than two states
- [Button](web-view-button.md) — a momentary press instead of a state


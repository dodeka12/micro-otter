# HA Button

Announces a press button to Home Assistant and outputs one cycle of `true` per press.

## Inputs

None — the node has no inputs and no controls for a device-side value.

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Pressed` | `bool` | `true` for one cycle per press, then `false` again |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Object ID` | text, required | empty | entity id inside the device, used in the command topic |
| `Name` | text | empty | the name Home Assistant shows; falls back to the object id |
| `Icon` | icon | empty | `<set>:<name>`, for example `mdi:gesture-tap-button` |
| `Availability Mode` | dropdown | `All must be online` | how the selected flags combine |
| `Available Flags` | multi-dropdown | `Device` | `Device` plus any `HA Availability` flag id |
| `Press Payload` | text | `PRESS` | payload Home Assistant sends when the button is pressed |

## Behaviour

- Init phase: announces the discovery config without a state topic — a button has nothing to
  measure — and subscribes `<topic_prefix>/<device_id>/button/<object_id>/set`.
- Loop: consumes the command as one edge, so `Pressed` is `true` for a single cycle and never
  latches; presses that arrive between two loop cycles collapse into one edge.
- `Press Payload` tells Home Assistant what to send; the node treats **any** message on its command
  topic as a press, so a payload from another automation also counts.
- Because the entity reports no state, a press survives a Home Assistant restart only as far as the
  broker delivers it; the runtime does not queue presses.
- Pair the press with device logic that is safe to repeat, since a duplicate delivery repeats the
  action.
- An empty `Object ID` leaves the node inert without an entity.

## Example

1. Set `Object ID` to `reboot` and keep `Press Payload` at `PRESS`.
2. Wire `Pressed` into the action graph — for example a `Digital Output` pulse or a signal post.
3. Use `Event` graphs for one-shot actions so the press runs at a defined moment.

## See also

- [HA package](index.md) — topic scheme and discovery defaults
- [HA Switch](hass-switch.md) — a state that stays on or off
- [HA Availability](hass-availability.md) — extra flags for this entity

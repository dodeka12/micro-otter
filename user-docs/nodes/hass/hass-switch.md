# HA Switch

Announces a settable switch to Home Assistant and exposes the device state, the last command and a
one-cycle command flag.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Enabled` | `bool` | publishes state only while true; the inline checkbox defaults to on |
| `Value` | `bool` | the device-side state; the inline checkbox is the fallback when it is unwired |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Value` | `bool` | the input while `Authority` is `Device wins`, the last command while it is `Home Assistant wins` |
| `Command` | `bool` | the last state Home Assistant sent, sticky |
| `Updated` | `bool` | `true` in the cycle a new command arrived for this node |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Object ID` | text, required | empty | entity id inside the device, used in both topics |
| `Name` | text | empty | the name Home Assistant shows; falls back to the object id |
| `Icon` | icon | empty | `<set>:<name>`, for example `mdi:lightbulb` |
| `Availability Mode` | dropdown | `All must be online` | how the selected flags combine |
| `Available Flags` | multi-dropdown | `Device` | `Device` plus any `HA Availability` flag id |
| `Authority` | dropdown | `Device wins` | who owns `Value`: the input or the last Home Assistant command |
| `Report State` | checkbox | on | publish the value back as the entity state |
| `Payload On` | text | `true` | payload Home Assistant sends for on |
| `Payload Off` | text | `false` | payload Home Assistant sends for off |

## Behaviour

- Init phase: announces the discovery config with the command topic and subscribes
  `<topic_prefix>/<device_id>/switch/<object_id>/set`.
- Loop: command intake and the outputs run every cycle, even with `Enabled` off; only the state
  publish is gated.
- `Payload On` and `Payload Off` default to the runtime's own bool encoding; change them only for a
  broker or automation that sends something else.
- Any command payload other than `true`, `1`, `yes` or `on` reads as off, so a stray message
  cannot leave the switch in an undefined state.
- An empty `Object ID` leaves the node inert without an entity.

## Example

1. Set `Object ID` to `pump`.
2. Keep `Authority` at `Device wins` and wire the relay's real state into `Value`.
3. Wire `Updated` into a `Logic` node to act on the command only when it changes.

## See also

- [HA package](index.md) — topic scheme and discovery defaults
- [HA Binary Sensor](hass-binary-sensor.md) — read-only on/off entities
- [HA Availability](hass-availability.md) — extra flags for this entity

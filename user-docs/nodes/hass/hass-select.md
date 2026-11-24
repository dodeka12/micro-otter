# HA Select

Announces a selection list to Home Assistant and exposes the device choice, the last command and a
one-cycle command flag.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Enabled` | `bool` | publishes state only while true; the inline checkbox defaults to on |
| `Value` | `string` | the device-side option; the inline text field is the fallback when it is unwired |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Value` | `string` | the input while `Authority` is `Device wins`, the last command while it is `Home Assistant wins` |
| `Command` | `string` | the last option Home Assistant sent, sticky |
| `Updated` | `bool` | `true` in the cycle a new command arrived for this node |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Object ID` | text, required | empty | entity id inside the device, used in both topics |
| `Name` | text | empty | the name Home Assistant shows; falls back to the object id |
| `Icon` | icon | empty | `<set>:<name>`, for example `mdi:format-list-bulleted` |
| `Availability Mode` | dropdown | `All must be online` | how the selected flags combine |
| `Available Flags` | multi-dropdown | `Device` | `Device` plus any `HA Availability` flag id |
| `Authority` | dropdown | `Device wins` | who owns `Value`: the input or the last Home Assistant command |
| `Report State` | checkbox | on | publish the value back as the entity state |
| `Options` | text | `low,medium,high` | comma-separated option list; spaces around entries are trimmed |

## Behaviour

- Init phase: announces the discovery config with the command topic and subscribes
  `<topic_prefix>/<device_id>/select/<object_id>/set`.
- Loop: command intake and the outputs run every cycle, even with `Enabled` off; only the state
  publish is gated.
- `Value` is a `string` port, so feed option names, not indices; the inline text field starts empty,
  and an empty string is not in `Options` — Home Assistant rejects that state until a real option
  arrives.
- Keep `Options` and the graph's own list identical — Home Assistant rejects a state that is not in
  the list.
- An empty `Object ID` leaves the node inert without an entity.

## Example

1. Set `Options` to `off,low,high`.
2. Feed the current mode into `Value` and wire `Command` into the logic that switches modes.
3. Wire `Updated` into a `Print` while bringing the entity up, to see every command arrive.

## See also

- [HA package](index.md) — topic scheme and discovery defaults
- [HA Number](hass-number.md), [HA Text](hass-text.md) — the other typed setters
- [HA Availability](hass-availability.md) — extra flags for this entity

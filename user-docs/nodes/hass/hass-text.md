# HA Text

Announces a text field to Home Assistant and exposes the device text, the last command and a
one-cycle command flag.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Enabled` | `bool` | publishes state only while true; the inline checkbox defaults to on |
| `Value` | `string` | the device-side text; the inline field is the fallback when it is unwired |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Value` | `string` | the input while `Authority` is `Device wins`, the last command while it is `Home Assistant wins` |
| `Command` | `string` | the last text Home Assistant sent, sticky |
| `Updated` | `bool` | `true` in the cycle a new command arrived for this node |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Object ID` | text, required | empty | entity id inside the device, used in both topics |
| `Name` | text | empty | the name Home Assistant shows; falls back to the object id |
| `Icon` | icon | empty | `<set>:<name>`, for example `mdi:form-textbox` |
| `Availability Mode` | dropdown | `All must be online` | how the selected flags combine |
| `Available Flags` | multi-dropdown | `Device` | `Device` plus any `HA Availability` flag id |
| `Authority` | dropdown | `Device wins` | who owns `Value`: the input or the last Home Assistant command |
| `Report State` | checkbox | on | publish the value back as the entity state |
| `Minimum Length` | number | `0` | shortest text Home Assistant accepts |
| `Maximum Length` | number | `255` | longest text Home Assistant accepts |
| `Pattern` | text | empty | regular expression Home Assistant validates against |
| `Mode` | dropdown | `Text` | `Text`, or `Password` to mask the field in Home Assistant |

## Behaviour

- Init phase: announces the discovery config with the command topic and subscribes
  `<topic_prefix>/<device_id>/text/<object_id>/set`.
- Loop: command intake and the outputs run every cycle, even with `Enabled` off; only the state
  publish is gated.
- Home Assistant enforces `Minimum Length`, `Maximum Length` and `Pattern` before it sends; the
  device receives whatever passes, so validate again if the value reaches hardware.
- Multi-line and non-ASCII text arrives as a plain string; the runtime passes it through unmodified.
- An empty `Object ID` leaves the node inert without an entity.

## Example

1. Set `Object ID` to `label` and `Maximum Length` to `24`.
2. Feed the current label into `Value` and display `Command` wherever the text matters.
3. Add a `Pattern` such as `[A-Za-z0-9 ]+` when only simple text should be accepted.

## See also

- [HA package](index.md) — topic scheme and discovery defaults
- [HA Number](hass-number.md), [HA Select](hass-select.md) — the other typed setters
- [HA Availability](hass-availability.md) — extra flags for this entity

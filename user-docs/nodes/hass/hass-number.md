# HA Number

Announces a settable number to Home Assistant and exposes the device value, the last command and a
one-cycle command flag.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Enabled` | `bool` | publishes state only while true; the inline checkbox defaults to on |
| `Value` | `float` `int` `bool` `string` | the device-side value; the inline control is the fallback when it is unwired |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Value` | `float` | the input while `Authority` is `Device wins`, the last command while it is `Home Assistant wins` |
| `Command` | `float` | the last value Home Assistant sent, sticky; it repeats the input until the first command |
| `Updated` | `bool` | `true` in the cycle a new command arrived for this node |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Object ID` | text, required | empty | entity id inside the device, used in both topics |
| `Name` | text | empty | the name Home Assistant shows; falls back to the object id |
| `Icon` | icon | empty | `<set>:<name>`, for example `mdi:thermometer` |
| `Availability Mode` | dropdown | `All must be online` | how the selected flags combine |
| `Available Flags` | multi-dropdown | `Device` | `Device` plus any `HA Availability` flag id |
| `Authority` | dropdown | `Device wins` | who owns `Value`: the input or the last Home Assistant command |
| `Report State` | checkbox | on | publish the value back as the entity state |
| `Minimum` | number | `0` | lower bound Home Assistant enforces and displays |
| `Maximum` | number | `100` | upper bound Home Assistant enforces and displays |
| `Step` | number | `1` | granularity of the Home Assistant control |
| `Mode` | dropdown | `Auto` | `Auto`, `Box` or `Slider` rendering in Home Assistant |
| `Unit` | text | empty | unit shown next to the value |

## Behaviour

- Init phase: announces the discovery config (including the command topic) and subscribes
  `<topic_prefix>/<device_id>/number/<object_id>/set`.
- Loop: command intake and the outputs run every cycle, even with `Enabled` off — only the state
  publish is gated, so a disabled entity still accepts commands.
- With `Device wins`, wire `Value` from the device logic and read `Updated` to react to commands;
  with `Home Assistant wins`, `Value` already carries the command and no extra node is needed.
- `Report State` off drops the state topic from the discovery config, and `Value` keeps following
  the authority you picked.
- An empty `Object ID` leaves the node inert without an entity.

## Example

1. Set `Object ID` to `target`, `Minimum` to `0`, `Maximum` to `40`, `Unit` to `°C`.
2. Keep `Authority` at `Device wins` and wire the device's current target into `Value`.
3. Wire `Command` into the same logic that the device uses for its setpoint.

## See also

- [HA package](index.md) — topic scheme and discovery defaults
- [HA Select](hass-select.md), [HA Text](hass-text.md) — the other typed setters
- [HA Availability](hass-availability.md) — extra flags for this entity

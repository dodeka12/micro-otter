# HA Sensor

Announces a measurement sensor to Home Assistant and publishes its value as the entity state.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Enabled` | `bool` | publishes state only while true; the inline checkbox defaults to on |
| `Value` | `float` `int` `bool` `string` | the measurement; the inline control is the fallback when it is unwired |

## Outputs

None — a sensor has no command topic, so nothing comes back from Home Assistant.

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Object ID` | text, required | empty | entity id inside the device, used in both topics |
| `Name` | text | empty | the name Home Assistant shows; falls back to the object id |
| `Icon` | icon | empty | `<set>:<name>`, for example `mdi:thermometer` |
| `Availability Mode` | dropdown | `All must be online` | how the selected flags combine |
| `Available Flags` | multi-dropdown | `Device` | `Device` plus any `HA Availability` flag id |
| `Device Class` | text | empty | Home Assistant device class, for example `temperature` |
| `Unit` | text | empty | unit of the value, for example `°C` |
| `State Class` | dropdown | `None` | `Measurement`, `Total` or `Total increasing` |
| `Expire After` | number | `0` | seconds after which Home Assistant marks the entity unavailable; `0` disables |

## Behaviour

- Init phase: announces the discovery config retained, and republishes it after every connect and
  when Home Assistant announces itself on the birth topic.
- Loop: publishes the value as retained state while `Enabled` is true, de-duplicated per entity.
- With `Expire After` set, the runtime repeats the state every half window instead of only on
  change, which is what keeps a quiet sensor available.
- An empty `Object ID` leaves the node inert; the `Icon` value reaches Home Assistant as written, and
  only a bundled `mdi:` name also draws on the node.
- The topic is `<topic_prefix>/<device_id>/sensor/<object_id>/state`; nothing is subscribed.

## Example

1. Set `Object ID` to `temperature`, `Device Class` to `temperature`, `Unit` to `°C`, and
   `State Class` to `Measurement`.
2. Wire an ADC-derived value into `Value`.
3. Leave `Expire After` at `0` and let the [bridge](hass-bridge.md) availability decide whether the
   entity is reachable.

## See also

- [HA package](index.md) — topic scheme and discovery defaults
- [HA Binary Sensor](hass-binary-sensor.md) — on/off entities
- [HA Availability](hass-availability.md) — extra flags for this sensor

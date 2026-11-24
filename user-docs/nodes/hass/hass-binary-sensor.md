# HA Binary Sensor

Announces a two-state sensor — motion, door, window, moisture, smoke or connectivity — to Home
Assistant.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Enabled` | `bool` | publishes state only while true; the inline checkbox defaults to on |
| `Value` | `bool` | the state; the inline checkbox is the fallback when it is unwired |

## Outputs

None — a binary sensor has no command topic.

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Object ID` | text, required | empty | entity id inside the device, used in both topics |
| `Name` | text | empty | the name Home Assistant shows; falls back to the object id |
| `Icon` | icon | empty | `<set>:<name>`, for example `mdi:motion-sensor` |
| `Availability Mode` | dropdown | `All must be online` | how the selected flags combine |
| `Available Flags` | multi-dropdown | `Device` | `Device` plus any `HA Availability` flag id |
| `Device Class` | dropdown | `None` | `Motion`, `Door`, `Window`, `Moisture`, `Smoke` or `Connectivity` |
| `Expire After` | number | `0` | seconds after which Home Assistant marks the entity unavailable; `0` disables |

## Behaviour

- Init phase: announces the discovery config retained, and republishes it after every connect and
  when Home Assistant announces itself on the birth topic.
- Loop: publishes the boolean as retained state while `Enabled` is true, de-duplicated per entity.
- The package pins `payload_on` and `payload_off` to `true` and `false`, matching the runtime's own
  bool encoding, so a boolean source needs no conversion.
- With `Expire After` set, the state is repeated every half window; keep the loop faster than that
  or leave expiry off.
- An empty `Object ID` leaves the node inert.

## Example

1. Set `Object ID` to `door`, choose `Door` as the device class.
2. Wire a `Digital Input` (with pull-up) into `Value`.
3. Choose the device class that matches the graph, since Home Assistant renders each class
   differently.

## See also

- [HA package](index.md) — topic scheme and discovery defaults
- [HA Sensor](hass-sensor.md) — numeric measurements
- [HA Availability](hass-availability.md) — extra flags for this sensor

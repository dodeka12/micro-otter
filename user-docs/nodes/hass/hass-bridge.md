# HA Bridge

Sets the device identity every Home Assistant entity carries, and owns the shared availability topic
and its will.

## Inputs

None — the bridge is configured entirely by its controls.

## Outputs

None — a bridge publishes no state of its own.

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Device ID` | text, required | empty | topic segment and `identifiers` of the device card; sanitised to `[A-Za-z0-9_-]` |
| `Device Name` | text | empty | the name Home Assistant shows |
| `Discovery Prefix` | text | `homeassistant` | prefix for discovery configs and the birth topic |
| `Topic Prefix` | text | `otter` | prefix for state, command and availability topics |
| `Availability` | checkbox | on | publish `online` / `offline` on the device availability topic |
| `Last Will` | checkbox | on | register that topic as the connection's last will |
| `Manufacturer` | text | `Micro-Otter` | device card field |
| `Model` | text | empty | device card field |
| `SW Version` | text | empty | device card field, also used as `origin.sw` |

## Behaviour

- Init phase, before any entity: the bridge configures the runtime with the device id, name and the
  manufacturer/model/version fields, so every entity's discovery config carries that `device` block.
  There is no device-level announcement — the device card appears once the first entity is announced.
- The same init call sets the availability topic and its will and subscribes the birth topic; both
  survive reconnects, and the retained entity configs are republished after every connect and when
  Home Assistant publishes `online` on `<discovery_prefix>/status`.
- Two bridges: the second replaces the first, and both carry a badge.
- A competing `MQTT Will` node is flagged: its will replaces the bridge's availability topic, so the
  device would stop going `offline`. `Last Will` off on the bridge leaves the will to another node.
- Entity nodes without any bridge in the collection are flagged instead of publishing into
  `homeassistant/` with an empty device id.
- Entity nodes registered while MQTT is switched off log a warning per entity; the transport is
  silent by design, so the log is the only signal.

## Example

1. Set `Device ID` to something stable such as `garage-node`; changing it later creates a new
   Home Assistant device.
2. Keep `Availability` and `Last Will` on unless another node owns the will.
3. Put the bridge in the startup graph and the entities wherever their values live.

## See also

- [HA package](index.md) — topic scheme, availability, discovery defaults
- [HA Availability](hass-availability.md) — extra availability flags
- [MQTT settings](../mqtt/index.md) — enable the transport on the device

# Home Assistant package

Home Assistant MQTT discovery entities on top of the MQTT package: announce the device card once,
then let entity nodes publish state and accept commands.

## Setup

| Requirement | Detail |
|---|---|
| MQTT working | the package requires the [MQTT package](../mqtt/index.md); enable MQTT in the device settings |
| A bridge node | [HA Bridge](hass-bridge.md) sets the device identity every entity carries; without it every entity is badged and nothing is announced |
| Stable `Device ID` | the id becomes a topic segment and the card's identifier; changing it creates a second device in Home Assistant |
| Prefixes | `Discovery Prefix` defaults to `homeassistant`, `Topic Prefix` to `otter`; only change them when your broker setup requires it |
| Network | the package requires a target with `wifi` or `ethernet` |

- Put the bridge in the startup graph and the entity nodes wherever their values live; registration
  happens in the init phase of the graph the node sits in.
- Credentials, broker address and the `Enable MQTT` switch are documented with the
  [MQTT package](../mqtt/index.md).

## Nodes

| Node | What it does |
|---|---|
| [HA Bridge](hass-bridge.md) | sets the device identity and owns the availability topic and will |
| [HA Availability](hass-availability.md) | publishes one named availability flag |
| [HA Sensor](hass-sensor.md) | measurement sensor |
| [HA Binary Sensor](hass-binary-sensor.md) | two-state sensor such as motion, door or smoke |
| [HA Number](hass-number.md) | settable number with bounds, step and unit |
| [HA Switch](hass-switch.md) | settable on/off entity |
| [HA Select](hass-select.md) | settable option list |
| [HA Text](hass-text.md) | settable text field |
| [HA Button](hass-button.md) | press button with a one-cycle `Pressed` output |

## Shared concepts

Every entity gets a discovery config, a state topic and — for `number`, `switch`, `select`, `text`
and `button` — a command topic:

| Purpose | Topic |
|---|---|
| Discovery config | `<discovery_prefix>/<component>/<device_id>/<object_id>/config` |
| State | `<topic_prefix>/<device_id>/<component>/<object_id>/state` |
| Command | `<topic_prefix>/<device_id>/<component>/<object_id>/set` |
| Availability | `<topic_prefix>/<device_id>/availability` |
| Flag availability | `<topic_prefix>/<device_id>/availability/<flag_id>` |
| Birth | `<discovery_prefix>/status` |

- `unique_id` is built from device id, component and object id only, so renaming an entity or a topic
  never duplicates it; renaming the `Object ID` does.
- Every config carries the same `device` block, so the device card appears with the first entity; the
  [bridge](hass-bridge.md) supplies its id, name and version fields.
- The discovery config is a deferred retained publish: it exists once after every connect and again
  when Home Assistant publishes `online` on `<discovery_prefix>/status`.
- `Authority` on the writable entities picks who owns `Value`: `Device wins` follows the device input,
  `Home Assistant wins` keeps the last command. `Report State` decides whether that value goes back
  to Home Assistant as the state.
- `Available Flags` combines the device topic with any [availability flags](hass-availability.md);
  `Availability Mode` decides whether all must be online, any one, or the latest wins.
- `Expire After` adds `expire_after` to the config and makes the runtime repeat the state every half
  window; leave it at `0` and let availability decide.
- Click `Icon` to search the bundled icon set by name or alias (`user` finds `account`, `temp` finds
  `thermometer`); arrows plus `Enter` take a tile, and a hand-typed `<set>:<name>` is accepted
  verbatim, so an icon from another set (`ph:house`) reaches Home Assistant unchanged.

## When Home Assistant shows nothing

| Symptom | Likely cause |
|---|---|
| No entity at all | no bridge node, MQTT switched off, or a different `Discovery Prefix` than Home Assistant listens on |
| Entity disappears after a Home Assistant restart | the broker lost the retained configs; the bridge re-announces on the birth message |
| Entity `unavailable` after a power cut | the will did not reach the broker; keep `Last Will` enabled on the bridge |
| Entity `unknown` | no state was published, or state publication is disabled |
| Entity `unavailable` shortly after it appeared | `Expire After` is set and the graph loop publishes too rarely |
| Entity duplicated after a reboot | `Object ID` or `Device ID` changed |

## Related

- [MQTT package](../mqtt/index.md) — the transport these nodes ride on
- [HA Bridge](hass-bridge.md) — start here
- [Device view](../../app/device-view.md) — `Enable MQTT` lives there

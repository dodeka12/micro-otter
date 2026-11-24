# HA Availability

Publishes one named availability flag that entity nodes can reference.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Enabled` | `bool` | publishes only while true; the inline checkbox defaults to on |
| `Available` | `bool` | `true` publishes `online`, `false` publishes `offline` |

## Outputs

None — the node only publishes.

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Availability ID` | text, required | empty | flag id used in the entity nodes' `Available Flags` |

## Behaviour

- Init phase: registers the flag under `<topic_prefix>/<device_id>/availability/<id>` (retained);
  the bridge owns the device-wide `<topic_prefix>/<device_id>/availability` topic.
- Loop: publishes only on change, and replays the retained state after every reconnect, so a
  steady flag costs nothing in traffic.
- Entity nodes combine flags with their `Availability Mode`: all must be online, any one, or the
  latest wins.
- A flag id that is empty or duplicated is flagged; so is an entity that references a flag no node
  defines, which stays unavailable until that flag exists. `__device__` is reserved for the device
  topic and needs no node.

## Example

1. Set `Availability ID` to `sensor` and wire a "sensor present" boolean into `Available`.
2. Select that id in an entity's `Available Flags` together with `Device`.
3. Keep `Availability Mode` at `All must be online` so a missing sensor makes the entity
   unavailable instead of showing stale values.

## See also

- [HA package](index.md) — the three availability mechanisms
- [HA Bridge](hass-bridge.md) — the device-wide topic and its will
- [HA Sensor](hass-sensor.md) — a consumer of the flag

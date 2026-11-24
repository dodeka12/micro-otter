# MQTT Will

Lets the broker publish a payload when this device disappears without disconnecting cleanly.

## Inputs

None — the will is configured entirely by its controls.

## Outputs

None — the node only configures the connection.

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Topic` | topic dropdown | empty | the will topic; a topic already used in the graph, or `New topic…` |
| `New topic` | text | empty | shown after `New topic…`; the full path |
| `Payload` | text | `offline` | what the broker publishes on an unclean disconnect |
| `Retain` | checkbox | on | leave the will payload as the retained value of the topic |
| `QoS` | dropdown | `0 — At most once` | `0` or `1 — At least once` |

## Behaviour

- Init phase only: registers the will before the connection starts; the loop body is a comment.
- The will belongs to the connection, so one node per device is enough — a second will node (or a
  bridge node that brings its own) replaces the first, and the graph rule badges the conflict.
- A clean disconnect discards the will, which is why an availability topic needs the broker to see
  the disconnect rather than the device to say goodbye.
- An empty topic is rejected with a badge: a will without a topic would silently do nothing.

## Example

1. Set `Topic` to `status/device` and keep the payload `offline`.
2. Pair it with `MQTT Announce` on the same topic publishing `online` so subscribers see both ends.
3. Do not add a will when a [HA Bridge](../hass/hass-bridge.md) already owns the availability topic.

## See also

- [MQTT package](index.md) — connection settings and diagnostics
- [MQTT Announce](mqtt-announce.md) — the `online` half of the pair
- [HA Bridge](../hass/hass-bridge.md) — brings its own will and availability topic

# MQTT Write

Publishes the value on its input to a topic while it is enabled.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Enabled` | `bool` | publishes only while true; the inline checkbox defaults to on |
| `Value` | `float` `int` `bool` `string` | the payload; the inline control is the fallback when it is unwired |

## Outputs

None — the node only publishes.

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Topic` | topic dropdown | empty | a topic already used in the graph, or `New topic…` |
| `New topic` | text | empty | shown after `New topic…`; the full path |
| `Payload Mode` | dropdown | `Single value` | `Single value` or `JSON from store` |
| `Store` | text | empty | namespace published as one JSON object (`JSON from store` only) |
| `QoS` | dropdown | `0 — At most once` | `0` or `1 — At least once` |
| `Retain` | checkbox | on | keep the last payload on the broker for late subscribers |
| `Publish Mode` | dropdown | `On change` | `On change` skips repeated payloads, `Every loop` publishes each cycle |

## Behaviour

- Init phase: registers the publisher; the MQTT service owns the socket.
- Loop: publishes while `Enabled` is true; `On change` compares against the last payload that
  actually reached the broker, so a failed publish is retried on the next cycle.
- `Retain` defaults to on: a subscriber that connects later still sees the value. Only an explicit
  off publishes unretained, and graphs saved before the default existed still retain.
- `JSON from store` publishes the whole namespace at once and ignores `Value`; the input stays
  visible but unused.
- While the broker link is down the publish is skipped and logged once per topic
  (`publish: skipped (not connected) topic='…'`); nothing is queued for later.

## Example

1. Wire a `Math` result into `Value` and set `Topic` to `sensors/temp`.
2. Keep `Publish Mode` at `On change` so the loop does not flood the broker at its full rate.
3. Subscribe with `MQTT Read` on the same topic — in the same graph or another one — to verify the
   round trip.

## See also

- [MQTT package](index.md) — topics, payload modes, settings
- [MQTT Read](mqtt-read.md) — the receiving half
- [MQTT Announce](mqtt-announce.md) — publishes that are replayed after every reconnect

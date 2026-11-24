# MQTT Read

Subscribes to a topic and emits the latest value, plus a one-cycle flag when a usable message
arrives.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Default` | `float` `int` `bool` `string` | the value to emit while no usable message is available; the inline control sets it |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Value` | the type picked in `Value Type` | the latest usable payload; sticky, so it never emits `null` |
| `Updated` | `bool` | `true` in the cycle a new usable message arrived for this node |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Topic` | topic dropdown | empty | a topic already used in the graph, or `New topic…` |
| `New topic` | text | empty | shown after `New topic…`; the full path, for example `sensors/temp` |
| `Payload Mode` | dropdown | `Single value` | `Single value` or `JSON to store` |
| `Store` | text | empty | store namespace that receives one entry per JSON key (`JSON to store` only) |
| `QoS` | dropdown | `0 — At most once` | `0` or `1 — At least once` |
| `Value Type` | dropdown | `String` | `String`, `Float`, `Int` or `Bool` (`Single value` only) |
| `JSON Key` | text | empty | extracts one key from a JSON payload (`Single value` only) |
| `Default on Dis.` | checkbox | off | fall back to `Default` whenever nothing arrived since the current connection came up |

## Behaviour

- Init phase: registers the subscription; the MQTT service owns the socket, so the node never
  connects on its own.
- Loop: emits `Value` first, then `Updated`; each output is generated only when wired.
- `Value` is sticky — last usable payload, else `Default`, else the type's zero, never `null`, so a
  downstream numeric input cannot receive a missing value.
- Every node consumes with its own cursor: several reads on one topic all see every message.
- `JSON to store` replaces the store namespace with the keys of the JSON object, but only while
  `Updated` is wired and the payload really parses as an object; malformed JSON writes nothing.

## Example

1. Set `Topic` to `sensors/temp`, `Value Type` to `Float`, and leave `Default` at `0`.
2. Wire `Value` into `Print` to watch the payload, or into `MQTT Write` to copy it to another topic.
3. Wire `Updated` into an event graph signal when something must run once per message.

A read whose topic nothing in the collection publishes carries a badge; deleting the publishing
node does not remove the topic from the dropdown.

## See also

- [MQTT package](index.md) — topics, payload modes, settings
- [MQTT Write](mqtt-write.md) — publishes the same topic
- [MQTT Announce](mqtt-announce.md) — retained payloads that survive reconnects

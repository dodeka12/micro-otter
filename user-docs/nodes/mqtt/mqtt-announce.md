# MQTT Announce

Publishes a retained payload now, again after every reconnect, and whenever a trigger topic fires.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Enabled` | `bool` | publishes only while true; the inline checkbox defaults to on |
| `Payload` | `float` `int` `bool` `string` | overrides the `Payload` control while it is wired |

## Outputs

None — the node only publishes.

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Topic` | topic dropdown | empty | the announce topic, or `New topic…` |
| `New topic` | text | empty | shown after `New topic…`; the full path |
| `Payload Mode` | dropdown | `Single value` | `Single value` or `JSON from store` |
| `Store` | text | empty | namespace published as one JSON object (`JSON from store` only) |
| `Payload` | text | empty | the text payload; ignored while the `Payload` input is wired |
| `Retain` | checkbox | on | keep the payload on the broker after the device is gone |
| `QoS` | dropdown | `0 — At most once` | `0` or `1 — At least once` |
| `Publish Mode` | dropdown | `On change` | `On change` skips repeats, `Every loop` publishes each cycle |
| `Trigger Topic` | topic dropdown | empty | a topic whose messages force one re-publish |
| `New topic` | text | empty | shown after the trigger `New topic…`; the full path |
| `Trigger Value` | text | `online` | only this payload triggers; an empty value triggers on any message |

## Behaviour

- Init phase: registers the announcement, so it is in place before the first connect.
- Loop: publishes through the deferred path — one publish now when connected, and a replay after
  **every** successful connect, even when the payload never changed again.
- `On change` keeps one retained publish per distinct payload; a trigger message bypasses that memo
  for exactly one cycle, which is what re-asserts the value to a broker that just came back.
- A disabled node is inert, including its trigger consumption; a trigger held while off may fire
  once when the node is re-enabled.
- `JSON from store` publishes the whole namespace and never writes to it.

## Example

1. Set `Topic` to `status/device`, `Payload` to `online`, and keep `Retain` on.
2. To follow Home Assistant restarts, set `Trigger Topic` to `homeassistant/status` and keep
   `Trigger Value` at `online`.
3. Add `MQTT Will` on the same topic with `offline` so subscribers see both ends of the link.

## See also

- [MQTT package](index.md) — topics, payload modes, settings
- [MQTT Write](mqtt-write.md) — per-cycle values, not replayed on connect
- [MQTT Will](mqtt-will.md) — the unclean-disconnect half

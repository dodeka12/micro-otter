# MQTT Node System

This document describes how the MQTT node package is modeled, transpiled, and executed at runtime.

## Scope

The MQTT node package lives under:

- `src/micro_otter/nodes/device/node_pkgs/mqtt/`

Key implementation files:

- Node definitions: `node_definitions.json`
- Generators: `node_generators.js`
- Runtime singleton + pump: `otter_mqtt/runtime.py`
- Vendored client: `otter_mqtt/umqtt/{simple,robust}.py`

The package requires the `["wifi", "ethernet"]` capability alternative (same pattern as `webview`) and is registered in the `general` runtime as a global package.

## Node Set

The package defines five node types, all category `mqtt`:

1. `mqtt-read` — subscribes to a topic and emits the latest value.
2. `mqtt-write` — publishes an input value to a topic.
3. `mqtt-status` — reports whether the broker connection is currently up.
4. `mqtt-will` — configures the broker-side last will (init only).
5. `mqtt-announce` — publishes a retained payload now, after every reconnect and on a trigger topic.

`mqtt-read`, `mqtt-write`, `mqtt-will` and `mqtt-announce` declare `initFunction: "init_mqtt"` and use generator-backed Python implementations; `mqtt-status` declares neither an init function nor init implementations and only samples the runtime state.


### `mqtt-read`

- Controls: `topic` (`graphTopics` dropdown), `customTopic` (text, revealed by the "New topic…" entry), `payloadMode` (`value`/`json-store`), `storeNamespace` (text), `qos` (0/1), `valueType` (float/int/bool/string), `jsonKey` (optional), `defaultWhenDisconnected` (checkbox).
- Inputs: `default` (float/int/bool/string) — a connector with an inline numeric `defaultControl` (default `0`), so an unconfigured node transpiles to `default=(0)` while a wired source replaces it with the source variable.
- Outputs: `value` (typed via `outputTypeControl`/`outputTypeByControlValue`) and `updated` (bool).
- Loop: emits one statement per connected output, `value` first so the coercion cache is shared:
  - `value = _mqtt.latest_value(topic=..., value_type=..., json_key=..., require_connected=..., default=(...))`
  - `updated = _mqtt.take_updated(... , key='_mqtt_read_<nodeId>')`

The three-way contract:

- `value` is **sticky**: it keeps the last usable payload and never emits `None`, so a downstream `float(...)` can never receive a null. When no usable payload exists it emits the `Default` input, then the type default (`0`, `0.0`, `False`, `''`).
- `updated` is `True` only in the cycle where a new **usable** message arrived for *this node*; each node consumes with its own cursor, so several read nodes on one topic all see every message.
- With `defaultWhenDisconnected` enabled the node passes `require_connected=True`, so the value falls back to the default whenever no usable message arrived since the current connection came up (after a broker drop the cached payload is ignored).

The `mqtt-read-unpublished` graph rule (`scope: 'collection'`, see
`docs/dev/nodes/node-validation-architecture.md`) only badges a read when **no** node of the
collection publishes its topic; a `mqtt-write` in another graph clears the badge.

### `mqtt-status`

- Inputs/controls: none.
- Output: `connected` (bool) — `_mqtt.is_connected()`.
- Loop: `connected = _mqtt.is_connected()`. It contributes no init block; the `MqttService` controller owns start/stop. The value drops to `False` as soon as the pump detects a dead socket or the controller disconnects.

### `mqtt-write`

- Controls: `topic` (`graphTopics` dropdown), `customTopic` (text), `payloadMode` (`value`/`json-store`), `storeNamespace` (text), `qos` (0/1), `retain` (checkbox, default **checked** — retained state is what makes a state topic useful to a late subscriber such as Home Assistant), `publishMode` (`on-change`/`every-loop`).
- Input: `value` (float/int/bool/string).
- Loop: calls `otter_mqtt.runtime.publish`; `on-change` uses a per-node `if_changed` key to skip duplicate payloads.
- A graph saved before the `retain` default changed carries no `retain` control value at all. The generator treats an absent value as `true`, so those graphs publish retained as well; only an explicit `retain: false` publishes unretained.
- Known limitation: in `json-store` mode the `value` input stays visible but unused, because `getVisibleInputs()` treats an empty `activeInputs` list as "everything visible".

### `mqtt-will`

- Purpose: set the broker's last will so a dead device leaves a definitive payload (`offline`) instead of a stale retained value.
- Controls: `willTopic` (`graphTopics` dropdown), `customWillTopic` (text), `willPayload` (text, default `offline`), `willRetain` (checkbox, default checked), `willQos` (0/1).
- Inputs/outputs: none.
- Init: `_mqtt.configure_will(topic=..., payload='offline', retain=True, qos=0)` in `init_mqtt()`, **before** `_mqtt.start()`.
- Loop: a comment only (`# mqtt will: configured in init_mqtt`).

Pitfalls:

- Only **one** will can exist per connection (and per collection): `configure_will()` overwrites
  the previous one. A second `mqtt-will` node with a different topic produces a second
  `configure_will()` call and the last one wins; the `mqtt-will-duplicate` graph rule
  (`scope: 'collection'`) flags the earlier will node even when it lives in another graph. Two
  identically configured nodes contribute the identical init block, which the assembler emits once.
- A `hass-bridge` in the collection is a will provider too (its `availability`/`will` controls,
  both defaulting to `true`, configure the will on `<topicPrefix>/<deviceId>/availability`), even
  though it has no `mqtt-will` node. The `hass-bridge-will-conflict` graph rule flags a competing
  `mqtt-will` node next to it.
- A clean `disconnect()` discards the will, so `online` has to be published by `mqtt-announce`; the will only covers unclean disconnects.
- `willTopic: ''` configures a will on an empty topic, which brokers reject: the node is an error and the graph-level topic validator flags it.

### `mqtt-announce`

- Purpose: publish a payload that is **retained** and **re-asserted after every reconnect**, optionally re-published when a trigger topic fires — the classic birth/re-announce pattern without any Home Assistant knowledge.
- Inputs: `payload` (float/int/bool/string, optional).
- Outputs: none.
- Controls: `announceTopic` (`graphTopics` dropdown), `customAnnounceTopic`, `payloadMode` (`value`/`json-store`), `storeNamespace`, `payload` (text), `retain` (checkbox, default checked), `qos` (0/1), `publishMode` (`on-change`/`every-loop`), `triggerTopic` (`graphTopics` dropdown), `customTriggerTopic`, `triggerValue` (text, default `online`).
- Init: `_mqtt.register_publish(topic=..., qos=...)`, plus `_mqtt.register_subscription(topic=<trigger>, qos=0)` when a trigger topic is set.
- Loop: one `_mqtt.publish_deferred(topic=..., payload=(...), qos=..., retain=..., key=..., if_changed=...)` call, preceded by the trigger handling when configured.

Payload precedence in `value` mode: the connected `payload` input, then the `payload` control. In `json-store` mode the store namespace is published instead and an empty namespace emits a comment only.

Trigger semantics: `_mqtt.take_updated(...)` consumes the trigger message; with a non-empty `triggerValue` the payload is then compared to it, and only a match forces a re-assertion. `if_changed` is `(None if <fired> else '<memo>')`, so exactly one cycle bypasses the memo — that is what re-sends the retained payload to a broker that just came back. With `triggerValue: ''` any trigger message forces the re-assertion. `every-loop` ignores the memo entirely (`if_changed=None`).

Why `publish_deferred` and not `publish`: the entry is kept for the session, so the announcement is re-published after **every** successful connect even when the payload never changes again. Announce is publish-only; it never writes a store.


## Payload modes

`payloadMode` decides *what* is handed to the runtime; the runtime call itself is unchanged.

**`value` (default)** — one scalar per cycle, byte-identical to the pre-`payloadMode` release:

```python
node_4_out0 = _mqtt.latest_value(topic='sensors/temp', value_type='float', json_key='',
                                require_connected=False, default=(0.0))
node_4_out1 = _mqtt.take_updated(topic='sensors/temp', value_type='float', json_key='',
                                 require_connected=False, key='_mqtt_read_4')
_mqtt.publish(topic='sensors/temp', value=(node_4_out0), qos=0, retain=True,
              if_changed='_mqtt_last_5')
```

**`json-store`** — one JSON object per message:

```python
# mqtt-read
if node_4_out1:
    _mqtt_json_4 = _mqtt.json_value(_mqtt.latest('sensors/temp'))
    if isinstance(_mqtt_json_4, dict):
        _store.replace('sensors', _mqtt_json_4)

# mqtt-write
_mqtt.publish(topic='sensors/temp', value=(_mqtt.json_payload(_store.items('sensors'))),
              qos=0, retain=True, if_changed='_mqtt_last_5')
```

- The store write is gated on `updated`, so a namespace is never rewritten with the same payload every loop.
- Malformed JSON is not the generator's job: `_mqtt.json_value()` returns `None` and the `isinstance(..., dict)` guard skips the write.
- `mqtt-write` publishes the namespace as one payload; because `json_payload()` returns bytes and `_encode_payload()` passes bytes through, `on-change` compares exact payload bytes and publishes once per distinct namespace content.
- An empty `storeNamespace` never writes or publishes: the node emits a comment instead (`# mqtt read: payload mode json-store without a store namespace`).
- `mqtt` declares `requiredPackages: ["vars"]`, so a deployment that uses the package always ships `otter_vars/store.py`.

## Topic authoring

Every MQTT `topic` control is a `graphTopics` dropdown: the topics already used in the graph, plus a **New topic…** entry that reveals the `customTopic` text control. The dropdown option list is `current → graph topics → __new__`; a stored topic is always offered first, so deleting the node that published it never loses the value. The mechanism is documented once in `docs/dev/nodes/node-definition-reference.md`.

The generator-side contract is one rule:

```text
effective = topic === '__new__' ? customTopic : topic
```

It lives in `effectiveTopic()` / `topicLiteral()` in `node_generators.js`, and the identical rule is exported from `graph-topics.ts` as `effectiveTopicValue()` for the authoring UI and the graph-level topic validator.

## Central Initialization

The transpiler's shared-init machinery (see `docs/dev/nodes/transpiler-architecture.md`) aggregates every `initFunction: "init_mqtt"` contribution into a single `async def init_mqtt()` that runs once in `run()` before any graph starts.

Each node's init generator returns:

- `init.block` (priority 10): `register_subscription(...)` / `register_publish(...)`.
- `init.execute`: `_mqtt.start()`.

The assembler emits all init blocks (sorted by priority) before all execute blocks, so every subscription across every graph is registered before the guarded `start()` connects and subscribes; byte-identical execute blocks are emitted only once. Because `start()` is idempotent and `register_subscription()` also subscribes immediately when the runtime is already connected, late registration and duplicate contributions are harmless.

## Runtime Execution Model

`otter_mqtt/runtime.py` owns a singleton `MqttRuntime` and exposes module-level helpers the generated code calls:

- `ensure_runtime()` — loads settings and returns the singleton (cheap, idempotent).
- `register_subscription(topic, qos)` — accumulate and dedupe, and subscribe immediately when the runtime is already connected. This is what makes registration order-independent: the `MqttService` controller may connect at boot long before `init_mqtt()` registers the graph's topics, and late registrations still reach the broker. `_subscriptions` stays the source of truth so a later (re)connect re-subscribes everything; a failing `subscribe()` is logged and ignored rather than propagated.
- `register_publish(topic, qos)` — accumulate and dedupe.
- `start()` — the single gate for network activity. When settings `enabled` is `False` it early-returns with no connect, no subscriptions, and no pump. Otherwise it creates the client, connects once, subscribes to all registered topics, and spawns the background pump. It is idempotent, so the controller can call it on every late connect / link-up. Credentials follow one rule: a configured `user` always gets a password (an empty one when none is set, because `umqtt.simple` calls `len(password)` and would raise `TypeError` on `None`), while a `password` without a `user` is ignored. A failed connect drops the half-open client so the next attempt cannot leak its socket.
- `connected` — public property reporting whether the client is currently up.
- `disconnect()` — cleanly closes the connection, clears `connected`, and stops the pump (idempotent).
- `_pump()` — `while self._client is not None: client.check_msg(); client ping when due; await asyncio.sleep_ms(pump_delay_ms)`. Any `check_msg()` exception is treated as connection loss: the runtime marks itself disconnected and returns, leaving the reconnect to the controller. `_keepalive_tick()` sends a `PINGREQ` once half the configured `keepalive` window (default 60 s → every ~30 s) passed without any outbound packet — a publish counts as activity — and a failing ping tears the link down the same way an exception does.
- `publish(topic, value, qos, retain, if_changed)` — no-op when disabled. `if_changed` skips a payload equal to the last **successfully published** one on this connection: the memo is written only after `client.publish()` returned without raising, and `_mark_disconnected()` clears it. "On change" therefore means "on change since the last successful publish on this connection", and a value that could not be sent (link down, publish failed) is re-sent after the reconnect even when it did not change. A successful publish also restarts the keepalive clock and prints one `publish: first ok …` line per topic per connection.
- `coerce(payload, value_type, json_key)` — payload decode, optional JSON key extraction, and type conversion. Returns `None` when the payload cannot be turned into the requested type (missing JSON key, malformed JSON, non-dict JSON, unparseable value), so callers can fall back to a default.
- `configure_will(topic, payload, retain=True, qos=0)` / `clear_will()` — set or drop the broker-side last will; applied to every fresh client before it connects.
- `publish_deferred(topic, payload, qos=0, retain=True, key=None, if_changed=None)` / `clear_deferred(key=None)` — retained payload that is published now and re-asserted after every successful connect.
- `on_connect(callback)` — register a hook that runs after every successful connect (never aborts the connection).
- `json_payload(value)` / `json_value(payload)` — canonical JSON encode/decode pair (bytes ↔ Python value), shared with `payloadMode: json-store` and the `hass` package.

### Read API

`runtime.py` separates two questions per consumer: *what is the current value?* and *did a new usable message arrive?*

| Call | Purpose |
|------|---------|
| `latest(topic)` | Raw payload of the last stored message, or `None`. |
| `latest_value(topic, value_type, json_key, default, require_connected)` | Sticky, typed value read — the call generated by `mqtt-read`. |
| `has_new(topic, key=None)` | Non-consuming peek: is there an unconsumed message for this consumer? |
| `take_latest(topic, key=None)` | Consumes and returns the raw payload, or `None`. |
| `take_updated(topic, value_type, json_key, key, require_connected)` | Consumes the message and reports whether it coerced to a usable value. |

`latest_value()` **never returns `None`** and never returns a type other than the requested one. It resolves the value in this order:

1. the stored payload, if one exists (and, with `require_connected=True`, if it arrived during the current connection);
2. the caller's `default`, coerced to `value_type`;
3. the type default (`0`, `0.0`, `False`, `''`).

Only `default=None` means "no default given", so `default=0` is a valid configured default (an `int` `0` on a `float` node yields `0.0`). Coerced payloads are cached per `(topic, value_type, json_key)` and invalidated by the message sequence number, so several read nodes on one topic share a single `ujson.loads` per payload; failures are cached the same way.

Freshness is tracked **per consumer**, not per topic: `take_updated()`/`take_latest()`/`has_new()` accept a `key` and use `key or topic` as the cursor name. The generated `mqtt-read` node passes `key='_mqtt_read_<nodeId>'`, so two read nodes on the same topic both see every message (`key=None` keeps the historical per-topic cursor). A payload that fails coercion is consumed silently — `take_updated()` reports `False` once and the next valid message reports `True` again.

Connection awareness comes from a per-message epoch: `start()` increments `_connect_epoch`, `disconnect()` and a pump-detected socket failure increment it again, and each stored message records the epoch it arrived in. `require_connected=True` ignores messages whose epoch does not match the current one, which is what makes `Default on Dis.` revert to the default while the old payload is still cached.

### Will (last will and testament)

`configure_will(topic, payload, retain=True, qos=0)` lets the **broker** publish one payload on the device's behalf when the TCP link dies. The will is not a normal publish: it travels inside the `CONNECT` packet, so it must be recorded on a client **before** `connect()` runs. `umqtt.simple.set_last_will()` only stores the values that `connect()` then encodes — calling it after `connect()` would never reach the broker.

`start()` builds a **fresh** client object on every attempt and calls `_apply_will(client)` between `set_callback()` and `connect()`, so the will is re-applied automatically on every reconnect without any extra bookkeeping. `_will` lives in the runtime (not the client) so it survives `_release_client()` and `_mark_disconnected()`; `clear_will()` drops it and the next connection carries none.

The broker publishes the will only on an **unclean** disconnect (socket loss, power cut, keepalive timeout). A clean `disconnect()` cancels it, so a will always pairs with an explicit `online` payload published by the application — otherwise a device that shuts down deliberately would look dead forever. A client without `set_last_will` is tolerated: one `will: client does not support set_last_will, ignored` error line and `start()` continues.

### Deferred retained publishes

`publish_deferred(topic, payload, qos=0, retain=True, key=None, if_changed=None)` stores a payload and publishes it **now** (when connected) and **again after every successful connect**. This is what discovery configs, captions and availability flags need: `publish()` drops silently while the link is down, so a retained payload composed during `init_mqtt()` would be lost whenever the broker is not up yet, and a broker without persistence forgets retained values after a restart.

- Entries are keyed by `key or topic`; the same key queued again replaces the payload (one entry, latest value).
- `if_changed` only suppresses the **immediate** publish. A connect replay always publishes, because the broker may have lost the retained value meanwhile; the replay then records the memo, so an immediate publish right after a reconnect does not repeat it.
- `_deferred` is never cleared on disconnect — re-asserting retained payloads after a reconnect is the point. Use `clear_deferred(key=None)` to remove one or all entries.
- A publish failure is logged once per topic as `publish failed (deferred) topic='…' (…)`; `start()` still completes.
- On a disabled runtime the entry is stored and nothing is published, exactly like `publish()`.

### Connect hooks

`on_connect(callback)` registers a callback that runs **after** a successful connect, i.e. after subscribing, after the deferred replay and after the epoch increment, and before the pump starts. Hooks are deduplicated by identity, are never cleared on disconnect (they belong to the runtime for the whole session, like `_subscriptions`), and never run retroactively. A hook that raises produces one `connect hook failed (…)` error line and the next hook still runs — a hook can never abort `start()`.

### Message hooks

`on_message(callback)` registers a callback that runs **synchronously inside the pump** for every
message the pump receives, after the message is stored and the sequence counter is bumped — so a hook
may itself call `latest_value()`, `take_updated()` or `publish()`. The callback receives the decoded
`(topic, payload)` strings, i.e. the same values the read API returns. Hooks persist across reconnects
like the connect hooks, are deduplicated by identity (a second `configure()` cannot register the same
handler twice), and one raising hook only emits one `message hook failed (…)` error line — the pump
keeps running and the message stays readable through the pull API.

Use `on_message()` when a package must react to one specific message without owning a loop — e.g. an
`Init` (startup) graph that never runs a loop again. For a graph that does run a loop, prefer the
pull API (`take_updated()`), which leaves the read timing to the graph.

### JSON payloads

`json_payload(value)` / `json_value(payload)` are the single JSON encode/decode pair. They are pure module-level functions (no runtime state), used by `payloadMode: json-store` and by the `hass` package, so both agree on the wire format: compact separators (`{"k":1,"b":true}`), dict insertion order preserved, `int`/`float`/`bool`/`str` intact after a round trip.

`json_payload()` returns bytes and never raises: a value that cannot be serialised is published as its `str()` with exactly one `[error] mqtt: json: encode failed …` line, because a payload that cannot be encoded means the graph produces something that will never round-trip. `json_value(None)` returns `None` **silently** (a missing message is not an error); malformed JSON logs one `[error] mqtt: json: decode failed …` line and returns `None`.

The message pump runs independently of graph loops, with its poll delay configured in the settings (`pump_delay_ms`, default 50 ms). It owns the MQTT keepalive: `umqtt.simple` never sends `PINGREQ` on its own, so a client that only subscribes would be disconnected by the broker after roughly 1.5× the negotiated `keepalive` (90 s at the default 60 s), and the link would flap forever because the controller only resyncs every `resync_interval_s`. The pump therefore calls `client.ping()` once half the keepalive window elapsed without an outbound packet; the `PINGRESP` (`0xd0`) is consumed transparently by `check_msg()` (`umqtt/simple.py`), so the vendored client stays unpatched. A failing ping is reported as `keepalive ping failed (…)` and tears the link down immediately, which makes the controller reconnect on its next tick instead of leaving a zombie connection. At the general runtime the **network-service controller** (see `docs/dev/device-communication/network-services.md`) owns start/stop: `MqttService` lazily imports `otter_mqtt.runtime`, uses the shared `ensure_runtime()` singleton, and calls `start()`/`disconnect()` as the station link comes up or drops, instead of node-generated init code connecting once with no network awareness.

## Diagnostics

`otter_mqtt/runtime.py` prints one-line diagnostics with an explicit severity prefix. The web console's serial parser (`src/micro_otter/nodes/html/js/serial/device-connection.ts`) turns `[info] …` into an info entry and `[error] …` into an error entry; anything else stays raw output. Use these prefixes for every MQTT log line, never a bare `print('[mqtt] …')`.

| Line | Severity | Meaning |
|------|----------|---------|
| `settings: file=<path> loaded enabled=… host='…' port=… client_id=… user=… password=set/unset keepalive=… pump_delay_ms=… resync_interval_s=…` | info | Settings were read. The password is never printed, only whether one is set. |
| `settings: file=<path> not found, using defaults` | info | No settings file: MQTT stays disabled. |
| `settings: load failed (…), using defaults` | error | The file exists but could not be parsed. |
| `register: subscription topic='…' qos=… (deferred, immediate, or duplicate ignored)` | info | Registration before connect, late registration onto a live link, or a duplicate contribution from a second graph. |
| `subscribe: '…' qos=… ok` | info | The SUBSCRIBE reached the broker. |
| `subscribe failed '…' qos=… (…)` | error | The broker refused the SUBSCRIBE; the runtime keeps running. |
| `register: publish topic='…' qos=…` | info | First registration of a publish topic. |
| `start: requested enabled=… connected=… wifi=up/down/unknown` | info | Every `start()` call, so silence is never ambiguous. `wifi` is the station link as far as `machine.WLAN(WLAN.STA_IF).isconnected()` can tell; `unknown` means the port has no WLAN interface (host tests), which keeps the unconditional path. |
| `start: skipped, disabled by settings (/mqtt_settings.json)` | info | MQTT is off — the usual reason nothing happens. |
| `start: skipped, already connected` | info | Idempotent call from a controller resync. |
| `start: deferred, wifi station link is down (the network service controller starts mqtt once it connects)` | info | `init_mqtt()` ran before the station associated (the normal case after a hard reset). Nothing is attempted and nothing is lost: the controller starts the runtime on the late-connect sync and replays the whole queue. |
| `start: skipped, umqtt client unavailable (otter_mqtt.umqtt.simple not importable)` | info | The frozen firmware does not contain the client module. |
| `connect: user configured without password, sending empty password` | info | A username without a password is legal; `umqtt.simple` would otherwise raise `TypeError` in `len(password)`. |
| `connect: password ignored (no username configured)` | info | A password alone is meaningless in MQTT. |
| `connect: mqtt://<host>:<port> client_id=… keepalive=… user=… password=set/unset` | info | The exact broker endpoint and negotiated keepalive being attempted. |
| `connect: ok mqtt://<host>:<port> (<n> ms)` | info | CONNACK received; the elapsed time bounds how long the connect blocked. `MQTTClient.connect()` sets `umqtt.simple.CONNECT_TIMEOUT_S` (10 s) on the socket so a dead link cannot block the event loop forever. |
| `connect: re-announcing <n> deferred topic(s) (discovery, state and availability)` | info | The retained queue is replayed after this connect. `connected` plus this count is the proof that the app actually queued something; a missing line means the bridge/entity registration never ran. |
| `connect failed mqtt://<host>:<port> (<n> ms) <error>` | error | Connect/SETUP/subscribe failed; the half-open client is closed and `connected` stays `False`. |
| `pump: started delay_ms=… keepalive_ms=…` | info | The `check_msg()` pump is running; `keepalive_ms` is the effective window (`keepalive` × 1000, `0` = no pings). |
| `pump: not started (no running event loop)` / `(no asyncio module)` | info | The runtime was started outside the device event loop. |
| `pump: start failed (…)` | error | `create_task` rejected the pump. |
| `pump: stopped (client cleared)` | info | The pump exited because the client went away. |
| `connection lost (…)` | error | `check_msg()` raised: the link is gone, the pump tears the client down and leaves the reconnect to the controller. |
| `keepalive ping failed (…)` | error | The idle `PINGREQ` could not be written: the link is dead even though no read failed yet. |
| `keepalive: link torn down after failed ping` | info | Follows the error above: `connected` is now `False` and the controller will reconnect. |
| `disconnect: requested connected=…` / `disconnect: done` | info | Explicit shutdown, bracketing any `disconnect: close failed (…)` error. |
| `message: topic='…' payload='…' (first on this topic)` | info | **First** payload per topic only, truncated to 32 characters. |
| `publish: skipped (not connected) topic='…'` | info | **First** skip per topic. |
| `publish: queued (not connected) topic='…' queued=<n>` | info | **First** `publish_deferred()` per key while offline; `queued` is the current queue size. Seeing the queue grow proves the announce path ran before the broker was reachable. |
| `publish failed topic='…' (…)` | error | **First** failure per topic. |
| `publish failed (deferred) topic='…' (…)` | error | **First** failure per topic for a `publish_deferred()` entry; the entry stays queued for the next connect. |
| `will: configured topic='…' retain=… qos=…` / `will: cleared` | info | The last will was set or dropped. |
| `will: client does not support set_last_will, ignored` | error | The client object has no last-will support; the connection continues without one. |
| `connect hook failed (…)` | error | One `on_connect()` callback raised; the remaining hooks still run. |
| `message hook failed (…)` | error | One `on_message()` callback raised; the pump keeps running and the message stays readable through the pull API. |
| `json: encode failed for <Type> (…)` / `json: decode failed (…)` | error | `json_payload()` / `json_value()` could not convert a value; no exception escapes. |
| `publish: first ok topic='…' qos=… retain=… payload='…'` | info | First successful publish on this topic since the last (re)connect; payload truncated to 32 characters. |

MQTT error arguments are CONNACK return codes; the runtime appends a readable reason to `umqtt.simple.MQTTException` messages:

| Code | Reason | Typical cause |
|------|--------|---------------|
| 1 | `unacceptable-protocol` | The broker rejected the protocol level (TLS/plain mismatch). |
| 2 | `identifier-rejected` | Duplicate or malformed `client_id`. |
| 3 | `server-unavailable` | The broker is up but not accepting clients. |
| 4 | `bad-username-or-password` | Wrong credentials. |
| 5 | `not-authorized` | Authenticated but not permitted. |

Per-message logging is **bounded by construction**: the pump runs every `pump_delay_ms` (50 ms by default) and must never print per message or per publish call. The runtime therefore keeps five de-dupe sets (`_log_topics`, `_log_publish_skips`, `_log_publish_failures`, `_log_publish_ok`, `_log_deferred_queued`) and logs at most one line per topic (or per deferred key) for each of those events: all but `publish: first ok` once per boot, and `publish: first ok` once per topic per connection (cleared in `start()`), so a reconnect proves the publish path works again.

## Settings & Config View

Broker settings live in a preserved `/mqtt_settings.json` (also `/app/mqtt_settings.json` for upgrades), edited through the `general` runtime custom view exactly like WiFi:

- `otter_runtime/custom_settings.py` provides `create_mqtt_settings`, `read_mqtt_settings`, and includes MQTT fields in the merged `read_runtime_settings`/`create_runtime_settings` (whose WiFi arguments are the per-mode `wifi_sta_enabled`/`wifi_sta_ssid`/`wifi_sta_password`/`wifi_ap_enabled`/`wifi_ap_ssid`/`wifi_ap_password` set).
- `custom_view.json` defines a collapsible `mqtt_settings` section with an `mqtt_enabled` checkbox (default `false`) and a `mqtt_resync_interval_s` number control.
- `resync_interval_s` (default `30`, minimum `1`) configures how often the runtime controller re-syncs its services, bounding how quickly a dropped broker connection is re-established while WiFi stays up.

MQTT is **opt-in**: because the firmware is a general runtime, MQTT is disabled by default and must be explicitly enabled. When disabled, no connection is established, no subscriptions are sent, and no message pump is started.

Because the section is collapsed by default, `create_runtime_settings()` answers an upload that
carries broker settings while `mqtt_enabled` is `false` with a `warning` dialog
(`generalRuntime.customView.mqttDisabledWarning`): the values are written to
`/mqtt_settings.json`, but nothing would ever use them. The same check covers station and
access-point credentials whose profile is disabled (`_disabled_section_warnings()`).

## Vendored umqtt Client

The stock `umqtt.simple` and `umqtt.robust` clients are vendored under `otter_mqtt/umqtt/` and frozen via `mpAssets`. `robust.py` imports `simple` through a package-relative import (`from . import simple`), keeping the whole client under the unambiguous `otter_mqtt.umqtt` namespace instead of a bare top-level `umqtt`.

The runtime uses `umqtt.simple` by default: `robust.MQTTClient.check_msg()`/`disconnect()` retry forever on a dead socket without yielding, which would busy-loop the event loop when a link drops; `simple.MQTTClient` raises promptly and leaves the reconnect decision to the controller. `robust.py` stays vendored but is no longer used by the runtime.

## Integration Pattern

This package establishes a reusable "device integration" shape that future ESPHome-style modules (e.g. Modbus) can follow without new core machinery:

- A preserved settings file + custom-view section.
- A central `init_<domain>()` derived from node init contributions.
- A singleton `otter_<domain>/runtime.py` with a background pump.
- Thin read/write nodes whose loop generators call the runtime.

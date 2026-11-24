# Changes since version 1.26.0

## Fixes

- **A generated app whose startup graph only holds the HA bridge no longer breaks the whole
  module** — the `Init` graph emitted `async def init():` with a comment-only body, so
  `mpy-cross` rejected `main_loop.py` with `SyntaxError: invalid syntax`, the runtime reported
  `controller-main-loop-load-failed` and the app never ran: `_hass.configure()` and
  `_mqtt.start()` were never called, so nothing was queued and nothing was ever announced to
  Home Assistant. Every emitter now writes `pass` when a body has no executable statement.
- **MQTT connects only after the WiFi station link is up** — `init_mqtt()` runs about two
  seconds after boot, before a hard reset has reassociated the station. `MqttRuntime.start()`
  now reads `machine.WLAN(WLAN.STA_IF).isconnected()` and defers with a log line instead of
  blocking in `MQTTClient.connect()`. The network-service controller starts the runtime on the
  late-connect sync, which replays the whole deferred queue.
- **Bounded connect** — the vendored `umqtt.simple.MQTTClient.connect()` sets
  `CONNECT_TIMEOUT_S` (10 s) on the socket, so `getaddrinfo`/`connect`/the CONNACK read can no
  longer freeze the event loop on a dead link.

## Improvements

- **A main loop that cannot start now logs `[error]`** — `app.main_loop` failures were only
  emitted as the machine-readable `[otter] {...}` event, which lands in the generic `otter`
  filter, so a boot in which the app never ran looked clean. The controller now also prints one
  short plain line (`tools.runtime_log.log_plain` / `describe_exception`):
  `[error] controller: main loop load failed; the app did not start - check that app/main_loop.py is valid (SyntaxError: invalid syntax)`.
  The same applies to `main loop task create failed` and to an app task that raises
  (`main loop raised; reloading (TypeError: …)`) — that exception used to be swallowed
  completely. The full traceback is still emitted as the JSON event.
- **The registration path is traceable in the device log** — `start: requested …
  wifi=up/down/unknown`, `start: deferred, wifi station link is down`,
  `publish: queued (not connected) topic='…' queued=<n>` (once per key) and
  `connect: re-announcing <n> deferred topic(s)`. `connected` without a `re-announcing` line now
  says explicitly that the bridge/entity registration never ran.
- **`skip mqtt: disabled` names its cause** — services may implement the optional
  `disabled_reason()` hook; `MqttService` reports `enabled=false in /mqtt_settings.json` or
  `runtime import failed`.
- **Tests** — the demo collection is transpiled and compiled as Python as a regression guard;
  new coverage for the empty-body rule, the WiFi gate, the deferred/live logging, the
  `disabled_reason()` hook and the connect timeout.

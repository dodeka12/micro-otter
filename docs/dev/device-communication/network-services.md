# Network Services

The general runtime treats every protocol (web server, MQTT, and future ones like WebSocket/BLE) as
a **network service**: each service starts when its own persisted `enabled` flag is set *and* its
transport prerequisite is met, retries on a late station connect, tears down when the link drops,
and stops on shutdown.

## Settings store

`otter_runtime/settings_store.py` is the single generic JSON settings I/O helper shared by the view
and the runtime services, so both stay on one file format.

- `read_settings(path, defaults)` reads a JSON dict and falls back to a **copy** of `defaults` on
  any problem (missing/unreadable/invalid/non-dict document). It is deliberately fail-open and never
  raises, matching `otter_mqtt.runtime._load_settings`. Unknown keys in the document are ignored, and
  the caller's `defaults` dict is never mutated.
- `write_settings(path, values)` writes a dict as JSON, overwriting the file.
- Constants: `WEBSERVER_SETTINGS_FILE` (`/webserver_settings.json`), `MQTT_SETTINGS_FILE`
  (`/mqtt_settings.json`), and `WEBSERVER_SETTINGS_DEFAULTS` (`{"enable": True, "port": 80}`).

The view (`custom_settings`) keeps its own stricter `success`/`error` semantics on top of this
fail-open read primitive.

## Service contract

`otter_runtime/service_controller.py` defines `NetworkService`, the protocol every adapter
implements:

- `name` — short identifier used in status events.
- `enabled()` — the service's own persisted flag.
- `running()` — whether the service is currently up (used to skip no-op transitions).
- `transport_ready(network)` — the service's gate over the transport facts. The default accepts
  `sta_connected or ap_active`; `requires_network = False` makes it always accept, and
  connection-oriented services (MQTT) override it with a stricter, station-only requirement.
- `start(network)` / `stop()` — idempotent; `start` reuses an existing instance where possible.

`network` is a plain dict (`host_ip`, `sta_connected`, `ap_active`, `ap_ip`) — no class needed on
MicroPython.

## Controller

`ServiceController` reconciles a list of services with the current network state:

- `sync(network)` starts every enabled service whose transport prerequisite is met, and stops
  services that should no longer run (disabled, or transport no longer ready — the
  stop-on-transport-loss rule). It is idempotent, so boot, late connect and link drop all share one
  code path.
- The transport facts also become true when the station was **already associated at boot** (soft
  reset: the radio was never torn down, so `bring_up_wifi()` never runs `connect_station()`). The
  station supervisor adopts the live link and calls `on_late_connect(ip)`, which re-derives the
  network dict and re-syncs the controller, so services start without a `connect_station()` round
  trip — and a station-only service such as MQTT is no longer stopped on the first resync tick.
- Failure isolation: one service's exception only emits a status event (`service-start-failed` /
  `service-stop-failed`); `sync()`/`shutdown()` never raise. The per-service state checks
  (`enabled()` / `running()` / `transport_ready()`) are covered by the same guard: a raising adapter is
  logged once as `[error] service-controller: <name> state check failed (<exc>)` and skipped, so one
  broken adapter cannot leave every later service unstarted. The message is repeated only after that
  service reconciles successfully again, which keeps a permanently broken adapter from logging on each
  resync tick.
- `shutdown()` stops every running service.
- `status_callback(state, **fields)` is optional and mirrors the WiFi status callback; events are
  `service-started`, `service-start-failed`, `service-stopped`, `service-stop-failed` (each with
  `service=<name>`, plus `error=<str>` on failures). A callback that raises is swallowed.
- Logging explains *silence*: when a service is not started the controller says why, but only when
  the reason changes — `sync()` runs on every periodic tick, so an unconditional line would repeat
  itself every `resync_interval_s`.

  | Line | Meaning |
  | --- | --- |
  | `[info] service-controller: skip <name>: disabled` | The service's own flag is off. |
  | `[info] service-controller: skip <name>: disabled (<detail>)` | The adapter implements the optional `disabled_reason()` hook, e.g. `MqttService` reports `enabled=false in /mqtt_settings.json` or `runtime import failed`, so a bare `disabled` cannot be mistaken for a broken adapter. |
  | `[info] service-controller: skip <name>: transport not ready (sta_connected=<bool> ap_active=<bool>)` | Enabled, but its gate refused the current transport facts. |
  | `[info] service-controller: starting <name>` / `started <name>` / `start failed <name> (<exc>)` | Every start attempt and its outcome. |
  | `[info] service-controller: stopping <name> (<reason>)` / `stopping <name>` | A stop, with the reason when the controller initiated it (`disabled`, `transport not ready (…)`); `shutdown()` stops without a reason. |
  | `[info] service-controller: stop failed <name> (<exc>)` | The adapter's `stop()` raised; the next tick retries. |

## Web server service

`otter_runtime/webserver_service.py` adapts `WebInterface` to the controller:

- `WebServerService.from_settings()` reads `enable` and `port` from `/webserver_settings.json` (via
  the settings store), so the persisted flags are honoured for the first time.
- `start(network)` constructs `WebInterface(host_ip, enable_server=False, port=self._port)` — the
  controller owns the start decision — and publishes it as `WEB_INTERFACE`. A late connect reuses the
  same instance via `set_host_ip()`; `start_server()`'s idempotency means no second server object is
  ever created.
- `stop()` awaits `shutdown()`, clears `WEB_INTERFACE`, and drops the instance.
- `enabled`/`port` are captured at construction time (`build_runtime_services()`), so changing them
  in the view takes effect only after a reset (live reconfiguration is out of scope).

### Runtime limits and scheduling

`WebServer` enforces hard limits so a misbehaving or slow client cannot monopolise the `uasyncio`
scheduler (the runtime also runs the 22.5 kHz I2S audio loop on the same scheduler):

| Constant | Default | Meaning |
| --- | --- | --- |
| `_REQUEST_TIMEOUT_S` | 10 | Timeout for reading a request (headers + body) from a new connection. |
| `_RESPONSE_TIMEOUT_S` | 30 | Timeout for the dispatch + body-send phase of one request. |
| `_WRITE_YIELD_INTERVAL_MS` | 4 | The send loops hand the scheduler back at least this often while streaming file/segmented bodies. |
| `_MAX_CONCURRENT_CLIENTS` | 8 | Concurrent connection cap; excess clients get `503 Service Unavailable` without being read. |
| `_KEEP_ALIVE_IDLE_TIMEOUT_S` | 5 | How long a keep-alive socket may stay idle between requests before the server closes it. |
| `_MAX_REQUESTS_PER_CONNECTION` | 24 | Requests one socket may serve before it is closed and the client reconnects. |

#### Keep-alive contract

HTTP/1.1 requests (and HTTP/1.0 requests with an explicit `Connection: keep-alive`) reuse the
socket; `404` keeps it open while `400`/`405`/`500`/`503`, parse failures, and any timeout or
`OSError` close it, because the framing may be stale after those. Reusable responses advertise
`Connection: keep-alive` plus `Keep-Alive: timeout=5, max=24`.

The per-connection cap is counted in **requests, not seconds**, so its wall-clock period scales with
the client's poll rate: the 10 Hz webview poll (100 ms) reconnects every 2.4 s, while a 1 Hz page
reconnects every 24 s. The response that reaches the cap is sent with `Connection: close` and without
a `Keep-Alive` header, so a client never reuses a socket the server is about to close; that is why the
cap is enforced inside `_serve_request()` rather than only in the accept loop. Setting
`_MAX_REQUESTS_PER_CONNECTION = 1` is the supported rollback to one request per connection. The cap
does not affect cadence — a 177-poll measurement at 100 ms across six reconnects showed no gap or
latency step at the reconnects.

These constants in `otter_runtime/web_server.py` are the supported on-device tuning knobs: changing
them requires a rebuild/deploy, and raising a value trades heap/task count for tolerance of slow
clients.

## MQTT service

`otter_runtime/mqtt_service.py` adapts the shared `otter_mqtt` singleton to the controller:

- It lazily imports `otter_mqtt.runtime` (keeping the node package off the boot import path) and uses
  `runtime.ensure_runtime()`, so node-generated code that calls `otter_mqtt.runtime.start()`/`publish()`
  shares the very instance the controller started — no double instance.
- `transport_ready` is station-only, so a station link drop (even with the AP still up) makes the
  controller call `stop()` → `disconnect()`, and the next transport-up `sync` reconnects.
- `start()` is idempotent (returns early when disabled or already connected); `stop()` calls
  `disconnect()` and drops the local reference.
- The runtime switched from the vendored `umqtt.robust` client to `umqtt.simple`; the resilient pump
  marks the runtime disconnected on any `check_msg()` error instead of busy-looping on a dead socket.
- The adapter logs its own state under the `mqtt-service` prefix and leaves the connection details to
  the runtime, which owns them:

  | Line | Meaning |
  | --- | --- |
  | `[info] mqtt-service: importing otter_mqtt.runtime` | First use: the node package is being imported. |
  | `[info] mqtt-service: runtime ready enabled=<bool>` | The shared singleton is available and whether MQTT is enabled. |
  | `[error] mqtt-service: runtime import failed (<exc>)` | The package is missing from the firmware; logged once, then the adapter reports `enabled() == False` instead of raising on every resync. |
  | `[info] mqtt-service: start sta_connected=<bool> enabled=<bool> running=<bool>` | State **before** the start attempt (the earlier code printed this after the work). |
  | `[info] mqtt-service: start done connected=<bool>` | The attempt finished; `connected=False` means the broker link is down and the `mqtt:` lines above say why. |
  | `[info] mqtt-service: stop connected=<bool>` / `stopped` | Teardown. |

  The broker URL, elapsed time and MQTT reason code come from the runtime's own `mqtt:` lines, so the
  adapter needs no accessor into the runtime's settings.

## Registry and boot wiring

`otter_runtime/services.py` is the single registry: `build_runtime_services()` returns the ordered
adapters (`[WebServerService, MqttService]`), and `load_mqtt_resync_interval_s()` lazily reads the
resync interval. A future protocol adds one adapter file + one registry entry — no change to
`otter_main`, `wifi_boot` or `service_controller`.

`otter_main` builds the controller once and calls `controller.sync(_network_from(boot))`:

- at **boot** (after bring-up),
- on **late station connect** (`_handle_late_station_connect`),
- on **link drop** (`_handle_transport_down`), and
- on a **periodic tick** (`_service_sync_loop`, driven by the MQTT resync interval), so a dropped
  broker connection is re-established while WiFi stays up.

`shutdown()` runs the controller's `shutdown()` (the web adapter clears `WEB_INTERFACE` in its own
`stop()`).

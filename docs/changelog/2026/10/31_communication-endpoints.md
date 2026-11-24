# Changes since version 1.23.0

## Bug Fixes
- **The web server now honours `webserver_settings.json`** — the persisted `enable` and `port` are
  read and applied (previously both were ignored and the server started whenever any interface came
  up, always on port 80).
- **A late station connect starts only enabled services** — previously it started the web server
  unconditionally.
- **MQTT now disconnects and reconnects with the link** — the runtime controller starts MQTT when its
  `enabled` flag is set and the station link is up, retries on a late connect, and disconnects cleanly
  and reconnects when the link drops (previously it connected once, failed silently while WiFi was
  down, never retried, and could busy-loop on a dropped link).

## Changes
- **WiFi reports transport facts only** — `wifi_boot` no longer decides which services run; it detects
  a station link drop and surfaces it as a transport-down event.
- **Configurable station reconnect interval** — set in the WiFi settings in seconds (min 1 s; was
  hard-coded 30 s).
- **Configurable MQTT resync interval** — the runtime periodically re-syncs its services so a dropped
  broker connection is re-established automatically; the interval is set in the MQTT settings in
  seconds (min 1 s).

## Notes
- **Settings snapshot at boot** — both intervals are read once at boot, so changing them takes effect
  after a reset. The MQTT client switched from the vendored `umqtt.robust` to `umqtt.simple` (the
  robust client busy-loops on a dead socket).
- **Runtime manifest** — general runtime `1.27.2 → 1.33.0` for the new
  `otter_runtime/{settings_store,service_controller,webserver_service,mqtt_service,services}.py`
  modules, the changed `custom_settings.py`, `web_interface.py`, `wifi_boot.py` and `otter_main.py`,
  and the new `custom_view.json` controls and locales. The MQTT package `0.4.0 → 0.6.0` for the
  `otter_mqtt/runtime.py` changes, and the device tools package `0.6.0 → 0.7.0` for the
  `wifi_manager.py` reconnect-interval additions.

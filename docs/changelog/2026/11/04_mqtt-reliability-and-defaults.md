# Changes since version 1.26.0

## Bug Fixes

- **MQTT stays connected after a soft reset** — after Ctrl-D / reload the WiFi radio is still
  associated, so `bring_up_wifi()` never runs `connect_station()` and the boot result kept
  `sta_connected=False`. The station supervisor now *adopts* an already-connected interface
  (`wifi-boot: station already connected, adopted ip=…`): `sta_ip`/`host_ip` are read from the live
  interface, `errors["sta"]` is cleared and `on_late_connect(ip)` re-syncs the services. The
  transport facts are therefore true before the first 30 s resync tick, and the controller no longer
  stops MQTT ~28 s after boot. No `connect_station()` round trip is made and `retry_count` is
  untouched.
- **A value that could not be published is sent after the reconnect** — `if_changed` recorded the
  payload *before* the connected check, so a value produced while the link was down was marked as
  published and suppressed forever. The memo is now written only after a successful
  `client.publish()` and cleared when the link drops, so the first value after a reconnect always
  goes out (which also restores retained state after a broker restart). Duplicates on a healthy
  connection are still suppressed.

## Improvements

- **First successful publish is logged** — one
  `[info] mqtt: publish: first ok topic='…' qos=… retain=… payload='…'` line per topic per
  connection, payload truncated to 32 characters. It proves the publish path works after every
  reconnect without logging per value, so "the device went quiet" can be told apart from "the value
  never changed" and "the link is down".
- **`mqtt-write` publishes retained by default** — retained state is what a late subscriber (Home
  Assistant, a freshly started `mosquitto_sub`) sees after a restart. Graphs saved before the change
  carry no `retain` value at all, and the generator now treats an absent value as `true`, so only an
  explicit `retain: false` publishes unretained.

## Changes

- **`mqtt-read`'s disconnected-default checkbox is labelled `Default on Dis.`** (de: `Standard bei
  Trennung`) — the old label overflowed the node body and forced the control row to wrap. The
  description keeps the full explanation, and the control id (`defaultWhenDisconnected`) with its
  `false` default is unchanged, so saved graphs transpile exactly as before.

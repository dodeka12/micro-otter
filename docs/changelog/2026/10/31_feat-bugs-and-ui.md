# Changes since version 1.23.0

## New Features
- **Refresh button for the WebSocket device list** — the device dropdown in the connection toolbar
  now has an inline refresh button that re-queries the bridge's `/api/serial-ports` endpoint, and the
  dropdown refreshes automatically whenever the Device view becomes visible again.
- **Wrapping `stack` layout entries in custom views** — the custom-view renderer now supports
  `stack` containers that lay arbitrary controls out horizontally and wrap onto extra rows when
  space runs out. The general runtime's webserver and MQTT sections use them so their controls sit
  side by side on wide panels and wrap on narrow ones.

## Bug Fixes
- **Device names no longer disappear after a deployment** — the device dropdown keeps the last known
  friendly port labels when the bridge briefly reports an empty or unreachable port list (e.g. while
  the device reboots during a deployment), refreshes when returning to the Device view, and preserves
  the friendly label for the connected device instead of degrading to a bare `/dev/tty...` path.

# Changes since version 1.23.0

## New Features
- **Independent station and access-point settings** — `/wifi_settings.json` now stores
  `profiles.sta` / `profiles.ap`, each with its own `enabled`, `ssid` and `password`, so switching a
  device between modes no longer discards the other mode's credentials. Legacy flat files are
  migrated on the first read.
- **WiFi can be switched off** — disabled profiles are never validated, so empty SSID/password values
  can be saved, and neither the runtime nor the status check touches a WiFi interface while both
  profiles are disabled.
- **Station reconnect supervisor** — a background task retries a failed station connect every 30 s,
  logs failures to the serial console only (no access-point fallback) and starts the web server as
  soon as a late attempt succeeds, so a router reboot no longer requires a manual reset.
- **`visibleWhen` control property** — custom views can show a control only while another control has
  a given value (single condition or AND-ed array); hidden controls are skipped by button `validate`
  arrays and fully hidden rows collapse.

## Changes
- **Device view** — the WiFi section now has two enable checkboxes plus per-mode SSID/password
  (`wifi_sta_*` / `wifi_ap_*`); `create_runtime_settings` / `read_runtime_settings` changed their
  signatures accordingly (see Notes for hand-written views).
- **Runtime manifest** — general runtime `1.19.0 → 1.27.1` for the new `otter_runtime/wifi_boot.py`
  (now part of the deployed filesystem list), the changed `custom_settings.py`, `web_interface.py` and
  `otter_main.py`, and the new `custom_view.json` and locales.

## Bug Fixes
- **The status button and the view setup no longer power up the WiFi radio while WiFi is disabled** —
  `check_wifi_status()` reads a snapshot instead of constructing `network.WLAN` objects.
- **Saving "WiFi off" works** — previously an empty SSID was rejected even for a disabled mode, and the
  ignored `"required": true` on the SSID control was replaced by real `validation` rules.
- **An access-point-only upload no longer fails silently** — a rejected form used to log the validation
  failure to the browser console only, so clicking "Upload" appeared to do nothing. The renderer now
  highlights the offending controls and reports the failure through the button's `onError` handler
  (the upload writes it into the status field) or an error dialog.
- **Open access points are editable from the view** — the access-point password field accepts an empty
  value (open network) as well as 8-63 characters, matching the device and the CLI, so a device
  provisioned with an open AP stays configurable from the browser.

## Notes
- **Settings migration** — a legacy `{"ssid", "password", "mode", "enabled"}` document is read as that
  mode's profile; the other mode starts disabled. The file is rewritten in the `version: 2` format on
  the next save.
- **APSTA** — with both profiles enabled the device runs the access point (up first) and the station at
  the same time: two IPs, one radio/channel, one HTTP server, so it is reachable at `192.168.4.1` and
  at the station address concurrently. The access point is *not* a bridge (no NAT between the AP
  subnet and the station LAN), the soft-AP follows the station channel once connected (AP clients may
  have to rejoin), and `host_ip` reports the station address.
- **Passwords** — the station password must be 8-63 characters in the view; the access-point password
  accepts an empty value (open access point) or 8-63 characters. The settings API and `set_wifi.py`
  accept an empty password for both modes; 1-7 character passwords are rejected by the device.

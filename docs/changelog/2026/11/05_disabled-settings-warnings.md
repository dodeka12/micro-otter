# Changes since version 1.26.0

## New Features

- **An upload that writes credentials into a disabled section says so** — the runtime settings
  view saved station SSID/password, access-point password and broker settings whether or not the
  matching checkbox was ticked, and answered with a plain success line. The MQTT section is
  collapsed by default, so an upload that filled it in but left **Enable MQTT** off looked
  successful while nothing could ever connect — the failure that made a live device publish into
  the void. `create_runtime_settings()` now returns one `warning` dialog per affected section
  (`_disabled_section_warnings()` → `generalRuntime.customView.wifiStaDisabledWarning`,
  `wifiApDisabledWarning`, `mqttDisabledWarning`), shown after the restart hint with the title
  *Saved, But Not Enabled*.
- **The dialog protocol knows `warning`** — `CustomViewRenderer._handleResponseDialogs()` accepts
  `type: "warning"` next to `info` and `error`: it opens the info dialog with the title `Warning`
  and the icon `⚠️` unless the directive overrides them, so a saved-but-ineffective setting needs
  an acknowledgement without being reported as a failure. Without a view manager the directive
  falls back to a `[WARNING]` console line.

## Improvements

- **HA nodes warn when MQTT is switched off** — `otter_mqtt` accepts every publish and
  subscription while `enabled` is `false`: it stores them and never connects, so a graph with
  Home Assistant nodes produced a clean log and an empty dashboard. `HassRuntime` now prints
  `[warning] hass: entity: <component>.<object_id> publish[ and subscribe] with MQTT disabled
  (enabled=false in /mqtt_settings.json), so every topic stays on the device: state='…'
  command='…'` once per entity, and `[warning] hass: state: <component>.<object_id> publish with
  MQTT disabled …` once per entity on the first state publish (`_report_mqtt_disabled()`). A
  transport that cannot report `enabled` stays silent, so the lines only appear when the settings
  really say `enabled=false`.
- **Docs follow the behaviour** — `custom-view-architecture.md` documents the `warning` type, its
  default title/icon and the `dialog`-then-`dialogs` order; `hass-node-system.md` gained both
  warning lines in its diagnostics table; `mqtt-node-system.md` explains the upload warning for
  the collapsed MQTT section; `mqtt-and-home-assistant.md` names the warning in its first step and
  in the *no entity at all* troubleshooting row.
- **Versions** — `hass` package **0.11.0**, runtime `general` **1.50.2**. A firmware rebuild is
  required for both: the device runs precompiled bytecode, so an older `otter_hass.mpy` keeps the
  silent behaviour and an older `custom_settings.mpy` keeps answering a plain success.

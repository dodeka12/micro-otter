# Changes since version 1.26.0

## Features

- **Device availability is now an availability entry** — every `hass` entity drops the separate
  `Availability` checkbox. Its `Available Flags` multi-select always starts with a reserved
  **`Device`** entry, selected by default, so a new entity still announces the
  bridge's device topic exactly as before.
- **One list for the whole availability policy** — the same multi-select now expresses
  device-only (`Device`), device plus subsystem flags (add `heating`, `pump`, …),
  subsystem flags only (untick `Device`), and no availability at all (untick
  everything).
- **Automatic migration** — graphs saved with the old checkbox are migrated when the runtime
  definition snapshot refreshes: `true` inserts the device entry, `false` removes it, and the
  legacy control disappears. The node definition declares this through the new
  `valueMigration` control metadata, and array defaults are cloned so nodes never share one
  definition array.

## Improvements

- **Legacy generator fallback** — an un-migrated JSON file keeps its old generated output while
  it is being migrated. If the old `availability` value is still stored it wins over the list;
  a node with neither a flag list nor the legacy control keeps the historical device-on default.
- **Graph rules ignore the device entry** — `hass-availability-missing-flag` no longer badges
  `__device__`, because the bridge owns that topic rather than a `hass-availability` node.
- **Example collection** — the demo sensor follows `Device` and `heating`; the demo
  select follows `Device`.

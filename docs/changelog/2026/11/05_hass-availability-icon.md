# Changes since version 1.26.0

## Improvements

- **The `HA Availability` node got its own glyph** — the palette and the node card drew the same
  `binary_sensor` icon as `HA Binary Sensor`, so a flag publisher looked like a sensor. The node now
  uses Google Material Symbols **`cloud_alert`** (`icons/cloud_alert_24dp.svg`, outlined 24dp,
  `fill="#e3e3e3"`), downloaded and wired with the workflow in
  `docs/workflow/adding-material-icons-to-node-packages.md`; nothing else about the node changed.
- **The mapping is pinned by a test** — `tests/data/node-icon-material-mappings.test.js` asserts the
  definition's `icon` path *and* that the file ships as a themed Material symbol (960-unit
  `viewBox`, standard fill), so a later icon swap cannot leave the palette pointing at a missing or
  untinted file.
- **`hass` package 0.18.0** — the icon lives inside the package, so the version moves even though no
  generated code changed; no firmware rebuild is required for this one.

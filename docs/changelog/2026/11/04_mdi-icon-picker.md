# Changes since version 1.26.0

## New Features

- **Searchable icon picker for Home Assistant entities** — clicking an entity's `icon`
  control opens a popover with the full Material Design Icons set, filtered by typing (names
  *and* MDI aliases, so `user` finds `account`). A tile click writes `mdi:<name>`; the field
  stays free text, so custom sets (`ph:`, `hue:`) and icons newer than the bundled release
  remain usable. Walk-through in `docs/user/mqtt-and-home-assistant.md` ("Choosing an icon").
- **Icons ship with the app** — one 394 KiB WOFF2 with all 7,447 glyphs, pinned to
  **MDI 7.4.47**, plus a generated name/alias index that loads lazily on first use. Nothing is
  fetched from a CDN, so the picker works offline and the startup payload is unchanged.
- **`hass-icon-invalid` validation** — an icon that Home Assistant cannot parse (a bare
  `thermometer`, `mdi:`, `MDI:Thermometer`, `mdi:thermo meter`) is a node badge with the fix in
  the message. An unknown but well-formed name is *not* an error: the picker hints it.
- **The node shows the icon it was given** — once the value names an icon of the bundled
  release, the `icon` control draws that glyph in front of the value in the node body, so a
  finished entity reads at a glance. The glyph lives inside the existing value box (node
  metrics unchanged), needs both the lazy index and the vendored webfont, and repaints the node
  through the new `NodeUi.requestRepaint()` hook when either arrives; free text, foreign sets
  (`ph:`), a failed font load or a webview without `FontFaceSet` keep the plain text box.

## Bug Fixes

- **The picker hid most of the icon set** — the grid stopped at the first 300 matches, so an
  empty (alphabetical) browse never got past the `a…` names. A `Show more` button in the footer
  now pages through the rest, so all 7,447 bundled icons are reachable and the count keeps
  reading "300 of 7447".
- **An open control editor closed itself on the first keystroke** — typing a value (or pressing
  Backspace) writes it to the node, the graph echoes `node-updated`, and the resulting
  control-instance rebuild removed the very element the user was typing in. Rebuilds now wait
  until the editor is closed, so the field, its caret and an open picker survive the edit.
- **`Enter` in the icon field replaced what you typed** — the picker used to take the
  highlighted tile whenever the grid was open, so pressing `Enter` on a hand-typed `therm` (or on
  `ph:house`) silently swapped in the first match and left the editor open. `Enter` now accepts
  the string in the field and closes the editor; only when the arrow keys were used to browse a
  grid with alternatives does it take the highlighted tile instead (and close as well).
- **Entity icons were silently dropped** — every `hass` entity generator built its discovery
  config without an `icon` entry, so a `mdi:thermometer` typed by hand never reached
  `_hass.register_entity(config=…)`. The key is now the first config entry; an empty icon emits
  no key at all, so collections without icons transpile byte-identically to before.

## Refactor

- **`icon` is a real control type** — `IconControlUi` extends the text control (identical layout
  and value-box metrics, plus the glyph column in front of the value) and the five entity
  definitions switched from `type: "text"` to `type: "icon"`. `check:mdi-generated` keeps the
  vendored artifacts in step with the pinned version, and `@mdi/font` (Apache-2.0, Pictogrammers)
  is listed in the About dialog.

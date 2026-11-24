# Changes since version 1.22.0

## New Features
- **Extended device-target capability model** — targets now carry granular pin
  capabilities (ADC unit/channel, DAC, touch, I2S roles, strapping and reserved
  pins) plus shared hardware resource limits (PWM, ADC, DAC, touch, UART, I2C,
  SPI, I2S) with canonical bus/pin id conventions.
- **Target capability & resource validation** — graph nodes are checked against
  the selected target's capabilities and shared resource pools (including
  per-instance limits such as ADC1 vs ADC2), and transpile errors now include
  node and graph context.
- **ESP32-S3 Mini target and migrated targets** — added the `esp32_s3_mini`
  target and backfilled the extended fields into `esp32_wroom` and
  `arduino_uno`; each target now resolves to a firmware compile board id.
- **Revamped Target Config view** — shows the selected target name and its
  firmware compile target, readable capability/resource tables, a pin-capability
  icon legend, and foldable groups (General Capabilities, Hardware Resources,
  per-pin and by-capability tables).

## Bug Fixes
- **SplitView splitter movability** — splitters next to a collapsed pane are now
  movable when a flexible pane exists on each side, and dragging resizes the
  nearest flexible panes while keeping collapsed panes fixed.
- **Pin-capability icon directions** — digital input/output/IO icons now use
  distinct single- and double-arrow glyphs, and I2S shows role-specific icons
  (data out, data in, bit clock, word select, master clock) instead of a
  TX-only glyph.

## Refactor
- **Target Config view uses the standard view architecture** — the view is now
  composed from `SplitView`, `CollapsibleView`, and `ContentView` panes instead
  of hand-rolled sections.
- **Removed the obsolete sandbox theme** — dropped the orphaned `sandbox/`
  theme and the view-system sandbox harness, defaulting to the `standard` theme.

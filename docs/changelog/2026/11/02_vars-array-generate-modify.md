# Changes since version 1.25.0

## New Features
- **Reusable `array-generate` buffer** — `array-generate` now only provides an `array('f')`
  buffer of the requested length. Its output is declared once as `None` in the graph
  initialization block and reused on every loop pass, allocating only when the array is first
  used or when the requested length changes.
- **`array-modify` node** — the former `array-shift` node is renamed to `array-modify` and now
  modifies an existing array in place. A `modifyType` dropdown (Fill / Ramp / Steps / Hat /
  Sine / Shift) selects the operation and shows only the relevant input connectors and
  controls; Shift additionally shows `wrap`, and every operation supports `clamp`.

## Breaking Changes
- `vars.array-shift` is replaced by `vars.array-modify`; saved graphs referencing `array-shift`
  will render as an unknown node type.
- `array-generate` no longer has fill controls (`fillType`, per-shape inputs, and `clamp`).
  Fill/ramp/steps/hat/sine logic moved to `array-modify`.

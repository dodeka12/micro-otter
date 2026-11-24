# Changes since version 1.35.0

## New Features
- **Constant node modes** — a new `Mode` dropdown switches the Constant node between a custom
  value and a special constant (Pi, Euler's number, degrees → radians, radians → degrees) ·
  `Special` hides the data-type and value controls and keeps the output typed as `float` · every
  Constant value is emitted as an inlined MicroPython `const(...)` with a single
  `from micropython import const` per graph.

## Bug Fixes
- **Hidden dropdown controls** — connector typing derived from dropdown options now ignores the
  options of a dropdown that is itself hidden, and the rendered rows and the graph share one
  visibility rule, so a stale control value can no longer retype a connector.

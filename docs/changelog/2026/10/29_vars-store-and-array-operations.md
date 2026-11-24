# Changes since version 1.23.0

## New Features
- **Store-only `vars` package** — a synchronous, collection-wide named value store with
  `var-read` (output type `any`, missing entry reads as `0`) and `var-write` (first write
  creates the entry). The `var-declare` node is removed.
- **General array operations** — `array-generate` (length + fill-type dropdown with
  per-shape controls), `array-math` (scalar/array operands, always-array output), and
  `array-shift`, backed by the host-runnable `otter_vars/arrays.py` runtime. All array
  nodes include a `clamp` checkbox (default off) that clamps results to `0..1`.
- **Startup graphs** — graph `executionType: "startup"` now generates a run-once graph,
  executed before continuous graphs. New and default collections create an `Init`
  (startup) graph first and `Graph 1` (continuous) second as the active graph.

## Changes
- **LED package reduced to drivers** — `led` now contains only `led-neopixel-output`,
  `led-pwm-strip-output`, and `led-single-output`; the former pattern sources/transforms
  are replaced by the general `vars` array nodes.

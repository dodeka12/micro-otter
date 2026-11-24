# Changes since version 1.26.0

## New Features
- **`array-math` covers the core math operation set** — besides `add`, `subtract`, `multiply` and
  `divide`, the node now offers `modulus`, `sqrt`, `square`, `fraction`, `exp`, `sin`, `cos`, `tan`,
  `asin`, `acos` and `atan2`. Unary operations take a single operand and always return an array, so
  a scalar input produces a length-1 array.
- **`angleUnit` for trigonometric operations** — `sin`, `cos`, `tan`, `asin`, `acos` and `atan2` use
  the same angle units as the core math node: `degrees` (default), `radians` and `percent` (`0..1`
  cycles). `atan2(a, b)` maps to `math.atan2(y=a, x=b)`, matching the core node's argument order.
- **Only the sockets that matter** — unary operations hide the unused `b` input, and `angleUnit` is
  shown only while a trigonometric operation is selected.

## Improvements
- **Safe zero divisors** — `modulus` returns `0.0` for a zero divisor, just like the existing
  `divide`, so a running audio or LED graph keeps producing values instead of raising.
- **Clamp everywhere** — every new operation honours the `Clamp to 0..1` checkbox. Clamping is
  applied after the operation and after any angle conversion.

## Internal
- The waveform runtime function was renamed from `otter_vars.arrays.sin` to
  `otter_vars.arrays.sin_wave`. The `array-modify` option is still `modifyType: "sin"`, so saved
  graphs and the node UI are unaffected.
- `otter_vars.arrays` gains `mod`, `sqrt`, `square`, `fraction`, `exp`, `sin`, `cos`, `tan`, `asin`,
  `acos` and `atan2` with host-side pytest coverage. Shared `_unary` and angle-conversion helpers
  keep the clamping and unit handling in one place.

## Documentation
- `docs/dev/nodes/vars-node-system.md` lists all 15 `array-math` operations, explains the
  `angleUnit` semantics and shows the call shape the generator emits for each operation family.

# Changes since version 1.26.0

## New Features
- **`Floor` and `Ceiling` in the math node** — the core `math` node gains `floor` and `ceil`
  operations next to the existing `Square Root`, `Square`, `Fraction` and `Round` entries. They
  are unary, so the second input stays hidden, and the generated code calls `math.floor(...)` /
  `math.ceil(...)` with the `import math` header added automatically.
- **Configurable `Round` precision** — `Round` now offers a `Decimal Places` control (`0..6`,
  step `1`, default `0`). At `0` the generator keeps emitting the plain builtin `round(value)`;
  above `0` it emits `round(value, n)`. A missing, empty or non-numeric value falls back to whole
  numbers, and out-of-range numbers are clamped to `0..6`.
- **The same three operations in `array-math`** — the `vars` `array-math` node offers `Floor`,
  `Ceiling` and `Round` and emits `_arr.floor(a, clamp=...)`, `_arr.ceil(a, clamp=...)` and
  `_arr.round(a, decimals=<n>, clamp=...)`. `Decimal Places` is only shown while `Round` is
  selected, just like `angleUnit` is only shown for the trigonometric operations.

## Internal
- `core/generator_math_processor.js` gains `getDecimalPlaces()` plus the `floor`/`ceil` handlers, so
  the control normalisation and the `math` import live in one place.
- `vars/otter_vars/arrays.py` gains `floor`, `ceil` and `round(buf, decimals=0, clamp=False)`.
  `round` passes `decimals` to the builtin as `ndigits` (MicroPython supports the two-argument
  form, covered upstream by `tests/float/builtin_float_round.py`) and falls back to the
  single-argument builtin at `0`; the module-level `round` shadows the builtin, so the builtin is
  captured as `_builtin_round` at the top of the module. All three honour `clamp` (negatives
  become `0.0` when enabled).
- `floor`/`ceil` join `ARRAY_MATH_UNARY_OPS`, while `round` is special-cased in
  `vars/node_generators.js` because it is the only unary operation with an extra keyword.
- Node packages bumped: `core` 1.8.0 → 1.9.0, `vars` 0.32.0 → 0.33.0.

## Documentation
- `docs/dev/nodes/vars-node-system.md` lists the three new `array-math` operations, documents the
  `decimalPlaces` control and the call shape the generator emits, and records the `round` runtime
  contract including the `_builtin_round` alias.

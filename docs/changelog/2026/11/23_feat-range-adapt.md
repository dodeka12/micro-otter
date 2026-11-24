# Changes since version 1.41.0

## New Features
- **Range Adapt bounds and invert as connectors** — `Minimum`, `Maximum`, and `Invert` leave the
  control card and become the `min`, `max`, and `invert` connectors with the inline defaults `0`,
  `100`, and unchecked, so another node can drive the range and the mirror switch; only the `Mode`
  dropdown stays a control · `core` package `1.29.0`.
- **Range Adapt connector visibility** — `min`, `max`, and `invert` are visible in every mode, while
  `default` appears only in *To Default* mode; the output type still follows only `value` and
  `default`, so wiring an `int` bound never widens the result.

## Breaking Changes
- **Saved Range Adapt graphs lose their bounds and invert** — a graph saved with the old `Minimum`,
  `Maximum`, and `Invert` controls has no stored connector defaults, so it transpiles with `0`,
  `100`, and no mirroring; set the inline defaults or wire the connectors once to restore the range.

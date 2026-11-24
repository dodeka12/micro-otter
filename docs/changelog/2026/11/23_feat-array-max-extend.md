# Changes since version 1.39.0

## New Features

- **Array math reductions** — `vars.array-math` gains `Length`, `Minimum`, `Maximum`, `Mean`,
  and `Median`; `Minimum`/`Maximum` take a `Percent` control (`0..100`, default `100`) that
  returns the highest value among the lowest N% of elements or the lowest value among the
  highest N%, so `100` is the plain extreme and `0` selects one element. Reductions return a
  length-one array (`Length` returns `int`), copy their input, and leave every existing
  element-wise call unchanged; the output connector retypes to `int`/`float` and returns to
  `vars.array` for an element-wise operation. The runtime exposes `mo_min`/`mo_max` to avoid
  shadowing Python's builtins. `vars` package `0.70.0`.

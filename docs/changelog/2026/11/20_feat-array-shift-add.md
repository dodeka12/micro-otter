# Changes since version 1.36.0

## New Features
- **Array Set `Shift` index mode** — `vars.array-set` gains `Shift` for `Index Mode`: a write with
  an out-of-range index slides the whole array by the full deficit instead of snapping to the edge
  or wrapping, and then writes on the edge the array slid towards.
- **Array Set `Fill Value`** — a new `Fill Value` connector (default `0`, shown only for `Set` and
  `Set at Indices`) supplies the value written into the slots a multi-place slide vacates, so a
  one-place slide fills nothing and `Clamp`/`Wrap` ignore it.
- **`vars` package `0.66.0`** — `set` and `set_indices` in `otter_vars/arrays.py` resolve
  `mode='shift'` through a new trailing `fill` argument, while generated `clamp`/`wrap` statements
  stay byte-identical, so existing graphs transpile to the same code.

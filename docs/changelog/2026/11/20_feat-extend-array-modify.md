# Changes since version 1.33.0

## New Features
- **Array Modify Repeat / Ping-Pong** — `vars.array-modify` gains the `Repeat` and `Ping-Pong`
  modes, both driven by a new `Count` input (default `1`): `Repeat` emits `count` consecutive
  copies of the array, while `Ping-Pong` alternates forward and backward blocks and repeats the
  endpoints between them, so `[1, 2, 3]` with `count = 2` becomes `[1, 2, 3, 3, 2, 1]`.
- **Array Modify Concat / Interlace** — the `Concat` and `Interlace` modes take a second array from
  the new `Other Array` connector: `Concat` appends it, and `Interlace` inserts one of its values
  every `Step`-th output slot starting at `Offset` (`Step` defaults to `2`, `Offset` to `0`),
  appending surplus values at the end. Both new modes, like Repeat and Ping-Pong, allocate a fresh
  output array on every pass.
- **Mode-dependent connectors** — `array-modify` now shows only the connectors and controls of the
  selected mode, so `wrap` and `inplace` stay visible for `Shift` while the four new modes only
  expose `clamp`; hidden wires are kept, not deleted.
- **Shift unchanged** — the `Shift` mode keeps its connectors, defaults, and generated statement,
  so existing graphs transpile to the same code and need no migration.
- **`vars` package `0.65.0`** — the runtime adds `repeat`, `ping_pong`, `concat`, and `interlace` to
  `otter_vars/arrays.py`; generated code calls them as `_arr.repeat`, `_arr.ping_pong`,
  `_arr.concat`, and `_arr.interlace`.

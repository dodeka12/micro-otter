# Changes since version 1.30.0

## New Features
- **Tuple Select index modes** — `core.tuple-select` gains an `Index Mode` dropdown
  (`Default Value` / `Clamp` / `Wrap`): `Default Value` reads the `Default` connector for an
  out-of-range position, `Clamp` reads the first or last element, and `Wrap` counts modulo the tuple
  length so `-1` reads the last element.
- **Default connector on Tuple Select** — a new `int` `Default` input supplies the fallback value and
  is hidden while `Clamp` or `Wrap` is selected, mirroring `vars.array-select`.

## Breaking Changes
- **Out-of-range Tuple Select positions read the default value instead of `None`** — in the default
  index mode, an index below `0`, at or above the tuple length, a non-numeric index, and a missing,
  non-tuple, or empty tuple now return the `Default` connector value, which is `0` when the connector
  is unwired. Graphs that relied on `None` must wire a `Default` value or switch to `Clamp` or `Wrap`;
  those two modes still return `None` for an unusable input.

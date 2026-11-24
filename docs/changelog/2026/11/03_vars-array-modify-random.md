# Changes since version 1.26.0

## New Features
- **`array-modify` gains random sources** — two new `modifyType` options:
  - **Random Uniform** fills the array with values uniformly distributed between `min` and `max`.
  - **Random Normal** fills the array with values drawn from a normal distribution with `mean` and
    `stdDev`, cut to the `min`/`max` range.
  Both honour the existing `inplace` and `clamp` controls. The `min`/`max` input controls now accept
  negative and larger values, so hat and random ranges are no longer limited to `0..1` in the UI.

## Internal
- `otter_vars/arrays.py` adds `random_uniform` and `random_normal`; the normal sampler uses a
  Box-Muller transform built on `random.random()` because MicroPython has no `gauss`/
  `normalvariate`. Values outside the requested range are cut to the bounds, then the normal
  `clamp` option is applied.
- `node_generators.js` maps `randomUniform` → `random_uniform` and `randomNormal` →
  `random_normal`.

## Documentation
- `docs/dev/nodes/vars-node-system.md` documents the new inputs, visibility matrix, generated
  calls, and runtime functions.

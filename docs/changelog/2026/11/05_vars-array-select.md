# Changes since version 1.26.0

## New Features

- **New `array-select` node in the `vars` package** — reads one element of an array and returns it
  as a scalar `float`, so LED, audio and Home Assistant chains no longer have to copy a whole array
  to get at a single channel. Inputs are `Array` (`vars.array`), `Index` (`float`/`int`, step `1`,
  default `0`) and `Default` (`float`/`int`, step `0.01`, default `0`); the index is truncated with
  `int()`, so `2.9` reads element `2` and `-1.9` reads element `-1`.
- **`Index Mode` control for out-of-range indices** — a dropdown with `Default Value` (return the
  `Default` input), `Clamp` (first element for a negative index, last element past the end) and
  `Wrap` (`buf[index % len]`, so `-1` reads the last element and `len` reads the first). The control
  sets `affectsInputs`, so the UI hides `Default` for `Clamp` and `Wrap`, which never read it. An
  in-range index always returns its element in every mode, and a `None` or empty array returns the
  default in every mode — there is no element to clamp or wrap to.
- **Themed node icon** — Material Symbols **`flex_no_wrap`** (`icons/flex_no_wrap_24dp.svg`,
  outlined 24dp with the standard `#e3e3e3` fill, added with
  `docs/workflow/adding-material-icons-to-node-packages.md`), distinct from the existing
  `data_array` (`array-generate`), `view_array` (`array-math`) and `view_apps` (`array-modify`)
  glyphs.

## Internal

- `vars/otter_vars/arrays.py` gains `select(buf, index, default=0.0, mode='default')`: it truncates
  the index, returns the element for an in-range index, and resolves an out-of-range index to the
  given default (`'default'`), the first/last element (`'clamp'`) or `buf[index % len]` (`'wrap'`).
  The read is scalar — it allocates nothing and mutates nothing — so it is safe to call every pass
  of a running graph. An unknown mode (including `None`) falls back to returning the default.
- `vars/node_generators.js` gains `NodeCodeGenerators.arraySelect`, which emits
  `node_x_out0 = _arr.select(src, index, default, mode='<mode>')` and registers
  `import otter_vars.arrays as _arr` once per graph like `array-math`/`array-modify`. The default
  argument is passed for every mode so the call shape stays stable; an unwired array input becomes
  `None`, an unwired output emits `# array-select output not connected`, and an unknown `indexMode`
  warns and falls back to `'default'`.
- Node packages bumped: `vars` 0.33.0 → 0.36.0. `hooks/device_version_hook.py` enforces one manifest
  bump per commit that changes a package, so the three implementation commits (definition, runtime,
  generator) each carried their own minor bump.
- A **firmware rebuild is required**: `otter_vars/arrays.py` is listed in the package manifest's
  `mpAssets`, so the shipped bytecode changes and existing firmware artifacts become stale.
  `src/micro_otter/nodes/device/firmware/runtime_lineage.json` is append-only history of past
  builds and is not edited by hand — the next build appends its own record.

## Documentation

- `docs/dev/nodes/vars-node-system.md` documents the node (inputs, output, `Index Mode` matrix,
  `int()` truncation and the emitted call shape), bumps the array node count to four and adds
  `select` to the `## Array runtime` function list with its contract.
- `docs/dev/nodes/index.md` and `docs/dev/nodes/led-node-system.md` list `array-select` next to the
  other `vars` array nodes.

## Tests

- `tests/data/vars-node-definitions.test.js` pins the definition: input order, `allowedTypes`, both
  number `defaultControl`s, the `float` output and the `indexMode` visibility matrix.
- `tests/data/node-icon-material-mappings.test.js` pins the icon path and the themed SVG.
- `tests/test_vars_arrays.py` covers the three modes, index truncation, unknown modes and `None` /
  empty buffers on CPython.
- `tests/proc/vars-generators.test.js` covers the emitted statement for every mode, the missing and
  unknown control values, the `None` fallback, the unconnected output and the import registration.
- `tests/proc/vars-transpiler-integration.test.js` transpiles an `array-generate` →
  `array-select` (`wrap`) → `var-write` graph end to end.

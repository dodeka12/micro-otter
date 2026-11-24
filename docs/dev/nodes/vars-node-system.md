# Vars Node System

This document describes how the `vars` node package is modeled, transpiled, and executed at runtime.

## Scope

The package lives under `src/micro_otter/nodes/device/node_pkgs/vars/`:

- Node definitions: `node_definitions.json`
- Generators: `node_generators.js`
- Capability checks: `node_capabilities.js`
- Data types: `data_types.json`
- Runtime: `otter_vars/store.py`, `otter_vars/arrays.py`

## Data type

The package declares the general `vars.array` connector type (`kind: "value"`, input 1:1, output fan-out). Its Python representation is `array('f')` — one `float` per element — but the type system treats it as an opaque value that flows through ordinary output variables.

## Store

`otter_vars/store.py` exposes a lazy module-level singleton through module-level functions so generated code can call it directly. The store is **namespaced**: it maps `store name → variable name → value`, defaulting to the `"default"` namespace.

- `ensure_store()` — returns the singleton, creating it on first use.
- `get(store, name, default=None)` — returns the current value, or `default` when the entry is absent.
- `set(store, name, value)` — writes the value, creating the entry on first write.
- `has(store, name)`.

The store is deliberately synchronous: graph loop bodies contain no `await` between read and write, so `uasyncio`'s cooperative scheduling makes a plain dict read-modify-write atomic within a tick.

## Persistence

Each namespace can be persisted to flash under `var_store/<name>.json`:

- `save(store)` — writes the named namespace atomically (tmp file + rename). `array.array('f', …)` values are tagged so they survive the JSON round-trip.
- `load(store)` — reads the named namespace and **fully replaces** it in memory (no merge). A missing or invalid file returns `False` and leaves the namespace untouched. Encoded arrays are reconstructed as `array.array('f', …)`.
- `edge_trigger(key, current)` — returns `True` only on a `false → true` transition for a per-key previous state (used by the save/load nodes).

Store names are sanitized to `[A-Za-z0-9._-]`; invalid or empty names raise `ValueError`.

## Reserved namespaces

The leading underscore is reserved for package-owned store namespaces. User graphs should not rely
on the contents or key layout of those entries; only the owning package may read or write them.

- `_webcontrol` — owned by the webview package's input controls. Keys are scoped node ids
  (`<graphId>:<nodeId>`, or `<nodeId>` when the graph has no id); `web-view-select` stores the option
  **index**, all other controls store their value. The control-level contract is documented in
  [`webview-node-system.md`](./webview-node-system.md#persistence). The webview package also ships
  `web-store-read`, `web-store-write`, `web-store-save` and `web-store-load` nodes that hard-code this
  namespace, so graphs can read, write, save and load it without naming `_webcontrol`.
- All other names (including `default`) are ordinary user namespaces.

`otter_vars.store` itself is unchanged by reserved namespaces: it stays a flat, single-level
`dict` of `store name → key → value`, with the same `get` / `set` / `has` / `save` / `load` API.
Reading and writing a reserved namespace needs no new API, no nesting and no data migration.

Packages may declare a MicroPython asset dependency on another package through the manifest key
`requiredPackages` (see
[`device-folder-structure.md`](../device-communication/device-folder-structure.md)); `vars` is the
first dependency target, pulled in by the `webview` package.

## Node set

### `var-read`

- Controls: `name` (dropdown, required) plus the `customName` text control it reveals when
  the user picks "New variable…".
- Inputs (full order):
  - `store` — store namespace as a `string` input with a **dropdown** `defaultControl`
    defaulting to `"default"`; its "New store…" option reveals the `customStore` text
    control.
  - `value` — fallback used when the store entry does not exist
    (`float`/`int`/`bool`/`string`/`vars.array`).
- Output `value` with `outputType: "any"` (can hold any value, including `vars.array`).
- Loop: `node_x_out0 = _store.get(<store>, '<name>', <fallback>)`.

### `var-write`

- Controls: `name` (dropdown, required) plus `customName`.
- Inputs (full order):
  - `store` — store namespace as a `string` input with a **dropdown** `defaultControl`
    defaulting to `"default"` plus the `customStore` companion control.
  - `value` (`float`/`int`/`bool`/`string`/`vars.array`).
- Loop: `_store.set(<store>, '<name>', <value>)` — creates the entry on first write.

The store namespace is an ordinary `string` input on both nodes, so it can be wired from
any `string` output or left on its dropdown default control. When the input is unconnected
(or empty), the generators fall back to the `"default"` namespace.

### Pickers

Both nodes offer two cascading dropdowns instead of free text:

- the **Store** picker lists every namespace of the collection (`default` first), so a
  namespace created on any node of any graph is one click away;
- the **Name** picker lists the variables of the *selected* store only, because `VarStore` is
  namespaced — `foo` in `presets` and `foo` in `default` are unrelated entries and a flat list
  would invite reading the wrong one.

Both pickers reuse the `__new__` "create new…" contract of the MQTT topic dropdown: picking
the sentinel reveals a text control (`customStore` / `customName`) and the typed text is what
the generator emits. Namespaces starting with `_` are package-owned (`_webcontrol`,
see [Reserved namespaces](#reserved-namespaces)) and are never offered, although a node may
still hold one as its stored value. An empty `customStore` falls back to `"default"`, exactly
like an unconnected or empty `store` input.

A fresh node selects `default` in the Store picker rather than the sentinel — the row names the
namespace the generator will use. The Name picker has three states: an empty `name` is **not set**
(the row reads `(not set)`), `name === '__new__'` is **declare** (the `Variable name` companion
holds the name), and any other value is **use** (an existing variable of the selected store).
While the sentinel *is* selected, both pickers echo the typed text on the row (`displayLabel`), so
a store or name that was just declared stays visible after the text field is closed; the menu entry
itself keeps reading `New store…` / `Declare variable…`. The echo is live:
`NodeUi._refreshCompanionPickers()` re-resolves the picker on every keystroke of its companion
field and updates the option list of the running instance in place
(`NodeDropdownControlUi.setOptions()`), so the row follows the text while it is typed instead of
only after the field closes.

A variable exists only while exactly one `var-read` / `var-write` declares it: `collectVarNames()`
lists only the declarations of the selected store (and skips the resolving node, so a declaring node
never sees its own name), and a second declaration of the same variable in the same store is flagged
as an error on both declaring nodes by the `vars-duplicate-declaration` graph rule. The generator
still emits `name` / `customName` literally, so a variable's existence is purely a UI and
data-consistency concern.

References stay in agreement with their declaration (`nodes/var-consistency.ts`, wired through
`Collection.reconcileVarReferences()` on `node-updated` / `node-removed` and on load): renaming a
declared variable rewrites every reference, and when a declaration disappears — the node switches
to "use", clears the name, changes store, or is deleted — every reference that no longer resolves is
reset to `(not set)`. The writes go through each graph's `updateNode` and are grouped for a single
undo step.

Neither picker changes code generation: both nodes still compile to
`_store.get(<store>, '<name>', <fallback>)` and `_store.set(<store>, '<name>', <value>)`, and
the generators resolve `store === '__new__'` / `name === '__new__'` to the typed companion text
before emitting the statement.

Only the companion of the selected sentinel is drawn and clickable: `NodeUi` resolves the option
list before it computes visibility, and `hitTestControl()` takes its rows from that same resolved
list, so the `Variable name` row a user clicks really is `customName` (not the hidden `customStore`
row that the raw option list would still contain).

### `var-store-save`

- Inputs: `save` (bool, rising-edge trigger) and `name` (string, store namespace, default `"default"`).
- Loop: on a `false → true` edge of `save`, calls `_store.save('<name>')`.

### `var-store-load`

- Inputs: `load` (bool, rising-edge trigger) and `name` (string, store namespace, default `"default"`).
- Loop: on a `false → true` edge of `load`, calls `_store.load('<name>')` (full-replace).

### `signal-post`

- Inputs: `enabled` (bool, checkbox, default `true`) and `fire` (bool, checkbox, default `false`),
  both loop phase. When `enabled` is false the node neither posts nor advances its edge state.
- Controls: `signal` (dropdown, `dynamicOptions.source: "signalNames"`; `(not set)` disables the
  node), `customSignal` (text, the name used when the picker sits on the `__new__` sentinel via
  `Define signal…`), and `once` (checkbox, default `true`).
- No outputs.
- Loop: `_signals.edge('post:<graphId>:<nodeId>', bool(<fire>))` gates `_signals.post('<name>')` on
  the rising edge of `fire` when `once` is true; `once: false` posts on every run while `fire` is
  true. A blank name is the `(not set)` disabled state: the node emits
  `# signal-post: no signal name selected` and no signal code.

### `random-value`

- Inputs `min` (`float`/`int`, number `defaultControl`, step `0.01`, default `0`), `max` (same, default `1`), `mean` (number, step `0.01`, default `0.5`) and `stdDev` (number, min `0`, step `0.01`, default `0.15`). `min`/`max` bound the uniform range and cut the normal distribution; `mean`/`stdDev` configure that normal distribution.
- Control `distribution` (dropdown, default `uniform`) with options `uniform`/`normal`. `affectsInputs` plus per-option `activeInputs` show `min`/`max` for `uniform` and `min`/`max`/`mean`/`stdDev` for `normal`; no option hides a control.
- Control `valueType` (dropdown, default `float`) with options `float`/`int`. It drives the connector type: the `out` output declares `outputTypeControl: "valueType"` and `outputTypeByControlValue` maps `float → float` and `int → int`, so `int` rounds the sample to the nearest whole number.
- Output `out` → `float`/`int`, one sample per pass. Inputs and output are loop phase.
- Loop: `_arr.random_uniform_value(min, max, integer=<bool>)` for `uniform` and `_arr.random_normal_value(mean, stdDev, min, max, integer=<bool>)` for `normal`, where `integer` is `True` only for the `int` value type. An unknown `distribution` warns and falls back to `uniform`, and an unconnected output emits `# random-value output not connected`.
- Icon `icons/casino_24dp.svg`.

### `random-seed`

- Inputs `enabled` (bool, checkbox `defaultControl`, default `true`) and `seed` (`float`/`int`, number `defaultControl`, min `0`, step `1`, default `0`). Neither input declares a `phase`, so both accept init- and loop-phase sources.
- No outputs and no controls. The node declares `executionPhase: "loop"` because it emits no data and therefore cannot be scheduled through a data dependency.
- Ordering: nothing pulls the node in through a connector, so place it before the random consumers in the graph. The first pass then already draws from the seeded stream, and later passes keep it.
- Loop: `_arr.reseed(enabled, seed, key='seed:<graph>:<node>')`, with `True` and `0` as the unwired defaults. The per-node key keeps two seed nodes independent, and `reseed` itself ignores a disabled call and clears the applied state.
- Icon `icons/key_24dp.svg`.

## Array operations

The package provides five general array nodes plus the `otter_vars/arrays.py` runtime.

### `array-generate`

- Input: `count` (Length, number `defaultControl`, default `60`).
- Output `out` → `vars.array`.
- Init: the init generator emits `node_x_out0 = None` into the graph's `# Initialization` section.
- Loop: `node_x_out0 = _arr.generate(node_x_out0, count)` — reuses the previous buffer when its length still matches, otherwise allocates a new zero-filled `array('f')`.

### `array-math`

- Inputs `a`/`b` (`float`/`int`/`vars.array`); controls `operation` (default `add`), `angleUnit` (default `degrees`), `decimalPlaces` (default `0`), `percent` (default `100`), `clamp` (default `false`).
- Operations: `add`, `subtract`, `multiply`, `divide`, `modulus`, `power`, `root`, `log` are binary; `sqrt`, `square`, `fraction`, `floor`, `ceil`, `round`, `exp`, `ln`, `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh` are unary; `sin`, `cos`, `tan`, `asin`, `acos`, `atan` are unary trigonometric; `atan2` is binary trigonometric; `length`, `min`, `max`, `mean`, `median` are reductions. The hyperbolic operations never use `angleUnit`.
- `operation` sets `affectsInputs`/`affectsControls`, so the UI hides input `b` for every unary operation and every reduction, hides `angleUnit` unless a trigonometric operation is selected, hides `decimalPlaces` unless `round` is selected, and hides `percent` unless `min`/`max` is selected. `activeControls` acts as an allowlist, so each option lists `clamp` explicitly, only the trigonometric ones also list `angleUnit`, `round` lists `clamp` plus `decimalPlaces`, `min`/`max` list `clamp` plus `percent`, and `length` lists no optional controls.
- `angleUnit` offers `degrees`, `radians`, and `percent` (`0..1` cycles) and only affects the trigonometric operations.
- `decimalPlaces` (number, `0..6`, step `1`, default `0`) is only used by `round`; the generator normalises it to an integer inside that range, so a missing, empty or non-numeric value rounds to whole numbers.
- `percent` (number, `0..100`, step `1`, default `100`) is only used by `min`/`max`; the generator clamps it to `0..100`, keeps decimals, and treats a missing or non-numeric value as `100`.
- Output `out` → `vars.array` for element-wise operations; `length` retypes it to `int` and `min`/`max`/`mean`/`median` to `float`, and switching back to an element-wise operation restores `vars.array`. Scalar⊗scalar element-wise operations yield a length-1 array.
- Loop: the emitted call depends on the operation family — `_arr.<op>(a, b, clamp=<bool>)` for `add`/`subtract`/`multiply`/`divide`/`modulus` (mapped to the runtime names `add`/`sub`/`mul`/`div`/`mod`) and for `power`/`root`/`log` (same runtime names), `_arr.<op>(a, clamp=<bool>)` for the unary `sqrt`/`square`/`fraction`/`floor`/`ceil`/`exp`/`ln`/`sinh`/`cosh`/`tanh`/`asinh`/`acosh`/`atanh`, `_arr.round(a, decimals=<n>, clamp=<bool>)` for `round`, `_arr.<op>(a, angle_unit=<unit>, clamp=<bool>)` for `sin`/`cos`/`tan`/`asin`/`acos`/`atan`, and `_arr.atan2(a, b, angle_unit=<unit>, clamp=<bool>)` for `atan2`. `power` raises `a` to `b`, `ln` is the natural logarithm `math.log(a)`, and `log` is the logarithm of `a` to base `b` (`math.log(a, b)`). `ln` and `log` raise `ValueError` for a non-positive value or base, including a `log` base of `0` (the default of an unconnected `b` input); `power` raises `ValueError` for an invalid domain such as a negative base with a fractional exponent, `root` is the real principal n-th root (`math.pow(a, 1.0 / b)`) and raises `ValueError` for a negative radicand and `ZeroDivisionError` for a degree of `0` (the default of an unconnected `b` input), and a `log` base of exactly `1` raises `ZeroDivisionError`. The hyperbolic operations map to `math.<fn>(a)`, take no `angle_unit`, and raise `ValueError` outside their domains (`acosh` requires `x >= 1`, `atanh` requires `-1 < x < 1`). Unary operations ignore input `b`, even when an older saved graph still wires it, and an unknown operation falls back to `add` with a console warning.
- Reductions: `length` emits `_arr.length(a)`; `min`/`max` emit `_arr.mo_min(a, percent=<n>, clamp=<bool>)` and `_arr.mo_max(a, percent=<n>, clamp=<bool>)`; `mean`/`median` emit `_arr.mean(a, clamp=<bool>)` and `_arr.median(a, clamp=<bool>)`. The selected share is `ceil(n * percent / 100)` clamped to `1..n`: `max` returns the highest value among the lowest `N%`, `min` returns the lowest value among the highest `N%`, `percent=100` is the plain extreme, and `percent=0` selects one element (the opposite extreme). A missing or non-numeric `percent` becomes `100`, values outside `0..100` are clamped, and decimals are preserved. `None`/empty gives `[0.0]` (and `length` gives `0`); a scalar is one element. Reductions copy the input, and `mo_min`/`mo_max` keep Python's builtin `min`/`max` available. `length` ignores `clamp`.


### `array-modify`

- Inputs in the locked order `in`, `amount`, `other`, `count`, `step`, `offset`: `in` (`vars.array`), `amount` (`float`/`int`, number `defaultControl`, step `1`, default `0`), `other` (`vars.array`, no `defaultControl`), `count` (`float`/`int`, number `defaultControl`, min `0`, max `1000`, step `1`, default `1`), `step` (`float`/`int`, number `defaultControl`, min `1`, max `1000`, step `1`, default `2`), `offset` (`float`/`int`, number `defaultControl`, min `0`, max `1000`, step `1`, default `0`).
- Control `modifyType` (dropdown, default `shift`) sets `affectsInputs` and `affectsControls`, so only the selected mode's connectors and controls are drawn:

  | mode | visible inputs | visible controls | emitted array call |
  |------|----------------|------------------|--------------------|
  | `shift` | `in`, `amount` | `modifyType`, `wrap`, `clamp`, `inplace` | `out = _arr.shift(in, amount, wrap=wrap, clamp=clamp, inplace=inplace)` |
  | `repeat` | `in`, `count` | `modifyType`, `clamp` | `out = _arr.repeat(in, count, clamp=clamp)` |
  | `pingPong` | `in`, `count` | `modifyType`, `clamp` | `out = _arr.ping_pong(in, count, clamp=clamp)` |
  | `concat` | `in`, `other` | `modifyType`, `clamp` | `out = _arr.concat(in, other, clamp=clamp)` |
  | `interlace` | `in`, `other`, `step`, `offset` | `modifyType`, `clamp` | `out = _arr.interlace(in, other, step, offset, clamp=clamp)` |

- In the emitted call, `out`, `in`, `other`, `count`, `step` and `offset` are replaced by the connected node output names (`node_<id>_out0`). An unwired `in` or `other` becomes `None`; an unwired `amount`, `count`, `step` or `offset` becomes its input default (`0`, `1`, `2`, `0`). `wrap`, `clamp` and `inplace` always render as `True`/`False` from the control values, so `repeat`, `pingPong`, `concat` and `interlace` only ever emit `clamp=` and never `wrap=`/`inplace=`. `pingPong` is the only mode whose runtime function name differs from its option id.

- Controls `wrap` (checkbox, default `true`), `clamp` (checkbox, default `false`), `inplace` (checkbox, default `false`).
- Output `out` → `vars.array`.
- `wrap` and `inplace` are Shift-only: `repeat`, `pingPong`, `concat` and `interlace` change the array length and always allocate a fresh `array('f')`, so they have no in-place variant and nothing to wrap. That allocation happens on every loop pass, so a length-changing mode churns the heap while it runs.
- A hidden connector keeps its wire. Switching `modifyType` hides connectors and controls but deletes no connection, and the generator reads only the inputs of the selected mode, so an inactive wire never leaks into the emitted code. An unknown `modifyType` warns and falls back to `shift`.

### `array-set`

- Inputs in fixed order: `in` (`vars.array`), `index` (`float`/`int`, step `1`, default `0`), `value` (`float`/`int`/`vars.array`), `indices` (`vars.array`), `start` (`float`/`int`, step `1`, default `0`), `width` (`float`/`int`, step `1`, default `-1`), `stepWidth` (`float`/`int`, step `1`, default `1`), `numSteps` (`float`/`int`, step `1`, default `2`), `min`, `max`, `period` (default `30`), `periodCount` (default `1`), `phase`, `amplitude`, `offset`, `mean`, `stdDev`, `fillValue`. `start`, `width`, `stepWidth` and `numSteps` are floored to integers internally; `width` is the span size with `-1` meaning "up to the last index", `-2` "up to the penultimate", and so on, while `stepWidth` is the number of indices each step fills. `period` is the length of one wave period in samples (a float, so partial periods are possible) and `periodCount` is the number of periods to generate, clamped to the length of the array. `fillValue` (number, min `-100000`, max `100000`, step `0.01`, default `0`) is appended last in the list, so every saved connection keeps its position; it is shown only for `set`/`setIndices` and is the value written into the slots a multi-place shift vacates.
- Control `setType` (dropdown, default `set`) with options `set`/`setIndices`/`fill`/`ramp`/`steps`/`hat`/`sin`/`square`/`sawtooth`/`randomUniform`/`randomNormal`. `affectsInputs` + per-option `activeInputs` show only the selected operation's inputs, and `affectsControls` + per-option `activeControls` show `indexMode` only for `set`/`setIndices` while always showing `inplace` and `clamp`.
- Control `indexMode` (dropdown, default `clamp`, options `clamp`/`wrap`/`shift`) resolves an out-of-range index for `set`/`setIndices`, and decides whether an overrunning sub-array wraps to the beginning or stops at the end. `clamp` snaps to the nearest edge, `wrap` wraps to the other edge, and `shift` slides the whole array by the deficit of the index, writes on the edge it slid towards, and fills the freed slots with `fillValue`. An unknown saved value falls through the runtime's `clamp` branch.
- Control `inplace` (checkbox, default `false`): write into the input array instead of a copy.
- Output `out` → `vars.array`.
- Loop shapes: `_arr.set(src, index, value, mode=<indexMode>, fill=<fillValue>, clamp=<bool>, inplace=<bool>)` for `set` (a scalar `value` writes one element, an array `value` copies in from `index` with the self-overwrite guard); `_arr.set_indices(src, indices, value, mode=<indexMode>, fill=<fillValue>, clamp=<bool>, inplace=<bool>)` for `setIndices` (each index floored, scalar or array `value`); `fill=<fillValue>` is emitted only for `indexMode` `shift`, so the `clamp`/`wrap` statements keep their existing shape; `_arr.fill(src, value, start, width, clamp=<bool>, inplace=<bool>)`; `_arr.ramp(src, start, width, min, max, clamp=<bool>, inplace=<bool>)`; `_arr.steps(src, start, stepWidth, numSteps, min, max, clamp=<bool>, inplace=<bool>)`; `_arr.hat(src, start, width, min, max, clamp=<bool>, inplace=<bool>)`; `_arr.<wave>(src, start, period, periodCount, phase, amplitude, offset, clamp=<bool>, inplace=<bool>)` for `sin_wave`/`square_wave`/`sawtooth_wave`; and `_arr.random_uniform(src, min, max, clamp=<bool>, inplace=<bool>)` / `_arr.random_normal(src, mean, stdDev, min, max, clamp=<bool>, inplace=<bool>)` for the random modes; those draws use the shared global generator, so no seed argument is passed. An unknown `setType` warns and falls back to `set`.

### `array-select`

- Inputs `array` (`vars.array`), `index` (`float`/`int`, number `defaultControl`, step `1`, default `0`) and `default` (`float`/`int`, number `defaultControl`, step `0.01`, default `0`).
- Output `value` → `float` — the node reads a single element and never returns an array.
- Control `indexMode` (dropdown, default `default`) with options `default`/`clamp`/`wrap`. `affectsInputs` plus per-option `activeInputs` hide the `Default` input for `clamp` and `wrap`, because those modes never read it.
- Mode matrix: an index inside `0 .. len-1` always returns its element; an out-of-range index returns the `default` input (mode `default`), the first or last element (mode `clamp`), or `buf[index % len]` (mode `wrap`, so `-1` reads the last element and `len` reads the first). A `None` or empty array returns `default` in every mode — there is no element to clamp or wrap to.
- `index` is truncated with `int()`, so `2.9` reads element `2` and `-1.9` reads element `-1`.
- Loop: `node_x_out0 = _arr.select(src, index, default, mode='<mode>')`. The default value is passed for every mode, so the call shape stays stable when the mode changes; an unwired array input becomes `None` and an unwired `Default` input stays the literal `0` emitted by its `defaultControl`. An unknown `indexMode` warns and falls back to `'default'`, and an unwired output emits `# array-select output not connected`.

`array-select` is float-array-only. For a heterogeneous Python tuple use the `core` package's `core.tuple-select` instead (zero-based, truncating, the same `default` / `clamp` / `wrap` index modes, with an `int` default value); see [core-tuple-node-system.md](core-tuple-node-system.md). The two nodes are deliberately not merged.

## Array runtime

`otter_vars/arrays.py` is pure Python and host-runnable. Functions: `generate`, `fill`, `ramp`, `steps`, `hat`, `sin_wave`, `square_wave`, `sawtooth_wave`, `add`, `sub`, `mul`, `div`, `mod`, `power`, `root`, `sqrt`, `square`, `fraction`, `floor`, `ceil`, `round`, `exp`, `ln`, `log`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh`, `select`, `set`, `set_indices`, `shift`, `random_uniform`, `random_normal`, `random_uniform_value`, `random_normal_value`, `reseed`, `length`, `mean`, `median`, `mo_min`, `mo_max`. `select(buf, index, default=0.0, mode='default')` is the scalar read behind `array-select`: it truncates `index`, returns the element for an in-range index, and resolves an out-of-range one to the given default (mode `'default'`), the first/last element (mode `'clamp'`), or `buf[index % len]` (mode `'wrap'`); a `None` or empty buffer returns the default in every mode. The read is scalar: it allocates nothing and mutates nothing, so it is safe to call every pass. `generate` reuses or allocates its caller-provided `array('f')` buffer; `None` inputs yield an empty `array('f')`. Binary ops still broadcast scalar/array operands and return a new `array('f')` (length 1 for scalar⊗scalar); mismatched array lengths raise `ValueError`. `power` maps to `math.pow(a, b)`, `root` to `math.pow(a, 1.0 / b)` (the real principal n-th root), `ln` to `math.log(x)`, and `log` to `math.log(a, b)`; `ln` and `log` raise `ValueError` for a non-positive value or base (including a `log` base of `0`), `power` raises `ValueError` for an invalid domain such as a negative base with a fractional exponent, `root` raises `ValueError` for a negative radicand and `ZeroDivisionError` for a degree of `0`, and a `log` base of exactly `1` raises `ZeroDivisionError`. `div` and `mod` return `0.0` for a zero divisor instead of raising, so a running audio or LED graph keeps producing values. Every function takes `clamp=False`; when enabled, results are clamped to `[0, 1]` (the LED value convention) after the operation has been applied, otherwise values are left unclamped. The unary math functions (`sqrt`, `square`, `fraction`, `floor`, `ceil`, `round`, `exp`, `ln`, `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh`) accept a scalar or an array and always return an `array('f')`, so a scalar input yields a length-1 array; `sqrt` of a negative value raises `ValueError` rather than producing an unrepresentable result. The hyperbolic functions map to `math.<fn>(x)` and take no `angle_unit`, because their argument and result are real numbers rather than angles: `sinh`, `cosh`, `tanh`, and `asinh` accept every real value, `acosh` requires `x >= 1`, and `atanh` requires `-1 < x < 1`; a value outside those domains raises `ValueError`. `floor` and `ceil` map to `math.floor`/`math.ceil`, and `round(buf, decimals=0)` calls the builtin `round` with an `ndigits` argument (`round(value, digits)`), mirroring the core `math` node's generated `round(v, n)`; MicroPython supports that second argument (upstream coverage: `tests/float/builtin_float_round.py`), so no scale-by-`10 ** n` emulation is needed. `decimals` is expected as a keyword (`decimals=2` in the generated call), is clamped to `0` when negative, and falls back to the single-argument builtin so whole-number rounding stays integral when `0`. The module-level `round` shadows the builtin, so `arrays.py` captures the builtin as `_builtin_round` before defining its own `round`; keep that alias when adding helpers above the function. The trigonometric functions `sin`, `cos`, `tan`, `asin`, `acos`, `atan` and the binary `atan2(a, b)` take an extra `angle_unit` keyword: `'degrees'` (the default and the fallback for unknown values), `'radians'`, or `'percent'`, which means `0..1` cycles (`0.25` is a quarter turn). Forward functions convert their input to radians before calling `math`; inverse functions and `atan2` convert the result back to the selected unit. `atan(x)` maps to `math.atan(x)`; `atan2(a, b)` maps to `math.atan2(y=a, x=b)`, matching the core `math` node's argument order. Clamp is applied after the operation and after any angle conversion.
The reduction functions share one shape rule: `None` and an empty buffer are empty, and a scalar is one element. `length(buf)` returns an `int` (`0` for empty, `1` for a scalar). `mean`, `median`, `mo_min`, and `mo_max` return a length-one `array('f')` (with `clamp` applied); empty input yields `[0.0]`. `mean` averages all values, `median` averages the two middle values for an even count, and `mo_min`/`mo_max` resolve `percent` to `ceil(n * percent / 100)` clamped to `1..n`; `percent=100` is the plain extreme, `percent=0` selects one element. `mo_min`/`mo_max` are prefixed so the module keeps Python's builtin `min`/`max`; do not add module-level `min`/`max` names. Reductions copy the input before sorting.


The modify functions (`fill`, `ramp`, `steps`, `hat`, `sin_wave`, `square_wave`, `sawtooth_wave`, `set`, `set_indices`, `shift`, `random_uniform`, `random_normal`) also take `inplace=False`: by default they write into a fresh copy of the input buffer and leave the input untouched, while `inplace=True` mutates and returns the caller-provided buffer. `fill` fills the span resolved from `start` and `width` (a positive `width` is a count of indices, `0` is just the start index, a negative `width` counts back from the end so `-1` fills to the last index and `-2` to the penultimate) and leaves elements outside it unchanged. `ramp` builds a linear ramp from `lo` to `hi` over the span resolved from `start` and `width`. `steps` fills `num_steps` plateaus of `step_width` indices starting at `start + k * step_width` for `k` in `0..num_steps-1`, so every index of a step shares the value linearly interpolated from `lo` to `hi`, and a plateau that runs past a buffer edge is clipped. `hat` is a top-hat over the span resolved from `start` and `width`: indices inside the span get `hi`, everything else `lo`. The wave functions (`sin_wave`, `square_wave`, `sawtooth_wave`) write `period_count` periods of `period` samples each, starting at the resolved `start` index and clamped to the end of the buffer; `phase` is a radian offset and indices outside that span keep their input value. `set(buf, index, value, mode='clamp', fill=0.0)` writes a scalar at the resolved `index` or copies an array `value` in starting at `index`; `mode='wrap'` wraps overrunning writes to the beginning while `mode='clamp'` stops at the end, and at most `len(buf)` elements are ever written so a longer sub-array never overwrites the start cell twice. `mode='shift'` slides the buffer by the full deficit of an out-of-range index (`position - (len-1)` slots left for a position past the end, `-position` slots right for a negative one), writes on the edge it slid towards, and fills only the slots the slide vacated with `fill`, so a one-place slide shows no fill and a deficit of at least `len(buf)` leaves the whole buffer at `fill` before the write. `set_indices(buf, indices, value, mode='clamp', fill=0.0)` floors each entry of `indices` and writes a scalar `value` at every resolved position, or pairs an array `value` element-wise with `indices` up to the shorter length; entries resolve sequentially, so in `shift` mode each one slides the buffer as the earlier writes left it. `fill` is ignored by `clamp` and `wrap`. `random_uniform` fills from a uniform distribution between `lo` and `hi`, swaps reversed bounds, returns an empty array for `None`, and applies `clamp` after generation. `random_normal` draws from a normal distribution with `mean` and `stdDev`, cuts samples to `lo..hi`, treats a negative `stdDev` as its absolute value, and uses a Box–Muller transform because MicroPython has no `gauss`/`normalvariate`; `clamp` is applied after the cut. `random_uniform_value` and `random_normal_value` are the scalar counterparts used by the `random-value` node: they return a single sample instead of filling a buffer, share the same bound swapping and normal cutting, return `mean` when `stdDev` is `0`, treat a negative `stdDev` as its absolute value, and round to a whole number when `integer=True` (through the captured builtin, since the module's own `round` is an array operation). The array fills and the scalar sample functions draw from the shared module-level `random` state; no random function takes a seed, so a graph seeds once through the `random-seed` node. `reseed(enabled, seed, key=None)` owns the shared seeding for the `random-seed` node: an enabled call seeds `int(seed)` once per remembered state, an unchanged `enabled`/`seed` pair is a no-op so the stream keeps advancing between passes, a changed seed reseeds, and disabling forgets the state so re-enabling restarts the sequence. `key` scopes the remembered state to one generated node (`seed:<graph>:<node>`), while a `None` key seeds on every call. The waveform functions are named `sin_wave`, `square_wave`, and `sawtooth_wave` to keep the names `sin`/`square` free for the element-wise math operations; the `array-set` options are still `setType: "sin"` / `"square"` / `"sawtooth"` and only the runtime function names differ.

The length-changing operations build a fresh `array('f')` on every call, so they expose no `inplace` argument. `repeat(buf, count, clamp=False)` writes `count` consecutive copies of the array, so `[1, 2, 3]` with `count = 2` yields `[1, 2, 3, 1, 2, 3]`; a negative `count` yields an empty array. `ping_pong(buf, count, clamp=False)` writes `count` blocks that alternate forward and backward, and consecutive blocks repeat the endpoints, so `[1, 2, 3]` with `count = 2` yields `[1, 2, 3, 3, 2, 1]`. `concat(buf, other, clamp=False)` appends the second array and returns `len(buf) + len(other)` elements; both operands are `vars.array` inputs, so an unconnected connector arrives as `None` and contributes nothing. `interlace(buf, other, step=1, offset=0, clamp=False)` places one `other` value at every `step`-th **output** index, the first at output index `offset`: `step` is floored to at least `1`, `start = int(offset) % step` normalises a negative offset, and the output is always `len(buf) + len(other)` elements long, with surplus `other` values appended at the end. Worked example: `in = [1, 2, 3, 4, 5, 6]`, `other = [9, 8, 7]`, `step = 2`, `offset = 1` yields `[1, 9, 2, 8, 3, 7, 4, 5, 6]`.

## Signals

See [signal-triggered-graphs.md](signal-triggered-graphs.md) for the full pulse-signal model. In
brief: a `signal-post` node raises a named pulse, an `event` graph watches a list of names with an
`any`/`all` trigger mode, and `otter_vars/signals.py` delivers each posted name to every watching
listener's pending set.

## Validation

The store model itself has no bespoke capability checks; `node_capabilities.js` registers one for
`signal-post` (over-long / ambiguous signal name; a blank name is the disabled `(not set)` state)
and three graph rules: `vars-duplicate-declaration`, `event-signal-selection`, and
`event-signal-producer`.

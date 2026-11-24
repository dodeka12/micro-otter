# Core Tuple Node System

This document describes the `core` package's `core.tuple` value type and the nodes that build, open
and index tuples: `compose`, `decompose` and `tuple-select`. It also covers the single-channel
`select`, whose union output may now carry a tuple on either branch, and `select-index`, the
indexed N-way mux that generalizes it.

## Overview

| Node | Purpose | Inputs | Outputs |
| --- | --- | --- | --- |
| `core.compose` | Collects connected values into one tuple literal | `item_1` … `item_8` (`any`) | `tuple` (`core.tuple`) |
| `core.decompose` | Reads a tuple position by position | `tuple` (`core.tuple`) | `item_1` … `item_8` (`any`) |
| `core.tuple-select` | Reads one zero-based position; index mode picks default / clamp / wrap | `tuple` (`core.tuple`), `index` (`int`/`float`), `default` (`int`) | `value` (`any`) |
| `core.select` | Picks one of two values from a condition | `condition` (`bool`), `trueValue` / `falseValue` (`any`) | `value` (`any`, union) |
| `core.select-index` | Forwards one of N values by zero-based index | `index` (`int`/`float`), `value_1` … `value_8` (`any`) | `value` (`any`, union) |

`compose`, `decompose` and `tuple-select` are `category: "data"` nodes with the shared `#4a6fa5`
colour; `select` and `select-index` stay in `category: "logic"` with `#5e7bb0`. All five are pure
value nodes: no capabilities, no runtime module, and no device imports.


## Scope

- Type declaration: `src/micro_otter/nodes/device/node_pkgs/core/data_types.json`
- Node definitions: `src/micro_otter/nodes/device/node_pkgs/core/node_definitions.json`
- Generators: `src/micro_otter/nodes/device/node_pkgs/core/node_generators.js`
  (`composeNode`, `decomposeNode`, `tupleSelectNode`, `selectNode`, `selectIndexNode`)
- Icons: `icons/call_merge_24dp.svg`, `icons/call_split_24dp.svg`,
  `icons/format_list_numbered_24dp.svg`

There is **no** tuple runtime module. Generated code uses ordinary Python tuples and only the
builtins `bool`, `int`, `isinstance`, `len`, `max`, `min`, indexing and `%` — never `otter_core.tuple`,
and never `array`. The type id `core.tuple` is a UI/connector id only; it does not appear in the
generated Python.

## The `core.tuple` type

`core.tuple` is a namespaced value type declared by the `core` package manifest
(`"dataTypes": "data_types.json"`).

| Field | Value |
| --- | --- |
| `kind` | `value` |
| `name` | **Tuple** / **Tupel** |
| `color` | `#9b7ad6` |
| `connectionPolicy.input.maxConnections` | `1` (one producer per tuple input) |
| `connectionPolicy.output.maxConnections` | `0` (fan-out is allowed) |

Contract:

- A tuple is ordered and **heterogeneous**: positions may carry different types (`float`, `string`,
  `bool`, another tuple, …).
- Values are **immutable**; there is no tuple mutation node. Build a new tuple instead.
- `None` is the explicit placeholder for a missing position, both when composing (unconnected input)
  and when decomposing/reading (position the tuple does not have).
- The type is accepted by `normalizeDataTypeId()` as a namespaced value type, so it needs **no**
  entry in `type-conversions.ts`; it is compatible with exact matches and with `any` targets and
  rejects scalar targets (see [Union typing](#union-typing)).

## `core.compose`

Collects up to eight connected values into one tuple literal.

- Inputs in fixed order `item_1` … `item_8`, every one `allowedTypes: ["any"]`,
  `initialTypes: ["any"]`, no `defaultControl`.
- Output `tuple` with `outputType: "core.tuple"` and `initialTypes: ["core.tuple"]`.
- Control `count` (dropdown, label **Positions** / **Positionen**, default `2`, options `2`–`8`,
  `affectsInputs: true`). Each option lists `activeInputs: ["item_1", …]`, so only the selected
  positions are shown. Connector **indices stay stable** (`item_1` … `item_8` are always indices
  `0` … `7`); the dropdown changes visibility, not order.
- An unconnected position composes as the literal `None`.
- The generated literal always carries a trailing comma, so a one-element tuple would stay a tuple
  even though the control minimum is 2.

```python
# two positions, both connected
node_3_out0 = (node_1_out0, node_2_out0,)

# three positions, item_2 unconnected
node_7_out0 = (node_4_out0, None, node_5_out0,)
```

An unwired output emits no assignment — the generator returns `# compose output not connected`, and
the transpiler drops that comment-only statement, leaving the node header in the app.

## `core.decompose`

Reads one tuple position by position.

- Input `tuple`, `allowedTypes: ["core.tuple"]`, `initialTypes: ["core.tuple"]` — a scalar producer
  is refused at connection time.
- Outputs in fixed order `item_1` … `item_8`, every one `outputType: "any"` with
  `initialTypes: ["any"]`. The outputs are `any` on purpose: positions can have different types, and
  a single connector id cannot describe that union.
- Control `count` (dropdown, **Positions** / **Positionen**, default `2`, options `2`–`8`,
  `affectsOutputs: true`) with per-option `activeOutputs`. As with `compose`, indices stay stable.
- Only **connected** outputs below `count` are generated, and every read is guarded so a short or
  non-tuple input yields `None` instead of raising:

```python
_tuple_9 = node_3_out0
node_9_out0 = _tuple_9[0] if isinstance(_tuple_9, tuple) and len(_tuple_9) > 0 else None
node_9_out1 = _tuple_9[1] if isinstance(_tuple_9, tuple) and len(_tuple_9) > 1 else None
```

The input is read into the node-scoped temp `_tuple_<nodeId>` once. A missing input becomes
`_tuple_<nodeId> = None`, which the guard resolves to `None` on every position. With no connected
output the generator emits `# decompose output not connected` and no assignment.

## `core.tuple-select`

Reads one position chosen at runtime, and resolves a position outside the tuple through the
`Index Mode` control.

- Inputs in order:
  - `tuple` (`allowedTypes: ["core.tuple"]`, `initialTypes: ["core.tuple"]`).
  - `index` (`allowedTypes: ["int", "float"]`, `initialTypes: ["int", "float"]`, number
    `defaultControl` label **Index**, default `0`, min `0`, max `100000`, step `1`), so it can be
    left unwired and still read a fixed position.
  - `default` (`allowedTypes: ["int"]`, `initialTypes: ["int"]`, number `defaultControl` label
    **Default** / **Standardwert**, default `0`, min `-100000`, max `100000`, step `1`). It is read
    only in Default Value mode; an unwired connector emits the literal `0`.
- Output `value`, `outputType: "any"`, `initialTypes: ["any"]`.
- One control, `indexMode` (`Index Mode` / `Index-Modus`, `affectsInputs: true`, default `default`,
  options in the order `default`, `clamp`, `wrap`). Each option declares the connectors it keeps:

| Option | Label | `activeInputs` |
| --- | --- | --- |
| `default` | Default Value / Standardwert | `tuple`, `index`, `default` |
| `clamp` | Clamp / Begrenzen | `tuple`, `index` |
| `wrap` | Wrap / Umlauf | `tuple`, `index` |

Hiding the `default` connector does **not** disconnect it. `activeInputs` only filters rendering,
so the connector keeps its index `2` and any wire, and switching back to Default Value reuses the
existing connection. In clamp and wrap mode the generator never reads that input, so a retained wire
has no effect.

Default Value mode:

```python
_tuple_5 = node_3_out0
_index_5 = int(node_1_out0) if isinstance(node_1_out0, (int, float)) else -1
node_5_out0 = _tuple_5[_index_5] if isinstance(_tuple_5, tuple) and 0 <= _index_5 < len(_tuple_5) else 0
```

The trailing `0` above is the fallback used when the `default` connector is unwired; a wired
connector is inlined in its place:

```python
node_5_out0 = _tuple_5[_index_5] if isinstance(_tuple_5, tuple) and 0 <= _index_5 < len(_tuple_5) else node_2_out0
```

Clamp mode:

```python
_tuple_5 = node_3_out0
_index_5 = int(node_1_out0) if isinstance(node_1_out0, (int, float)) else None
node_5_out0 = _tuple_5[max(0, min(_index_5, len(_tuple_5) - 1))] if isinstance(_tuple_5, tuple) and _index_5 is not None and len(_tuple_5) > 0 else None
```

Wrap mode:

```python
_tuple_5 = node_3_out0
_index_5 = int(node_1_out0) if isinstance(node_1_out0, (int, float)) else None
node_5_out0 = _tuple_5[_index_5 % len(_tuple_5)] if isinstance(_tuple_5, tuple) and _index_5 is not None and len(_tuple_5) > 0 else None
```

Python's `%` on a negative integer with a positive divisor is non-negative, so `-1 % len` reads the
last element without a helper or an extra temporary. Every mode keeps the same three-line shape: the
tuple read, the index conversion, then the guarded read.

Runtime contract:

- The input is read into `_tuple_5` once and the index into `_index_5`; `_tuple_5` is `None` when the
  tuple input is unwired.
- Positions are **zero-based**: index `0` reads the first position.
- A fractional index is **truncated before the mode rule** (`int()` truncates toward zero), so `2.9`
  reads position `2` and becomes in range, while `-0.5` truncates to `0` and reads the **first**
  position.
- `default`: an index below `0` or at/above `len(tuple)` reads the `default` value (wired connector,
  otherwise `0`). A non-numeric index, and a missing/`None`/non-tuple/empty tuple, also read the
  `default` value.
- `clamp`: an index below `0` reads the first element, an index at/above `len(tuple)` reads the last
  one. A non-numeric index, and a missing/`None`/non-tuple/empty tuple, resolve to `None`.
- `wrap`: the index wraps modulo `len(tuple)`, so `-1` reads the last element and `len` reads the
  first. A non-numeric index, and a missing/`None`/non-tuple/empty tuple, resolve to `None`.
- An unknown, empty or missing `indexMode` value falls back to `default` (case and surrounding
  whitespace are ignored), so graphs saved before the control existed keep reading a position.
- An unwired output emits `# tuple-select output not connected` and no assignment.

**Not the same node as `vars.array-select`.** Both now offer `default` / `clamp` / `wrap`, but
`vars.array-select` indexes a `vars.array` (a `float`-only `array('f')` buffer) with a `float`
default value, while `core.tuple-select` indexes a heterogeneous Python tuple with an `int` default.
Keep them separate; see [vars-node-system.md](vars-node-system.md).

## `core.select`

`select` is a single-channel mux: one boolean picks between two values.

- Inputs in order `condition` (`bool`, checkbox `defaultControl` default `true`), `trueValue`
  (`any`, text default `"ON"`), `falseValue` (`any`, text default `"OFF"`).
- One output `value` with `outputType: "any"`,
  `initialTypes: ["bool", "int", "float", "string", "core.tuple"]` and
  `typeInputSources: ["trueValue", "falseValue"]`.
- There is **no `channels` control** and no suffixed connector (`condition_2`, `trueValue_2`,
  `falseValue_2`, `value_2` do not exist). Channel 1 is the node.
- Generated code is exactly one ternary; a tuple on a branch arrives as a plain tuple value:

```python
node_6_out0 = (node_3_out0) if bool(True) else ('low')
node_7_out0 = (node_2_out0) if bool(node_1_out0) else (node_4_out0)
```

An unwired input normally resolves through its `defaultControl` (`true`, `"ON"`, `"OFF"`); if it
resolves to nothing at all the generator falls back to `False` for the condition and `None` for
either value. An unwired output emits `# select output not connected` and no assignment.

## `core.select-index`

`select-index` generalizes `select` from two branches to N: one numeric index forwards one of two to
eight independent value inputs. It stays in `category: "logic"` with the `#5e7bb0` colour and square
shape of `select`, and shares the `icons/format_list_numbered_24dp.svg` icon with `tuple-select`.

- Inputs in fixed order `index` and `value_1` … `value_8`. `index` is input index **0**; the values
  are indices **1** … **8**. `index` declares `allowedTypes`/`initialTypes` `["int", "float"]` and a
  number `defaultControl` (label **Index**, min `0`, max `7`, step `1`, default `0`), so it can stay
  unwired. Every `value_N` declares `["any"]` / `["any"]` plus a number `defaultControl` (label
  **Value N** / **Wert N**, min `0`, max `255`, step `1`, default `0`), so an unwired value forwards
  the integer `0`; a node-level `inputDefaults` entry overrides that default.
- One output `value` with `outputType: "any"`,
  `initialTypes: ["bool", "int", "float", "string", "core.tuple"]` and
  `typeInputSources: ["value_1", … "value_8"]`.
- Control `count` (dropdown, label **Values** / **Werte**, default `2`, options `2`–`8`,
  `affectsInputs: true`). Every option lists `["index", "value_1", … "value_<N>"]`, so the selector
  connector never disappears. As with `compose`, connector **indices stay stable**; `count` changes
  visibility only and the visible connectors are never compacted.
- Generated code is a guard, a `None` default and exactly one branch per active value:

```python
_select_raw_5 = node_1_out0
_select_index_5 = int(_select_raw_5) if isinstance(_select_raw_5, (int, float)) and -1 < _select_raw_5 < 3 else -1
node_5_out0 = None
if _select_index_5 == 0:
    node_5_out0 = node_2_out0
elif _select_index_5 == 1:
    node_5_out0 = node_3_out0
elif _select_index_5 == 2:
    node_5_out0 = node_4_out0
```

Runtime contract:

- The index is **zero-based**: `0` forwards `value_1`.
- A fractional index is **truncated toward zero** before the comparison (`2.9` → `2`, `-0.5` → `0`).
- An index below `0` or at/above `count` yields `None`; there is no clamp or wrap mode.
- An active but unconnected value forwards its integer default (`0` unless the node stores another
  `inputDefaults` value). A `value_N` above `count` is never read, so both the emitted branches and
  the connector union follow the dropdown.
- A non-numeric index (`str`, `None`) and non-finite values (`NaN`, `inf`) yield `None` without
  raising, because the `-1 < raw < count` guard rejects them before `int()` runs.
- An unwired output emits `# select-index output not connected` and no assignment.

**Not the same node as `tuple-select` or `select`.** `tuple-select` reads one position out of an
existing tuple, `select` chooses between exactly two branches with a boolean condition, and
`select-index` chooses among N independent connectors with a numeric index. See
[Union typing](#union-typing) for how the output type narrows to the active, connected values.

## Union typing

`getResolvedOutputTypes()` follows `typeInputSources` upstream and lists the types that can actually
arrive. For `select` with a tuple source on `trueValue` and a `float` source on `falseValue`:

```js
graph.getResolvedOutputTypes(selectId, 0); // ['core.tuple', 'float']
resolveUnionOutputType(['core.tuple', 'float']); // 'any'
```

The representative rule in `resolveUnionOutputType()` (`type-conversions.ts`) is:

| Candidates | Representative |
| --- | --- |
| none / only `unknown` | `any` |
| one | that type |
| `any` present | `any` |
| two or more distinct, at least one namespaced (dotted) id | `any` |
| only `bool` / `int` / `float` / `double` | the widest (`bool < int < float < double`) |
| anything else | the first candidate, in declaration order |

The namespaced clause exists because a namespaced value type (`core.tuple`) and a scalar are not
representable by one connector colour or one connection policy. `select` therefore declares
`outputType: "any"` in the shipped definition, matching what the rule computes.

**`select-index` unions only its active, connected values.** Its `count` dropdown sets
`affectsInputs`, so `resolveActiveInputIds()` (`type-conversions.ts`) supplies the same active set
that hides connectors, and `getResolvedOutputTypes()` skips every declared source outside it before
looking up a connection. With `value_1` fed by a `float` producer and `value_3` by a `string`
producer the output reports `['float', 'string']` at `count: 3` and only `['float']` at `count: 2`;
a wired-but-hidden `value_3` contributes neither a candidate nor a fallback. Raising the count
widens the union, and `updateNode()` prunes an outgoing connection that no longer fits.

The integer default is not a union candidate: `getResolvedOutputTypes()` follows connections only, so
an unconnected `value_2` at `count: 3` leaves the union at `['float']` even though the branch emits
`0`. Numeric consumers stay compatible because `int` fits every wider numeric input.

**Connection validation is unchanged: every candidate must fit the target.** A mixed tuple/scalar
union is refused by a `core.tuple`-only input *and* by a `float`-only input:

```text
Type mismatch: Cannot connect union 'core.tuple | float' to input accepting [core.tuple]
Type mismatch: Cannot connect union 'core.tuple | float' to input accepting [float]
```

Only an `any` input (or an input declaring both candidates) accepts it. Widening the representative
to `any` changes the connector's colour and policy, not the safety check.

## Migration of saved `select` nodes

The ten-channel select is gone. Loading a collection saved with it reduces each node to the
single-channel definition through the generic runtime-definition migration — there is no
select-specific code path:

- the node's `controls` array shrinks to the current definition (empty) and its `controlValues`
  keep only ids that still exist, so the `channels` value is dropped;
- `inputDefaults` are filtered to the surviving input ids, so channel-2 … channel-10 defaults are
  dropped rather than reinterpreted;
- `NodeGraph.updateNode()` prunes connections whose connector index no longer exists, so wires to
  the removed connector slots disappear instead of shifting to a neighbouring channel.

Nothing is guessed: data that lived on channels 2–10 is intentionally not preserved. A graph that
used the multi-channel mux must be rebuilt with one `select` per condition/value pair, or with
`compose` + `select` when the branches are heterogeneous.

## Validation

- Node definitions, generators and icons: `tests/proc/core-tuple-nodes.test.js`,
  `tests/proc/core-tuple-select-node.test.js` and `tests/proc/core-select-node.test.js`.
- `select-index` definition, generator and connector defaults:
  `tests/proc/core-select-index-node.test.js`; graph and transpiler integration (including the
  emitted integer default and the union drift check):
  `tests/proc/core-select-index-graph-integration.test.js` and
  `tests/proc/core-select-index-transpiler-integration.test.js`.
- Cross-node transpiler graphs (two and eight positions, `None` padding, guarded reads, mixed
  branches, package metadata): `tests/proc/core-tuple-transpiler-integration.test.js`.
- Type registration and connection policy: `tests/data/core-package-data-types.test.js`.
- Mixed-union representative and rejection messages: `tests/data/type-conversions.test.js` and
  `tests/data/node-graph-type-compatibility.test.js`.
- Migration of saved select nodes: `tests/data/runtime-node-definition-migration.test.js`.
- Shipped demo: `tests/proc/hass-example-collection.test.js` transpiles
  `src/micro_otter/nodes/device/graphs/examples/mqtt-hass-demo.json` with the single-channel select.
- Device gates: `npm run check:device-syntax` (the generated code must stay MicroPython-parseable)
  and `tests/test_device_micropython_api_guard.py` (only builtins used, no new module API).

Run the whole set with `npm run test:node`; the focused files also work directly, for example
`node --import tsx --test tests/proc/core-tuple-transpiler-integration.test.js`.

## See also

- [node-definition-reference.md](node-definition-reference.md) — connector contracts,
  `typeInputSources` and the union representative table.
- [vars-node-system.md](vars-node-system.md) — the `vars.array` type, `array-select` and the
  `otter_vars.arrays` runtime that tuple nodes deliberately do not use.
- [transpiler-architecture.md](transpiler-architecture.md) — how generator results become loop
  statements.


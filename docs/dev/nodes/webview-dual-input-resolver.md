# DualInputControl

`DualInputControl` (in `otter_webview.input_control`) is the single class for resolving
the active value when a webview node has two competing input sources: a **backend
connector** and a **user frontend**.  It handles both scalar and N-tuple values under a
consistent **last-changed-wins, frontend-wins-on-tie** policy.

## Problem

Webview input nodes (number slider, joystick, checkbox, etc.) receive values from two
independent sources every loop tick:

- **Connector input** — a value arriving from other nodes in the graph.
- **Frontend input** — a value sent by the user interacting with the webview UI.

Without a consistent policy, nodes either permanently latch onto whichever source acted
last, or arbitrarily pick one. Both break expected behavior.

## Policy: Last-Changed Wins

```
frontend arrived this cycle?              →  use frontend  (tie-break: frontend wins)
connector changed since last cycle?       →  use connector
neither changed?                          →  keep previous output unchanged
```

- While the user is actively interacting (frontend payloads arrive each poll), frontend wins.
- The moment the user stops, the connector resumes control as soon as its value changes.
- If nothing changes, the last resolved output is preserved — no spurious updates.
- If both sources change in the same tick, frontend wins.

## API

### Constructor

```python
from otter_webview.input_control import DualInputControl

ctrl = DualInputControl(initial_values, minimum=None, maximum=None)
```

- `initial_values`: a scalar (for single-value nodes) or a tuple (for multi-axis nodes).
  The instance stores and returns values in the same form — scalars stay scalars, tuples
  stay tuples.
- `minimum` / `maximum`: optional inclusive bounds for the **scalar** path. Both default to
  `None`, which disables clamping, so nodes without bounds keep their previous behaviour.
  Bounds apply to scalar controls only: tuple values are never clamped.
- Bounds are validated once in the constructor. A missing, non-numeric or non-finite bound
  (`NaN`, `±inf`) disables clamping for the pair. `maximum < minimum` is swapped, so
  `DualInputControl(value, 100, 0)` behaves like `DualInputControl(value, 0, 100)`.
- The constructor default itself is clamped, so `DualInputControl(500, 0, 100).output_value`
  is `100` before the first tick.

### Bounds and clamping

When bounds are active, every scalar value that becomes the output is clamped to the
inclusive range before it is stored:

- the constructor default (see above),
- a connector value that wins a tick,
- a user frontend value that wins a tick.

Non-numeric values (`None`, strings that do not parse as numbers) pass through untouched, so a
bounded checkbox or string control is unaffected. `step` is **not** a runtime concern: the
runtime never snaps, rounds, or quantises a value to a step; step only drives the browser
spinner increment and payload metadata.

### `update()` — scalar path (number-input, checkbox, slider)

```python
output_value, push = ctrl.update(backend_value, consume_fn, frontend_key, sync_epoch=None)
```

| Parameter | Description |
|-----------|-------------|
| `backend_value` | Current connector input value for this tick. |
| `consume_fn` | The webview consume function (`WEB_INTERFACE.consume_webview_values_keys`). |
| `frontend_key` | The transient-store key for this node's frontend payload. |
| `sync_epoch` | Optional webview sync epoch; a change forces one publish of the unchanged value. |

Returns `(output_value, push)`:
- `output_value` — the resolved scalar to use as the node output.
- `push` — `True` when the connector changed and the browser UI needs an update; `False`
  when the user acted (the browser already knows) or nothing changed.

### `update()` — tuple path (joystick, multi-axis nodes)

```python
output_values, source = ctrl.update(connector_values, frontend_values)
```

| Parameter | Description |
|-----------|-------------|
| `connector_values` | Tuple of current connector inputs, already normalised by the caller. |
| `frontend_values` | Pre-extracted tuple from the frontend payload, or `None` if no user input arrived this cycle. |

Returns `(output_values, source)`:
- `output_values` — the resolved tuple.
- `source` — `"frontend"`, `"connector"`, or `"unchanged"`.

### `output_value` property

Returns the last resolved value (scalar or tuple), after clamping on the scalar path.

### `output_changed` property

Returns `True` only on a tick whose resolved output differs from the previous tick's resolved
output. Semantics:

- Reset to `False` at the start of every `update()` call, so it is a **one-tick** flag — read it
  after `update()` and before the next tick.
- Always `False` on the first tick of an instance, even when that tick resolves a value
  different from the constructor default, because there is no previous tick to compare against.
- Always `False` on a forced sync-epoch publish: that re-sends an unchanged value, so it is a
  publish event rather than a value change. On the scalar path `push` and `output_changed` are
  therefore independent.
- Compares resolved output values, not inputs: a connector jump that clamps to the same bound
  (for example `150 → 200` with `maximum=100`) is not a change.
- Tuple values are compared element-wise with the same `1e-9` epsilon as the resolution policy.

### `SelectControl`

`SelectControl` subclasses `DualInputControl` but tracks a selected option index and exposes
`(value, label)` outputs. Its `output_changed` compares the resolved option **value** only:
switching between two options that carry the same value is not a change, while a value change
reported under the same label is. The initial refresh performed by `__init__` never flags a
change; only completed ticks do.

### Joystick change flag

`otter_webview.joystick` stores the tuple control's flag in the per-node state as
`state["outputChanged"]`. It is a **single** flag for the whole joystick, not one flag per axis:
any axis change (or any frontend payload) sets it for one tick, so both axis consumers can read
the same `changed` output. Creating a new control (`ensure_state` on a fresh state key) resets
the flag to `False`; an existing state keeps its value so the next tick still reports the last
real axis change.

## Usage — scalar path (generated code pattern)

```python
# init (emitted by NodeInitGenerators)
import otter_webview.input_control as _wv_numinput
node_ctrl = _wv_numinput.DualInputControl(default_value, minimum, maximum)

# loop (emitted by NodeCodeGenerators)
output_value, push = node_ctrl.update(
    backend_value,
    web_interface_module.WEB_INTERFACE.consume_webview_values_keys,
    frontend_key,
)
changed = node_ctrl.output_changed
if push:
    web_interface_module.WEB_INTERFACE.publish_webview_values({...})
```

## Usage — tuple path (joystick pattern)

```python
from otter_webview.input_control import DualInputControl

# In ensure_state — create once per state key
state["ctrl"] = DualInputControl((0.0, 0.0))

# In resolve loop — called every tick
frontend_pair = extract_frontend_pair(frontend_payload)  # tuple or None
(out_x, out_y), source = state["ctrl"].update(
    (connector_x, connector_y),
    frontend_pair,
)
```

## Location

```
src/micro_otter/nodes/device/node_pkgs/webview/otter_webview/input_control.py
```

Tests:
```
tests/test_runtime_webview_input_control.py
```


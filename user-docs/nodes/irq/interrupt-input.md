# Interrupt Input

Binds a digital pin to a GPIO interrupt and exposes the arriving edges as a boolean, a running edge count and the current pin level.

## Inputs

None — the node has no inputs.

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Triggered` | `bool` | true when an edge arrived since the last read |
| `Count` | `int` | edges seen since the program started |
| `State` | `bool` | current pin level |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Pin` | dropdown | `0` | digital pin observed by the interrupt |
| `Trigger` | dropdown | `Rising edge` | signal edge or level that fires the interrupt |
| `Pull Resistor` | dropdown | empty | optional internal pull resistor |
| `Debounce (ms)` | number | `0` | minimum time between two accepted edges; 0 disables debouncing |
| `Interrupt name` | text | `empty` | name that irq-mode graphs and interrupt-enable nodes use to reach this input |

## Behaviour

- Init phase, once for the whole collection: builds the `Pin` with the selected `Pull Resistor` and
  registers one interrupt channel under `Interrupt name`.
- The handler only counts: `Triggered` is true once per batch of edges since that output last ran,
  `Count` is a running total since boot, and `State` reads the pin level now.
- `Debounce (ms)` discards edges that arrive closer together than the value; 0 disables it and the
  control is clamped to 0–10000.
- `Triggered`, `Count` and `State` never consume the wake-up an `irq` graph is waiting for, so a
  `continuous` graph can poll them next to an `irq` graph on the same name.
- One GPIO carries one interrupt input: a second input node on the same pin loses every edge in
  silence, so the editor badges the duplicate and the build rejects it.

## Example

1. Set `Pin` to the button's GPIO, `Trigger` to `Falling edge`, `Pull Resistor` to the pull-up the
   board needs, and `Debounce (ms)` to 30.
2. Give the node an `Interrupt name` and set one graph's execution type to `irq` with the same name.
3. Wire `Count` into `Print` from a `continuous` graph to watch edges arrive while the `irq` graph
   handles them.

## See also

- [Interrupt package](index.md) — trigger, debounce and the one-graph-per-name rule
- [Interrupt Enable](interrupt-enable.md) — gate this channel from the graph
- [Graph panel](../../app/graph-panel.md) — the `irq` execution type and its trigger name


# Post Signal

Posts a named pulse signal that event-triggered graphs can wait on.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Enabled` | `bool` | when off, the node neither posts nor advances its edge state |
| `Fire` | `bool` | value whose rising edge posts the signal |

## Outputs

None — the node has no outputs.

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Signal` | dropdown, required | empty | use an existing signal, leave it unset to disable the node, or define a new one |
| `Signal name` | text | `empty` | signal name used when "Define signal…" is selected above |
| `Only on rising edge` | checkbox | on | when unchecked, the signal posts on every run while fire is true |

## Behaviour

- Loop: posts the named pulse; with `Only on rising edge` on (the default) it fires once per low →
  high edge of `Fire`, otherwise on every pass while `Fire` is true.
- `Enabled` off stops both the post and the edge tracking, so re-enabling cannot fire on an edge that
  arrived while the node was off.
- An `event` graph watches one or more signal names and wakes on the next pass after a post; the
  signal itself carries no value.
- `Signal` must be set: `(not set)` is the disabled state and emits no code, while a name that is
  ambiguous or too long is flagged by the graph rule.
- Posts are delivered to every listener watching the name, so one button can wake several graphs.

## Example

1. Pick or define a `Signal` such as `refresh`.
2. Wire a bool that turns true once per press into `Fire` and leave `Only on rising edge` on.
3. In an `event` graph, watch the same name to run the expensive work outside the main loop.

## See also

- [Vars package](index.md) — the pulse-signal model
- [Graph panel](../../app/graph-panel.md) — the `event` execution type that watches signal names
- [Variable Write](var-write.md) — hand a value to the woken graph through the store


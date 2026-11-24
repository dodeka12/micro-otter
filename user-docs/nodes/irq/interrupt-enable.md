# Interrupt Enable

Enables or disables the interrupt input selected by name.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Enabled` | `bool` | when off, waiting irq-mode graphs do not wake up |

## Outputs

None — the node has no outputs.

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Interrupt name` | dropdown | empty | interrupt input this node enables or disables |

## Behaviour

- Loop phase: applies `Enabled` to the named channel on every pass; repeating the same state is free.
- Disabling suspends only the wake-up: the interrupt keeps counting edges, so `Count` and `Triggered`
  stay live in a `continuous` graph.
- The gate is flipped before the pin is attached or detached, so no edge slips through the half
  applied state.
- `Interrupt name` only lists names that an interrupt input declares; a name that no longer resolves
  resets to `(not set)`.
- With no name selected the node emits no code at all, and the build reports the dangling enable.

## Example

1. Give it the same `Interrupt name` as the interrupt input it should gate.
2. Wire `Enabled` from a switch or a slider-backed variable.
3. Keep the channel disabled while a menu is open, then enable it again when the graph is ready for
   the next press.

## See also

- [Interrupt package](index.md) — what a disabled channel still does
- [Interrupt Input](interrupt-input.md) — the node that declares the name
- [Post Signal](../vars/signal-post.md) — the other way to wake a graph from the device side


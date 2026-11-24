# Interrupt package

A GPIO interrupt channel: declare one on a pin, enable it from the graph, and let an `irq` graph run
the moment an edge arrives instead of waiting for the next loop pass.

## Setup

| Requirement | Detail |
|---|---|
| Interrupt pin | every pin the target declares as a digital input can carry an interrupt; `Pull Resistor` is offered for the same pins |
| Trigger | `Rising edge`, `Falling edge`, `Any edge`, `Low level` or `High level`, default `Rising edge` |
| Debounce | `Debounce (ms)` from 0 to 10000, default 0; a mechanical switch usually needs 20–50 |
| Interrupt name | free text on the input node; it binds the input to exactly one `irq`-mode graph and to any `Interrupt Enable` nodes with the same name |
| One pin, one interrupt | two input nodes on the same pin are rejected |

## Nodes

| Node | What it does |
|---|---|
| [Interrupt Input](interrupt-input.md) | binds a pin to an interrupt channel and exposes the edge as `Triggered`, `Count` and `State` |
| [Interrupt Enable](interrupt-enable.md) | switches the named interrupt on or off from a boolean |

## Shared concepts

- The name is the binding: the input node declares it, one `irq` graph waits on it, and any number of
  `Interrupt Enable` nodes address it. Renaming the input without updating the graph or the enable
  node leaves them pointing at a channel that no longer exists.
- Only the interrupt handler touches the pin. It latches one boolean and increments a count, and the
  `irq` graph wakes up after the handler returns — so an interrupt graph may take its time without
  losing the next edge, and a `continuous` graph can read `Count` without stealing the wake-up.
- A disabled interrupt still counts edges; only the `irq` graph stays suspended. That makes
  `Interrupt Enable` a cheap gate around an expensive handler.
- `Triggered` is true once per edge for the graph that consumed it; use `Count` for "how many" and
  `State` for "is the pin high right now".
- Keep `irq` graphs short. Work that takes milliseconds belongs in a `continuous` graph that the
  `irq` graph wakes through a store entry.

## Related

- [Graph panel](../../app/graph-panel.md) — the `irq` execution type for a graph
- [vars package](../vars/index.md) — store entries for handing work to the main loop
- [Settings view](../../app/settings-view.md) — pins available on the target

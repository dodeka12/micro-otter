# Memory Info

Reports free heap memory in KB and optionally triggers GC before reading.

## Inputs

None — the node has no inputs.

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Free KB` | `int` | free heap memory in kilobytes |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Run GC before read` | checkbox | on | run garbage collection before reading |

## Behaviour

- Loop: one reading per pass, free heap in KB as an `int`.
- `Run GC before read` on (the default) collects first, so the value is the heap that is really
  available instead of what is left before the next collection.
- Collecting on every pass costs time, so a fast `continuous` graph should read this node rarely.
- The value drops in steps as arrays and stores grow; a steady fall over minutes is the leak signal.
- An unwired output emits no code, so a forgotten node costs nothing on the device.

## Example

1. Add it to a slow graph and wire `Free KB` into an `HA Sensor` to chart the heap.
2. Compare two readings with `Math` `Subtract` to see the change per pass.
3. Turn `Run GC before read` off to measure the heap between collections instead of after them.

## See also

- [Core package](index.md) — debugging nodes
- [Print](print.md) — put the reading in the console
- [vars package](../vars/index.md) — the arrays and stores that consume the heap


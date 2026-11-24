# Time

Emits uptime and delta time in selected units.

## Inputs

None — the node has no inputs.

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Now` | `float` | uptime since startup |
| `Delta` | `float` | time since the previous loop |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Unit` | dropdown | `Seconds` | time unit of the outputs |

## Behaviour

- Init records the first tick; the loop reads the current tick, computes the difference to the
  previous pass and stores it for the next one.
- `Now` is the uptime since boot in the selected unit: `Seconds` divides the millisecond counter by
  1000, `Milliseconds` and `Microseconds` report raw ticks.
- `Delta` is the time since this node last ran — the real pass length, not the graph's sleep setting.
- `Microseconds` switches the tick source to the microsecond counter, which wraps sooner; a long
  uptime is better read in seconds.
- With both outputs unwired the node emits nothing; the tick bookkeeping only exists when a value is
  actually consumed.

## Example

1. Wire `Delta` into `Print` to see how long a pass really takes.
2. Wire `Now` into a `Compare` to run something for the first ten seconds after boot.
3. Use `Delta` with `Math` `Multiply` to turn a loop count into elapsed time.

## See also

- [Core package](index.md) — value nodes and their units
- [Time package](../time/index.md) — wall-clock time from NTP instead of uptime
- [Graph panel](../../app/graph-panel.md) — the sleep setting that shapes `Delta`


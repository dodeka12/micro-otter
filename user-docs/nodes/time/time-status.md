# Time Status

Reports the epoch, the sync flag and the age of the last successful sync of the time service.

## Inputs

None — the node has no inputs and no controls.

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Epoch` | `int` | current UTC epoch in seconds (derived from the last NTP sync) |
| `Synced` | `bool` | true once the service has synchronised at least once |
| `Age` | `int` | seconds since the last successful sync, or -1 before the first sync |

## Behaviour

- No init phase: reads the running service from wherever the node sits, so it may be placed before or
  after `Time Service`.
- `Epoch` is derived from the last successful sync plus the elapsed ticks, never read back from the
  board clock, so it keeps counting between fetches.
- `Age` is the number of seconds since the last success and `-1` before the first; `Synced` is the
  flag to gate anything that needs a real timestamp.
- Without a `Time Service` in the collection the epoch falls back to the port's own clock and `Synced`
  never turns true.
- Reads are cheap arithmetic, so the node can sit in a fast `continuous` graph.

## Example

1. Wire `Epoch` into `Clock Parts`, `Date Parts` or `Format Time` when you want one reading instead of
   the moving "now".
2. Wire `Synced` into a `Logic` gate around everything that must not run with an unsynchronised clock.
3. Wire `Age` into a comparison to warn when the clock has not been refreshed for a day.

## See also

- [Time package](index.md) — what the epoch and the age mean
- [Time Service](time-service.md) — the node that synchronises the clock
- [Format Time](time-format.md) — turn the epoch into text


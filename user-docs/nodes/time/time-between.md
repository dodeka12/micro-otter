# Time Between

True while the local time is inside an HH:MM window.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Epoch` | `int` | UTC epoch in seconds |
| `Timezone` | `float` | UTC offset in hours (-12 to +14) |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Active` | `bool` | true while the local time is inside the window |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Start` | text | `08:00` | HH:MM in local time; the start instant is inside the window |
| `End` | text | `17:00` | HH:MM in local time, exclusive; earlier than the start means the window runs past midnight |

## Behaviour

- Pure comparison in the loop: the local minute of the day is tested against `Start` and `End` on
  every pass, with no state across passes.
- `Start` is inside the window, `End` is outside it — `08:00`..`17:00` is already inactive at exactly
  17:00.
- When `End` is earlier than `Start` the window wraps midnight: `22:00`..`06:00` is active at 23:30,
  00:00 and 05:59, inactive at 06:00.
- `Start` equal to `End` is always active, so a zero-length window never silently disables the node.
- Both controls are free text: keep exactly `HH:MM` with two digits each. Anything else raises on the
  device instead of quietly returning false.

## Example

1. Leave `Start` and `End` at `08:00` and `17:00` for a working-hours window, or set `22:00`/`06:00`
   for a night window that wraps midnight.
2. Wire `Active` into `Logic` together with a motion signal to light an LED only at night.
3. Wire `Active` into an event graph gate so the graph sleeps outside the window.

## See also

- [Time package](index.md) — the window rules and the `-1`/`-100` sentinels
- [Clock Parts](time-clock-parts.md) — when you need the hour itself rather than a window
- [Date Parts](time-date-parts.md) — weekday rules next to the time-of-day rule


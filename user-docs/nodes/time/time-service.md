# Time Service

Fetches the time via NTP, sets the device clock to local time and runs in its own background task.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Server` | `string` | SNTP server host name |
| `Interval (min)` | `int` `float` | minutes between two NTP fetches (1 to 1440) |
| `Timezone` | `float` | UTC offset in whole hours for this collection (-12 to +14, half hours allowed) |
| `Enabled` | `bool` | enable the background time synchronisation |

## Outputs

None — the node has no outputs.

## Behaviour

- Init phase: starts the single background task that owns the network; a second `Time Service` node
  joins that task instead of starting another.
- Loop: hands the four inputs to the service and returns immediately — no fetch, no sleep, no
  branching in the loop body.
- Before the first success the task retries after 2, 4, 8 … seconds, capped at 60; afterwards it
  sleeps `Interval (min)` and applies a changed interval within a second.
- Every success also sets the board clock to local time (`UTC + Timezone`); a board without a settable
  RTC keeps running on the internal epoch instead.
- `Enabled` off stops the fetching but leaves the synchronised epoch running, and an empty `Server`
  falls back to the node default.

## Example

1. Add one `Time Service` and set `Timezone` to your offset, for example `1` or `5.5`.
2. Leave `Server` and `Interval (min)` alone unless your network needs an internal NTP host.
3. Add `Time Status` and wire `Synced` into a `Print` while bringing the device up, to see the first
   sync succeed.

## See also

- [Time package](index.md) — retry policy, RTC handling and the sentinel values
- [Time Status](time-status.md) — the epoch, the sync flag and the age of the last sync
- [HA Sensor](../hass/hass-sensor.md) — publish a synchronised timestamp


# Time package

One network-synchronised clock per collection and five pure conversions on top of it: parts of the
clock, parts of the date, a daily window, and a formatted string.

## Setup

| Requirement | Detail |
|---|---|
| Network | only `Time Service` needs `wifi` or `ethernet`; every other node in the package works offline |
| NTP server | `Server` defaults to `pool.ntp.org`; an empty value falls back to it |
| Interval | `Interval (min)` from 1 to 1440, default 60 |
| Timezone | `Timezone` is a fixed UTC offset in hours, −12 to +14, half hours allowed, default 0 |
| Device clock | after every successful sync the service sets the board's RTC to local time; that is best effort and never fatal |
| Retries | before the first success the service retries after 2, 4, 8 … up to 60 seconds; afterwards it sleeps the configured interval |

- There is one service per collection: two `Time Service` nodes still start a single background task.
- The service never blocks the graph loop. It fetches in its own task, and the loop body only hands
  it the current configuration, so a graph that reads the time keeps running while the network is
  down.

## Nodes

| Node | What it does |
|---|---|
| [Time Service](time-service.md) | fetches NTP time in the background, sets the device clock and has no outputs |
| [Time Status](time-status.md) | reports the current epoch, whether a sync ever succeeded, and the age of the last one |
| [Clock Parts](time-clock-parts.md) | splits an epoch into `Hour`, `Minute`, `Second` |
| [Date Parts](time-date-parts.md) | splits an epoch into `Year`, `Month`, `Day`, `Weekday` (0 = Monday) |
| [Time Between](time-between.md) | is the local time inside an `HH:MM` window? |
| [Format Time](time-format.md) | renders an epoch with a small `strftime`-like pattern |

## Shared concepts

- Two conventions carry through every conversion node: `Epoch` = −1 means "use the device clock",
  and `Timezone` = −100 means "inherit the timezone from `Time Service`". Both are the defaults, so a
  node added without wiring already shows local time.
- A literal epoch also works — feed the `Epoch` output of `Time Status` into `Clock Parts` when you
  want a value that was read once rather than "now" on every pass.
- `Time Between` accepts a window that crosses midnight (`22:00` to `06:00`), treats `End` as
  exclusive, and treats `Start` equal to `End` as always active.
- `Format Time` knows `%Y %m %d %H %M %S %j %%`; an unknown specifier is echoed unchanged instead of
  raising, so a typo cannot break the loop.
- Before the first sync `Synced` is false and `Age` is −1. Gate anything that depends on a real
  timestamp on `Synced` rather than on `Epoch` being non-zero.

## Related

- [hass package](../hass/index.md) — publish a formatted time as a sensor
- [vars package](../vars/index.md) — store the window result between loops
- [Graph panel](../../app/graph-panel.md) — execution types for the graphs that use these nodes

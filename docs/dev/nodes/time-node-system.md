# Time Node System

This document describes the `time` node package: one collection-wide NTP clock plus pure
clock/date/window/format conversions on top of it.

## Overview

The package has exactly one job: give every graph the same, synchronised notion of "now" without
any blocking call in the loop body. It does that with one service node that owns the network side
and five conversion nodes that are pure arithmetic.

| Node | Purpose | Outputs | Capabilities |
| --- | --- | --- | --- |
| `time-service` | Fetches NTP time in its own background task, keeps the internal epoch and sets the device clock to local time | none | `[["wifi", "ethernet"]]` |
| `time-status` | Reports the running service | `epoch`, `synced`, `age` | none |
| `time-clock-parts` | Local hour/minute/second of an epoch | `hour`, `minute`, `second` | none |
| `time-date-parts` | Local date of an epoch | `year`, `month`, `day`, `weekday` | none |
| `time-between` | Is the local time inside an `HH:MM` window? | `active` | none |
| `time-format` | `strftime`-like text of an epoch | `text` | none |

Only `time-service` declares a capability requirement, so every conversion node stays usable on a
target without networking. The package manifest itself deliberately carries no
`requiredCapabilities`.

## Scope

The package lives under `src/micro_otter/nodes/device/node_pkgs/time/`:

- Node definitions: `node_definitions.json`
- Generators: `node_generators.js`
- Capability checks: `node_capabilities.js` (no bespoke checks — the requirement is declarative)
- Icons: `icons/` (`schedule`, `sync`, `timer`, `calendar_month`, `hourglass_bottom`, `text_fields`)
- Runtime: `otter_time/`

## Runtime modules

- `otter_time/parts.py` — pure calendar arithmetic. It imports nothing (no `time`, no `machine`,
  no `network`, not even the service), which is why it is unit-tested on CPython and reused by
  every conversion node.
- `otter_time/service.py` — the singleton. All state lives in module globals, so
  `import otter_time.service as _time_srv` sees one clock per program, and every function is
  idempotent.
- `otter_time/__init__.py` — re-exports both (`__all__ = ['parts', 'service']`).

The frozen `mpAssets` list (every `time` node needs all three modules, so the wildcard key is used
the way `vars` and `mqtt` use it):

```json
"mpAssets": {
  "*": ["otter_time/__init__.py", "otter_time/parts.py", "otter_time/service.py"]
}
```

## Time contract

- An **epoch** is a UTC timestamp in whole seconds since 1970-01-01T00:00:00Z and may be negative
  (dates before 1970 are valid).
- A **timezone** is a fixed UTC offset in hours, `-12` ... `+14`, half hours allowed.
- `weekday` is `0` for Monday ... `6` for Sunday (ISO order), stated on the connector.
- **`epoch` input default `-1`** means "use the device clock", i.e. the service's current epoch.
  A literal `-1` and an unconnected input behave identically, and both `-1` and `-1.0` resolve
  through `service.epoch_or_now()`, which compares numerically (`value < 0`).
- **`timezone` input default `-100`** means "inherit the timezone of the `time-service` node".
  Any value in `-12` ... `+14` is a literal offset; anything below `-12` cannot be a real offset,
  so it means "inherit" and `-100` is merely the conventional way to write that. Values above
  `+14` are clamped to `+14`. `service.timezone_from_argument()` is the single place implementing
  this.
- Epoch readings are always **derived** (`fetched_epoch + ticks_diff`) and never read back from
  `time.time()`, so the package is independent of the port's epoch base. Before the first sync the
  port's own clock is the fallback.

The parts module keeps these rules testable without hardware:

| Function | Result |
| --- | --- |
| `days_from_civil(y, m, d)` / `civil_from_days(days)` | Hinnant's civil-date pair, no leap-year table |
| `weekday_index(days)` | `0` = Monday ... `6` = Sunday |
| `clock_parts(epoch, offset_hours=0)` | `(hour, minute, second)` |
| `date_parts(epoch, offset_hours=0)` | `(year, month, day, weekday)` |
| `hour/minute/second/year/month/day/weekday` | single values, for readable generated code |
| `minute_of_day(epoch, offset_hours=0)` | `0` ... `1439` |
| `parse_hhmm('08:00')` | minutes of day; raises `ValueError` on malformed input |
| `between(epoch, offset_hours, start, end)` | `bool` |
| `day_of_year(epoch, offset_hours=0)` | `1` ... `366` |
| `format_time(epoch, offset_hours, pattern)` | `str` |

## Service behaviour

- **Its own task.** `init_time()` calls `service.start()`, which creates one `uasyncio` task.
  `start()` is idempotent, so two `time-service` nodes still create one task. Without a running
  event loop (host tooling, unit tests) no task is created and the next `configure()` call from
  inside the graph loop retries -- `start()` never blocks and never fetches inline.
- **Configuration only in the loop.** `configure(server, interval_minutes, timezone_hours,
  enabled)` stores clamped values and returns; it never fetches, never sleeps and never blocks.
- **Network gate.** Before a fetch the task checks `network.WLAN(network.STA_IF).isconnected()` and
  `network.LAN().ifconfig()[0]` defensively. A port without a `network` module reports ready, so a
  failure shows up in the log instead of the service idling invisibly.
- **Backoff before the first success.** Unreachable network or failing fetch: sleep 2, 4, 8 ... 60 s
  (capped) and retry. After the first success the sleep is the configured interval (1 ... 1440
  minutes, default 60), chunked into 1 s slices so a changed interval applies within a second.
- **Device clock.** After every successful fetch the service sets the device clock to **local**
  time (`UTC + timezone`) through `machine.RTC().datetime((year, month, day, weekday + 1, hour,
  minute, second, 0))`; MicroPython's RTC counts weekdays `1`-`7`, so the ISO index is shifted by
  one. This is best effort: a missing `machine` module, a port without a settable RTC or an
  `OSError` is swallowed and the internal epoch keeps running.
- **Logging.** Progress and failures go through `tools.runtime_log.log_plain()` with the source
  `time` -- `info` for a successful sync, `warning` for an attempt that will be retried. Lines stay
  on one physical line; there is no bracketed ad-hoc tag.

## Loop contract

The generated loop contains exactly one statement per `time-service` node:

```python
_time_srv.configure(server='pool.ntp.org', interval_minutes=60, timezone_hours=0, enabled=True)
```

That is a keyword-argument call built from the four inputs; an input the transpiler cannot resolve
(`None`) is dropped so the service default stays in place. No fetch, no `sleep`, no `while` and no
branching appears in the loop body -- reading the time is a delta computation on demand.

## Node reference

### `time-service`

Round node, `icons/schedule_24dp.svg`, no outputs, `requiredCapabilities: [["wifi", "ethernet"]]`.

| # | Input | Type | Default | Control |
| --- | --- | --- | --- | --- |
| 0 | `server` | string | `pool.ntp.org` | `text`, placeholder `pool.ntp.org` |
| 1 | `interval` | int/float | `60` | `number`, min 1, max 1440, step 1 (minutes) |
| 2 | `timezone` | float | `0` | `number`, min -12, max 14, step 0.5 |
| 3 | `enabled` | bool | `true` | `checkbox` |

The node has no outputs, so the init/loop split is the whole contract: init starts the background
task, the loop only updates the configuration.

### `time-status`

Square node, `icons/sync_24dp.svg`, no inputs, three outputs:

| # | Output | Type | Meaning |
| --- | --- | --- | --- |
| 0 | `epoch` | int | current UTC epoch (derived from the last sync) |
| 1 | `synced` | bool | `True` once the service synchronised at least once |
| 2 | `age` | int | seconds since the last successful sync, `-1` before the first |

It reads the running service, so a graph may place it before or after the `time-service` node.

### `time-clock-parts` and `time-date-parts`

Square nodes (`icons/timer_24dp.svg`, `icons/calendar_month_24dp.svg`) with the same two inputs:

| # | Input | Type | Default | Control |
| --- | --- | --- | --- | --- |
| 0 | `epoch` | int | `-1` | `number`, min -1 (`-1` = device clock), max 4102444800, step 1 |
| 1 | `timezone` | float | `-100` | `number`, min -100 (`-100` = inherit), max 14, step 0.5 |

Outputs: `time-clock-parts` -> `hour`, `minute`, `second`; `time-date-parts` -> `year`, `month`,
`day`, `weekday` (all `int`).

### `time-between`

Square node, `icons/hourglass_bottom_24dp.svg`, the same two inputs plus two **controls** and one
`bool` output `active`.

| Control | Default | Meaning |
| --- | --- | --- |
| `start` | `08:00` | `HH:MM` local time, inside the window |
| `end` | `17:00` | `HH:MM` local time, **exclusive** |

Window rules (`parts.between`):

- `start < end` -> plain window: active from `start` until `end`, `end` itself is outside.
- `start > end` -> the window wraps midnight (`22:00` -> `06:00` is active at 23:30, 00:00 and
  05:59, inactive at 06:00).
- `start == end` -> always active, so a zero-length window never silently disables the node.

A malformed control value raises `ValueError` in `parse_hhmm`; the node definitions only produce
valid values, so this is a programming error rather than a user-input path.

### `time-format`

Square node, `icons/text_fields_24dp.svg`, the same two inputs plus the `pattern` control
(default `%Y-%m-%d %H:%M:%S`) and one `string` output `text`.

| Specifier | Meaning |
| --- | --- |
| `%Y` | year, four digits |
| `%m` | month, `01`-`12` |
| `%d` | day of month, `01`-`31` |
| `%H` | hour, `00`-`23` |
| `%M` | minute, `00`-`59` |
| `%S` | second, `00`-`59` |
| `%j` | day of year, `001`-`366` |
| `%%` | a literal `%` |

An unknown specifier is emitted verbatim (`%q` stays `%q`) instead of raising, so a typo in a
control value cannot break the loop.

## Generated code shape

A graph with all six nodes (the `time-clock-parts.hour` output feeding `time-between.epoch`)
transpiles to:

```python
# Imports
import otter_time.parts as _parts
import otter_time.service as _time_srv
import uasyncio as asyncio

# Shared init: init_time
async def init_time():
    _time_srv.start()

# Graph: time
async def time():
    while True:
        # time-service [time-service]
        _time_srv.configure(server='pool.ntp.org', interval_minutes=60, timezone_hours=0, enabled=True)
        # time-status [time-status]
        node_2_out0 = _time_srv.now()
        node_2_out1 = _time_srv.synced()
        node_2_out2 = _time_srv.age()
        # time-clock-parts [time-clock-parts]
        node_3_out0, node_3_out1, node_3_out2 = _parts.clock_parts(_time_srv.epoch_or_now(-1), _time_srv.timezone_from_argument(-100))
        # time-date-parts [time-date-parts]
        node_4_out0, node_4_out1, node_4_out2, node_4_out3 = _parts.date_parts(_time_srv.epoch_or_now(-1), _time_srv.timezone_from_argument(-100))
        # time-format [time-format]
        node_6_out0 = _parts.format_time(_time_srv.epoch_or_now(-1), _time_srv.timezone_from_argument(-100), '%H:%M')
        # time-between [time-between]
        node_5_out0 = _parts.between(_time_srv.epoch_or_now(node_3_out0), _time_srv.timezone_from_argument(-100), '22:00', '06:00')
        await asyncio.sleep_ms(100)

# Main entry point - called by runtime framework
async def run():
    await init_time()
    await time()
```

Contract points that the shape encodes:

- one `import otter_time.service as _time_srv` and one `import otter_time.parts as _parts` per
  program (`registerImport` de-duplicates), and one `_time_srv.start()` in the shared
  `init_time()`;
- the `configure(...)` statement precedes every conversion statement of the same pass, so a
  timezone or interval change applies immediately;
- multi-output nodes become one tuple assignment (`clock_parts` -> three names, `date_parts` ->
  four), single-output nodes one assignment;
- both sentinels survive as literals (`-1`, `-100`) and are resolved by the two service functions,
  so a connected epoch is wrapped in `epoch_or_now(...)` exactly once and a connected timezone in
  `timezone_from_argument(...)`.

## Limitations

- **Fixed UTC offset, no DST.** A hand-entered offset has to be adjusted across a DST change.
- **No sub-second scheduling.** Precision is bounded by the `ticks_ms` wrap and the sync interval;
  the epoch is right for clock display, date display and time windows, not for sub-second timing.
- **`time-service` is optional.** Without it the conversion nodes use the port's own clock as the
  epoch and the timezone defaults to `0`.
- **`ntptime` is not used.** It ignores the configured server on several ports and does not return
  the fetched value, so the epoch could not be derived; the 48-byte SNTP query is hand-written.

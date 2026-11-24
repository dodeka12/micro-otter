# Changes since version 1.26.0

## New Features

- **New `time` node package** — one collection-wide NTP clock plus pure conversions on top of it.
  The package ships six node types: `time-service` (fetches SNTP time in its own `uasyncio` task,
  keeps the epoch as `fetched_epoch + ticks_diff`, sets the device clock to local time, no
  outputs), `time-status` (`epoch`/`synced`/`age`), `time-clock-parts`
  (`hour`/`minute`/`second`), `time-date-parts` (`year`/`month`/`day`/`weekday`),
  `time-between` (an `HH:MM` window, end exclusive, wrapping past midnight, `start == end` = always
  active) and `time-format` (a small `strftime`-like pattern: `%Y %m %d %H %M %S %j %%`, unknown
  specifiers pass through).
- **Two input sentinels, resolved in exactly one place** — `epoch` defaults to `-1` ("use the
  device clock") and `timezone` defaults to `-100` ("inherit the `time-service` timezone"); both
  compare numerically, so the float literals the transpiler emits (`-1.0`, `-100.0`) behave like
  the integers. A literal timezone is a fixed UTC offset clamped to −12 … +14.
- **The loop never fetches** — the generated init block calls `_time_srv.start()` once in a shared
  `init_time()`, while the loop body only emits one
  `_time_srv.configure(server=…, interval_minutes=…, timezone_hours=…, enabled=…)` per
  `time-service` node plus one expression per conversion output. Unreachable network and failed
  fetches back off 2, 4, 8 … 60 s before the first success, after which the configured interval
  (1 … 1440 minutes) applies; long sleeps are chunked so a changed interval lands within a second.
- **Nothing to configure to get started** — the service defaults to `pool.ntp.org` every 60
  minutes at offset 0, and the five conversion nodes work without a `time-service` node (the epoch
  then falls back to the port clock and the timezone to 0).

## Internal

- `otter_time/parts.py` is dependency-free integer arithmetic (Hinnant's `days_from_civil` /
  `civil_from_days`, weekday `0 = Monday`) and is tested on CPython; `otter_time/service.py` holds
  the singleton state and the hand-written 48-byte SNTP query (`ntptime` ignores the configured
  server on several ports and does not return the fetched value, so the epoch could not be derived
  from it). Epoch readings are always derived, never read back from `time.time()`.
- The device clock is set best effort to **local** time through `machine.RTC().datetime(...)` with
  the MicroPython weekday offset (`0` = Monday becomes `1`); a port without a settable RTC keeps
  running on the derived epoch. Sync outcomes are logged through
  `tools.runtime_log.log_plain(..., 'time', ...)` (`info` on success, `warning` on a retry).
- The package is registered in `node_pkgs/index.json` and in
  `runtime/general/manifest.json → nodePackages.global`; `requiredCapabilities: [["wifi",
  "ethernet"]]` is declared on the `time-service` node only, so the conversion nodes stay usable on
  a target without networking. `time` 0.13.1 (new package), runtime `general` 1.51.0.

## Documentation

- `docs/dev/nodes/time-node-system.md` documents the node set, the `-1`/`-100` sentinels, the
  timezone semantics, the device-clock behaviour, the `HH:MM` window rules, the `format_time`
  specifier table and the exact generated-code shape; it is linked from `docs/dev/nodes/index.md`
  and the `time` source is listed in
  `docs/dev/device-communication/log-prefix-conventions.md`.

## Tests

- `tests/test_time_parts.py` (civil dates, clock/date parts, window rules, formatting),
  `tests/test_time_service.py` (SNTP query, configuration and sentinels, derived clock with a
  `ticks_ms` wrap, backoff schedule, chunked sleep, `machine.RTC` handling),
  `tests/proc/time-package-scaffold.test.js`, `tests/proc/time-package-registration.test.js`,
  `tests/proc/time-node-definitions.test.js`, `tests/proc/time-generators.test.js` and
  `tests/proc/time-transpiler-integration.test.js`.

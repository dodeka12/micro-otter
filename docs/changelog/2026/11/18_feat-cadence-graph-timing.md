# Changes since version 1.27.0

## New Features
- **The graph interval is a true cadence** — the configured value is now the period between the start
  of consecutive loop iterations, so a graph whose body takes 5 ms with an interval of 100 ms runs
  every 100 ms instead of every 105 ms.
- **0 ms intervals are supported** — an interval of `0` generates a yield-only loop that awaits
  `asyncio.sleep_ms(0)` once per iteration, so a graph can run as fast as the scheduler allows
  without adding a delay.

## Breaking Changes
- **"Sleep Duration" is now "Interval (ms)"** — both the graph settings view and the graph panel
  toolbar use the new label and a description that explains cadence and the `0` value; the locale
  keys are unchanged, so saved UI state and translations keep working.
- **The interval range is `0–60000` ms** — the control floor drops from 10 ms to 0 ms and
  `NodeGraph` no longer has a 1 ms floor without a ceiling; values above 60000 ms are clamped.
- **Generated loops use deadline scheduling** — continuous graphs now track `_next_run_ms` with
  `utime.ticks_ms()`, `utime.ticks_add()`, and `utime.ticks_diff()`, so a graph with interval `I`
  takes `I` per iteration instead of `I` plus the body time; an overrun restarts the cadence from the
  current time without a catch-up burst.
- **Blank or invalid input falls back to 500 ms** — an empty field never writes and restores the
  graph value, while non-numeric input resolves to `DEFAULT_SLEEP_MS` (`500`) instead of `10` or `0`.

## Refactor
- **One shared interval contract** — `NodeGraph`, `GraphSettingsView`, the graph panel toolbar, and
  the transpiler all resolve the interval through `clampSleepDuration()` in
  `js/data/graph-execution-settings.ts`, so the generated period always matches what the settings
  surfaces show.

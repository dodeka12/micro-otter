# Changes since version 1.36.0

## New Features
- **Line Graph Web View node** — `graph-display` draws a single-series 2D line graph from a `y`
  array or an `x`+`y` array pair, where an unconnected `x` array falls back to the original `y`
  indices and non-finite pairs are dropped · the graph title comes from a `title` string connector
  with a text default control, matching the `title-content` pattern · each axis has an
  `Automatic`/`Manual` range mode whose manual bounds only appear in manual mode, plus axis labels,
  a pixel height, a line colour, a tick count, and a `maxPoints` tail cap · the canvas redraws on
  every refresh and on resize, and the node is read-only with no `changed` output and no store
  writes.
- **Web View graph runtime** — the webview package ships `otter_webview/graph.py` through the
  `graph-display` `mpAssets` variant (version `1.43.4`); `build_series(x_values, y_values,
  max_points)` prepares equal-length float lists on the device, caps the tail at `maxPoints`
  (`256` by default, `2..2048`) and returns empty lists for missing data instead of failing.
- **`[wv-perf]` refresh diagnostics** — the generated `webview_client.js` exposes a measurement
  harness (`window.__wvPerfStats`, `__wvPerfSummary()`, `__wvPerfReport()`) that can log one `recv
  #<n>` line per refresh with cadence gap, request/body/apply durations, payload bytes, slow streak and
  the next scheduled delay, plus `[wv-perf]` phase buckets (`poll:*`, `apply:*`, `graph:draw:*`); the
  counters always accumulate but console output is opt-in via `localStorage.setItem("wvPerf", "1")`
  and a reload, and `__wvPerfReport()` prints one snapshot on demand.

## Bug Fixes
- **Web View console noise** — the generated client no longer writes `[wv-perf]` cadence, summary or
  graph-draw lines to the console on a deployed device: logging is opt-in per browser, and the
  `console.table` phase dump now honours the same switch instead of printing on its own every 50
  receives.
- **Web View refresh floor** — the web-root node clamps `refreshIntervalMs` to a 100 ms minimum (and a
  60 s maximum) on every path, including when its controls are normalized without the shared helper
  handoff, so a stored or typed sub-100 ms value can no longer poll faster than the device answers.
  The graph editor's number control now enforces the same bounds: it reads `min`/`max`/`step` from
  the node definition (previously only from an unused nested `constraints` object, so the bounds were
  ignored), applies them to the input element, and clamps the stored value while typing and again on
  close, so typing `5` leaves `100` behind instead of an out-of-range poll interval.
- **Keep-alive close announcement** — a connection that reaches `_MAX_REQUESTS_PER_CONNECTION` now
  sends its final response with `Connection: close` and no `Keep-Alive` header instead of advertising
  a reuse the server has already ruled out, so a client that ignores `max=` cannot lose a request to
  the closing socket.
- **Per-request serial noise** — the web server no longer prints `[info] ws: <method> <path>` for every
  request. At the webview's ~10 Hz poll that line alone drowned the serial console; request
  visibility stays available through the sampled `[data] ws-trace: request-received` line when
  `log_requests` (or `log_frequent_messages`) is enabled.
- **Web View refresh cadence** — the generated client now completion-chains `pollRefresh()`, so the
  next request is scheduled from the current one's `finally` block instead of a fixed timer that
  skipped in-flight ticks; `refreshIntervalMs` is a floor on the period between poll *starts*, the
  slow-response backoff threshold is floored at 1 s (`max(2 * interval, 1000)`) so an ordinary
  200–400 ms ESP32 round trip no longer escalates it, and the 5 s timeout now also covers the response
  body so a stalled body cannot leave the loop permanently in-flight. A 100 ms interval that used to
  sawtooth between 200 ms and 500 ms now polls at the measured round trip (about 250 ms) with no
  backoff.
- **Line Graph canvas fit** — the `graph-display` canvas now takes its width from its own laid-out box
  instead of the card's `clientWidth`, keeps its `width: 100%` layout width, and never writes an inline
  pixel width, so it can no longer paint over the card's right padding and border · axis gutters are
  measured from the rendered tick labels (a 16 px caption band plus the widest y label, clamped to
  45 %/25 % of the canvas width) and tick labels are drawn with a `maxWidth` safety net, so wide labels
  such as `-1000000` and the last x tick stay inside the canvas instead of being clipped.


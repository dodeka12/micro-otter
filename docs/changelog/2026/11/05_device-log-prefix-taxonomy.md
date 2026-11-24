# Changes since version 1.26.0

## Improvements

- **One canonical device log taxonomy, enforced by a test** — device lines are classified
  by their leading tag, but the host parser only knew `user`, `system`, `error`, `warning`,
  `info`, `debug` and `otter` while the console offered `success`, `data` and `raw` on top.
  A `[success] …` line therefore fell into `raw`, `[debug]` was parsed and then silently
  rewritten to `info`, and every ad-hoc tag (`[web-server]`, `[wv-refresh]`, `[web]`,
  `[WiFi]`, `[servo]`, `[diag]`, …) was invisible in every filter. The taxonomy is now
  `system`, `otter`, `info`, `warning`, `error`, `success`, `data`, `user`, `raw` is the
  bucket for everything else, and `tests/test_log_prefix_contract.py` fails when the device
  declarations, the host parser, the console filters and the docs disagree.
- **The host parses the tag list it filters on** — `LOG_PREFIXES` in
  `serial/device-connection.ts` is the single source for the message pattern, so `[success]`
  and `[data]` lines now reach their own console filters; `MessageType` gained
  `SUCCESS`/`DATA` and lost the unused `DEBUG`.
- **`log_plain()` refuses to invent a bucket** — an unknown level (`debug`, a typo) is
  normalised to `info` instead of printing a line the console shows under `raw`.
  `PLAIN_LEVELS` in `tools/runtime_log.py` declares the set.
- **Emitters reclassified where the tag was wrong** — `[info]` lines that reported failures
  became `[error]` (`service-controller: start failed`/`stop failed`), completions became
  `[success]` (`started`, `connect: ok`, `subscribe: … ok`, `publish: first ok`,
  `AP started ip=…`, `station connected ip=…`, `hass: connected`), recoverable degradation
  became `[warning]` (`settings: load failed, using defaults`, station connect retries,
  `keepalive: link torn down …`), and high-volume traces became `[data]`
  (`ws-trace`, `wv-refresh`, `wv-input`, `webview-hook`, `radar`, `io-queue`,
  `message: topic='…' payload='…'`).
- **No more ad-hoc tags in runtime code** — `[web-server]` → `[data] ws-trace:`,
  `[web]` → `[info] web:`, `[WiFi]` → `[level] wifi:` (level derived from the status state),
  `[servo]`/`[servo-node]` → `[error] servo:`/`[error] servo-node:`, the LED drivers' bare
  `print(message)` → `[warning] led:`, `[otter] radar` → `[data] radar:`. The generated
  `boot.py`/`main.py` banners and the `main.py` shim now use `[system] boot: …` and
  `[error] boot: …`.
- **Docs** — new
  [log-prefix-conventions.md](../../../dev/device-communication/log-prefix-conventions.md)
  with the taxonomy table, the rule for choosing a tag, source naming, the four declarations
  that must stay in sync and the list of print paths that stay `raw` by design (vendored
  `umqtt`, REPL tools, tracebacks).
- **Tests** — `[success]`/`[data]` parsing plus `[debug]`-stays-raw in
  `tests/serial/device-connection-message-parsing.test.js`; level assertions in the MQTT
  service/runtime, web-server trace and firmware-shim tests; new
  `tests/test_log_prefix_contract.py`.

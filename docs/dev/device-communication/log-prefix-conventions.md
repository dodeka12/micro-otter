# Device Log Prefix Conventions

Every line the device prints to the serial console is classified by a single tag at
the start of the line:

```
[<level>] <source>: <message>
```

The device log view turns that tag into a filter, an icon and a colour. A line whose
tag is **not** in the table below — a stray `[WiFi]`, a `[diag]` from a REPL tool, a
MicroPython traceback frame — is shown in the **`raw`** filter instead, where nobody
looks for a failure. That is the whole reason this page exists: the tag is a contract
between device code and UI, and it silently degrades when it is wrong.

## The taxonomy

| Tag | Use for | Typical source |
| --- | --- | --- |
| `[system]` | Device session and runtime-shell lifecycle: boot banners, "ready", "no runtime installed" | generated `boot.py`/`main.py` |
| `[otter]` | Micro-Otter structured JSON events, one per event | `tools.runtime_log.log_event()` and friends |
| `[info]` | Normal progress of a running subsystem | service controller, WiFi bring-up, MQTT, web server |
| `[warning]` | Degraded but still running: a fallback, a retry, a missing optional capability | `… using defaults`, station connect retries, host-only LED simulation |
| `[error]` | A line of work failed and nothing retries it | service start/stop failures, connect failures, servo write errors |
| `[success]` | An operation completed | `connected`, `started`, `subscribed`, `AP started ip=…` |
| `[data]` | Value and payload dumps, high-volume traces (filtered out by default) | request/response traces, `payload='…'`, value snapshots |
| `[user]` | Output produced by the collection itself | `Print` node, user code in `app/main_loop.py` |
| `raw` | Not a tag — the bucket for everything else | tracebacks, vendored third-party output, REPL tools |

## Choosing a tag

1. **Does the line report that something the app asked for did not happen?** → `error`.
   A failure that a retry loop or supervisor will handle is `warning`, not `error`.
2. **Did the operation complete?** → `success`. Reserve it for completions the user
   waits for (connected, started, announced), not for every step.
3. **Is it a value, payload or per-request trace?** → `data`. These are the lines the
   user turns off when the console gets noisy.
4. **Is it a lifecycle banner?** → `system` for boot/session, `info` for a subsystem
   that is starting or stepping.
5. **Everything else in a subsystem** → `info`.

Rules that follow from this:

- **One physical line.** A newline inside the message splits the entry and the
  continuation lines lose their tag. Collapse tracebacks (`describe_exception()` in
  `tools/runtime_log.py`, `" ".join(text.splitlines())`) before printing.
- **Never two tags.** `[otter] [error] …` is parsed as one `otter` line.
- **A swallowed failure needs a plain line too.** JSON events land in the generic
  `otter` filter; a subsystem that refused to start must additionally print an
  `[error] <source>: …` line. Use `log_plain()` for that.
- **Throttle, don't drop the tag.** The high-volume paths (web request traces, MQTT
  payloads, webview refreshes) log the first occurrence and then every N-th; they keep
  the `data` tag so the user can still see them on demand.

## Source naming

Use the subsystem name as `<source>`, lowercase and hyphenated: `ws`, `wi`,
`webserver-service`, `service-controller`, `mqtt-service`, `mqtt`, `hass`, `wifi-boot`,
`wifi`, `servo`, `led`, `time`, `io-queue`, `radar`, `wv-refresh`, `webview-hook`.
`[otter]` events carry their source in the JSON payload instead.

## Where the taxonomy lives

The same list is declared in four places; `tests/test_log_prefix_contract.py` fails if
any of them drifts:

| Declaration | File | Meaning |
| --- | --- | --- |
| `PLAIN_LEVELS` | `src/micro_otter/nodes/device/tools/runtime_log.py` | levels device code may pass to `log_plain()`; anything else is normalised to `info` |
| `LOG_PREFIXES` | `src/micro_otter/nodes/html/js/serial/device-connection.ts` | tags the host parses into typed console messages |
| `MessageType` | `src/micro_otter/nodes/html/js/serial/device-connection.ts` | tags that can reach the view, plus `raw` |
| `DEFAULT_MESSAGE_TYPES` | `src/micro_otter/nodes/html/js/views/console-log-view.ts` | filter entries the user can select |

The same test also scans the device runtime, the node packages and the embedded
runtime assets for `[tag]` literals outside the taxonomy, so a new ad-hoc tag fails
the build instead of quietly landing in `raw`.

## Out of scope

These print in their own format and are expected to show up under `raw`:

- REPL-only tools typed by hand: `tools/wifi_diag.py` (`[diag]`), `tools/wifi_probe.py`,
  `tools/set_wifi.py`, `tools/runtime_info.py`.
- The vendored MicroPython client `node_pkgs/mqtt/otter_mqtt/umqtt/` (upstream code).
- MicroPython tracebacks and the REPL echo of a command's return value.

## Examples

```python
from tools.runtime_log import log_plain

log_plain("info", "wifi-boot", "connecting station ssid=lab")        # progress
log_plain("warning", "wifi-boot", "station connect failed (OSError: -1)")  # retried
log_plain("error", "controller", "main loop load failed; the app did not start")
print("[success] mqtt-service: start done connected=True")            # completed
print("[data] ws-trace:", "response-timeout", {"request_id": 7})      # trace
```

Node packages that log a lot keep one helper per level so a call site never repeats
the tag:

```python
_LOG_SOURCE = "mqtt"

def _log(level, message):
    print("[{}] {}: {}".format(level, _LOG_SOURCE, message))

def _info(message):     _log("info", message)
def _warning(message):  _log("warning", message)
def _error(message):    _log("error", message)
```

## See also

- [device-tools-reference.md](device-tools-reference.md) — `runtime_log.py` reference.
- [webserial-architecture.md](webserial-architecture.md) — how the console receives the
  bytes and where `_parseMessages()` classifies them.

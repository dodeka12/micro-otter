# Streamed process execution

**Scope:** How the firmware toolchain runs an external command, reports its output while it runs, and
stops it on a cancel or timeout. Applies to the build (`make`/`ninja`) and flash (`esptool`) paths.

## Why one seam

`micro_otter/tools/firmware_compile/process_stream.py` is the only module in `firmware_compile/` that
launches a process on behalf of a backend. Both toolchain paths go through it:

| Caller | Command |
|---|---|
| `backends/esp_idf.py` | the MicroPython `make`/`ninja` build |
| `flash/esptool.py` | `esptool erase-flash` and `esptool write-flash` |

A boundary test (`tests/test_firmware_compile_backend_boundaries.py`) fails if
`build_orchestration.py`, `backends/*.py`, or `flash/*.py` calls `subprocess.run`/`Popen` directly, so
a new adapter gets streaming, cancellation, and timeout behaviour by construction instead of by
copying the plumbing.

## API

```python
from micro_otter.tools.firmware_compile.process_stream import (
    LogCallback,
    ProcessCancelled,
    ProcessTimeout,
    discard_log,
    emit_event,
    run_streamed_process,
    streamed_tool_env,
    strip_ansi,
)
```

`run_streamed_process(*, argv, cwd=None, env=None, log_callback=None, cancel_event=None,
timeout_seconds=None, cancelled_error=ProcessCancelled, timeout_error=ProcessTimeout) -> int`

- `argv` is an argument array; nothing is passed through a shell.
- `env` is the **base** environment: `None` inherits `os.environ`, and `streamed_tool_env()` is layered
  on top of whatever the mapping holds. The streamed defaults win over a caller-supplied value.
- `log_callback` receives `(stream, text)` per line while the process runs, where `stream` is
  `"stdout"` or `"stderr"`. `None` (or `discard_log`) keeps the call fire-and-forget.
- `cancel_event` is polled every 100 ms. A set event terminates the whole process group
  (`SIGTERM`, then `SIGKILL` after a five-second grace) and raises `ProcessCancelled`.
- `timeout_seconds` is a wall-clock budget checked in the same loop; exceeding it terminates the
  group and raises `ProcessTimeout`, which carries `timeout_seconds` and the message
  `process timed out after <n>s`.
- A non-zero exit raises `subprocess.CalledProcessError` with the return code, exactly like
  `check=True`, so callers keep their existing error handling.

`cancelled_error` / `timeout_error` let a caller keep its own vocabulary. The build path passes
`BuildCancelled` (a `ProcessCancelled` subclass) and `BuildTimeout` (a `ProcessTimeout` subclass), so
`compile_command.py` and `firmware_ws_handler.py` still catch those names and the log still reads
`build cancelled` / `build timed out after <n>s`.

## Line splitting and terminal hygiene

The seam reads the child's pipes as **raw bytes** and owns the line splitting, instead of letting
`readline` do it:

- A reader thread calls `pipe.read1(65536)`, which returns as soon as the child writes anything, so a
  single long line never delays the lines behind it.
- `_LineSplitter` decodes UTF-8 incrementally (a character cut by a read boundary is not corrupted)
  and splits the way a console does: `\n` and `\r\n` end a line, and **a bare `\r` rewinds the line
  being built** — the text written after it overwrites the text before it, so only the surviving text
  is published. A tool that redraws one line in place (esptool's `progress_bar` does exactly that)
  therefore costs one log line, not several hundred, and its unterminated tail can no longer be glued
  onto the next real line.
- The splitter holds a `\r` that ends a read until the next read decides whether `\n` follows, so a
  CRLF split across two pipe reads is still one line ending and not a spurious redraw.
- A `\r` that arrives **while the line is still empty** rewinds a line that has already been
  published, which the splitter cannot take back. Such a line is published with its carriage return
  kept in front of the text — `_REDRAW_MARKER` — and the carrier is dropped again if the same line
  overwrites itself later on, because the text after a second `\r` is new content rather than a
  reprint. Under `TERM=dumb` esptool writes `\r<bar>…\n` for **every** progress update, so this marker
  is what lets a log sink rewrite the line it already shows: a run of several hundred updates costs
  one line that advances, not several hundred lines.
- `strip_ansi()` removes CSI/OSC/two-byte escape sequences from every line, and a line that is empty
  after stripping is dropped. The callback always receives `text` ending in `\n`, with no escapes and
  no trailing whitespace; leading whitespace inside a tool's own message is preserved, and a reprint
  keeps its leading `\r`.

The child environment sets four variables so the tools cooperate (see `streamed_tool_env()`):

| Variable | Value | Why |
|---|---|---|
| `PYTHONUNBUFFERED` | `1` | A Python tool would otherwise block-buffer its stdout into the 8 KiB pipe and deliver nothing until it exits. |
| `TERM` | `dumb` | Keeps esptool out of its "smart terminal" mode, where it writes ANSI erase codes and deletes the stage lines it already printed. |
| `NO_COLOR` | `1` | Same: esptool treats `xterm*`/`screen*` as colour-capable even when `stdout` is a pipe. |
| `CLICOLOR` | `0` | Belt and braces for tools that honour `CLICOLOR` instead of `NO_COLOR`. |

The environment is not an optimisation the caller may skip: without it the first `esptool` stage line
of a deploy arrives only when the process exits, which is the "silent until the result" behaviour this
contract exists to prevent.

## Build path

`esp_idf` calls `run_streamed_process` for every non-dry-run build — there is no plain
`subprocess.run` fast path any more. It passes `request.log_callback or discard_log`,
`request.cancel_event`, and `request.timeout_seconds` from the `BuildRequest`, so a CLI run discards
output while the server streams it. `build_orchestration` keeps only the two exception subclasses; the
old `_run_streamed_build` helper is gone, so `esp_idf` names the seam directly.

## Flash path

`FlashRequest.log_callback` is the same `(stream, text)` sink. `esptool` runs its erase and write steps
through the seam and maps `ProcessTimeout` onto `FlashCommandError(exit_code=-1)`, which is the code the
old `subprocess.TimeoutExpired` path produced. The `error` event is still emitted before the adapter
raises. `FirmwareDeployRequest.log_callback` forwards the sink to the `FlashRequest`.

The adapter forwards every line the seam gives it. It parses nothing: a progress-bar line is a log line
like any other, so the Deploy log is a faithful transcript of what the tool printed — its stage
headers, each bar update, and the closing `Wrote … bytes`. Filtering or re-wording a line here would
hide what the tool actually did, and it would tie the adapter to one release's output format.

The protocol stays synchronous: `FlashBackend.flash()` blocks until the tool exits and reports progress
only through `on_event` and `log_callback`.

## Wire format

`(stream, text)` maps onto the existing `output` frame — `{"type": "output", "job": <job>, "stream":
"stdout"|"stderr", "text": <line>}`. `stderr` stays `stderr`; the client marks those lines with a
textual `[stderr]` prefix. `_deploy_event_callback` prefers `event.payload["stream"]` when a flash event
sets it and otherwise derives the stream from the event kind (`error` → `stderr`).

`text` may begin with a single `\r` when the tool reprinted the line before it (`_REDRAW_MARKER`). No
second field carries that meaning: the marker is the carriage return the tool wrote, and a client that
renders a log is expected to rewrite its last line instead of appending a duplicate — that is how a
progress bar stays one line. A client that ignores it merely shows the extra lines a console would.

No percentage travels over the wire: the protocol carries the tool's own words, and a client that wants
a bar can read it from them.

## Invariants

1. Only `process_stream.py` launches a process for a backend.
2. A streamed line reaches the caller before the process exits; a terminal frame never carries output
   that the log never saw.
3. No line waits for the child's buffer to fill: the child is unbuffered (`PYTHONUNBUFFERED=1`) and the
   reader uses `read1`, so a line reaches the sink as soon as the tool finishes it rather than when the
   next one arrives. A reprint reaches it as a reprint — marked with `\r` — instead of being replaced
   by a rewritten history the sink never saw.
4. Cancellation and timeout always terminate the whole process group, never only the direct child.
5. A non-zero exit is reported as `CalledProcessError`, not as a cancel or timeout.

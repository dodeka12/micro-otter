# Changes since version 1.26.0

## Bug Fixes

- **The Home Assistant bridge no longer kills the main loop on startup** — the
  `_sanitize_id()` helper in `otter_hass/runtime.py` classified characters with
  `str.isalnum()`, which MicroPython's `str` does not implement (`py/objstr.c` of v1.29.0
  provides `isspace`, `isalpha`, `isdigit`, `isupper`, `islower` and nothing else). Every boot
  raised `AttributeError: 'str' object has no attribute 'isalnum'` while `app/main_loop.py`
  imported the bridge, so the app never ran and no entity or value was published. The check is
  now `char.isalpha() or char.isdigit()` with the same accepted character set.
- **The supervisor reports why a run failed instead of hitting its own error** — `_stop_main_loop_task()`
  and the `main_loop_task.done()` restart branch in `otter_main.py` inspected the finished task
  with `Task.exception()`, which `uasyncio.Task` does not have; the resulting
  `AttributeError: 'Task' object has no attribute 'exception'` replaced the real exception and the
  controller reloaded in a loop with no usable log line. A new `_collect_task_failure()` awaits
  the finished task, returns what it raised, and lets the caller classify `SystemExit`,
  `KeyboardInterrupt` and cancellation separately, so a genuine failure is logged once and a
  deliberate stop is not treated as a crash.
- **A crashed web server task is reported as itself, not as a start timeout** —
  `wait_until_server_ready()` in `otter_runtime/web_interface.py` used the same missing
  `Task.exception()`; it now awaits `_server_task` inside a `try/except` and propagates the task's
  own error, so a failing `start_server()` surfaces with its traceback instead of a generic
  "server not ready" message.

## Improvements

- **An API-subset guard test stops the next MicroPython-impossible call** — `npm run
  check:device-syntax` only proves that the device tree *compiles*; attribute access is resolved at
  runtime, which is why both calls above passed the gate and failed on hardware.
  `tests/test_device_micropython_api_guard.py` scans every device source file, fails on the
  CPython-only `str` methods (`isalnum()`, `isascii()`, `removeprefix()`, `title()`,
  `translate()`, …) and on `asyncio.Task.exception()`, skips `__pycache__`/`__mpycache__`, and
  accepts a documented `micropython-api-ok` marker per line so real exceptions stay reviewable.
  `tests/test_otter_main_main_loop_logging.py` gained tests for the failure classification.
- **Docs gained the rule, the skill gained the step** —
  [mpy-precompilation/workflow.md](../../../dev/mpy-precompilation/workflow.md#compiled-is-not-available-the-runtime-api-surface)
  now explains why `mpy-cross` cannot catch these calls, lists the two regressions and requires the
  guard test in its validation checklist; the `code` skill requires both gates for every
  device-tree change and a MicroPython source check for each assumed API.
- **Versions** — runtime `general` **1.50.1**, `hass` package **0.9.1**. A firmware rebuild is
  required to ship the fixed sources to the boards, because the device runtime is flashed as
  precompiled bytecode.

# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

import sys

try:
    import ujson as json
except ImportError:  # pragma: no cover - fallback for host tooling
    import json  # type: ignore

try:
    import utime as _time
except ImportError:  # pragma: no cover - fallback for host tooling
    import time as _time  # type: ignore

try:
    from io import StringIO
except ImportError:  # pragma: no cover - MicroPython alias
    from uio import StringIO  # type: ignore

OTTER_PREFIX = "[otter]"
TRACE_LINE_BREAK_TOKEN = "<<NL>>"

#: Levels a plain log line may carry.
#:
#: The device log UI filters by exactly this set (`system`, `otter`, `info`,
#: `warning`, `error`, `success`, `data`); every other line ends up under `raw`.
#: Keep this tuple, `LOG_PREFIXES` in
#: `src/micro_otter/nodes/html/js/serial/device-connection.ts` and the taxonomy in
#: `docs/dev/device-communication/log-prefix-conventions.md` in sync.
PLAIN_LEVELS = ("system", "otter", "info", "warning", "error", "success", "data")


def _now_ms() -> int:
    if hasattr(_time, "ticks_ms"):
        return _time.ticks_ms()  # type: ignore[attr-defined]
    if hasattr(_time, "time"):
        return int(_time.time() * 1000)  # type: ignore[attr-defined]
    return 0


def _sanitize_value(value):
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, (list, tuple)):
        return [_sanitize_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _sanitize_value(val) for key, val in value.items()}
    return str(value)


def _emit(payload: dict) -> None:
    if "ts_ms" not in payload:
        payload["ts_ms"] = _now_ms()
    try:
        message = json.dumps(payload)
    except Exception:
        safe_payload = {str(key): _sanitize_value(val) for key, val in payload.items()}
        message = json.dumps(safe_payload)
    print(OTTER_PREFIX, message)


def _collapse_trace_text(text: str) -> str:
    if not text:
        return ""
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = normalized.split("\n")
    while lines and lines[-1] == "":
        lines.pop()
    if not lines:
        return ""
    return TRACE_LINE_BREAK_TOKEN.join(lines)


def log_event(event: str, **fields) -> None:
    payload = {"event": event, "level": fields.get("level", "info")}
    payload.update(fields)
    _emit(payload)


def log_message(message: str, **fields) -> None:
    log_event("message", message=message, **fields)


def log_startup(phase: str, **fields) -> None:
    log_event("startup", phase=phase, **fields)


def log_wifi_state(state: str, **fields) -> None:
    log_event("wifi", state=state, **fields)


def log_error(message: str, **fields) -> None:
    if "level" not in fields:
        fields["level"] = "error"
    log_event("error", message=message, **fields)


def log_plain(level: str, source: str, message: str) -> None:
    """Print one short, human-readable ``[level] source: message`` line.

    The JSON events above are emitted as ``[otter] {...}``. They carry the full
    traceback, but both the serial console and the web UI show them as one opaque
    blob, so anything that must not be missed (a subsystem that refused to start)
    also gets a plain line tagged with the level the UI filters by: see
    :data:`PLAIN_LEVELS`. An unknown level falls back to ``info`` so a typo cannot
    create a line the device log shows under ``raw``.

    The line must stay on one physical line: a newline inside *message* splits the
    entry and the continuation lines lose their tag. Use :func:`describe_exception`
    to fold a traceback into the message.
    """

    try:
        level = str(level).strip().lower()
        if level not in PLAIN_LEVELS:
            level = "info"
        print("[{}] {}: {}".format(level, source, message))
    except Exception:
        pass


def describe_exception(exc: BaseException, limit: int = 200) -> str:
    """Return a single-line, length-limited ``Type: message`` description of *exc*.

    Intended for plain log lines: tracebacks are collapsed elsewhere and blown up
    many lines, which hides the reason on a narrow serial console.
    """

    try:
        text = "{}: {}".format(type(exc).__name__, exc)
    except Exception:
        text = "unprintable exception"
    text = text.replace("\r", " ").replace("\n", " ").strip()
    if not text:
        text = "no details"
    if len(text) > limit:
        text = text[: limit - 3] + "..."
    return text


def log_exception(event: str, exc: BaseException, **fields) -> None:
    buffer = None
    try:
        buffer = StringIO()
        sys.print_exception(exc, buffer)
        trace = buffer.getvalue()
    except Exception:
        trace = repr(exc)
    finally:
        if buffer is not None:
            buffer.close()
    payload = {
        "event": event,
        "level": fields.pop("level", "error"),
        "message": str(exc),
        "exception": _collapse_trace_text(trace) or "(no traceback available)",
    }
    payload.update(fields)
    _emit(payload)

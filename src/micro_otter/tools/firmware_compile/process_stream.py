"""Shared streamed-subprocess plumbing for the firmware toolchain.

Every toolchain subprocess — the MicroPython ``make``/``ninja`` build and the
``esptool`` erase/write steps — runs through :func:`run_streamed_process`. This
module is the leaf that owns the only ``Popen`` call in ``firmware_compile`` and
knows nothing about builds, flashes, or board targets, so a future toolchain
reuses the streaming, cancellation, and timeout behaviour without importing the
build pipeline.

Failure vocabulary: a non-zero exit keeps raising
``subprocess.CalledProcessError`` so callers keep the ``check=True`` error
handling they already have, while cancellation and timeout raise
:class:`ProcessCancelled` / :class:`ProcessTimeout`. The build path passes its own
subclasses through ``cancelled_error``/``timeout_error`` to preserve the
``BuildCancelled``/``BuildTimeout`` names and messages.

Output is read as raw bytes rather than with ``readline``, because tools redraw one
line in place for progress (esptool's ``progress_bar``). A ``readline`` loop would
publish such a line only when the next write arrived, and would glue the
unterminated tail onto the following real line.

The seam reproduces the one piece of terminal behaviour that formatting depends
on: a bare ``\\r`` returns the carriage to the start of the line, so the text
written after it replaces the text written before it. Only ``\\n`` (or ``\\r\\n``)
ends a line. The overwritten text is dropped here, which makes a log sink read
like a console instead of showing every intermediate redraw.

A tool that reprints a *finished* line (``\\r`` while the line is still empty,
which is how esptool writes every progress-bar update under ``TERM=dumb``) cannot
be collapsed here: the line it rewrites is already published. Such a line keeps
its carriage return as a marker in front of the text, so a sink that keeps a log
can rewrite the line it is showing instead of appending a duplicate — see
:class:`_LineSplitter` and ``docs/dev/firmware-compile/process-streaming.md``.
"""

from __future__ import annotations

import codecs
import os
import re
import signal
import subprocess
import threading
import time
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import BinaryIO

from .backends.base import BuildEvent, StreamCallback

LogCallback = Callable[[str, str], None]
"""Signature for one streamed output line: ``(stream, text)``."""

_CANCEL_POLL_SECONDS = 0.1
"""How often the streaming loop checks the clock and the cancel event."""

_TERMINATE_GRACE_SECONDS = 5.0
"""How long a terminated process group gets before it is killed outright."""

_READ_CHUNK_BYTES = 65536
"""Bytes requested per pipe read; ``read1`` returns as soon as any are available."""

_STREAMED_TOOL_ENV: dict[str, str] = {
    "PYTHONUNBUFFERED": "1",
    "TERM": "dumb",
    "NO_COLOR": "1",
    "CLICOLOR": "0",
}
"""Environment every streamed child gets so its output is line oriented.

``PYTHONUNBUFFERED`` stops a Python tool (esptool is one) from block-buffering its
stdout into an 8 KiB pipe, which would otherwise hold every message back until the
process exits. ``TERM=dumb`` plus ``NO_COLOR`` keep esptool out of its "smart
terminal" mode, where it writes ANSI erase codes and deletes the lines it printed
earlier in the stage (``stage(finish=True)``); in plain mode each stage line and
each progress-bar update is a complete, newline-terminated line.
"""

_LINE_BREAK_PATTERN = re.compile(r"[\r\n]")
"""The two characters that move the carriage in a tool's output.

``\\n`` ends a line; a ``\\r`` that is not followed by ``\\n`` does not, because a
console only returns to column 0 — the text after it overwrites the current line.
"""

_REDRAW_MARKER = "\r"
"""Marker that prefixes a line a tool reprinted over the line before it.

The marker is the carriage return itself, kept in front of the published text. A
sink that keeps a log rewrites its last line instead of appending a duplicate,
which is what a terminal does with esptool's progress bar; a sink that only prints
gets the same effect for free, because a console honours the character.
"""

_ANSI_ESCAPE_PATTERN = re.compile(
    r"\x1b\[[0-9;?]*[ -/]*[@-~]"  # CSI: colours, cursor movement, erase-line
    r"|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)"  # OSC: window title and similar
    r"|\x1b[@-Z\\-_]"  # two-byte escapes
)
"""ANSI escape sequences stripped from streamed lines when a tool ignores the env."""


def streamed_tool_env() -> dict[str, str]:
    """Return the non-interactive, line-oriented environment of a streamed child.

    :func:`run_streamed_process` always layers these values on top of the caller's
    environment, even when the caller supplies its own ``TERM``: the sink is a
    pipe, so a tool that formats for a terminal would emit escape codes and
    overwritten lines. The copy is returned so a caller can inspect or extend it.
    """

    return dict(_STREAMED_TOOL_ENV)


def strip_ansi(text: str) -> str:
    """Return *text* without ANSI escape sequences."""

    return _ANSI_ESCAPE_PATTERN.sub("", text)


def _normalise_line(text: str) -> str:
    """Return one streamed line without escapes or trailing whitespace.

    Leading whitespace is kept: a wrapped toolchain message or a traceback stays
    readable, and a caller that parses a line can still strip what it needs.
    """

    return strip_ansi(text).rstrip()


class _LineSplitter:
    """Split one byte stream into the lines a console would show.

    The splitter decodes incrementally so a multi-byte UTF-8 character cut by a
    read boundary is not corrupted, and it keeps the unterminated tail until the
    stream closes or a line ends.

    It also models the carriage: ``\\n`` and ``\\r\\n`` end a line, while a bare
    ``\\r`` returns to column 0 of the line being built, so the text accumulated
    before it is overwritten and never published. A ``\\r`` at the end of the
    available text is held until the next read decides whether an ``\\n`` follows.

    A ``\\r`` that arrives while the line is still empty rewrites a line that has
    already been published, which this splitter cannot take back. Such a line is
    published with :data:`_REDRAW_MARKER` in front of it so the sink can rewrite it,
    and that marker is dropped again if the same line overwrites itself later on:
    the text after a second ``\\r`` is new content, not a reprint.
    """

    def __init__(self) -> None:
        """Start with an empty decoder and no pending text."""

        self._decoder = codecs.getincrementaldecoder("utf-8")("replace")
        self._pending = ""
        self._redraw = False

    def feed(self, chunk: bytes) -> list[str]:
        """Return every line *chunk* completed, in order."""

        self._pending += self._decoder.decode(chunk)
        return self._drain()

    def flush(self) -> list[str]:
        """Return the unterminated tail, once the stream closed."""

        self._pending += self._decoder.decode(b"", final=True)
        lines = self._drain(final=True)
        self._pending = ""
        return lines

    def _commit(self, text: str) -> str:
        """Return one finished line, marked when it reprints the line before it."""

        redraw, self._redraw = self._redraw, False
        if not redraw or not text:
            return text
        return f"{_REDRAW_MARKER}{text}"

    def _drain(self, *, final: bool = False) -> list[str]:
        """Publish every line the buffered text has completed.

        With ``final`` set, a trailing ``\\r`` is consumed as a cursor move with
        nothing written after it: the console keeps the text before it.
        """

        lines: list[str] = []
        while True:
            match = _LINE_BREAK_PATTERN.search(self._pending)
            if match is None:
                break
            index = match.start()
            if self._pending[index] == "\n":
                lines.append(self._commit(self._pending[:index]))
                self._pending = self._pending[index + 1 :]
                continue
            following = self._pending[index + 1 : index + 2]
            if following == "":
                if final:
                    # A trailing ``\r`` moves the cursor with nothing written
                    # after it, so the console keeps the text before it.
                    self._pending = self._pending[:index]
                # Otherwise the next read decides: ``\r\n`` ends the line, a bare
                # ``\r`` rewinds it. Hold both characters until then.
                break
            if following == "\n":
                lines.append(self._commit(self._pending[:index]))
                self._pending = self._pending[index + 2 :]
                continue
            # A bare carriage return. At the start of the line it reprints a line
            # that is already published, so the sink is asked to rewrite it;
            # anywhere else it only overwrites text this line already holds, which
            # nothing has seen yet and which therefore leaves nothing to rewrite.
            self._redraw = index == 0
            self._pending = self._pending[index + 1 :]
        if final:
            lines.append(self._commit(self._pending))
            self._pending = ""
        return [line for line in map(_normalise_line, lines) if line.strip()]


class ProcessCancelled(RuntimeError):
    """Raised when the caller's ``cancel_event`` fired while the process ran."""

    def __init__(self, message: str = "process cancelled") -> None:
        """Record the cancellation message."""

        super().__init__(message)


class ProcessTimeout(RuntimeError):
    """Raised when the process exceeded its ``timeout_seconds`` budget."""

    def __init__(self, timeout_seconds: float, message: str | None = None) -> None:
        """Record the budget that was exceeded and the message to report."""

        self.timeout_seconds = timeout_seconds
        super().__init__(message or f"process timed out after {timeout_seconds:g}s")


def discard_log(stream: str, text: str) -> None:
    """Accept one streamed line without doing anything with it."""

    return None


def emit_event(callback: StreamCallback | None, event: BuildEvent) -> None:
    """Deliver *event* to *callback* when one is configured."""

    if callback is None:
        return
    callback(event)


def _terminate_process_group(process: subprocess.Popen[bytes]) -> None:
    """Terminate the whole process group of *process*, escalating to ``SIGKILL``.

    ``start_new_session=True`` is what makes this safe: the child runs in its own
    session, so the group id equals the child's pid and the signal reaches the
    ``make``/``ninja`` grandchildren instead of only the direct child.
    """

    try:
        os.killpg(os.getpgid(process.pid), signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        return
    try:
        process.wait(timeout=_TERMINATE_GRACE_SECONDS)
        return
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(os.getpgid(process.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass
    try:
        process.wait(timeout=_TERMINATE_GRACE_SECONDS)
    except subprocess.TimeoutExpired:
        pass


def _pump_stream(name: str, pipe: BinaryIO, log_callback: LogCallback) -> None:
    """Forward every line read from *pipe* to *log_callback* until the pipe closes.

    Lines are published as soon as the tool finishes them rather than when the
    next one arrives, so a slow build still shows progress; ``read1`` never waits
    for a full chunk, which keeps one slow line from delaying the lines behind it.
    A redrawn line is published once, with the text a terminal would leave on
    screen, because :class:`_LineSplitter` drops what a bare ``\\r`` overwrites; a
    line a tool reprints over one it already finished keeps :data:`_REDRAW_MARKER`
    in front of it so the sink can rewrite the line it is showing.
    """

    splitter = _LineSplitter()
    try:
        while True:
            chunk = pipe.read1(_READ_CHUNK_BYTES)
            if not chunk:
                break
            for line in splitter.feed(chunk):
                log_callback(name, f"{line}\n")
        for line in splitter.flush():
            log_callback(name, f"{line}\n")
    finally:
        try:
            pipe.close()
        except OSError:
            pass


def _child_env(env: Mapping[str, str] | None) -> dict[str, str]:
    """Return the child environment: *env* (or the parent's) plus the streamed defaults.

    The streamed defaults win over a caller-supplied value. A caller that forwards
    its own ``TERM`` would otherwise reintroduce terminal formatting into a stream
    that no terminal reads.
    """

    child_env = dict(os.environ if env is None else env)
    child_env.update(_STREAMED_TOOL_ENV)
    return child_env


def run_streamed_process(
    *,
    argv: list[str],
    cwd: Path | None = None,
    env: Mapping[str, str] | None = None,
    log_callback: LogCallback | None = None,
    cancel_event: threading.Event | None = None,
    timeout_seconds: float | None = None,
    cancelled_error: type[ProcessCancelled] = ProcessCancelled,
    timeout_error: type[ProcessTimeout] = ProcessTimeout,
) -> int:
    """Run *argv*, stream its output, and honour cancel and timeout requests.

    Two reader threads own the blocking reads so this loop can poll the wall clock
    and the cancel event every 100 ms. A non-zero exit raises
    :class:`subprocess.CalledProcessError` with the return code.

    Lines are split as a console splits them: ``\\n`` and ``\\r\\n`` end a line,
    and a bare ``\\r`` rewinds the line so the new text replaces the old. A tool
    that redraws a progress bar therefore reaches *log_callback* with its final
    text only, while a tool that prints one line per update (esptool under the
    environment below) reaches it line by line, live. Each callback receives one
    line with a trailing ``\\n`` and without ANSI escape sequences; a line that
    reprints the line before it arrives with :data:`_REDRAW_MARKER` in front of its
    text, so a sink that keeps a log rewrites that line instead of duplicating it.

    :param argv Argument array; never a shell string.
    :param cwd Working directory, or ``None`` to inherit.
    :param env Base environment, or ``None`` to inherit; :func:`streamed_tool_env`
        is layered on top of whatever this mapping holds.
    :param log_callback Receives ``(stream, text)`` per line; ``None`` discards.
    :param cancel_event Polled every 100 ms; a set event cancels the process.
    :param timeout_seconds Wall-clock budget, or ``None`` for no limit.
    :param cancelled_error Exception type raised on cancellation.
    :param timeout_error Exception type raised on timeout, built with the budget.
    :returns The exit code, which is always ``0`` because a non-zero exit raises.
    """

    sink = log_callback or discard_log
    process = subprocess.Popen(
        argv,
        cwd=cwd,
        env=_child_env(env),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        # Buffered mode (the default) is what gives the readers a ``read1`` that
        # returns as soon as the child writes; ``bufsize=0`` would hand out a raw
        # ``FileIO`` whose ``read`` waits for a full chunk.
        bufsize=-1,
        start_new_session=True,
    )
    readers = [
        threading.Thread(
            target=_pump_stream,
            args=("stdout", process.stdout, sink),
            daemon=True,
        ),
        threading.Thread(
            target=_pump_stream,
            args=("stderr", process.stderr, sink),
            daemon=True,
        ),
    ]
    for reader in readers:
        reader.start()

    started = time.monotonic()
    try:
        while process.poll() is None:
            if cancel_event is not None and cancel_event.is_set():
                _terminate_process_group(process)
                error = cancelled_error()
                sink("stderr", f"{error}\n")
                raise error
            if timeout_seconds is not None and time.monotonic() - started > timeout_seconds:
                _terminate_process_group(process)
                error = timeout_error(timeout_seconds)
                sink("stderr", f"{error}\n")
                raise error
            time.sleep(_CANCEL_POLL_SECONDS)
    finally:
        for reader in readers:
            reader.join(timeout=_TERMINATE_GRACE_SECONDS)

    return_code = process.returncode or 0
    if return_code != 0:
        raise subprocess.CalledProcessError(return_code, argv)
    return return_code

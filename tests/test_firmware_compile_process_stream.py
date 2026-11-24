"""Tests for the shared streamed-process seam.

The seam is the only place the toolchain launches a subprocess, so these tests
pin its contract: lines arrive as ``(stream, text)`` while the process runs, a
non-zero exit still raises ``CalledProcessError``, and cancellation/timeout raise
the caller's exception type with the reported message.
"""

from __future__ import annotations

import subprocess
import sys
import threading
from pathlib import Path

import pytest

from micro_otter.tools.firmware_compile.build_orchestration import BuildCancelled, BuildTimeout
from micro_otter.tools.firmware_compile.process_stream import (
    ProcessCancelled,
    ProcessTimeout,
    discard_log,
    run_streamed_process,
)


def _python(*args: str) -> list[str]:
    """Return an argv array that runs *args* with the test interpreter."""

    return [sys.executable, "-c", *args]


def test_run_streamed_process_streams_stdout_and_stderr_in_order():
    lines: list[tuple[str, str]] = []
    script = "import sys; print('out-line'); sys.stderr.write('err-line\\n'); sys.stderr.flush()"

    exit_code = run_streamed_process(
        argv=_python(script),
        log_callback=lambda stream, text: lines.append((stream, text)),
    )

    assert exit_code == 0
    assert ("stdout", "out-line\n") in lines
    assert ("stderr", "err-line\n") in lines


def test_run_streamed_process_raises_called_process_error_for_a_failed_exit():
    with pytest.raises(subprocess.CalledProcessError) as excinfo:
        run_streamed_process(argv=_python("raise SystemExit(3)"))

    assert excinfo.value.returncode == 3


def test_run_streamed_process_timeout_raises_process_timeout():
    lines: list[tuple[str, str]] = []

    with pytest.raises(ProcessTimeout) as excinfo:
        run_streamed_process(
            argv=_python("import time; time.sleep(5)"),
            log_callback=lambda stream, text: lines.append((stream, text)),
            timeout_seconds=0.2,
        )

    assert excinfo.value.timeout_seconds == 0.2
    assert str(excinfo.value) == "process timed out after 0.2s"
    assert any("timed out" in text for _stream, text in lines)


def test_run_streamed_process_cancel_event_raises_process_cancelled():
    cancel = threading.Event()
    cancel.set()

    with pytest.raises(ProcessCancelled) as excinfo:
        run_streamed_process(
            argv=_python("import time; time.sleep(5)"),
            cancel_event=cancel,
        )

    assert str(excinfo.value) == "process cancelled"


def test_run_streamed_process_honours_cwd_and_env(tmp_path: Path):
    lines: list[tuple[str, str]] = []

    run_streamed_process(
        argv=_python(
            "import os, sys; sys.stdout.write(os.getcwd() + '|' + os.environ['MO_PROBE'] + '\\n')"
        ),
        cwd=tmp_path,
        env={"MO_PROBE": "marker", "PATH": "/usr/bin:/bin"},
        log_callback=lambda stream, text: lines.append((stream, text)),
    )

    assert lines == [("stdout", f"{tmp_path}|marker\n")]


def test_run_streamed_process_raises_the_callers_exception_types():
    with pytest.raises(BuildTimeout):
        run_streamed_process(
            argv=_python("import time; time.sleep(5)"),
            timeout_seconds=0.2,
            timeout_error=BuildTimeout,
        )

    cancel = threading.Event()
    cancel.set()
    with pytest.raises(BuildCancelled):
        run_streamed_process(
            argv=_python("import time; time.sleep(5)"),
            cancel_event=cancel,
            cancelled_error=BuildCancelled,
        )


def test_discard_log_accepts_lines_without_side_effects():
    assert discard_log("stdout", "line\n") is None


# --- carriage-return redraws --------------------------------------------------


def test_run_streamed_process_overwrites_a_redrawn_line_like_the_console():
    """A bar redrawn with ``\\r`` leaves one line on screen, so the log gets one.

    This is esptool's smart-terminal shape: each update starts with ``\\r`` and
    erases the line, and the stage ends by deleting it. A terminal shows only the
    final text, and the log must agree instead of keeping each redraw.
    """

    lines: list[tuple[str, str]] = []
    script = (
        "import sys; "
        "sys.stdout.write('\\rWriting at 0x00001000 [==>   ]  33.3% 4096/12000 bytes... '); "
        "sys.stdout.write('\\rWriting at 0x00001000 [====> ]  66.7% 8192/12000 bytes... '); "
        "sys.stdout.write('\\r\\x1b[1A\\x1b[2KStub flasher running.\\n')"
    )

    run_streamed_process(
        argv=_python(script),
        log_callback=lambda stream, text: lines.append((stream, text)),
    )

    assert [text for _stream, text in lines] == ["Stub flasher running.\n"]


def test_run_streamed_process_marks_every_bar_update_that_ends_with_a_newline():
    """Under ``TERM=dumb`` esptool ends each bar update with ``\\n``: keep them, marked.

    The leading carriage return rewinds an empty line, so nothing is overwritten
    and a flash stays live line by line in the log. Such a line reprints the one
    before it, so it keeps the carriage return as a marker: a sink that keeps a log
    rewrites the line it already shows instead of appending a duplicate.
    """

    lines: list[tuple[str, str]] = []
    script = (
        "import sys; "
        "sys.stdout.write('\\rWriting at 0x00001000 [==>   ]  33.3% 4096/12000 bytes... \\n'); "
        "sys.stdout.write('\\rWriting at 0x00001000 [====> ]  66.7% 8192/12000 bytes... \\n')"
    )

    run_streamed_process(
        argv=_python(script),
        log_callback=lambda stream, text: lines.append((stream, text)),
    )

    assert [text for _stream, text in lines] == [
        "\rWriting at 0x00001000 [==>   ]  33.3% 4096/12000 bytes...\n",
        "\rWriting at 0x00001000 [====> ]  66.7% 8192/12000 bytes...\n",
    ]


def test_run_streamed_process_does_not_mark_a_line_that_overwrites_itself():
    """A ``\\r`` after text of the same line is not a reprint: that line is new.

    Nothing was published for the text before the carriage return, so there is no
    line for a sink to rewrite, and the finished line is appended unmarked.
    """

    lines: list[tuple[str, str]] = []

    run_streamed_process(
        argv=_python("import sys; sys.stdout.write('Reading 10%\\rReading 20%\\n')"),
        log_callback=lambda stream, text: lines.append((stream, text)),
    )

    assert lines == [("stdout", "Reading 20%\n")]


def test_run_streamed_process_drops_the_marker_when_a_reprint_rewrites_itself():
    """A reprint that overwrites its own text is appended, not rewritten in place."""

    lines: list[tuple[str, str]] = []

    run_streamed_process(
        argv=_python("import sys; sys.stdout.write('\\rbar 0%\\rbar 1%\\n')"),
        log_callback=lambda stream, text: lines.append((stream, text)),
    )

    assert lines == [("stdout", "bar 1%\n")]


def test_run_streamed_process_does_not_mark_crlf_line_endings():
    """``\\r\\n`` is one line ending, not a reprint of the line before it."""

    lines: list[tuple[str, str]] = []

    run_streamed_process(
        argv=_python("import sys; sys.stdout.write('one\\r\\ntwo\\r\\n')"),
        log_callback=lambda stream, text: lines.append((stream, text)),
    )

    assert lines == [("stdout", "one\n"), ("stdout", "two\n")]


def test_run_streamed_process_marks_a_reprint_split_across_reads():
    """A ``\\r`` that ends a read still marks the line the next read completes."""

    lines: list[tuple[str, str]] = []
    script = (
        "import sys, time; "
        "sys.stdout.write('\\r'); "
        "sys.stdout.flush(); "
        "time.sleep(0.2); "
        "sys.stdout.write('bar 1%\\n')"
    )

    run_streamed_process(
        argv=_python(script),
        log_callback=lambda stream, text: lines.append((stream, text)),
    )

    assert lines == [("stdout", "\rbar 1%\n")]


def test_run_streamed_process_marks_a_reprint_that_was_never_terminated():
    """The unterminated tail is flushed with its marker, so the rewrite still applies."""

    lines: list[tuple[str, str]] = []

    run_streamed_process(
        argv=_python("import sys; sys.stdout.write('\\rbar 0%\\n\\rbar 1%')"),
        log_callback=lambda stream, text: lines.append((stream, text)),
    )

    assert lines == [("stdout", "\rbar 0%\n"), ("stdout", "\rbar 1%\n")]


def test_run_streamed_process_holds_a_carriage_return_until_the_next_read():
    """A ``\\r`` that ends a read is not the end of the line: the overwrite still wins."""

    lines: list[tuple[str, str]] = []
    script = (
        "import sys, time; "
        "sys.stdout.write('partial write\\r'); "
        "sys.stdout.flush(); "
        "time.sleep(0.2); "
        "sys.stdout.write('final write\\n')"
    )

    run_streamed_process(
        argv=_python(script),
        log_callback=lambda stream, text: lines.append((stream, text)),
    )

    assert lines == [("stdout", "final write\n")]


def test_run_streamed_process_keeps_the_text_before_a_trailing_carriage_return():
    """A ``\\r`` with nothing written after it rewinds an empty tail, not the text."""

    lines: list[tuple[str, str]] = []

    run_streamed_process(
        argv=_python("import sys; sys.stdout.write('stub running\\r')"),
        log_callback=lambda stream, text: lines.append((stream, text)),
    )

    assert lines == [("stdout", "stub running\n")]


def test_run_streamed_process_flushes_an_unterminated_final_line():
    lines: list[tuple[str, str]] = []

    run_streamed_process(
        argv=_python("import sys; sys.stdout.write('no newline at the end')"),
        log_callback=lambda stream, text: lines.append((stream, text)),
    )

    assert lines == [("stdout", "no newline at the end\n")]


def test_run_streamed_process_drops_blank_lines_and_escape_only_lines():
    lines: list[tuple[str, str]] = []
    script = "import sys; sys.stdout.write('\\x1b[2K\\n   \\n\\x1b[1mesptool v5\\x1b[0m\\n')"

    run_streamed_process(
        argv=_python(script),
        log_callback=lambda stream, text: lines.append((stream, text)),
    )

    assert lines == [("stdout", "esptool v5\n")]


def test_run_streamed_process_gives_the_child_an_unbuffered_plain_terminal():
    """A terminal-shaped ``TERM`` from the caller must not leak into the stream."""

    lines: list[tuple[str, str]] = []
    script = (
        "import os, sys; "
        "sys.stdout.write('|'.join([os.environ.get('PYTHONUNBUFFERED', ''), "
        "os.environ.get('TERM', ''), os.environ.get('NO_COLOR', '')]) + '\\n')"
    )

    run_streamed_process(
        argv=_python(script),
        env={"TERM": "xterm-256color", "PATH": "/usr/bin:/bin"},
        log_callback=lambda stream, text: lines.append((stream, text)),
    )

    assert lines == [("stdout", "1|dumb|1\n")]


def test_run_streamed_process_delivers_a_line_while_the_process_still_runs():
    """A short ``print`` must not stay in the child's block buffer until it exits."""

    saw_first_line = threading.Event()
    script = "import time; print('uploading stub'); time.sleep(1.5); print('done')"

    def log_callback(stream: str, text: str) -> None:
        """Record the first line as soon as the seam publishes it."""

        if "uploading stub" in text:
            saw_first_line.set()

    worker = threading.Thread(
        target=lambda: run_streamed_process(argv=_python(script), log_callback=log_callback),
        daemon=True,
    )
    worker.start()

    assert saw_first_line.wait(timeout=1.0), "the first line arrived before the process exited"
    worker.join(timeout=10)
    assert not worker.is_alive()

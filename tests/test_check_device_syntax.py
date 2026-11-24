"""Tests for the MicroPython device syntax gate (``tools/check_device_syntax.py``).

The device tree is intentionally not ruff-linted (see the ``extend-exclude`` comment in
``pyproject.toml``); ``mpy-cross`` is its checker. These tests pin the contract of that gate:
it must compile every device file for every supported architecture, it must report *all*
failures instead of the first one, it must never write into the repository, and a broken
toolchain must not be reported as broken device code.

Tests that need the real compiler skip when it is unavailable; the argument-shape and
error-path tests run everywhere by intercepting ``subprocess.run``.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest
from tools import check_device_syntax

REPO_ROOT = Path(__file__).resolve().parents[1]
DEVICE_TREE = REPO_ROOT / "src" / "micro_otter" / "nodes" / "device"

# viper code only compiles when mpy-cross resolves -march, so this fixture fails loudly if
# the gate ever degrades to a bare parse.
VIPER_MODULE = '''"""Viper driver fixture: none of it imports, only compiles."""


@micropython.viper
def zero_words(buf: ptr16, count: int) -> int:
    index = 0
    while index < count:
        buf[index] = 0
        index += 1
    return count
'''

BROKEN_MODULE = "def broken(:\n    pass\n"


def _real_mpy_cross() -> Path | None:
    for candidate in (shutil.which("mpy-cross"), check_device_syntax.PRIMARY_COMPILER_PATH):
        if candidate and Path(candidate).is_file():
            return Path(candidate)
    return None


requires_mpy_cross = pytest.mark.skipif(
    _real_mpy_cross() is None,
    reason=(
        "mpy-cross not available; build it at "
        f"{check_device_syntax.PRIMARY_COMPILER_PATH} or put it on PATH"
    ),
)


def _fake_compiler(tmp_path: Path) -> Path:
    """Create an executable that stands in for mpy-cross; ``subprocess.run`` is intercepted."""
    binary = tmp_path / "mpy-cross"
    binary.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    binary.chmod(0o755)
    return binary


def _device_tree(tmp_path: Path, files: dict[str, str]) -> Path:
    root = tmp_path / "device"
    for relative, content in files.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    return root


def _snapshot(root: Path) -> dict[str, tuple[int, int]]:
    """Map every file below ``root`` to (mtime, size), to prove a run wrote nothing."""
    snapshot: dict[str, tuple[int, int]] = {}
    for path in sorted(root.rglob("*")):
        if path.is_file():
            stat = path.stat()
            snapshot[str(path.relative_to(root))] = (stat.st_mtime_ns, stat.st_size)
    return snapshot


def _git_status() -> str:
    return subprocess.run(
        ["git", "status", "--porcelain"],
        capture_output=True,
        text=True,
        check=True,
        cwd=REPO_ROOT,
    ).stdout


class RecordingRun:
    """Stand-in for ``subprocess.run`` that records commands and always succeeds."""

    def __init__(self) -> None:
        self.commands: list[list[str]] = []

    def __call__(self, command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        self.commands.append(list(command))
        return subprocess.CompletedProcess(command, 0, "", "")

    def compiled(self, source: Path) -> list[list[str]]:
        return [command for command in self.commands if str(source) in command]


def test_gate_compiles_each_source_for_every_default_architecture(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = _device_tree(tmp_path, {"pkg/driver.py": VIPER_MODULE})
    binary = _fake_compiler(tmp_path)
    recorder = RecordingRun()
    monkeypatch.setattr(check_device_syntax.subprocess, "run", recorder)

    exit_code = check_device_syntax.main(["--device-root", str(root), "--mpy-cross", str(binary)])

    assert exit_code == check_device_syntax.EXIT_OK
    source = root / "pkg" / "driver.py"
    expected = [
        [str(binary.resolve()), f"-march={arch}", "-o", os.devnull, str(source)]
        for arch in ("xtensa", "xtensawin")
    ]
    assert recorder.compiled(source) == expected, (
        "-march and '-o <devnull>' are the whole point of the gate: a bare mpy-cross call only "
        "parses, leaving viper intrinsics unchecked, and a real output path would litter the tree"
    )
    assert not list(root.rglob("*.mpy"))


def test_repeated_march_flags_narrow_and_deduplicate_the_gate(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    root = _device_tree(tmp_path, {"driver.py": VIPER_MODULE})
    binary = _fake_compiler(tmp_path)
    recorder = RecordingRun()
    monkeypatch.setattr(check_device_syntax.subprocess, "run", recorder)

    exit_code = check_device_syntax.main(
        [
            "--device-root",
            str(root),
            "--mpy-cross",
            str(binary),
            "--march=xtensa",
            "--march=xtensa",
        ]
    )

    assert exit_code == check_device_syntax.EXIT_OK
    assert [command[1] for command in recorder.compiled(root / "driver.py")] == ["-march=xtensa"]
    assert "1 files x 1 architectures (xtensa)" in capsys.readouterr().out


def test_cache_directories_are_never_selected(tmp_path: Path) -> None:
    root = _device_tree(
        tmp_path,
        {
            "driver.py": VIPER_MODULE,
            "__pycache__/stale.py": BROKEN_MODULE,
            "__mpycache__/0123abcd/stale.py": BROKEN_MODULE,
        },
    )

    assert check_device_syntax.collect_device_sources(root) == [root / "driver.py"], (
        "stale __pycache__/__mpycache__ artefacts must never be compiled: they are generated "
        "output, and a broken leftover would fail a device source that is actually fine"
    )


@requires_mpy_cross
def test_gate_ignores_stale_cache_artefacts_with_the_real_compiler(tmp_path: Path) -> None:
    root = _device_tree(
        tmp_path,
        {
            "driver.py": VIPER_MODULE,
            "__pycache__/stale.py": BROKEN_MODULE,
            "__mpycache__/0123abcd/stale.py": BROKEN_MODULE,
        },
    )

    exit_code = check_device_syntax.main(
        ["--device-root", str(root), "--mpy-cross", str(_real_mpy_cross())]
    )

    assert exit_code == check_device_syntax.EXIT_OK


@requires_mpy_cross
def test_gate_accepts_viper_intrinsics_in_a_device_module(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    root = _device_tree(tmp_path, {"driver.py": VIPER_MODULE})
    before = _snapshot(root)

    exit_code = check_device_syntax.main(
        ["--device-root", str(root), "--mpy-cross", str(_real_mpy_cross())]
    )

    captured = capsys.readouterr()
    assert exit_code == check_device_syntax.EXIT_OK, captured.err
    assert "1 files x 2 architectures (xtensa, xtensawin)" in captured.out
    assert _snapshot(root) == before, "the gate must not write inside the device tree"


@requires_mpy_cross
def test_gate_reports_every_broken_file_with_its_architecture(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    root = _device_tree(tmp_path, {"broken.py": BROKEN_MODULE, "ok.py": VIPER_MODULE})

    exit_code = check_device_syntax.main(
        ["--device-root", str(root), "--mpy-cross", str(_real_mpy_cross())]
    )

    captured = capsys.readouterr()
    assert exit_code == check_device_syntax.EXIT_COMPILE_FAILURE
    assert str(root / "broken.py") in captured.err
    assert "-march=xtensa" in captured.err
    assert "-march=xtensawin" in captured.err
    assert str(root / "ok.py") not in captured.err, (
        "a healthy file must not be dragged into the report; that only buries the real failure"
    )
    assert "2 of 4 compilations failed" in captured.err


@requires_mpy_cross
def test_gate_is_clean_on_the_real_device_tree(capsys: pytest.CaptureFixture[str]) -> None:
    before_sources = _snapshot(DEVICE_TREE)
    before_status = _git_status()

    exit_code = check_device_syntax.main(["--mpy-cross", str(_real_mpy_cross())])

    captured = capsys.readouterr()
    assert exit_code == check_device_syntax.EXIT_OK, captured.err
    sources = check_device_syntax.collect_device_sources(DEVICE_TREE)
    assert len(sources) >= 70, f"device tree shrank unexpectedly: {len(sources)} sources"
    assert f"{len(sources)} files x 2 architectures (xtensa, xtensawin)" in captured.out
    assert _snapshot(DEVICE_TREE) == before_sources, (
        "the gate writes to os.devnull only; a changed device tree means it started producing "
        "artefacts that belong to tools/compile_runtime_mpy.py and the firmware build"
    )
    assert _git_status() == before_status


# --- configuration and toolchain failures are exit 2, not "device code is broken" ----------


def test_missing_device_root_is_a_toolchain_error(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code = check_device_syntax.main(["--device-root", str(tmp_path / "nowhere")])

    assert exit_code == check_device_syntax.EXIT_TOOLCHAIN_ERROR
    assert "Device root not found" in capsys.readouterr().err


def test_empty_device_tree_is_a_toolchain_error(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    root = _device_tree(tmp_path, {"README.md": "no python here\n"})

    exit_code = check_device_syntax.main(["--device-root", str(root)])

    assert exit_code == check_device_syntax.EXIT_TOOLCHAIN_ERROR
    assert "No Python sources found" in capsys.readouterr().err, (
        "an empty selection must fail instead of passing: a moved device root would otherwise "
        "turn the gate into a no-op that reports success"
    )


def test_missing_explicit_compiler_is_a_toolchain_error(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    root = _device_tree(tmp_path, {"driver.py": VIPER_MODULE})

    exit_code = check_device_syntax.main(
        ["--device-root", str(root), "--mpy-cross", str(tmp_path / "not-a-compiler")]
    )

    captured = capsys.readouterr()
    assert exit_code == check_device_syntax.EXIT_TOOLCHAIN_ERROR
    assert "not-a-compiler" in captured.err
    assert "--mpy-cross" in captured.err


def test_invalid_mpy_cross_env_var_is_a_toolchain_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    root = _device_tree(tmp_path, {"driver.py": VIPER_MODULE})
    monkeypatch.setenv("MPY_CROSS", str(tmp_path / "bogus-compiler"))

    exit_code = check_device_syntax.main(["--device-root", str(root)])

    captured = capsys.readouterr()
    assert exit_code == check_device_syntax.EXIT_TOOLCHAIN_ERROR
    assert "$MPY_CROSS" in captured.err, (
        "an explicit $MPY_CROSS must not silently fall back to another compiler: the caller "
        "would believe a different binary ran"
    )


def test_unresolvable_compiler_names_the_escape_hatches(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    root = _device_tree(tmp_path, {"driver.py": VIPER_MODULE})
    monkeypatch.delenv("MPY_CROSS", raising=False)
    monkeypatch.setattr(check_device_syntax, "compiler_candidates", lambda: ())
    monkeypatch.setattr(check_device_syntax.shutil, "which", lambda _name: None)

    exit_code = check_device_syntax.main(["--device-root", str(root)])

    captured = capsys.readouterr()
    assert exit_code == check_device_syntax.EXIT_TOOLCHAIN_ERROR
    assert "Could not locate mpy-cross" in captured.err
    assert "--mpy-cross" in captured.err and "PATH" in captured.err
    assert "micro-otter toolchain install" in captured.err


def test_env_var_compiler_is_used_when_no_flag_is_given(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = _device_tree(tmp_path, {"driver.py": VIPER_MODULE})
    binary = _fake_compiler(tmp_path)
    recorder = RecordingRun()
    monkeypatch.setenv("MPY_CROSS", str(binary))
    monkeypatch.setattr(check_device_syntax.subprocess, "run", recorder)

    exit_code = check_device_syntax.main(["--device-root", str(root)])

    assert exit_code == check_device_syntax.EXIT_OK
    assert recorder.commands, "no compilation was attempted"
    assert {command[0] for command in recorder.commands} == {str(binary.resolve())}


def test_explicit_compiler_flag_wins_over_the_env_var(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = _device_tree(tmp_path, {"driver.py": VIPER_MODULE})
    from_flag = _fake_compiler(tmp_path)
    monkeypatch.setenv("MPY_CROSS", str(tmp_path / "ignored-compiler"))
    recorder = RecordingRun()
    monkeypatch.setattr(check_device_syntax.subprocess, "run", recorder)

    exit_code = check_device_syntax.main(
        ["--device-root", str(root), "--mpy-cross", str(from_flag)]
    )

    assert exit_code == check_device_syntax.EXIT_OK
    assert {command[0] for command in recorder.commands} == {str(from_flag.resolve())}


@requires_mpy_cross
def test_unsupported_architecture_is_a_toolchain_error(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    root = _device_tree(tmp_path, {"driver.py": VIPER_MODULE})

    exit_code = check_device_syntax.main(
        ["--device-root", str(root), "--march=bogus", "--mpy-cross", str(_real_mpy_cross())]
    )

    captured = capsys.readouterr()
    assert exit_code == check_device_syntax.EXIT_TOOLCHAIN_ERROR, (
        "an unusable -march is a broken gate, not broken device code: reporting it as exit 1 "
        "would send the next person hunting through 77 healthy files"
    )
    assert "-march=bogus" in captured.err


def test_candidates_derive_from_resolved_micropython_root(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "micropython"
    (root / "mpy-cross" / "build").mkdir(parents=True)
    (root / "mpy-cross" / "build" / "mpy-cross").write_text("#!/bin/sh\n", encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("MICRO_OTTER_MICROPYTHON_ROOT", str(root))

    candidates = check_device_syntax.compiler_candidates()

    assert candidates[0] == root / "mpy-cross" / "build" / "mpy-cross"
    assert root / "mpy-cross" / "mpy-cross" in candidates
    assert check_device_syntax.LEGACY_COMPILER_PATH in candidates


def test_broken_config_falls_back_to_legacy_candidate(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "micro-otter.toml").write_text("[paths\nbroken = = =\n", encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("MICRO_OTTER_MICROPYTHON_ROOT", raising=False)
    monkeypatch.delenv("MICROPYTHON_ROOT", raising=False)

    candidates = check_device_syntax.compiler_candidates()

    assert candidates == (check_device_syntax.LEGACY_COMPILER_PATH,)

"""Tests for the wheel-content contract checker ``tools/inspect_wheel.py``."""

from __future__ import annotations

import tomllib
import zipfile
from pathlib import Path

import pytest
from tools.inspect_wheel import (
    REQUIRED_FILES,
    collect_entries,
    find_violations,
    main,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
PYPROJECT = REPO_ROOT / "pyproject.toml"


def _write_wheel(tmp_path: Path, entries: list[str]) -> Path:
    """Write a zip archive containing *entries* and return its path.

    Every entry is written as an empty file, which is enough for the checker:
    it only compares member names.

    Args:
        tmp_path: Pytest temporary directory.
        entries: Wheel member names to write.

    Returns:
        The path of the produced ``.whl`` fixture.
    """

    wheel = tmp_path / "fixture.whl"
    with zipfile.ZipFile(wheel, "w") as archive:
        for entry in entries:
            archive.writestr(entry, b"")
    return wheel


def test_happy_path_accepts_the_full_required_set() -> None:
    """A wheel with every required file plus extra product entries is valid."""

    entries = [*REQUIRED_FILES, "micro_otter/toolchain/assets/README.md"]
    assert find_violations(entries) == []


@pytest.mark.parametrize("missing", REQUIRED_FILES)
def test_each_missing_required_file_is_reported_once(missing: str) -> None:
    """Removing one required file yields exactly one violation naming it."""

    entries = [path for path in REQUIRED_FILES if path != missing]
    assert find_violations(entries) == [f"missing required file: {missing}"]


@pytest.mark.parametrize(
    "entry",
    [
        "tools/mod/mod.py",
        "tools/inspect_wheel.py",
        "tests/test_config.py",
        "ldev/todos/x.md",
        "dev/README.md",
        "node_modules/pkg/index.js",
        "micro_otter/__pycache__/x.pyc",
        "micro_otter/nodes/compiled.pyc",
    ],
)
def test_forbidden_entries_are_reported(entry: str) -> None:
    """A forbidden entry yields a violation even beside a full required set."""

    entries = [*REQUIRED_FILES, entry]
    assert f"forbidden entry: {entry}" in find_violations(entries)


def test_collect_entries_reads_the_wheel_member_names(tmp_path: Path) -> None:
    """``collect_entries`` returns the exact member names of a wheel."""

    wheel = _write_wheel(tmp_path, ["micro_otter/a.py", "micro_otter/b.py"])
    assert collect_entries(wheel) == ["micro_otter/a.py", "micro_otter/b.py"]


def test_main_accepts_a_valid_wheel(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """``main`` returns 0 and prints the checked count for a valid wheel."""

    wheel = _write_wheel(tmp_path, [*REQUIRED_FILES])
    assert main([str(wheel)]) == 0
    assert f"{len(REQUIRED_FILES)} entries checked" in capsys.readouterr().out


def test_main_reports_missing_paths_for_a_minimal_wheel(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """``main`` returns 2 and names every missing file for a one-entry wheel."""

    wheel = _write_wheel(tmp_path, ["only/one.txt"])
    assert main([str(wheel)]) == 2
    errors = capsys.readouterr().err
    for required in REQUIRED_FILES:
        assert required in errors


def test_pyproject_wheel_packages_only_src_micro_otter() -> None:
    """The wheel target ships the runtime package only."""

    project = tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))
    wheel = project["tool"]["hatch"]["build"]["targets"]["wheel"]
    assert wheel["packages"] == ["src/micro_otter"]


def test_pyproject_wheel_forces_in_the_bundle_and_toolchain_assets() -> None:
    """The bundle is an artifact and the toolchain assets are force-included."""

    project = tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))
    wheel = project["tool"]["hatch"]["build"]["targets"]["wheel"]
    assert any("src/micro_otter/dist/webapp" in pattern for pattern in wheel["artifacts"])
    assert wheel["force-include"]["deploy/toolchain"] == "micro_otter/toolchain/assets"


def test_pyproject_sdist_keeps_an_explicit_include() -> None:
    """The sdist target still declares an explicit ``include`` list."""

    project = tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))
    sdist = project["tool"]["hatch"]["build"]["targets"]["sdist"]
    assert "include" in sdist

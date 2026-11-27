"""Text contract for the PyInstaller Windows distribution.

These assertions pin the *shape* of the Windows exe build without running
PyInstaller (which would need a Windows host): the entry module, the spec, the
PowerShell build script, and the declared build dependency must not drift. The
live ``micro-otter.exe`` build and smoke run on a Windows host (iteration 34
phase 6) and in the CI ``windows`` job.
"""

from __future__ import annotations

import tomllib
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PYINSTALLER_DIR = REPO_ROOT / "deploy" / "packaging" / "pyinstaller"
ENTRY = PYINSTALLER_DIR / "micro-otter-entry.py"
SPEC = PYINSTALLER_DIR / "micro-otter.spec"
BUILD_PS1 = REPO_ROOT / "deploy" / "packaging" / "build-exe.ps1"
PYPROJECT = REPO_ROOT / "pyproject.toml"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_entry_module_calls_the_cli_main() -> None:
    text = _read(ENTRY)
    assert "from micro_otter.cli import main" in text
    assert "main()" in text


def test_spec_is_onefile_and_named_micro_otter() -> None:
    text = _read(SPEC)
    assert 'name="micro-otter"' in text, "the exe must be named micro-otter"
    assert "collect_data_files" in text, "the spec must collect the package data trees"
    assert "dist/webapp" in text, "the spec must guard the built web app"
    assert "toolchain/assets" in text, "the spec must guard the toolchain assets"
    # Onefile: the EXE embeds a.binaries and a.datas directly (no COLLECT).
    assert "COLLECT(" not in text, "the spec must be onefile (no COLLECT step)"


def test_build_script_builds_the_wheel_then_pyinstaller() -> None:
    text = _read(BUILD_PS1)
    assert "build-wheel.sh" in text, "the exe must embed the same wheel the images use"
    assert "uv pip install --reinstall" in text, "the wheel must be installed before pyinstaller"
    assert "pyinstaller" in text
    assert "micro-otter.spec" in text
    assert "micro-otter.exe" in text


def test_pyinstaller_is_a_dev_dependency() -> None:
    with PYPROJECT.open("rb") as fh:
        dev = list(tomllib.load(fh)["dependency-groups"]["dev"])
    assert any(
        entry.startswith("pyinstaller") for entry in dev
    ), "pyinstaller must be a declared dev dependency so the exe build resolves in CI and WSL"

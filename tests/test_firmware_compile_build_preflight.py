from pathlib import Path
from unittest import mock

import pytest

from micro_otter.tools.firmware_compile import (
    BuildProfile,
    ModulePackagingMode,
    run_build_preflight,
    run_build_preflight_with_mode,
)


def test_run_build_preflight_validates_micropython_root_and_make(tmp_path: Path):
    (tmp_path / "ports").mkdir(parents=True)
    profile = BuildProfile(runtime_id="general", board="esp32")

    with mock.patch("shutil.which", return_value="/usr/bin/make"):
        result = run_build_preflight(profile=profile, micropython_root=tmp_path)

    assert result.warnings == ()


def test_run_build_preflight_rejects_missing_ports_directory(tmp_path: Path):
    profile = BuildProfile(runtime_id="general", board="esp32")

    with mock.patch("shutil.which", return_value="/usr/bin/make"):
        with pytest.raises(ValueError, match="ports directory"):
            run_build_preflight_with_mode(profile=profile, micropython_root=tmp_path, strict=True)


def test_run_build_preflight_requires_make(tmp_path: Path):
    (tmp_path / "ports").mkdir(parents=True)
    profile = BuildProfile(runtime_id="general", board="esp32")

    with mock.patch("shutil.which", return_value=None):
        with pytest.raises(OSError, match="Required tool not found: make"):
            run_build_preflight_with_mode(profile=profile, micropython_root=tmp_path, strict=True)


def test_run_build_preflight_warns_when_compiled_mode_without_mpy_cross(tmp_path: Path):
    (tmp_path / "ports").mkdir(parents=True)
    profile = BuildProfile(
        runtime_id="general",
        board="esp32",
        packaging_mode=ModulePackagingMode.COMPILED_MPY,
    )

    def fake_which(name: str):
        if name == "make":
            return "/usr/bin/make"
        return None

    with mock.patch("shutil.which", side_effect=fake_which):
        result = run_build_preflight(profile=profile, micropython_root=tmp_path)

    assert result.warnings
    assert "Could not locate mpy-cross" in result.warnings[0]


def test_run_build_preflight_accepts_local_mpy_cross_fallback(tmp_path: Path):
    (tmp_path / "ports").mkdir(parents=True)
    local_mpy_cross = tmp_path / "mpy-cross" / "build" / "mpy-cross"
    local_mpy_cross.parent.mkdir(parents=True)
    local_mpy_cross.write_text("#!/bin/sh\n", encoding="utf-8")
    profile = BuildProfile(
        runtime_id="general",
        board="esp32",
        packaging_mode=ModulePackagingMode.COMPILED_MPY,
    )

    with mock.patch("shutil.which", return_value="/usr/bin/make"):
        result = run_build_preflight(profile=profile, micropython_root=tmp_path)

    assert result.warnings == ()


def test_run_build_preflight_default_mode_warns_for_missing_root(tmp_path: Path):
    profile = BuildProfile(runtime_id="general", board="esp32")

    result = run_build_preflight(profile=profile, micropython_root=tmp_path / "missing")

    assert result.warnings
    assert "Invalid MicroPython root" in result.warnings[0]

def test_stock_module_shadow_raises_with_checkout_hint(tmp_path: Path):
    (tmp_path / "ports" / "esp32" / "modules").mkdir(parents=True)
    (tmp_path / "ports" / "esp32" / "modules" / "_boot.mpy").write_text("", encoding="utf-8")
    profile = BuildProfile(runtime_id="general", board="esp32")

    with mock.patch("shutil.which", return_value="/usr/bin/make"), mock.patch(
        "micro_otter.tools.firmware_compile.build_preflight._tracked_module_files",
        return_value=("ports/esp32/modules/_boot.py",),
    ):
        with pytest.raises(ValueError, match="shadowed"):
            run_build_preflight(profile=profile, micropython_root=tmp_path, port="esp32")


def test_stock_module_missing_raises(tmp_path: Path):
    (tmp_path / "ports" / "esp32" / "modules").mkdir(parents=True)
    profile = BuildProfile(runtime_id="general", board="esp32")

    with mock.patch("shutil.which", return_value="/usr/bin/make"), mock.patch(
        "micro_otter.tools.firmware_compile.build_preflight._tracked_module_files",
        return_value=("ports/esp32/modules/machine.py",),
    ):
        with pytest.raises(ValueError, match="missing"):
            run_build_preflight(profile=profile, micropython_root=tmp_path, port="esp32")


def test_stock_check_skipped_when_git_unavailable(tmp_path: Path):
    (tmp_path / "ports" / "esp32" / "modules").mkdir(parents=True)
    profile = BuildProfile(runtime_id="general", board="esp32")

    with mock.patch("shutil.which", return_value="/usr/bin/make"), mock.patch(
        "micro_otter.tools.firmware_compile.build_preflight._tracked_module_files",
        return_value=None,
    ):
        result = run_build_preflight(profile=profile, micropython_root=tmp_path, port="esp32")

    assert result.warnings
    assert "Stock module integrity check skipped" in result.warnings[-1]


def test_stock_check_intact_adds_no_warning(tmp_path: Path):
    (tmp_path / "ports" / "esp32" / "modules").mkdir(parents=True)
    (tmp_path / "ports" / "esp32" / "modules" / "_boot.py").write_text("", encoding="utf-8")
    profile = BuildProfile(runtime_id="general", board="esp32")

    with mock.patch("shutil.which", return_value="/usr/bin/make"), mock.patch(
        "micro_otter.tools.firmware_compile.build_preflight._tracked_module_files",
        return_value=("ports/esp32/modules/_boot.py",),
    ):
        result = run_build_preflight(profile=profile, micropython_root=tmp_path, port="esp32")

    assert result.warnings == ()


def test_stock_check_skipped_without_port(tmp_path: Path):
    (tmp_path / "ports").mkdir(parents=True)
    profile = BuildProfile(runtime_id="general", board="esp32")

    with mock.patch("shutil.which", return_value="/usr/bin/make"), mock.patch(
        "micro_otter.tools.firmware_compile.build_preflight._tracked_module_files",
    ) as tracked_mock:
        result = run_build_preflight(profile=profile, micropython_root=tmp_path)

    tracked_mock.assert_not_called()
    assert result.warnings == ()


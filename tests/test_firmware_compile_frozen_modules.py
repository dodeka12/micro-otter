"""Tests for the frozen-module-name verification guard."""

from pathlib import Path

import pytest

from micro_otter.tools.firmware_compile.build_artifact import (
    ArtifactVerificationError,
    frozen_module_names,
    verify_frozen_module_names,
)


def test_frozen_module_names_parses_relative_and_absolute_entries() -> None:
    content = (
        'MICROPY_FROZEN_LIST_ITEM("main")\n'
        'MICROPY_FROZEN_LIST_ITEM("otter_main")\n'
        'MICROPY_FROZEN_LIST_ITEM("/opt/micropython/ports/esp32/modules/_boot")\n'
    )

    assert frozen_module_names(content) == (
        "main",
        "otter_main",
        "/opt/micropython/ports/esp32/modules/_boot",
    )


def test_verify_frozen_module_names_accepts_relative_names(tmp_path: Path) -> None:
    frozen = tmp_path / "frozen_content.c"
    frozen.write_text(
        'MICROPY_FROZEN_LIST_ITEM("main")\n'
        'MICROPY_FROZEN_LIST_ITEM("otter_runtime/bootstrap_setup")\n',
        encoding="utf-8",
    )

    assert verify_frozen_module_names(frozen) == ("main", "otter_runtime/bootstrap_setup")


def test_verify_frozen_module_names_rejects_absolute_names(tmp_path: Path) -> None:
    frozen = tmp_path / "frozen_content.c"
    frozen.write_text(
        'MICROPY_FROZEN_LIST_ITEM("main")\n'
        'MICROPY_FROZEN_LIST_ITEM("/opt/micropython/ports/esp32/modules/_boot")\n',
        encoding="utf-8",
    )

    with pytest.raises(ArtifactVerificationError) as excinfo:
        verify_frozen_module_names(frozen)

    assert "/opt/micropython/ports/esp32/modules/_boot" in str(excinfo.value)
    assert "relative source name" in str(excinfo.value)


def test_verify_frozen_module_names_rejects_windows_drive_names(tmp_path: Path) -> None:
    frozen = tmp_path / "frozen_content.c"
    frozen.write_text('MICROPY_FROZEN_LIST_ITEM("C:/firmware/pkg")\n', encoding="utf-8")

    with pytest.raises(ArtifactVerificationError):
        verify_frozen_module_names(frozen)


def test_verify_frozen_module_names_missing_file_returns_empty(tmp_path: Path) -> None:
    assert verify_frozen_module_names(tmp_path / "missing.c") == ()

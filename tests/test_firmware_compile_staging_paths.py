from pathlib import Path

import pytest

from micro_otter.tools.firmware_compile.staging_paths import resolve_staging_paths


def test_resolve_staging_paths_uses_target_derived_default(tmp_path: Path):
    workspace = tmp_path
    micropython_root = workspace / "src" / "micropython"
    modules_root = micropython_root / "ports" / "esp32" / "modules"
    modules_root.mkdir(parents=True)

    result = resolve_staging_paths(workspace_root=workspace, target="esp32")

    assert result.micropython_root == micropython_root.resolve()
    assert result.modules_path == modules_root.resolve()


def test_resolve_staging_paths_validates_target_chars(tmp_path: Path):
    workspace = tmp_path
    (workspace / "src" / "micropython").mkdir(parents=True)

    with pytest.raises(ValueError, match="Invalid target"):
        resolve_staging_paths(workspace_root=workspace, target="esp32/")


def test_resolve_staging_paths_rejects_missing_micropython_root(tmp_path: Path):
    with pytest.raises(ValueError, match="Invalid MicroPython root"):
        resolve_staging_paths(workspace_root=tmp_path, target="esp32")


def test_resolve_staging_paths_rejects_modules_path_outside_root(tmp_path: Path):
    workspace = tmp_path
    micropython_root = workspace / "src" / "micropython"
    micropython_root.mkdir(parents=True)
    external_modules = workspace / "external" / "modules"
    external_modules.mkdir(parents=True)

    with pytest.raises(ValueError, match="under the selected MicroPython root"):
        resolve_staging_paths(
            workspace_root=workspace,
            target="esp32",
            modules_path=external_modules,
        )

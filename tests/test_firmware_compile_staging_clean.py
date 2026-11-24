from pathlib import Path

import pytest

from micro_otter.tools.firmware_compile.staging_clean import clean_managed_subtree
from micro_otter.tools.firmware_compile.staging_paths import resolve_staging_paths


def _prepare_paths(tmp_path: Path):
    modules = tmp_path / "src" / "micropython" / "ports" / "esp32" / "modules"
    modules.mkdir(parents=True)
    return resolve_staging_paths(workspace_root=tmp_path, target="esp32")


def test_clean_managed_subtree_removes_default_managed_paths(tmp_path: Path):
    paths = _prepare_paths(tmp_path)
    modules = paths.modules_path

    for folder in [
        "tools",
        "libs",
        "otter_runtime",
        "otter_core",
        "otter_webview",
        "otter_stdmo",
        "otter_audio_viper",
        "otter_power",
        "otter_mqtt",
        "otter_vars",
        "otter_led",
        "otter_audio",
        "otter_otter_audio_viper",
        "app",
        "otter",
    ]:
        (modules / folder).mkdir(parents=True)
    (modules / "main.py").write_text("print('x')\n", encoding="utf-8")

    result = clean_managed_subtree(paths)

    assert len(result.deleted_paths) == 16
    assert not (modules / "tools").exists()
    assert not (modules / "otter_runtime").exists()
    assert not (modules / "main.py").exists()


def test_clean_managed_subtree_dry_run_keeps_files(tmp_path: Path):
    paths = _prepare_paths(tmp_path)
    modules = paths.modules_path
    (modules / "libs").mkdir(parents=True)

    result = clean_managed_subtree(paths, dry_run=True)

    assert result.dry_run is True
    assert (modules / "libs").exists()


def test_clean_managed_subtree_rejects_outside_paths(tmp_path: Path):
    paths = _prepare_paths(tmp_path)

    with pytest.raises(ValueError, match="outside modules root"):
        clean_managed_subtree(paths, managed_dirs=("../outside",))


def test_clean_managed_subtree_sweeps_addon_module_roots(tmp_path: Path):
    paths = _prepare_paths(tmp_path)
    modules = paths.modules_path
    (modules / "moa_pulse").mkdir(parents=True)
    (modules / "moa_pulse_viper").mkdir(parents=True)
    (modules / "not_an_addon").mkdir(parents=True)

    result = clean_managed_subtree(paths)

    assert not (modules / "moa_pulse").exists()
    assert not (modules / "moa_pulse_viper").exists()
    assert (modules / "not_an_addon").exists()
    assert len(result.deleted_paths) == 2

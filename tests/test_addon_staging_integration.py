"""End-to-end proof that an installed add-on reaches the image as ``.mpy``.

The device tree is a small fixture (the real one is staged by
``tests/test_firmware_compile_mpy_only_packaging.py``), the add-on is installed through
the real :func:`micro_otter.tools.addon_archive.install_addon` path from the checked-in
fixture archive, and staging runs with the same fake mpy hook the packaging suite uses —
no ``mpy-cross`` is needed.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from tests.test_firmware_compile_mpy_only_packaging import _mpy_only_hook

from micro_otter.tools.addon_archive import install_addon
from micro_otter.tools.firmware_compile.staging_resolver import PackageNotStagedError
from micro_otter.tools.firmware_compile.staging_runner import run_staging

REPO_ROOT = Path(__file__).resolve().parents[1]
CAPABILITIES_SOURCE = REPO_ROOT / "src" / "micro_otter" / "nodes" / "device" / "capabilities"
FIXTURE_ARCHIVE = REPO_ROOT / "tests" / "fixtures" / "addons" / "sample_addon.zip"
BUILTIN_IDS = ("core",)


def _write_json(path: Path, payload: object) -> None:
    """Write *payload* as JSON to *path*, creating parents."""

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _device_root(tmp_path: Path, *, core_assets: list[str] | None = None) -> Path:
    """Create the minimal device tree staging needs and return its root."""

    device_root = tmp_path / "device"
    _write_json(device_root / "runtime" / "manifest.json", {"runtimes": {"general": "general"}})
    _write_json(
        device_root / "runtime" / "general" / "manifest.json",
        {
            "id": "general",
            "name": "Micro-Otter",
            "description": "Add-on staging fixture",
            "version": "1.11.0",
            "filesystem": ["app/main_loop.py"],
            "nodePackages": {"global": ["core"], "local": []},
            "deviceTargets": {"include": [], "exclude": []},
            "mpySourceExcludes": ["otter_main.py"],
        },
    )
    _write_json(device_root / "tools" / "manifest.json", {"files": ["wifi_manager.py"]})
    _write_json(
        device_root / "node_pkgs" / "index.json",
        {"packages": [{"id": "core", "manifest": "core/manifest.json"}]},
    )
    assets = ["otter_core/system.py"] if core_assets is None else core_assets
    _write_json(
        device_root / "node_pkgs" / "core" / "manifest.json",
        {
            "id": "core",
            "version": "1.0.1",
            "manifestVersion": 2,
            "variants": {"py": {"mpAssets": {"*": assets}}},
        },
    )

    files = {
        device_root / "runtime" / "general" / "app" / "main_loop.py": "print('loop')\n",
        device_root / "runtime" / "general" / "otter_main.py": "def run():\n    pass\n",
        device_root / "tools" / "wifi_manager.py": "# wifi\n",
    }
    for asset in assets:
        files[device_root / "node_pkgs" / "core" / asset] = "x = 1\n"
    for path, content in files.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    shutil.copytree(CAPABILITIES_SOURCE, device_root / "capabilities")
    (tmp_path / "src" / "micropython" / "ports" / "esp32" / "modules").mkdir(parents=True)
    return device_root


def _install_fixture_addon(tmp_path: Path) -> Path:
    """Install the checked-in add-on fixture and return the addons root."""

    addons_root = tmp_path / "addons"
    install_addon(FIXTURE_ARCHIVE, addons_root=addons_root, builtin_ids=BUILTIN_IDS)
    return addons_root


def test_addon_modules_are_staged_and_compiled_to_mpy(tmp_path: Path) -> None:
    device_root = _device_root(tmp_path)
    addons_root = _install_fixture_addon(tmp_path)
    excludes_seen: list[tuple[str, ...]] = []

    report = run_staging(
        workspace_root=tmp_path,
        runtime_id="general",
        target="esp32",
        device_root=device_root,
        addons_root=addons_root,
        dry_run=False,
        mpy_precompile_hook=_mpy_only_hook(excludes_seen),
    )

    modules_root = report.modules_path
    assert report.conflicts == []
    assert excludes_seen == [("otter_main.py",)]
    assert report.precompile is not None

    staged_addon = modules_root / "moa_sample_addon"
    assert (staged_addon / "__init__.mpy").is_file()
    assert (staged_addon / "generator.mpy").is_file()
    assert not (staged_addon / "__init__.py").exists()
    assert not (staged_addon / "generator.py").exists()

    assert report.embedded_hashes_path is not None
    payload = json.loads(report.embedded_hashes_path.read_text(encoding="utf-8"))
    hashed_paths = [entry["path"] for entry in payload["files"]]
    assert "moa_sample_addon/__init__.mpy" in hashed_paths
    assert "moa_sample_addon/generator.mpy" in hashed_paths
    for path in hashed_paths:
        assert (modules_root / path).is_file(), path


def test_staged_addon_tree_carries_no_tool_owned_files(tmp_path: Path) -> None:
    device_root = _device_root(tmp_path)
    addons_root = _install_fixture_addon(tmp_path)

    report = run_staging(
        workspace_root=tmp_path,
        runtime_id="general",
        target="esp32",
        device_root=device_root,
        addons_root=addons_root,
        dry_run=False,
        mpy_precompile_hook=_mpy_only_hook([]),
    )

    modules_root = report.modules_path
    assert list(modules_root.rglob("__mpycache__")) == []
    assert list(modules_root.rglob(".installed.json")) == []
    assert list(modules_root.rglob("manifest.json")) == []


def test_addon_collision_with_a_builtin_module_fails_the_preflight(tmp_path: Path) -> None:
    """The preflight names both sources instead of overwriting a built-in module."""

    device_root = _device_root(tmp_path, core_assets=["moa_sample_addon/__init__.py"])
    addons_root = _install_fixture_addon(tmp_path)

    report = run_staging(
        workspace_root=tmp_path,
        runtime_id="general",
        target="esp32",
        device_root=device_root,
        addons_root=addons_root,
        dry_run=False,
        mpy_precompile_hook=_mpy_only_hook([]),
    )

    assert len(report.conflicts) == 1
    conflict = report.conflicts[0]
    assert conflict.target_rel_path == "moa_sample_addon/__init__.py"
    assert conflict.first_source.is_file()
    assert conflict.second_source.is_file()
    assert conflict.first_source != conflict.second_source
    assert report.precompile is None


def test_runtime_local_package_is_still_rejected(tmp_path: Path) -> None:
    """An add-on makes its id stage-eligible; a runtime-local id keeps ``package-not-staged``."""

    device_root = _device_root(tmp_path)
    _write_json(
        device_root / "runtime" / "general" / "manifest.json",
        {
            "id": "general",
            "version": "1.11.0",
            "filesystem": ["app/main_loop.py"],
            "nodePackages": {"global": ["core"], "local": ["local_pkg"]},
            "deviceTargets": {"include": [], "exclude": []},
        },
    )
    addons_root = _install_fixture_addon(tmp_path)

    with pytest.raises(PackageNotStagedError) as error:
        run_staging(
            workspace_root=tmp_path,
            runtime_id="general",
            target="esp32",
            device_root=device_root,
            addons_root=addons_root,
            package_ids=("local_pkg",),
            dry_run=True,
        )

    assert error.value.package_ids == ("local_pkg",)

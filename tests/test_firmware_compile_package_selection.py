"""Runtime package selection tests for the firmware compile staging resolver."""

import json
import shutil
from pathlib import Path

import pytest

from micro_otter.tools.firmware_compile.compile_command import _collect_constituent_versions
from micro_otter.tools.firmware_compile.staging_paths import resolve_staging_paths
from micro_otter.tools.firmware_compile.staging_resolver import (
    PackageNotStagedError,
    UnknownPackageIdError,
    resolve_runtime_payload,
)

REAL_CAPABILITIES = (
    Path(__file__).parent.parent / "src" / "micro_otter" / "nodes" / "device" / "capabilities"
)


def _write_json(path: Path, payload: dict) -> None:
    """Write ``payload`` as JSON, creating parent directories."""

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _write_target_mapping(workspace: Path) -> None:
    """Write the compile target mapping used by every fixture below."""

    _write_json(
        workspace
        / "src"
        / "micro_otter"
        / "nodes"
        / "device"
        / "targets"
        / "compile_target_mappings.json",
        {
            "schemaVersion": 1,
            "rules": [
                {
                    "id": "esp32-default",
                    "webTargetId": "esp32_wroom",
                    "runtimeIdInclude": ["general"],
                    "runtimeIdExclude": [],
                    "compile": {"board": "esp32", "port": "esp32"},
                    "priority": 100,
                },
                {
                    "id": "generic-fallback",
                    "webTargetId": "generic_micropython",
                    "runtimeIdInclude": ["*"],
                    "runtimeIdExclude": [],
                    "compile": {"board": "*", "port": "*"},
                    "priority": 10,
                },
            ],
        },
    )


def _add_package(device_root: Path, package_id: str, version: str) -> None:
    """Register ``package_id`` in the node package index with one staged asset."""

    index_path = device_root / "node_pkgs" / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8"))
    index["packages"].append({"id": package_id, "manifest": f"{package_id}/manifest.json"})
    _write_json(index_path, index)

    _write_json(
        device_root / "node_pkgs" / package_id / "manifest.json",
        {
            "id": package_id,
            "version": version,
            "manifestVersion": 2,
            "variants": {"py": {"mpAssets": {"*": [f"libs/{package_id}/__init__.py"]}}},
        },
    )
    asset = device_root / "node_pkgs" / package_id / "libs" / package_id / "__init__.py"
    asset.parent.mkdir(parents=True, exist_ok=True)
    asset.write_text("# test\n", encoding="utf-8")


def _setup_device_root(
    workspace: Path,
    *,
    global_ids: tuple[str, ...] = ("core", "boss"),
    local_ids: tuple[str, ...] = ("local_only",),
) -> Path:
    """Build a synthetic device tree declaring global and runtime-local packages."""

    device_root = workspace / "src" / "micro_otter" / "nodes" / "device"

    _write_json(
        device_root / "runtime" / "manifest.json",
        {"defaultRuntime": "general", "runtimes": {"general": "general"}},
    )
    _write_json(
        device_root / "runtime" / "general" / "manifest.json",
        {
            "id": "general",
            "version": "1.11.0",
            "filesystem": ["main.py", "app/main_loop.py"],
            "nodePackages": {"global": list(global_ids), "local": list(local_ids)},
            "deviceTargets": {"include": [], "exclude": []},
            "mpySourceExcludes": ["main.py", "./app/main_loop.py"],
        },
    )
    _write_json(device_root / "tools" / "manifest.json", {"files": ["wifi_manager.py"]})
    _write_json(device_root / "node_pkgs" / "index.json", {"packages": []})

    for package_id in (*global_ids, *local_ids):
        _add_package(device_root, package_id, version="1.0.0")

    shutil.copytree(REAL_CAPABILITIES, device_root / "capabilities")

    return device_root


def _stage_modules_dir(workspace: Path) -> None:
    """Create the module target directory so staging paths resolve."""

    (workspace / "src" / "micropython" / "ports" / "esp32" / "modules").mkdir(
        parents=True, exist_ok=True
    )


def test_package_ids_subset_limits_assets(tmp_path: Path):
    _stage_modules_dir(tmp_path)
    _write_target_mapping(tmp_path)
    device_root = _setup_device_root(tmp_path)

    paths = resolve_staging_paths(workspace_root=tmp_path, target="esp32")
    payload = resolve_runtime_payload(
        workspace_root=paths.workspace_root,
        target=paths.target,
        runtime_id="general",
        device_root=device_root,
        package_ids=("core",),
    )

    assert {asset.package_id for asset in payload.package_assets} == {"core"}


def test_package_ids_none_keeps_all_packages(tmp_path: Path):
    _stage_modules_dir(tmp_path)
    _write_target_mapping(tmp_path)
    device_root = _setup_device_root(tmp_path)

    paths = resolve_staging_paths(workspace_root=tmp_path, target="esp32")
    default_payload = resolve_runtime_payload(
        workspace_root=paths.workspace_root,
        target=paths.target,
        runtime_id="general",
        device_root=device_root,
    )
    empty_payload = resolve_runtime_payload(
        workspace_root=paths.workspace_root,
        target=paths.target,
        runtime_id="general",
        device_root=device_root,
        package_ids=(),
    )

    expected = {"core", "boss", "local_only"}
    assert {asset.package_id for asset in default_payload.package_assets} == expected
    assert {asset.package_id for asset in empty_payload.package_assets} == expected


def test_unknown_package_id_raises_with_known_ids(tmp_path: Path):
    _stage_modules_dir(tmp_path)
    _write_target_mapping(tmp_path)
    device_root = _setup_device_root(tmp_path)

    paths = resolve_staging_paths(workspace_root=tmp_path, target="esp32")
    with pytest.raises(UnknownPackageIdError) as excinfo:
        resolve_runtime_payload(
            workspace_root=paths.workspace_root,
            target=paths.target,
            runtime_id="general",
            device_root=device_root,
            package_ids=("core", "nope"),
        )

    error = excinfo.value
    assert error.code == "unknown-package-id"
    assert error.requested == ("nope",)
    assert error.known == ("boss", "core", "local_only")
    assert "boss, core, local_only" in error.hint


def test_runtime_local_only_package_is_rejected_as_not_staged(tmp_path: Path):
    _stage_modules_dir(tmp_path)
    _write_target_mapping(tmp_path)
    device_root = _setup_device_root(tmp_path)

    paths = resolve_staging_paths(workspace_root=tmp_path, target="esp32")
    with pytest.raises(PackageNotStagedError) as excinfo:
        resolve_runtime_payload(
            workspace_root=paths.workspace_root,
            target=paths.target,
            runtime_id="general",
            device_root=device_root,
            package_ids=("core", "local_only"),
        )

    error = excinfo.value
    assert error.code == "package-not-staged"
    assert error.package_ids == ("local_only",)
    assert "device/runtime/<runtime_id>/node_pkgs/" in error.hint


def test_package_ids_preserve_caller_order(tmp_path: Path):
    _stage_modules_dir(tmp_path)
    _write_target_mapping(tmp_path)
    device_root = _setup_device_root(tmp_path, global_ids=("core", "boss", "alpha"))

    paths = resolve_staging_paths(workspace_root=tmp_path, target="esp32")
    payload = resolve_runtime_payload(
        workspace_root=paths.workspace_root,
        target=paths.target,
        runtime_id="general",
        device_root=device_root,
        package_ids=("alpha", "core"),
    )

    assert [asset.package_id for asset in payload.package_assets] == ["alpha", "core"]


def test_constituent_versions_reflect_selection(tmp_path: Path):
    _stage_modules_dir(tmp_path)
    runtime_payload = {"nodePackages": {"global": ["core", "boss"], "local": []}}
    device_root = _setup_device_root(tmp_path)

    _tools_version, selected = _collect_constituent_versions(
        device_root=device_root,
        runtime_payload=runtime_payload,
        package_ids=("core",),
    )
    _tools_version, all_packages = _collect_constituent_versions(
        device_root=device_root,
        runtime_payload=runtime_payload,
    )

    assert selected.merged() == {"core": "1.0.0"}
    assert all_packages.merged() == {"boss": "1.0.0", "core": "1.0.0"}


def test_non_semver_package_version_is_rejected(tmp_path: Path):
    _stage_modules_dir(tmp_path)
    _write_target_mapping(tmp_path)
    device_root = _setup_device_root(tmp_path, global_ids=("core",), local_ids=())

    # Overwrite `core`'s manifest version with a non-semver string.
    manifest_path = device_root / "node_pkgs" / "core" / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["version"] = "dev-build"
    _write_json(manifest_path, manifest)

    paths = resolve_staging_paths(workspace_root=tmp_path, target="esp32")

    with pytest.raises(ValueError, match="must be semver x.y.z"):
        resolve_runtime_payload(
            workspace_root=paths.workspace_root,
            target=paths.target,
            runtime_id="general",
            device_root=device_root,
        )

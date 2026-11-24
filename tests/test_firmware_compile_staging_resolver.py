import json
import shutil
from pathlib import Path

import pytest

from micro_otter.tools.addon_store import DEFAULT_VARIANT_ID
from micro_otter.tools.firmware_compile.capability_registry import CapabilityRegistry
from micro_otter.tools.firmware_compile.package_resolver import VariantUnknownError
from micro_otter.tools.firmware_compile.staging_paths import resolve_staging_paths
from micro_otter.tools.firmware_compile.staging_resolver import (
    UnknownPackageIdError,
    VariantPackageNotSelectedError,
    resolve_runtime_payload,
)
from micro_otter.tools.firmware_compile.target_context import (
    build_package_gating_context,
)
from micro_otter.tools.firmware_compile.target_resolution import load_effective_target_payload

REAL_CAPABILITIES = (
    Path(__file__).parent.parent / "src" / "micro_otter" / "nodes" / "device" / "capabilities"
)

REAL_DEVICE_ROOT = Path(__file__).parent.parent / "src" / "micro_otter" / "nodes" / "device"


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _write_target_mapping(workspace: Path) -> None:
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


def _setup_device_root(workspace: Path) -> Path:
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
            "nodePackages": {"global": ["core"], "local": []},
            "deviceTargets": {"include": [], "exclude": []},
        },
    )

    _write_json(device_root / "tools" / "manifest.json", {"files": ["wifi_manager.py"]})

    _write_json(
        device_root / "node_pkgs" / "index.json",
        {"packages": [{"id": "core", "manifest": "core/manifest.json"}]},
    )
    _write_json(
        device_root / "node_pkgs" / "core" / "manifest.json",
        {
            "id": "core",
            "version": "1.0.1",
            "manifestVersion": 2,
            "variants": {
                "py": {"mpAssets": {"*": ["libs/core/__init__.py", "libs/core/system.py"]}}
            },
        },
    )

    for rel in [
        "node_pkgs/core/libs/core/__init__.py",
        "node_pkgs/core/libs/core/system.py",
    ]:
        path = device_root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("# test\n", encoding="utf-8")

    shutil.copytree(REAL_CAPABILITIES, device_root / "capabilities")

    return device_root


def test_resolve_runtime_payload_collects_runtime_tools_and_assets(tmp_path: Path):
    workspace = tmp_path
    (workspace / "src" / "micropython" / "ports" / "esp32" / "modules").mkdir(parents=True)
    _write_target_mapping(workspace)
    device_root = _setup_device_root(workspace)

    paths = resolve_staging_paths(workspace_root=workspace, target="esp32")
    payload = resolve_runtime_payload(
        workspace_root=paths.workspace_root,
        target=paths.target,
        runtime_id="general",
        device_root=device_root,
    )

    assert payload.runtime_id == "general"
    assert payload.runtime_version == "1.11.0"
    assert payload.runtime_target_id is None
    assert payload.compile_board_id == "esp32"
    assert payload.compile_port_id == "esp32"
    assert payload.target_mapping_rule_id == "esp32-default"
    assert payload.runtime_files == ("main.py", "app/main_loop.py")
    assert payload.tools_files == ("wifi_manager.py",)
    assert len(payload.package_assets) == 2
    assert payload.package_assets[0].package_id == "core"


def test_payload_carries_mpy_source_excludes(tmp_path: Path):
    workspace = tmp_path
    (workspace / "src" / "micropython" / "ports" / "esp32" / "modules").mkdir(parents=True)
    _write_target_mapping(workspace)
    device_root = _setup_device_root(workspace)

    runtime_manifest = device_root / "runtime" / "general" / "manifest.json"
    manifest_payload = json.loads(runtime_manifest.read_text(encoding="utf-8"))
    manifest_payload["mpySourceExcludes"] = ["main.py", "./app/main_loop.py"]
    runtime_manifest.write_text(json.dumps(manifest_payload), encoding="utf-8")

    paths = resolve_staging_paths(workspace_root=workspace, target="esp32")
    payload = resolve_runtime_payload(
        workspace_root=paths.workspace_root,
        target=paths.target,
        runtime_id="general",
        device_root=device_root,
    )

    assert payload.mpy_source_excludes == ("main.py", "app/main_loop.py")


def test_resolve_runtime_payload_errors_for_unknown_runtime(tmp_path: Path):
    workspace = tmp_path
    (workspace / "src" / "micropython" / "ports" / "esp32" / "modules").mkdir(parents=True)
    device_root = _setup_device_root(workspace)

    paths = resolve_staging_paths(workspace_root=workspace, target="esp32")
    with pytest.raises(ValueError, match="Unknown runtime id"):
        resolve_runtime_payload(
            workspace_root=paths.workspace_root,
            target=paths.target,
            runtime_id="missing",
            device_root=device_root,
        )


def test_resolve_runtime_payload_rejects_excluded_target(tmp_path: Path):
    workspace = tmp_path
    (workspace / "src" / "micropython" / "ports" / "rp2" / "modules").mkdir(parents=True)
    device_root = _setup_device_root(workspace)

    runtime_manifest = device_root / "runtime" / "general" / "manifest.json"
    payload = json.loads(runtime_manifest.read_text(encoding="utf-8"))
    payload["deviceTargets"] = {"include": [], "exclude": ["rp2"]}
    runtime_manifest.write_text(json.dumps(payload), encoding="utf-8")

    paths = resolve_staging_paths(workspace_root=workspace, target="rp2")

    with pytest.raises(ValueError, match="Runtime excludes target"):
        resolve_runtime_payload(
            workspace_root=paths.workspace_root,
            target=paths.target,
            runtime_id="general",
            device_root=device_root,
        )


def test_resolve_runtime_payload_git_source_is_none_outside_repo(tmp_path: Path):
    # tmp_path is not a git repo, so git_source must be None.
    workspace = tmp_path
    (workspace / "src" / "micropython" / "ports" / "esp32" / "modules").mkdir(parents=True)
    device_root = _setup_device_root(workspace)
    _write_target_mapping(workspace)

    paths = resolve_staging_paths(workspace_root=workspace, target="esp32")
    payload = resolve_runtime_payload(
        workspace_root=paths.workspace_root,
        target=paths.target,
        runtime_id="general",
        device_root=device_root,
    )

    assert payload.git_source is None


def test_resolve_runtime_payload_uses_explicit_board_for_target_mapping(tmp_path: Path):
    workspace = tmp_path
    (workspace / "src" / "micropython" / "ports" / "esp32" / "modules").mkdir(parents=True)
    device_root = _setup_device_root(workspace)

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
                    "id": "esp32-s3-mini-default",
                    "webTargetId": "esp32_s3_mini",
                    "runtimeIdInclude": ["*"],
                    "runtimeIdExclude": [],
                    "compile": {"board": "ESP32_GENERIC_S3", "port": "esp32"},
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

    paths = resolve_staging_paths(workspace_root=workspace, target="esp32")
    payload = resolve_runtime_payload(
        workspace_root=paths.workspace_root,
        target=paths.target,
        runtime_id="general",
        device_root=device_root,
        board="ESP32_GENERIC_S3",
    )

    assert payload.compile_board_id == "ESP32_GENERIC_S3"
    assert payload.compile_port_id == "esp32"
    assert payload.target_mapping_rule_id == "esp32-s3-mini-default"


def _add_viper_package(device_root: Path) -> None:
    index_path = device_root / "node_pkgs" / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8"))
    index["packages"].append({"id": "audio", "manifest": "audio/manifest.json"})
    index_path.write_text(json.dumps(index), encoding="utf-8")

    _write_json(
        device_root / "node_pkgs" / "audio" / "manifest.json",
        {
            "id": "audio",
            "version": "1.0.0",
            "manifestVersion": 2,
            "variants": {
                "viper": {
                    "requiredCapabilities": ["viper"],
                    "mpAssets": {"*": ["otter_audio/__init__.py"]},
                }
            },
        },
    )
    asset = device_root / "node_pkgs" / "audio" / "otter_audio" / "__init__.py"
    asset.parent.mkdir(parents=True, exist_ok=True)
    asset.write_text("# test\n", encoding="utf-8")

    runtime_manifest = device_root / "runtime" / "general" / "manifest.json"
    payload = json.loads(runtime_manifest.read_text(encoding="utf-8"))
    payload["nodePackages"] = {"global": ["core", "audio"], "local": []}
    runtime_manifest.write_text(json.dumps(payload), encoding="utf-8")


def _write_esp32_target(device_root: Path, viper_supported: bool) -> None:
    _write_json(
        device_root / "targets" / "esp32_wroom.json",
        {
            "targetId": "esp32_wroom",
            "generalCapabilities": {"viper": {"supported": viper_supported}},
        },
    )


def test_resolve_runtime_payload_includes_package_when_capability_satisfied(tmp_path: Path):
    workspace = tmp_path
    (workspace / "src" / "micropython" / "ports" / "esp32" / "modules").mkdir(parents=True)
    _write_target_mapping(workspace)
    device_root = _setup_device_root(workspace)
    _add_viper_package(device_root)
    _write_esp32_target(device_root, viper_supported=True)

    paths = resolve_staging_paths(workspace_root=workspace, target="esp32")
    payload = resolve_runtime_payload(
        workspace_root=paths.workspace_root,
        target=paths.target,
        runtime_id="general",
        device_root=device_root,
    )

    package_ids = {asset.package_id for asset in payload.package_assets}
    assert "audio" in package_ids
    assert "core" in package_ids


def test_resolve_runtime_payload_excludes_package_missing_capability(tmp_path: Path):
    workspace = tmp_path
    (workspace / "src" / "micropython" / "ports" / "esp32" / "modules").mkdir(parents=True)
    _write_target_mapping(workspace)
    device_root = _setup_device_root(workspace)
    _add_viper_package(device_root)
    _write_esp32_target(device_root, viper_supported=False)

    paths = resolve_staging_paths(workspace_root=workspace, target="esp32")
    with pytest.warns(UserWarning, match="missing required capabilities"):
        payload = resolve_runtime_payload(
            workspace_root=paths.workspace_root,
            target=paths.target,
            runtime_id="general",
            device_root=device_root,
        )

    package_ids = {asset.package_id for asset in payload.package_assets}
    assert "audio" not in package_ids
    assert "core" in package_ids


def _add_package_with_requirements(device_root: Path, package_id: str, required: object) -> None:
    index_path = device_root / "node_pkgs" / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8"))
    index["packages"].append({"id": package_id, "manifest": f"{package_id}/manifest.json"})
    index_path.write_text(json.dumps(index), encoding="utf-8")

    _write_json(
        device_root / "node_pkgs" / package_id / "manifest.json",
        {
            "id": package_id,
            "version": "1.0.0",
            "manifestVersion": 2,
            "requiredCapabilities": required,
            "variants": {"py": {"mpAssets": {"*": [f"{package_id}/__init__.py"]}}},
        },
    )
    asset = device_root / "node_pkgs" / package_id / package_id / "__init__.py"
    asset.parent.mkdir(parents=True, exist_ok=True)
    asset.write_text("# test\n", encoding="utf-8")

    runtime_manifest = device_root / "runtime" / "general" / "manifest.json"
    payload = json.loads(runtime_manifest.read_text(encoding="utf-8"))
    payload["nodePackages"] = {"global": ["core", package_id], "local": []}
    runtime_manifest.write_text(json.dumps(payload), encoding="utf-8")


def _write_i2s_target(device_root: Path, controllers: int) -> None:
    _write_json(
        device_root / "targets" / "esp32_wroom.json",
        {
            "targetId": "esp32_wroom",
            "generalCapabilities": {"viper": {"supported": True}},
            "resources": {"i2s": {"controllers": controllers}},
        },
    )


def test_resolve_runtime_payload_includes_package_when_pin_capability_present(
    tmp_path: Path,
):
    workspace = tmp_path
    (workspace / "src" / "micropython" / "ports" / "esp32" / "modules").mkdir(parents=True)
    _write_target_mapping(workspace)
    device_root = _setup_device_root(workspace)
    _add_package_with_requirements(device_root, "audio", ["i2s"])
    _write_i2s_target(device_root, controllers=2)

    paths = resolve_staging_paths(workspace_root=workspace, target="esp32")
    payload = resolve_runtime_payload(
        workspace_root=paths.workspace_root,
        target=paths.target,
        runtime_id="general",
        device_root=device_root,
    )

    package_ids = {asset.package_id for asset in payload.package_assets}
    assert "audio" in package_ids


def test_resolve_runtime_payload_excludes_package_when_pin_capability_missing(
    tmp_path: Path,
):
    workspace = tmp_path
    (workspace / "src" / "micropython" / "ports" / "esp32" / "modules").mkdir(parents=True)
    _write_target_mapping(workspace)
    device_root = _setup_device_root(workspace)
    _add_package_with_requirements(device_root, "audio", ["i2s"])
    _write_i2s_target(device_root, controllers=0)

    paths = resolve_staging_paths(workspace_root=workspace, target="esp32")
    with pytest.warns(UserWarning, match="missing required capabilities"):
        payload = resolve_runtime_payload(
            workspace_root=paths.workspace_root,
            target=paths.target,
            runtime_id="general",
            device_root=device_root,
        )

    package_ids = {asset.package_id for asset in payload.package_assets}
    assert "audio" not in package_ids


def _write_connectivity_target(device_root: Path, wifi: bool, ethernet: bool) -> None:
    _write_json(
        device_root / "targets" / "esp32_wroom.json",
        {
            "targetId": "esp32_wroom",
            "generalCapabilities": {
                "wifi": {"supported": wifi},
                "ethernet": {"supported": ethernet},
            },
        },
    )


def test_resolve_runtime_payload_satisfies_or_group(tmp_path: Path):
    workspace = tmp_path
    (workspace / "src" / "micropython" / "ports" / "esp32" / "modules").mkdir(parents=True)
    _write_target_mapping(workspace)
    device_root = _setup_device_root(workspace)
    _add_package_with_requirements(device_root, "webview", [["wifi", "ethernet"]])
    _write_connectivity_target(device_root, wifi=True, ethernet=False)

    paths = resolve_staging_paths(workspace_root=workspace, target="esp32")
    payload = resolve_runtime_payload(
        workspace_root=paths.workspace_root,
        target=paths.target,
        runtime_id="general",
        device_root=device_root,
    )

    package_ids = {asset.package_id for asset in payload.package_assets}
    assert "webview" in package_ids


def test_resolve_runtime_payload_excludes_or_group_when_all_missing(tmp_path: Path):
    workspace = tmp_path
    (workspace / "src" / "micropython" / "ports" / "esp32" / "modules").mkdir(parents=True)
    _write_target_mapping(workspace)
    device_root = _setup_device_root(workspace)
    _add_package_with_requirements(device_root, "webview", [["wifi", "ethernet"]])
    _write_connectivity_target(device_root, wifi=False, ethernet=False)

    paths = resolve_staging_paths(workspace_root=workspace, target="esp32")
    with pytest.warns(UserWarning, match="missing required capabilities"):
        payload = resolve_runtime_payload(
            workspace_root=paths.workspace_root,
            target=paths.target,
            runtime_id="general",
            device_root=device_root,
        )

    package_ids = {asset.package_id for asset in payload.package_assets}
    assert "webview" not in package_ids


def test_package_gating_context_presence_for_esp32_s3():
    registry = CapabilityRegistry(REAL_CAPABILITIES)
    target = load_effective_target_payload(REAL_DEVICE_ROOT, "esp32_s3_mini")
    is_general, has_general, has_pin = build_package_gating_context(target, registry)

    assert is_general("viper") is True
    assert is_general("wifi") is True
    assert is_general("ethernet") is True
    assert is_general("i2s") is False

    assert has_general("viper") is True
    assert has_general("wifi") is True
    assert has_general("ethernet") is False

    assert has_pin("i2s") is True
    assert has_pin("i2c") is True
    assert has_pin("spi") is True
    assert has_pin("uart") is True


def _install_addon(addons_root: Path, package_id: str = "sample_addon") -> Path:
    """Create one installed add-on package and return its directory."""

    package_dir = addons_root / package_id
    _write_json(
        package_dir / "manifest.json",
        {
            "id": package_id,
            "version": "1.0.0",
            "manifestVersion": 2,
            "variants": {"py": {"mpAssets": {"*": [f"moa_{package_id}/__init__.py"]}}},
        },
    )
    module = package_dir / f"moa_{package_id}" / "__init__.py"
    module.parent.mkdir(parents=True, exist_ok=True)
    module.write_text("# addon\n", encoding="utf-8")
    return package_dir


def _install_variant_addon(addons_root: Path, package_id: str = "pulse") -> Path:
    """Create one installed add-on with a default and a viper variant, and return its directory."""

    package_dir = addons_root / package_id
    _write_json(
        package_dir / "manifest.json",
        {
            "id": package_id,
            "version": "1.0.0",
            "manifestVersion": 2,
            "variants": {
                "py": {"precedence": 0, "mpAssets": {"*": [f"moa_{package_id}/__init__.py"]}},
                "viper": {
                    "requiredCapabilities": ["viper"],
                    "precedence": 10,
                    "mpAssets": {"*": [f"moa_{package_id}_viper/__init__.py"]},
                },
            },
        },
    )
    for module in (f"moa_{package_id}", f"moa_{package_id}_viper"):
        asset = package_dir / module / "__init__.py"
        asset.parent.mkdir(parents=True, exist_ok=True)
        asset.write_text("# addon\n", encoding="utf-8")
    return package_dir


def test_resolve_runtime_payload_stages_addons_by_default(tmp_path: Path):
    workspace = tmp_path
    (workspace / "src" / "micropython" / "ports" / "esp32" / "modules").mkdir(parents=True)
    _write_target_mapping(workspace)
    device_root = _setup_device_root(workspace)
    addons_root = workspace / "addons"
    package_dir = _install_addon(addons_root)

    paths = resolve_staging_paths(workspace_root=workspace, target="esp32")
    payload = resolve_runtime_payload(
        workspace_root=paths.workspace_root,
        target=paths.target,
        runtime_id="general",
        device_root=device_root,
        addons_root=addons_root,
    )

    staged_ids = list(dict.fromkeys(asset.package_id for asset in payload.package_assets))
    assert staged_ids == ["core", "sample_addon"]
    assert payload.addon_package_ids == ("sample_addon",)
    addon_asset = payload.package_assets[-1]
    assert addon_asset.source_path == (package_dir / "moa_sample_addon" / "__init__.py").resolve()
    assert addon_asset.provenance.value == "addon"
    assert payload.package_assets[0].provenance.value == "builtin"


def test_resolve_runtime_payload_without_addons_keeps_the_builtin_order(tmp_path: Path):
    workspace = tmp_path
    (workspace / "src" / "micropython" / "ports" / "esp32" / "modules").mkdir(parents=True)
    _write_target_mapping(workspace)
    device_root = _setup_device_root(workspace)

    paths = resolve_staging_paths(workspace_root=workspace, target="esp32")
    baseline = resolve_runtime_payload(
        workspace_root=paths.workspace_root,
        target=paths.target,
        runtime_id="general",
        device_root=device_root,
    )
    with_root = resolve_runtime_payload(
        workspace_root=paths.workspace_root,
        target=paths.target,
        runtime_id="general",
        device_root=device_root,
        addons_root=workspace / "missing-addons",
    )

    assert with_root.package_assets == baseline.package_assets
    assert with_root.addon_package_ids == ()


def test_package_ids_accepts_an_addon_and_rejects_an_unknown_id(tmp_path: Path):
    workspace = tmp_path
    (workspace / "src" / "micropython" / "ports" / "esp32" / "modules").mkdir(parents=True)
    _write_target_mapping(workspace)
    device_root = _setup_device_root(workspace)
    addons_root = workspace / "addons"
    _install_addon(addons_root)

    paths = resolve_staging_paths(workspace_root=workspace, target="esp32")
    payload = resolve_runtime_payload(
        workspace_root=paths.workspace_root,
        target=paths.target,
        runtime_id="general",
        device_root=device_root,
        package_ids=("sample_addon",),
        addons_root=addons_root,
    )

    assert [asset.package_id for asset in payload.package_assets] == ["sample_addon"]

    with pytest.raises(UnknownPackageIdError) as error:
        resolve_runtime_payload(
            workspace_root=paths.workspace_root,
            target=paths.target,
            runtime_id="general",
            device_root=device_root,
            package_ids=("ghost_pkg",),
            addons_root=addons_root,
        )

    assert "sample_addon" in error.value.known


def test_package_variants_for_an_unselected_package_raises(tmp_path: Path):
    workspace = tmp_path
    (workspace / "src" / "micropython" / "ports" / "esp32" / "modules").mkdir(parents=True)
    _write_target_mapping(workspace)
    device_root = _setup_device_root(workspace)
    addons_root = workspace / "addons"
    _install_addon(addons_root)

    paths = resolve_staging_paths(workspace_root=workspace, target="esp32")

    with pytest.raises(VariantPackageNotSelectedError) as error:
        resolve_runtime_payload(
            workspace_root=paths.workspace_root,
            target=paths.target,
            runtime_id="general",
            device_root=device_root,
            package_ids=("sample_addon",),
            addons_root=addons_root,
            package_variants={"ghost_pkg": "viper"},
        )

    assert error.value.package_ids == ("ghost_pkg",)


def test_package_variants_reaches_variant_selection(tmp_path: Path):
    workspace = tmp_path
    (workspace / "src" / "micropython" / "ports" / "esp32" / "modules").mkdir(parents=True)
    _write_target_mapping(workspace)
    device_root = _setup_device_root(workspace)
    addons_root = workspace / "addons"
    _install_addon(addons_root)

    paths = resolve_staging_paths(workspace_root=workspace, target="esp32")

    # The override reaches select_variant and names an unknown variant, proving the
    # plumbing (it would otherwise raise VariantPackageNotSelectedError).
    with pytest.raises(VariantUnknownError) as error:
        resolve_runtime_payload(
            workspace_root=paths.workspace_root,
            target=paths.target,
            runtime_id="general",
            device_root=device_root,
            package_ids=("sample_addon",),
            addons_root=addons_root,
            package_variants={"sample_addon": "nonexistent"},
        )

    assert error.value.package_id == "sample_addon"
    assert error.value.requested == "nonexistent"


def test_package_variants_none_matches_the_default_selection(tmp_path: Path):
    workspace = tmp_path
    (workspace / "src" / "micropython" / "ports" / "esp32" / "modules").mkdir(parents=True)
    _write_target_mapping(workspace)
    device_root = _setup_device_root(workspace)
    addons_root = workspace / "addons"
    _install_addon(addons_root)

    paths = resolve_staging_paths(workspace_root=workspace, target="esp32")
    kwargs = dict(
        workspace_root=paths.workspace_root,
        target=paths.target,
        runtime_id="general",
        device_root=device_root,
        package_ids=("sample_addon",),
        addons_root=addons_root,
    )

    baseline = resolve_runtime_payload(**kwargs)
    with_none = resolve_runtime_payload(package_variants=None, **kwargs)

    assert with_none.package_assets == baseline.package_assets


def test_package_variants_default_forces_the_micro_python_implementation(tmp_path: Path):
    workspace = tmp_path
    (workspace / "src" / "micropython" / "ports" / "esp32" / "modules").mkdir(parents=True)
    _write_target_mapping(workspace)
    device_root = _setup_device_root(workspace)
    _write_esp32_target(device_root, viper_supported=True)
    addons_root = workspace / "addons"
    _install_variant_addon(addons_root)

    paths = resolve_staging_paths(workspace_root=workspace, target="esp32")
    payload = resolve_runtime_payload(
        workspace_root=paths.workspace_root,
        target=paths.target,
        runtime_id="general",
        device_root=device_root,
        addons_root=addons_root,
        package_variants={"pulse": DEFAULT_VARIANT_ID},
    )

    pulse_assets = [asset for asset in payload.package_assets if asset.package_id == "pulse"]
    assert pulse_assets, "expected the pulse add-on to be staged"
    module_roots = {asset.source_path.parts[-2] for asset in pulse_assets}
    assert "moa_pulse" in module_roots
    assert "moa_pulse_viper" not in module_roots

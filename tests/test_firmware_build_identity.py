"""Tests for the single build-identity resolver introduced in M4j phase 1."""

from __future__ import annotations

import json
from pathlib import Path
from unittest import mock

import pytest

from micro_otter.tools.firmware_compile.build_identity import (
    BuildIdentity,
    PackageVersionInventory,
    resolve_build_identity,
)
from micro_otter.tools.firmware_compile.package_versions import (
    PackageVersionInventory as MovedPackageVersionInventory,
)
from micro_otter.tools.firmware_compile.target_mapping import CompileTargetResolution


def test_package_version_inventory_is_reexported_from_build_identity() -> None:
    """Both import paths name the one dataclass, so no call site breaks."""

    assert PackageVersionInventory is MovedPackageVersionInventory


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _add_builtin(device_root: Path, package_id: str, version: str) -> None:
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


def _add_two_variant_builtin(device_root: Path, package_id: str, version: str) -> None:
    """Add one built-in package with a default and a ``viper`` variant."""

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
            "variants": {
                "py": {"mpAssets": {"*": [f"libs/{package_id}/__init__.py"]}},
                "viper": {
                    "precedence": 10,
                    "requiredCapabilities": ["viper"],
                    "mpAssets": {"*": [f"libs/{package_id}_viper/__init__.py"]},
                },
            },
        },
    )


def _add_addon(addons_root: Path, package_id: str, version: str) -> None:
    _write_json(
        addons_root / package_id / "manifest.json",
        {
            "id": package_id,
            "name": package_id,
            "version": version,
            "manifestVersion": 2,
            "variants": {"py": {"mpAssets": {"*": [f"moa_{package_id}/__init__.py"]}}},
        },
    )


def _request(tmp_path: Path, device_root: Path, addons_root: Path | None) -> mock.Mock:
    request = mock.Mock(
        board="esp32",
        slug="esp32",
        runtime_id="general",
        device_root=device_root,
        addons_root=addons_root,
        workspace_root=tmp_path,
        package_ids=("core", "hello"),
        package_variants=None,
    )
    request.target = mock.Mock(build_backend="esp-idf")
    request.build_profile = mock.Mock(
        packaging_mode=mock.Mock(value="source-py"),
        optimization_level=None,
    )
    return request


def _fake_version_identity() -> mock.Mock:
    """Return a resolved firmware version identity mock."""
    return mock.Mock(
        version="0.1.0",
        base_version="0.1.0",
        channel="release",
        source=mock.Mock(value="git-release-tag"),
        commit=None,
        distance=None,
        branch=None,
        tag=None,
        released_at_utc=None,
        shallow=False,
    )


def test_package_version_inventory_merged_is_sorted_and_disjoint() -> None:
    inventory = PackageVersionInventory(builtin={"b": "1.0.0", "a": "2.0.0"}, addons={"c": "3.0.0"})
    assert inventory.merged() == {"a": "2.0.0", "b": "1.0.0", "c": "3.0.0"}


def test_package_version_inventory_collision_raises() -> None:
    inventory = PackageVersionInventory(builtin={"a": "1.0.0"}, addons={"a": "2.0.0"})
    with pytest.raises(ValueError):
        inventory.merged()


def test_resolve_build_identity_populates_every_field(tmp_path: Path) -> None:
    device_root = tmp_path / "device"
    _write_json(device_root / "runtime" / "general" / "manifest.json", {"version": "1.11.0"})
    _write_json(device_root / "tools" / "manifest.json", {"version": "0.2.1"})
    _write_json(device_root / "node_pkgs" / "index.json", {"packages": []})
    _add_builtin(device_root, "core", "1.0.0")

    addons_root = tmp_path / "addons"
    _add_addon(addons_root, "hello", "0.2.0")

    request = _request(tmp_path, device_root, addons_root)

    with mock.patch(
        "micro_otter.tools.firmware_compile.build_identity.get_repo_name",
        return_value="my-repo",
    ), mock.patch(
        "micro_otter.tools.firmware_compile.build_identity.read_packaged_runtime_assets_version",
        return_value="1.2.2",
    ), mock.patch(
        "micro_otter.tools.firmware_compile.version_identity.resolve_firmware_version",
        return_value=_fake_version_identity(),
    ):
        identity = resolve_build_identity(
            request=request,
            runtime_payload={
                "version": "1.11.0",
                "nodePackages": {"global": ["core"], "local": []},
            },
            micropython_version="1.27.0",
        )

    assert isinstance(identity, BuildIdentity)
    assert identity.board_name == "esp32"
    assert identity.board_slug == "esp32"
    assert identity.backend == "esp-idf"
    assert identity.runtime_id == "general"
    assert identity.platform_version == "1.27.0"
    assert identity.runtime_source_version == "1.11.0"
    assert identity.device_tools_version == "0.2.1"
    assert identity.runtime_assets_version == "1.2.2"
    assert identity.runtime_firmware_version == "0.1.0"
    assert identity.package_ids == ("core", "hello")
    assert identity.package_variants == {"core": "py", "hello": "py"}
    assert identity.requested_package_variants is None
    assert identity.packages.merged() == {"core": "1.0.0", "hello": "0.2.0"}
    assert identity.packages.addons == {"hello": "0.2.0"}
    assert identity.constituents == {
        "runtime-source": "1.11.0",
        "device-tools": "0.2.1",
        "runtime-assets": "1.2.2",
    }
    assert len(identity.content_hash) == 12
    assert identity.full_version.startswith("1.27.0-esp32-general-0.1.0-")
    assert identity.filename == f"my-repo-{identity.full_version}.bin"


def test_resolve_build_identity_is_deterministic(tmp_path: Path) -> None:
    device_root = tmp_path / "device"
    _write_json(device_root / "runtime" / "general" / "manifest.json", {"version": "1.11.0"})
    _write_json(device_root / "tools" / "manifest.json", {"version": "0.2.1"})
    _write_json(device_root / "node_pkgs" / "index.json", {"packages": []})

    request = _request(tmp_path, device_root, None)
    with mock.patch(
        "micro_otter.tools.firmware_compile.build_identity.get_repo_name",
        return_value="my-repo",
    ), mock.patch(
        "micro_otter.tools.firmware_compile.build_identity.read_packaged_runtime_assets_version",
        return_value="1.2.2",
    ), mock.patch(
        "micro_otter.tools.firmware_compile.version_identity.resolve_firmware_version",
        return_value=_fake_version_identity(),
    ):
        first = resolve_build_identity(
            request=request,
            runtime_payload={"version": "1.11.0"},
            micropython_version="1.27.0",
        )
        second = resolve_build_identity(
            request=request,
            runtime_payload={"version": "1.11.0"},
            micropython_version="1.27.0",
        )

    assert first.content_hash == second.content_hash
    assert first.filename == second.filename


def test_resolve_build_identity_prefers_staged_runtime_assets(tmp_path: Path) -> None:
    device_root = tmp_path / "device"
    _write_json(device_root / "runtime" / "general" / "manifest.json", {"version": "1.11.0"})
    _write_json(device_root / "tools" / "manifest.json", {"version": "0.2.1"})
    _write_json(device_root / "node_pkgs" / "index.json", {"packages": []})

    request = _request(tmp_path, device_root, None)
    with mock.patch(
        "micro_otter.tools.firmware_compile.build_identity.get_repo_name",
        return_value="my-repo",
    ), mock.patch(
        "micro_otter.tools.firmware_compile.build_identity.read_packaged_runtime_assets_version",
        return_value="1.2.2",
    ), mock.patch(
        "micro_otter.tools.firmware_compile.version_identity.resolve_firmware_version",
        return_value=_fake_version_identity(),
    ):
        identity = resolve_build_identity(
            request=request,
            runtime_payload={"version": "1.11.0"},
            micropython_version="1.27.0",
            staged_runtime_assets_version="1.3.0",
        )

    assert identity.runtime_assets_version == "1.3.0"
    assert identity.constituents["runtime-assets"] == "1.3.0"
    assert list(identity.warnings) == [
        {"code": "runtime-assets-version-mismatch", "staged": "1.3.0", "packaged": "1.2.2"}
    ]


def _write_viper_capability(device_root: Path, *, supported: bool) -> None:
    """Write a capability registry and target payload exposing ``viper`` or not."""

    _write_json(
        device_root / "capabilities" / "index.json",
        {"version": 1, "files": ["general.json"]},
    )
    _write_json(
        device_root / "capabilities" / "general.json",
        {"capabilities": [{"id": "viper", "domain": "general"}]},
    )
    _write_json(
        device_root / "targets" / "esp32_wroom.json",
        {"generalCapabilities": {"viper": {"supported": supported}}},
    )


def _two_variant_identity(
    tmp_path: Path,
    *,
    viper: bool,
    requested_variants: dict[str, str] | None = None,
):
    """Resolve one identity for a package that ships a default and a ``viper`` manifest."""

    device_root = tmp_path / "device"
    _write_json(device_root / "runtime" / "general" / "manifest.json", {"version": "1.11.0"})
    _write_json(device_root / "tools" / "manifest.json", {"version": "0.2.1"})
    _write_json(device_root / "node_pkgs" / "index.json", {"packages": []})
    _add_two_variant_builtin(device_root, "pulse", "1.0.0")
    _write_viper_capability(device_root, supported=viper)

    request = _request(tmp_path, device_root, None)
    request.package_ids = ("pulse",)
    request.package_variants = requested_variants
    request.target_resolution = CompileTargetResolution(
        web_target_id="esp32_wroom",
        allowed_web_target_ids=("esp32_wroom",),
        compile_board="esp32",
        compile_port="esp32",
        mapping_rule_id="test-rule",
        mapping_source="test",
        mapping_confidence="exact",
    )

    with mock.patch(
        "micro_otter.tools.firmware_compile.build_identity.get_repo_name",
        return_value="my-repo",
    ), mock.patch(
        "micro_otter.tools.firmware_compile.build_identity.read_packaged_runtime_assets_version",
        return_value="1.2.2",
    ), mock.patch(
        "micro_otter.tools.firmware_compile.version_identity.resolve_firmware_version",
        return_value=_fake_version_identity(),
    ):
        return resolve_build_identity(
            request=request,
            runtime_payload={"version": "1.11.0", "nodePackages": {"global": ["pulse"]}},
            micropython_version="1.27.0",
        )


def test_resolve_build_identity_carries_the_effective_variant_map(tmp_path: Path) -> None:
    """The collected inventory names the variant the target actually froze."""

    identity = _two_variant_identity(tmp_path, viper=True, requested_variants={"pulse": "viper"})

    assert identity.packages.variants == {"pulse": "viper"}
    assert identity.package_variants == {"pulse": "viper"}
    assert identity.packages.merged() == {"pulse": "1.0.0"}
    assert identity.requested_package_variants == {"pulse": "viper"}
    assert identity.selection["packageVariants"] == {"pulse": "viper"}


def test_a_variant_change_renames_the_image(tmp_path: Path) -> None:
    """Two builds that stage different variants differ in hash, version and filename."""

    capable = _two_variant_identity(
        tmp_path / "capable", viper=True, requested_variants={"pulse": "viper"}
    )
    incapable = _two_variant_identity(
        tmp_path / "incapable", viper=False, requested_variants={"pulse": "py"}
    )

    assert capable.package_variants == {"pulse": "viper"}
    assert incapable.package_variants == {"pulse": "py"}
    assert capable.content_hash != incapable.content_hash
    assert capable.full_version != incapable.full_version
    assert capable.filename != incapable.filename


def test_an_explicit_request_is_recorded_beside_the_outcome(tmp_path: Path) -> None:
    """The request and the outcome are separate facts on the identity."""

    identity = _two_variant_identity(
        tmp_path, viper=True, requested_variants={"pulse": "py"}
    )

    assert identity.package_variants == {"pulse": "py"}
    assert identity.requested_package_variants == {"pulse": "py"}
    assert identity.selection["packageVariants"] == {"pulse": "py"}


def test_the_same_request_twice_produces_the_same_identity(tmp_path: Path) -> None:
    """Identity resolution stays deterministic for an unchanged tree."""

    first = _two_variant_identity(tmp_path, viper=True, requested_variants={"pulse": "viper"})
    second = _two_variant_identity(tmp_path, viper=True, requested_variants={"pulse": "viper"})

    assert (first.content_hash, first.full_version, first.filename) == (
        second.content_hash,
        second.full_version,
        second.filename,
    )


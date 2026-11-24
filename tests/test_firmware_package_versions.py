"""Tests for the single package-version collector (M4u phase 2)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from micro_otter.tools.firmware_compile.package_resolver import (
    VariantCapabilitiesUnsatisfiedError,
    VariantUnknownError,
)
from micro_otter.tools.firmware_compile.package_versions import (
    PackageVersionInventory,
    collect_package_versions,
    read_device_tools_version,
    read_manifest_version,
)
from micro_otter.tools.firmware_compile.target_context import TargetPackageContext


def _write_json(path: Path, payload: object) -> None:
    """Write *payload* as JSON to *path*, creating parents."""

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _context(*, viper: bool, wifi: bool = False) -> TargetPackageContext:
    """Return a context that supports ``viper``/``wifi`` only when asked."""

    def is_general(capability: str) -> bool:
        """Report ``viper`` and ``wifi`` as general-domain capabilities."""

        return capability in {"viper", "wifi"}

    def has_general_capability(capability: str) -> bool:
        """Report the requested general capabilities only."""

        if capability == "viper":
            return viper
        if capability == "wifi":
            return wifi
        return False

    def has_pin_capability(_capability: str) -> bool:
        """Report no pin capabilities; these tests gate on general ones."""

        return False

    return TargetPackageContext(
        target_id="test-target",
        is_general=is_general,
        has_general_capability=has_general_capability,
        has_pin_capability=has_pin_capability,
    )


def _add_builtin(
    device_root: Path,
    package_id: str,
    version: str,
    *,
    variants: dict[str, str] | None = None,
    required: tuple[str, ...] = (),
) -> None:
    """Add one built-in package with a ``py`` variant plus optional extra variants."""

    index_path = device_root / "node_pkgs" / "index.json"
    index = (
        json.loads(index_path.read_text(encoding="utf-8"))
        if index_path.is_file()
        else {"version": 2, "packages": []}
    )
    index["packages"].append({"id": package_id, "manifest": f"{package_id}/manifest.json"})
    variant_map = {
        "py": {
            "precedence": 0,
            "requiredCapabilities": list(required),
            "mpAssets": {"*": [f"{package_id}/__init__.py"]},
        }
    }
    for variant in (variants or {}):
        variant_map[variant] = {
            "precedence": 10,
            "requiredCapabilities": ["viper"],
            "mpAssets": {"*": [f"{package_id}_{variant}/__init__.py"]},
        }
    _write_json(
        device_root / "node_pkgs" / package_id / "manifest.json",
        {
            "id": package_id,
            "version": version,
            "manifestVersion": 2,
            "variants": variant_map,
        },
    )
    _write_json(index_path, index)


def _add_addon(
    addons_root: Path,
    package_id: str,
    version: str,
    *,
    variants: dict[str, str] | None = None,
) -> None:
    """Add one installed add-on package with a ``py`` variant plus optional variants."""

    variant_map = {
        "py": {
            "precedence": 0,
            "requiredCapabilities": [],
            "mpAssets": {"*": [f"moa_{package_id}/__init__.py"]},
        }
    }
    for variant in (variants or {}):
        variant_map[variant] = {
            "precedence": 10,
            "requiredCapabilities": ["viper"],
            "mpAssets": {"*": [f"moa_{package_id}_{variant}/__init__.py"]},
        }
    _write_json(
        addons_root / package_id / "manifest.json",
        {
            "id": package_id,
            "name": package_id,
            "version": version,
            "manifestVersion": 2,
            "variants": variant_map,
        },
    )



def test_read_device_tools_version_follows_the_manifest(tmp_path: Path) -> None:
    """A valid tools manifest supplies the device-tools version."""

    _write_json(tmp_path / "tools" / "manifest.json", {"version": "0.2.1"})

    assert read_device_tools_version(tmp_path) == "0.2.1"


def test_read_device_tools_version_falls_back_without_a_manifest(tmp_path: Path) -> None:
    """A missing tools manifest degrades to ``0.0.0``."""

    assert read_device_tools_version(tmp_path) == "0.0.0"


def test_read_device_tools_version_falls_back_on_an_invalid_version(tmp_path: Path) -> None:
    """A non-semver tools version degrades to ``0.0.0`` instead of raising."""

    _write_json(tmp_path / "tools" / "manifest.json", {"version": "dev-build"})

    assert read_device_tools_version(tmp_path) == "0.0.0"


def test_read_manifest_version_tolerates_garbage_and_missing_files(tmp_path: Path) -> None:
    """A broken manifest and an absent one both read as ``None``."""

    broken = tmp_path / "manifest.json"
    broken.write_text("{not json", encoding="utf-8")

    assert read_manifest_version(broken) is None
    assert read_manifest_version(tmp_path / "missing.json") is None
    assert read_manifest_version(tmp_path) is None


def test_inventory_defaults_the_variant_map_to_empty() -> None:
    """An inventory built without variants keeps the legacy shape."""

    inventory = PackageVersionInventory(builtin={"core": "1.0.0"}, addons={})

    assert inventory.variants == {}
    assert inventory.merged() == {"core": "1.0.0"}


def test_single_manifest_package_records_the_default_variant(tmp_path: Path) -> None:
    """A package with one manifest records version and ``py``."""

    device_root = tmp_path / "device"
    _add_builtin(device_root, "core", "1.0.0")

    inventory = collect_package_versions(
        device_root=device_root,
        runtime_payload={"nodePackages": {"global": ["core"]}},
        context=_context(viper=False),
    )

    assert inventory.builtin == {"core": "1.0.0"}
    assert inventory.addons == {}
    assert inventory.variants == {"core": "py"}


def test_two_variant_package_records_the_requested_variant(tmp_path: Path) -> None:
    """The collector records the explicitly requested variant."""

    device_root = tmp_path / "device"
    _add_builtin(device_root, "pulse", "1.0.0", variants={"viper": "1.0.0"})
    runtime_payload = {"nodePackages": {"global": ["pulse"]}}

    capable = collect_package_versions(
        device_root=device_root,
        runtime_payload=runtime_payload,
        context=_context(viper=True),
        requested_variants={"pulse": "viper"},
    )
    incapable = collect_package_versions(
        device_root=device_root,
        runtime_payload=runtime_payload,
        context=_context(viper=False),
        requested_variants={"pulse": "py"},
    )

    assert capable.variants == {"pulse": "viper"}
    assert incapable.variants == {"pulse": "py"}
    assert capable.merged() == incapable.merged() == {"pulse": "1.0.0"}


def test_unsatisfiable_package_is_absent_from_both_maps(tmp_path: Path) -> None:
    """A package the image cannot contain is not claimed by the identity."""

    device_root = tmp_path / "device"
    _add_builtin(device_root, "wifi_only", "1.0.0", required=("wifi",))

    inventory = collect_package_versions(
        device_root=device_root,
        runtime_payload={"nodePackages": {"global": ["wifi_only"]}},
        context=_context(viper=False),
    )

    assert inventory.merged() == {}
    assert inventory.variants == {}


def test_addon_is_collected_under_addons_with_its_variant(tmp_path: Path) -> None:
    """An installed add-on is part of the image, so it is part of the inventory."""

    device_root = tmp_path / "device"
    _write_json(device_root / "node_pkgs" / "index.json", {"version": 1, "packages": []})
    addons_root = tmp_path / "addons"
    _add_addon(addons_root, "pulse", "1.0.0", variants={"viper": "1.0.0"})

    inventory = collect_package_versions(
        device_root=device_root,
        runtime_payload={"nodePackages": {"global": []}},
        context=_context(viper=True),
        addons_root=addons_root,
        requested_variants={"pulse": "viper"},
    )

    assert inventory.addons == {"pulse": "1.0.0"}
    assert inventory.builtin == {}
    assert inventory.variants == {"pulse": "viper"}


def test_package_ids_narrows_the_collection(tmp_path: Path) -> None:
    """``package_ids`` freezes exactly the requested subset."""

    device_root = tmp_path / "device"
    _add_builtin(device_root, "core", "1.0.0")
    _add_builtin(device_root, "audio", "2.0.0")

    inventory = collect_package_versions(
        device_root=device_root,
        runtime_payload={"nodePackages": {"global": ["core", "audio"]}},
        context=_context(viper=False),
        package_ids=("core",),
    )

    assert inventory.merged() == {"core": "1.0.0"}
    assert inventory.variants == {"core": "py"}


def test_explicit_unsatisfiable_request_raises(tmp_path: Path) -> None:
    """A request that cannot be honoured is never silently replaced."""

    device_root = tmp_path / "device"
    _add_builtin(device_root, "pulse", "1.0.0", variants={"viper": "1.0.0"})

    with pytest.raises(VariantCapabilitiesUnsatisfiedError):
        collect_package_versions(
            device_root=device_root,
            runtime_payload={"nodePackages": {"global": ["pulse"]}},
            context=_context(viper=False),
            requested_variants={"pulse": "viper"},
        )


def test_explicit_unknown_request_raises(tmp_path: Path) -> None:
    """An unknown requested variant id is an error, not a fallback."""

    device_root = tmp_path / "device"
    _add_builtin(device_root, "pulse", "1.0.0", variants={"viper": "1.0.0"})

    with pytest.raises(VariantUnknownError):
        collect_package_versions(
            device_root=device_root,
            runtime_payload={"nodePackages": {"global": ["pulse"]}},
            context=_context(viper=True),
            requested_variants={"pulse": "nonexistent"},
        )


def test_explicit_default_request_forces_the_plain_implementation(tmp_path: Path) -> None:
    """``pulse=py`` selects the default manifest even on a capable target."""

    device_root = tmp_path / "device"
    _add_builtin(device_root, "pulse", "1.0.0", variants={"viper": "1.0.0"})

    inventory = collect_package_versions(
        device_root=device_root,
        runtime_payload={"nodePackages": {"global": ["pulse"]}},
        context=_context(viper=True),
        requested_variants={"pulse": "py"},
    )

    assert inventory.variants == {"pulse": "py"}


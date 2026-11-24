"""Tests for root-aware node-package resolution (:mod:`package_resolver`)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from micro_otter.tools.firmware_compile.package_resolver import (
    NodePackageRoot,
    PackageIndexEntry,
    load_package_entries,
    package_roots,
    read_package_manifest,
    resolve_variant_entries,
    select_variant,
)


def _write_json(path: Path, payload: object) -> None:
    """Write *payload* as JSON to *path*, creating parents."""

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _device_root(tmp_path: Path, ids: list[str]) -> Path:
    """Create a device root whose index declares *ids* and whose manifests exist."""

    device_root = tmp_path / "device"
    _write_json(
        device_root / "node_pkgs" / "index.json",
        {
            "version": 1,
            "packages": [
                {"id": package_id, "manifest": f"{package_id}/manifest.json"}
                for package_id in ids
            ],
        },
    )
    for package_id in ids:
        _write_json(
            device_root / "node_pkgs" / package_id / "manifest.json",
            {"id": package_id, "version": "1.0.0", "manifestVersion": 2, "variants": {"py": {}}},
        )
    return device_root


def _addon(addons_root: Path, package_id: str, *, version: str = "2.0.0") -> Path:
    """Create one installed add-on package and return its directory."""

    package_dir = addons_root / package_id
    _write_json(
        package_dir / "manifest.json",
        {
            "id": package_id,
            "version": version,
            "manifestVersion": 2,
            "variants": {"py": {"mpAssets": {"*": [f"moa_{package_id}/__init__.py"]}}},
        },
    )
    module = package_dir / f"moa_{package_id}" / "__init__.py"
    module.parent.mkdir(parents=True, exist_ok=True)
    module.write_text("# stub\n", encoding="utf-8")
    return package_dir


def _context(viper_supported: bool = True):
    """Return the capability callables ``select_variant`` needs."""

    return {
        "is_general": lambda capability: capability == "viper",
        "has_general_capability": lambda capability: capability == "viper" and viper_supported,
        "has_pin_capability": lambda capability: False,
    }


def test_package_roots_joins_both_roots(tmp_path: Path) -> None:
    device_root = _device_root(tmp_path, ["core"])
    addons_root = tmp_path / "addons"
    roots = package_roots(device_root, addons_root)

    builtin_entry = PackageIndexEntry(id="core", manifest="core/manifest.json")
    addon_entry = PackageIndexEntry(
        id="sample_addon",
        manifest="sample_addon/manifest.json",
        root=NodePackageRoot.ADDONS,
    )

    assert roots.builtin_node_pkgs == device_root / "node_pkgs"
    assert roots.root_path(NodePackageRoot.DEVICE) == device_root / "node_pkgs"
    assert roots.root_path(NodePackageRoot.ADDONS) == addons_root
    assert roots.manifest_path(builtin_entry) == (
        device_root / "node_pkgs" / "core" / "manifest.json"
    )
    assert roots.package_dir(addon_entry) == addons_root / "sample_addon"


def test_package_roots_rejects_an_addon_entry_without_a_root(tmp_path: Path) -> None:
    roots = package_roots(tmp_path / "device", None)
    entry = PackageIndexEntry(
        id="sample_addon", manifest="sample_addon/manifest.json", root=NodePackageRoot.ADDONS
    )

    with pytest.raises(ValueError, match="addons root"):
        roots.manifest_path(entry)


def test_asset_path_resolves_and_rejects_escapes(tmp_path: Path) -> None:
    package_dir = _addon(tmp_path / "addons", "sample_addon")
    roots = package_roots(tmp_path / "device", tmp_path / "addons")

    assert roots.asset_path(package_dir, "moa_sample_addon/__init__.py") == (
        package_dir / "moa_sample_addon" / "__init__.py"
    ).resolve()
    for bad in ("../x", "/abs/x", "", "moa_sample_addon\\x.py"):
        with pytest.raises(ValueError, match="package asset path|invalid package asset"):
            roots.asset_path(package_dir, bad)


def test_load_package_entries_without_addons_matches_the_index(tmp_path: Path) -> None:
    device_root = _device_root(tmp_path, ["core", "led"])

    entries = load_package_entries(device_root)

    assert [(entry.id, entry.manifest, entry.root) for entry in entries] == [
        ("core", "core/manifest.json", NodePackageRoot.DEVICE),
        ("led", "led/manifest.json", NodePackageRoot.DEVICE),
    ]


def test_load_package_entries_appends_addons_after_builtins(tmp_path: Path) -> None:
    device_root = _device_root(tmp_path, ["core", "led"])
    addons_root = tmp_path / "addons"
    _addon(addons_root, "sample_addon")

    entries = load_package_entries(device_root, addons_root=addons_root)

    assert [entry.id for entry in entries] == ["core", "led", "sample_addon"]
    addon_entry = entries[-1]
    assert addon_entry.root == NodePackageRoot.ADDONS
    assert addon_entry.manifest == "sample_addon/manifest.json"


def test_duplicate_id_keeps_only_the_builtin_entry(tmp_path: Path) -> None:
    device_root = _device_root(tmp_path, ["core"])
    addons_root = tmp_path / "addons"
    _addon(addons_root, "core")

    entries = load_package_entries(device_root, addons_root=addons_root)

    assert [(entry.id, entry.root) for entry in entries] == [("core", NodePackageRoot.DEVICE)]


def test_resolve_variant_entries_returns_the_package_entry(tmp_path: Path) -> None:
    device_root = _device_root(tmp_path, ["core"])
    addons_root = tmp_path / "addons"
    _addon(addons_root, "sample_addon")
    entries = load_package_entries(device_root, addons_root=addons_root)

    assert [entry.id for entry in resolve_variant_entries(entries, "sample_addon")] == [
        "sample_addon"
    ]
    with pytest.raises(ValueError, match="Unknown node package id"):
        resolve_variant_entries(entries, "ghost")


def test_select_variant_reads_the_addon_manifest_and_carries_the_root(tmp_path: Path) -> None:
    device_root = _device_root(tmp_path, ["core"])
    addons_root = tmp_path / "addons"
    _addon(addons_root, "sample_addon", version="3.1.4")
    entries = load_package_entries(device_root, addons_root=addons_root)

    variant = select_variant(
        entries,
        "sample_addon",
        device_root=device_root,
        addons_root=addons_root,
        **_context(),
    )

    assert variant is not None
    assert variant.root == NodePackageRoot.ADDONS
    assert variant.manifest_rel == "sample_addon/manifest.json"
    assert variant.version == "3.1.4"


def test_select_variant_prefers_the_builtin_manifest_for_a_shared_id(tmp_path: Path) -> None:
    device_root = _device_root(tmp_path, ["core"])
    addons_root = tmp_path / "addons"
    _addon(addons_root, "core", version="9.9.9")
    entries = load_package_entries(device_root, addons_root=addons_root)

    variant = select_variant(
        entries, "core", device_root=device_root, addons_root=addons_root, **_context()
    )

    assert variant is not None
    assert variant.root == NodePackageRoot.DEVICE
    assert variant.version == "1.0.0"


def test_read_package_manifest_reads_from_the_requested_root(tmp_path: Path) -> None:
    device_root = _device_root(tmp_path, ["core"])
    addons_root = tmp_path / "addons"
    _addon(addons_root, "sample_addon")

    builtin = read_package_manifest(device_root, "core/manifest.json")
    addon = read_package_manifest(
        device_root,
        "sample_addon/manifest.json",
        addons_root=addons_root,
        root=NodePackageRoot.ADDONS,
    )

    assert builtin["id"] == "core"
    assert addon["id"] == "sample_addon"

    with pytest.raises(OSError):
        read_package_manifest(device_root, "sample_addon/manifest.json")


def test_staging_resolution_is_unchanged_without_an_addons_root(tmp_path: Path) -> None:
    """``addons_root=None`` resolves exactly the built-in assets (the parity rule)."""

    device_root = _device_root(tmp_path, ["core"])
    _write_json(
        device_root / "node_pkgs" / "core" / "manifest.json",
        {
            "id": "core",
            "version": "1.0.0",
            "manifestVersion": 2,
            "variants": {"py": {"mpAssets": {"*": ["otter_core/__init__.py"]}}},
        },
    )
    module = device_root / "node_pkgs" / "core" / "otter_core" / "__init__.py"
    module.parent.mkdir(parents=True, exist_ok=True)
    module.write_text("# stub\n", encoding="utf-8")
    addons_root = tmp_path / "addons"
    _addon(addons_root, "sample_addon")

    roots = package_roots(device_root, None)
    entries = load_package_entries(device_root)
    variant = select_variant(
        entries, "core", device_root=device_root, **_context()
    )

    assert variant is not None
    package_dir = roots.package_dir(
        PackageIndexEntry(id=variant.id, manifest=variant.manifest_rel, root=variant.root)
    )
    assert roots.asset_path(package_dir, "otter_core/__init__.py") == module.resolve()

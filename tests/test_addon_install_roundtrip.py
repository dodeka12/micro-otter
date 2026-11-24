"""End-to-end round trip for the checked-in add-on fixture.

Install the fixture archive, confirm the inventory and the merged index payload see it,
then uninstall and confirm the payload returns to the built-in-only shape.
"""

from __future__ import annotations

import json
import zipfile
from pathlib import Path

from micro_otter.tools.addon_archive import install_addon, uninstall_addon
from micro_otter.tools.addon_store import (
    PackageProvenance,
    addon_index_entries,
    builtin_package_ids,
    installed_addons,
    merged_index_payload,
    provenance_of,
    read_addon_manifest,
)

DEVICE_ROOT = Path(__file__).resolve().parents[1] / "src" / "micro_otter" / "nodes" / "device"
"""Shipped device tree, used to read the built-in node-package index."""

FIXTURE_ADDONS = Path(__file__).resolve().parent / "fixtures" / "addons"
"""Directory holding ``sample_addon/`` and the archive built from it."""


def test_install_list_merge_then_uninstall_round_trip(tmp_path: Path) -> None:
    addons_root = tmp_path / "addons"
    builtin_ids = builtin_package_ids(DEVICE_ROOT)
    baseline = merged_index_payload(DEVICE_ROOT, None)

    result = install_addon(
        FIXTURE_ADDONS / "sample_addon.zip",
        addons_root=addons_root,
        builtin_ids=builtin_ids,
    )

    assert result.id == "sample_addon"
    assert result.version == "1.0.0"

    records = installed_addons(addons_root)
    assert [record.id for record in records] == ["sample_addon"]
    assert records[0].name == "Sample Add-on"
    assert records[0].archive_sha256 == result.archive_sha256
    assert records[0].installed_at is not None

    manifest = read_addon_manifest(addons_root, "sample_addon")
    assert manifest is not None
    assert manifest["variants"]["py"]["mpAssets"] == {
        "*": ["moa_sample_addon/__init__.py", "moa_sample_addon/generator.py"]
    }
    assert provenance_of(DEVICE_ROOT, addons_root, "sample_addon") == PackageProvenance.ADDON
    assert provenance_of(DEVICE_ROOT, addons_root, "core") == PackageProvenance.BUILTIN

    merged = merged_index_payload(DEVICE_ROOT, addons_root)
    merged_ids = [entry["id"] for entry in merged["packages"]]
    assert merged_ids == [*builtin_ids, "sample_addon"]
    assert merged["version"] == baseline["version"]
    assert addon_index_entries(addons_root)[0]["manifest"] == "sample_addon/manifest.json"

    uninstall_addon("sample_addon", addons_root=addons_root)

    assert installed_addons(addons_root) == ()
    assert merged_index_payload(DEVICE_ROOT, addons_root) == baseline


def test_fixture_package_matches_the_checked_in_archive(tmp_path: Path) -> None:
    """The unpacked fixture and the archive agree, so neither can drift silently."""

    with zipfile.ZipFile(FIXTURE_ADDONS / "sample_addon.zip") as archive:
        names = sorted(archive.namelist())

    on_disk = sorted(
        f"sample_addon/{path.relative_to(FIXTURE_ADDONS / 'sample_addon').as_posix()}"
        for path in (FIXTURE_ADDONS / "sample_addon").rglob("*")
        if path.is_file()
    )

    assert names == on_disk


def test_fixture_manifest_is_valid_json() -> None:
    manifest = json.loads(
        (FIXTURE_ADDONS / "sample_addon" / "manifest.json").read_text(encoding="utf-8")
    )

    assert manifest["id"] == "sample_addon"
    assert manifest["version"] == "1.0.0"

from __future__ import annotations

import json
from pathlib import Path

import pytest

from micro_otter.tools.firmware_compile.firmware_inventory import (
    FirmwareInventoryError,
    build_firmware_inventory_payload,
    delete_firmware_entry,
    latest_firmware_ids,
    list_firmware_inventory,
    read_firmware_sidecar,
    resolve_inventory_image,
)
from micro_otter.tools.firmware_compile.imported_firmware import import_firmware_binary
from micro_otter.tools.firmware_compile.version_identity import firmware_version_sort_key

BIN_A = "micro-otter-1.27.0-esp32-general-0.10.0.bin"
BIN_B = "micro-otter-1.27.0-esp32-general-0.13.0.bin"
BIN_C = "micro-otter-1.27.0-esp32_generic_s3-general-0.1.0.bin"
BIN_ODD = "micro-otter-1.27.0-esp32-general-custom.bin"
BIN_HASH = "micro-otter-1.27.0-esp32-general-0.1.0-0123456789ab.bin"


def _write_bin(root: Path, name: str) -> Path:
    path = root / name
    path.write_bytes(b"\x00\x01")
    return path


def _write_sidecar(root: Path, name: str, payload: dict) -> Path:
    sidecar = root / f"{Path(name).with_suffix('.manifest.json').name}"
    sidecar.write_text(json.dumps(payload), encoding="utf-8")
    return sidecar


def test_firmware_version_sort_key_orders_semver_before_odd_names():
    assert firmware_version_sort_key("0.13.0") > firmware_version_sort_key("0.2.0")
    assert firmware_version_sort_key("0.10.0") > firmware_version_sort_key("0.9.0")
    assert firmware_version_sort_key("0.13.0") > firmware_version_sort_key("custom")


def test_firmware_version_sort_key_ties_deterministically():
    assert firmware_version_sort_key("custom") == firmware_version_sort_key("custom")


def test_list_inventory_parses_four_and_five_segment_names(tmp_path: Path):
    _write_bin(tmp_path, BIN_A)
    _write_bin(tmp_path, BIN_HASH)

    entries = list_firmware_inventory(publish_root=tmp_path)

    assert {entry.filename for entry in entries} == {BIN_A, BIN_HASH}
    by_name = {entry.filename: entry for entry in entries}
    assert by_name[BIN_HASH].content_hash == "0123456789ab"
    assert by_name[BIN_A].content_hash is None


def test_list_inventory_skips_non_firmware_files(tmp_path: Path):
    _write_bin(tmp_path, BIN_A)
    (tmp_path / "notes.txt").write_text("nope", encoding="utf-8")
    (tmp_path / "unrelated.bin").write_bytes(b"\x00")

    entries = list_firmware_inventory(publish_root=tmp_path)

    assert [entry.filename for entry in entries] == [BIN_A]


def test_list_inventory_reads_sidecar_tolerantly(tmp_path: Path):
    _write_bin(tmp_path, BIN_A)
    _write_sidecar(
        tmp_path,
        BIN_A,
        {"embeddedPackages": {"core": "1.0.0"}, "notEmbedded": ["extra"]},
    )
    # A second image with a corrupt sidecar should still list, with no manifest.
    _write_bin(tmp_path, BIN_C)
    (tmp_path / BIN_C).with_suffix(".manifest.json").write_text("{not json", encoding="utf-8")

    entries = list_firmware_inventory(publish_root=tmp_path)
    by_name = {entry.filename: entry for entry in entries}

    assert by_name[BIN_A].has_manifest is True
    assert by_name[BIN_A].embedded_packages == {"core": "1.0.0"}
    assert by_name[BIN_A].not_embedded == ("extra",)
    assert by_name[BIN_C].has_manifest is False
    assert by_name[BIN_C].embedded_packages == {}


def test_list_inventory_orders_by_board_runtime_then_version_desc(tmp_path: Path):
    _write_bin(tmp_path, BIN_A)
    _write_bin(tmp_path, BIN_B)
    _write_bin(tmp_path, BIN_C)

    entries = list_firmware_inventory(publish_root=tmp_path)

    assert [entry.filename for entry in entries] == [BIN_B, BIN_A, BIN_C]


def test_list_inventory_missing_directory_returns_empty():
    assert list_firmware_inventory(publish_root=Path("/nonexistent")) == []


def test_latest_firmware_ids_picks_newest_per_board_runtime(tmp_path: Path):
    _write_bin(tmp_path, BIN_A)
    b = _write_bin(tmp_path, BIN_B)
    c = _write_bin(tmp_path, BIN_C)

    latest = latest_firmware_ids(list_firmware_inventory(publish_root=tmp_path))

    assert latest[("esp32", "general")] == str(b)
    assert latest[("esp32_generic_s3", "general")] == str(c)


def test_latest_firmware_ids_ignores_odd_names_for_latest(tmp_path: Path):
    a = _write_bin(tmp_path, BIN_A)
    _write_bin(tmp_path, BIN_ODD)

    latest = latest_firmware_ids(list_firmware_inventory(publish_root=tmp_path))

    assert latest[("esp32", "general")] == str(a)


def test_build_payload_marks_is_latest_from_mapping(tmp_path: Path):
    _write_bin(tmp_path, BIN_A)
    _write_bin(tmp_path, BIN_B)

    entries = list_firmware_inventory(publish_root=tmp_path)
    latest = latest_firmware_ids(entries)
    payload = build_firmware_inventory_payload(
        publish_root=tmp_path,
        entries=entries,
        latest=latest,
    )

    assert payload["schemaVersion"] == 2
    assert payload["publishRoot"] == str(tmp_path)
    by_name = {entry["filename"]: entry for entry in payload["entries"]}
    assert by_name[BIN_B]["isLatest"] is True
    assert by_name[BIN_A]["isLatest"] is False
    assert by_name[BIN_B]["path"] == str(latest[("esp32", "general")])


def test_delete_removes_bin_and_sidecar(tmp_path: Path):
    path = _write_bin(tmp_path, BIN_A)
    _write_sidecar(tmp_path, BIN_A, {"embeddedPackages": {}})

    result = delete_firmware_entry(path=path, publish_root=tmp_path)

    assert result == {"removed": [str(path)], "absent": []}
    assert not path.exists()
    assert not path.with_suffix(".manifest.json").exists()


def test_delete_missing_file_reports_absent(tmp_path: Path):
    missing = (tmp_path / BIN_A).resolve()

    result = delete_firmware_entry(path=missing, publish_root=tmp_path)

    assert result == {"removed": [], "absent": [str(missing)]}


def test_delete_refuses_path_outside_publish_root(tmp_path: Path):
    outside = (tmp_path.parent / "escape.bin").resolve()

    with pytest.raises(FirmwareInventoryError) as excinfo:
        delete_firmware_entry(path=outside, publish_root=tmp_path)

    assert excinfo.value.code == "firmware-path-invalid"


def test_delete_ignores_missing_sidecar(tmp_path: Path):
    path = _write_bin(tmp_path, BIN_A)

    result = delete_firmware_entry(path=path, publish_root=tmp_path)

    assert result["removed"] == [str(path)]


def test_read_firmware_sidecar_returns_none_for_missing(tmp_path: Path):
    path = _write_bin(tmp_path, BIN_A)

    assert read_firmware_sidecar(path) is None



def test_resolve_inventory_image_accepts_an_image_in_the_root(tmp_path: Path):
    image = _write_bin(tmp_path, BIN_A)

    assert resolve_inventory_image(path=image, publish_root=tmp_path) == image.resolve()


def test_resolve_inventory_image_refuses_a_path_outside_the_root(tmp_path: Path):
    outside = tmp_path.parent / "outside.bin"
    outside.write_bytes(b"x")

    with pytest.raises(FirmwareInventoryError) as exc:
        resolve_inventory_image(path=outside, publish_root=tmp_path)

    assert exc.value.code == "firmware-path-invalid"


def test_resolve_inventory_image_refuses_a_missing_file(tmp_path: Path):
    with pytest.raises(FirmwareInventoryError) as exc:
        resolve_inventory_image(path=tmp_path / "missing.bin", publish_root=tmp_path)

    assert exc.value.code == "firmware-image-unavailable"


def test_inventory_reads_v3_package_variants(tmp_path: Path):
    """A v3 sidecar names the frozen variants and stays a complete identity."""

    _write_bin(tmp_path, BIN_A)
    _write_sidecar(
        tmp_path,
        BIN_A,
        {
            "schemaVersion": 3,
            "embeddedPackages": {"pulse": "1.0.0"},
            "packageVariants": {"pulse": "viper"},
        },
    )

    entry = list_firmware_inventory(publish_root=tmp_path)[0]

    assert entry.package_variants == {"pulse": "viper"}
    assert entry.identity_complete is True


def test_inventory_keeps_v2_entries_complete_without_variants(tmp_path: Path):
    """A v2 sidecar is complete and reports no variants rather than a guess."""

    _write_bin(tmp_path, BIN_A)
    _write_sidecar(
        tmp_path,
        BIN_A,
        {"schemaVersion": 2, "embeddedPackages": {"core": "1.0.0"}},
    )

    entry = list_firmware_inventory(publish_root=tmp_path)[0]

    assert entry.package_variants == {}
    assert entry.identity_complete is True


def test_inventory_ignores_a_garbage_variant_map(tmp_path: Path):
    """A non-object ``packageVariants`` degrades to an empty map."""

    _write_bin(tmp_path, BIN_A)
    _write_sidecar(
        tmp_path,
        BIN_A,
        {"schemaVersion": 3, "packageVariants": [], "embeddedPackages": {}},
    )

    entry = list_firmware_inventory(publish_root=tmp_path)[0]

    assert entry.package_variants == {}


def test_inventory_payload_serializes_package_variants(tmp_path: Path):
    """The client payload uses camelCase and never serializes ``null``."""

    _write_bin(tmp_path, BIN_A)
    _write_sidecar(
        tmp_path,
        BIN_A,
        {"schemaVersion": 3, "packageVariants": {"pulse": "viper"}},
    )
    _write_bin(tmp_path, BIN_B)

    entries = list_firmware_inventory(publish_root=tmp_path)
    payload = build_firmware_inventory_payload(
        publish_root=tmp_path,
        entries=entries,
        latest=latest_firmware_ids(entries),
    )
    by_name = {entry["filename"]: entry for entry in payload["entries"]}

    assert by_name[BIN_A]["packageVariants"] == {"pulse": "viper"}
    assert by_name[BIN_B]["packageVariants"] == {}



def test_inventory_reports_import_provenance_for_an_imported_image(tmp_path: Path):
    """An imported binary lists its provenance with an intentionally incomplete identity."""

    source = tmp_path / "MicroPython-v1.27.0-esp32.bin"
    source.write_bytes(b"\x00\x01")
    root = tmp_path / "publish"
    import_firmware_binary(source, board_id="esp32", target_id="esp32", publish_root=root)

    entries = list_firmware_inventory(publish_root=root)

    assert len(entries) == 1
    entry = entries[0]
    assert entry.runtime_id == "imported"
    assert entry.source == "imported-binary"
    assert entry.target_id == "esp32"
    assert entry.original_filename == source.name
    assert entry.has_manifest is True
    assert entry.identity_complete is False


def test_inventory_leaves_import_provenance_unset_for_a_build_image(tmp_path: Path):
    """A build-style image reports empty provenance instead of a made-up value."""

    _write_bin(tmp_path, BIN_A)
    _write_sidecar(tmp_path, BIN_A, {"schemaVersion": 2})

    entry = list_firmware_inventory(publish_root=tmp_path)[0]

    assert entry.source == ""
    assert entry.target_id is None
    assert entry.original_filename is None
    assert entry.identity_complete is True


def test_inventory_ignores_non_string_import_provenance(tmp_path: Path):
    """Garbage provenance values read as "not recorded" instead of raising."""

    _write_bin(tmp_path, BIN_A)
    _write_sidecar(tmp_path, BIN_A, {"source": 7, "targetId": [], "originalFilename": None})

    entry = list_firmware_inventory(publish_root=tmp_path)[0]

    assert entry.source == ""
    assert entry.target_id is None
    assert entry.original_filename is None


def test_inventory_payload_emits_import_provenance_keys(tmp_path: Path):
    """Every payload entry carries the three additive keys, ``null`` when unrecorded."""

    _write_bin(tmp_path, BIN_A)
    _write_sidecar(
        tmp_path,
        BIN_A,
        {"source": "imported-binary", "targetId": "esp32", "originalFilename": "stock.bin"},
    )
    _write_bin(tmp_path, BIN_B)

    entries = list_firmware_inventory(publish_root=tmp_path)
    payload = build_firmware_inventory_payload(
        publish_root=tmp_path,
        entries=entries,
        latest=latest_firmware_ids(entries),
    )
    by_name = {entry["filename"]: entry for entry in payload["entries"]}

    assert payload["schemaVersion"] == 2
    assert by_name[BIN_A]["source"] == "imported-binary"
    assert by_name[BIN_A]["targetId"] == "esp32"
    assert by_name[BIN_A]["originalFilename"] == "stock.bin"
    assert by_name[BIN_B]["source"] == ""
    assert by_name[BIN_B]["targetId"] is None
    assert by_name[BIN_B]["originalFilename"] is None

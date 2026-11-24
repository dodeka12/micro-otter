"""Tests for channel-aware firmware inventory latest resolution."""

from __future__ import annotations

import json
from pathlib import Path

from micro_otter.tools.firmware_compile.firmware_inventory import (
    FirmwareInventoryEntry,
    build_firmware_inventory_payload,
    latest_firmware_ids,
    latest_firmware_ids_by_channel,
    list_firmware_inventory,
)


def _entry(board: str, runtime: str, version: str, name: str) -> FirmwareInventoryEntry:
    from micro_otter.tools.firmware_compile.version_semver import channel_of, is_prerelease

    return FirmwareInventoryEntry(
        path=Path(f"/publish/{name}"),
        filename=name,
        board_id=board,
        runtime_id=runtime,
        micropython_version="1.29.0",
        runtime_firmware_version=version,
        content_hash="0123456789ab",
        size_bytes=1,
        modified_at="",
        has_manifest=True,
        embedded_packages={},
        not_embedded=(),
        channel=channel_of(version),
        is_prerelease=is_prerelease(version),
    )


def test_latest_by_channel_reports_both_leaders_and_one_cross_channel_is_latest():
    release = _entry("esp32", "general", "1.0.0", "a.bin")
    dev = _entry("esp32", "general", "1.0.1-dev.7.gabc1234", "b.bin")
    older = _entry("esp32", "general", "0.9.0", "c.bin")

    by_channel = latest_firmware_ids_by_channel([release, dev, older])

    assert by_channel[("esp32", "general")] == {
        "release": "/publish/a.bin",
        "dev": "/publish/b.bin",
    }


def test_latest_firmware_ids_channel_narrows():
    release = _entry("esp32", "general", "1.0.0", "a.bin")
    dev = _entry("esp32", "general", "1.0.1-dev.7.gabc1234", "b.bin")

    assert latest_firmware_ids([release, dev])[("esp32", "general")] == "/publish/b.bin"
    assert latest_firmware_ids([release, dev], channel="release")[("esp32", "general")] == (
        "/publish/a.bin"
    )
    assert latest_firmware_ids([release, dev], channel="unknown") == {}


def test_payload_includes_channel_fields_and_latest_by_channel():
    release = _entry("esp32", "general", "1.0.0", "a.bin")
    dev = _entry("esp32", "general", "1.0.1-dev.7.gabc1234", "b.bin")

    payload = build_firmware_inventory_payload(
        publish_root=Path("/publish"),
        entries=[release, dev],
        latest=latest_firmware_ids([release, dev]),
        latest_by_channel=latest_firmware_ids_by_channel([release, dev]),
    )

    assert payload["schemaVersion"] == 2
    assert payload["latestByChannel"]["esp32:general"] == {
        "release": "/publish/a.bin",
        "dev": "/publish/b.bin",
    }
    by_name = {entry["filename"]: entry for entry in payload["entries"]}
    assert by_name["a.bin"]["channel"] == "release"
    assert by_name["a.bin"]["isPrerelease"] is False
    assert by_name["b.bin"]["channel"] == "dev"
    assert by_name["b.bin"]["isPrerelease"] is True


def test_v1_payload_entry_decodes_with_empty_channel():
    entry = _entry("esp32", "general", "0.22.0", "a.bin")
    assert entry.channel == "release"


def test_v2_sidecar_addon_packages_reach_entry_and_payload(tmp_path: Path) -> None:
    root = tmp_path / "publish"
    root.mkdir()
    (root / "micro-otter-1.27.0-esp32-general-1.0.0-0123456789ab.bin").write_bytes(b"\x00")
    (root / "micro-otter-1.27.0-esp32-general-1.0.0-0123456789ab.manifest.json").write_text(
        json.dumps(
            {
                "schemaVersion": 2,
                "addonPackages": {"hello": "0.2.0"},
                "selection": {"packageIds": ["core"]},
                "version": {"channel": "release", "versionSource": "git-release-tag"},
            }
        ),
        encoding="utf-8",
    )

    entries = list_firmware_inventory(publish_root=root)
    payload = build_firmware_inventory_payload(
        publish_root=root,
        entries=entries,
        latest=latest_firmware_ids(entries),
    )

    assert entries[0].addon_packages == {"hello": "0.2.0"}
    assert entries[0].identity_complete is True
    assert payload["entries"][0]["addonPackages"] == {"hello": "0.2.0"}
    assert payload["entries"][0]["selection"] == {"packageIds": ["core"]}


def test_v1_sidecar_yields_empty_addon_packages(tmp_path: Path) -> None:
    root = tmp_path / "publish"
    root.mkdir()
    (root / "micro-otter-1.27.0-esp32-general-0.22.0.bin").write_bytes(b"\x00")
    (root / "micro-otter-1.27.0-esp32-general-0.22.0.manifest.json").write_text(
        json.dumps({"schemaVersion": 1, "embeddedPackages": {"core": "1.0.0"}}),
        encoding="utf-8",
    )

    entries = list_firmware_inventory(publish_root=root)

    assert entries[0].addon_packages == {}
    assert entries[0].identity_complete is False

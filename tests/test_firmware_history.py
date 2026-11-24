"""Tests for the append-only publish-root firmware build history."""

from __future__ import annotations

from pathlib import Path

from micro_otter.tools.firmware_compile.firmware_history import (
    append_firmware_history,
    firmware_history_path,
    load_firmware_history,
)


def _record(image: str = "x.bin", **overrides) -> dict:
    record = {
        "version": "1.0.0",
        "baseVersion": "1.0.0",
        "channel": "release",
        "versionSource": "git-release-tag",
        "contentHash": "0123456789ab",
        "boardId": "esp32",
        "runtimeId": "general",
        "micropythonVersion": "1.29.0",
        "builtAtUtc": "2026-11-10T00:00:00Z",
        "image": image,
    }
    record.update(overrides)
    return record


def test_append_then_load_round_trip(tmp_path: Path) -> None:
    append_firmware_history(tmp_path, _record())

    payload = load_firmware_history(tmp_path)

    assert payload["schemaVersion"] == 1
    assert len(payload["builds"]) == 1
    assert payload["builds"][0]["image"] == "x.bin"


def test_rebuilding_same_image_keeps_one_record(tmp_path: Path) -> None:
    append_firmware_history(tmp_path, _record())
    append_firmware_history(tmp_path, _record(version="1.1.0"))

    payload = load_firmware_history(tmp_path)

    assert len(payload["builds"]) == 1
    assert payload["builds"][0]["version"] == "1.1.0"


def test_distinct_images_append(tmp_path: Path) -> None:
    append_firmware_history(tmp_path, _record("a.bin"))
    append_firmware_history(tmp_path, _record("b.bin"))

    assert len(load_firmware_history(tmp_path)["builds"]) == 2


def test_corrupt_history_starts_fresh(tmp_path: Path) -> None:
    firmware_history_path(tmp_path).write_text("{not valid json", encoding="utf-8")

    assert load_firmware_history(tmp_path) == {"schemaVersion": 1, "builds": []}
    append_firmware_history(tmp_path, _record())
    assert len(load_firmware_history(tmp_path)["builds"]) == 1


def test_missing_history_returns_empty(tmp_path: Path) -> None:
    assert load_firmware_history(tmp_path) == {"schemaVersion": 1, "builds": []}


def test_record_keeps_the_frozen_package_variants(tmp_path: Path) -> None:
    """A v3 build record names the variants it froze, next to ``addonPackages``."""

    append_firmware_history(
        tmp_path,
        _record(
            addonPackages={"pulse": "1.0.0"},
            packageVariants={"pulse": "viper"},
            selection={"packageVariants": {}},
        ),
    )

    build = load_firmware_history(tmp_path)["builds"][0]

    assert build["packageVariants"] == {"pulse": "viper"}
    assert build["addonPackages"] == {"pulse": "1.0.0"}
    assert build["selection"] == {"packageVariants": {}}

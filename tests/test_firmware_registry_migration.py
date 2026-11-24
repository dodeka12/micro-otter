"""Tests for the one-shot firmware registry migration."""

from __future__ import annotations

import json
from pathlib import Path

from tools.migrate_firmware_registries import (
    migrate_latest_versions,
    migrate_runtime_lineage,
)


def _latest_v1(entry: dict) -> dict:
    return {"schemaVersion": 1, "targets": {"esp32-general": entry}}


def _lineage_v2(target_id: str, versions: dict) -> dict:
    return {"schemaVersion": 2, "lineage": {target_id: versions}}


def test_migrate_latest_versions_keeps_existing_content_hash() -> None:
    latest = _latest_v1(
        {
            "boardId": "esp32",
            "runtimeId": "general",
            "fullVersion": "1.29.0-esp32-general-0.22.0",
            "micropythonVersion": "1.29.0",
            "runtimeFirmwareVersion": "0.22.0",
            "contentHash": "da58bfa25810",
            "updatedAtUtc": "2026-11-01T00:00:00Z",
        }
    )
    lineage = _lineage_v2(
        "esp32-general",
        {
            "0.9.0": {
                "micropythonVersion": "1.27.0",
                "runtimeSourceVersion": "1.18.0",
                "deviceToolsVersion": "0.2.1",
                "nodePackages": {},
                "createdAtUtc": "2026-10-26T00:00:00Z",
            }
        },
    )

    migrated = migrate_latest_versions(latest, lineage)

    release = migrated["targets"]["esp32-general"]["channels"]["release"]
    assert release["version"] == "0.22.0"
    assert release["versionSource"] == "legacy-lineage"
    assert release["contentHash"] == "da58bfa25810"
    assert migrated["targets"]["esp32-general"]["channels"]["dev"]["version"] == "0.9.0"


def test_migrate_latest_versions_without_hash_gets_null() -> None:
    latest = _latest_v1(
        {
            "boardId": "esp32",
            "runtimeId": "general",
            "fullVersion": "1.29.0-esp32-general-0.22.0",
            "micropythonVersion": "1.29.0",
            "runtimeFirmwareVersion": "0.22.0",
            "updatedAtUtc": "2026-11-01T00:00:00Z",
        }
    )
    migrated = migrate_latest_versions(latest, _lineage_v2("esp32-general", {}))

    assert migrated["targets"]["esp32-general"]["channels"]["release"]["contentHash"] is None


def test_migrate_latest_versions_target_absent_from_lineage_keeps_release_only() -> None:
    latest = _latest_v1(
        {
            "boardId": "esp32",
            "runtimeId": "general",
            "fullVersion": "1.29.0-esp32-general-0.22.0",
            "micropythonVersion": "1.29.0",
            "runtimeFirmwareVersion": "0.22.0",
            "updatedAtUtc": "2026-11-01T00:00:00Z",
        }
    )
    migrated = migrate_latest_versions(latest, _lineage_v2("other", {}))

    channels = migrated["targets"]["esp32-general"]["channels"]
    assert set(channels) == {"release"}


def test_migrate_runtime_lineage_drops_origin_url_and_adds_fields() -> None:
    lineage = _lineage_v2(
        "esp32-general",
        {
            "0.9.0": {
                "micropythonVersion": "1.27.0",
                "runtimeSourceVersion": "1.18.0",
                "deviceToolsVersion": "0.2.1",
                "nodePackages": {},
                "createdAtUtc": "2026-10-26T00:00:00Z",
                "gitSource": {
                    "branch": "main",
                    "commitHash": "abc123",
                    "originUrl": "https://github.com/example/repo.git",
                },
            }
        },
    )

    migrated = migrate_runtime_lineage(lineage)

    entry = migrated["lineage"]["esp32-general"]["0.9.0"]
    assert migrated["schemaVersion"] == 3
    assert entry["channel"] == "dev"
    assert entry["versionSource"] == "legacy-lineage"
    assert entry["contentHash"] is None
    assert entry["addonPackages"] == {}
    assert "originUrl" not in entry["gitSource"]
    assert entry["gitSource"]["shallow"] is False


def test_migration_is_idempotent(tmp_path: Path) -> None:
    latest_path = tmp_path / "latest.json"
    lineage_path = tmp_path / "lineage.json"
    latest = _latest_v1(
        {
            "boardId": "esp32",
            "runtimeId": "general",
            "fullVersion": "1.29.0-esp32-general-0.22.0",
            "micropythonVersion": "1.29.0",
            "runtimeFirmwareVersion": "0.22.0",
            "updatedAtUtc": "2026-11-01T00:00:00Z",
        }
    )
    lineage = _lineage_v2("esp32-general", {})

    latest_path.write_text(json.dumps(latest), encoding="utf-8")
    lineage_path.write_text(json.dumps(lineage), encoding="utf-8")

    import tools.migrate_firmware_registries as module

    monkeypatch_paths(module, latest_path, lineage_path)
    assert module.main(["--check"]) == 1
    assert module.main([]) == 0
    assert module.main(["--check"]) == 0


def monkeypatch_paths(module, latest_path: Path, lineage_path: Path) -> None:
    module.LATEST_VERSIONS_PATH = latest_path
    module.RUNTIME_LINEAGE_PATH = lineage_path


def test_main_check_exits_one_on_unmigrated(tmp_path: Path) -> None:
    import tools.migrate_firmware_registries as module

    latest_path = tmp_path / "latest.json"
    lineage_path = tmp_path / "lineage.json"
    latest_path.write_text(
        json.dumps(
            _latest_v1(
                {
                    "boardId": "esp32",
                    "runtimeId": "general",
                    "fullVersion": "1.29.0-esp32-general-0.22.0",
                    "micropythonVersion": "1.29.0",
                    "runtimeFirmwareVersion": "0.22.0",
                    "updatedAtUtc": "2026-11-01T00:00:00Z",
                }
            )
        ),
        encoding="utf-8",
    )
    lineage_path.write_text(json.dumps(_lineage_v2("esp32-general", {})), encoding="utf-8")

    monkeypatch_paths(module, latest_path, lineage_path)
    assert module.main(["--check"]) == 1

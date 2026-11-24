from __future__ import annotations

import json
from pathlib import Path

import pytest

from micro_otter.tools.firmware_compile.version_registry import (
    VersionRegistryError,
    add_lineage_entry_for_target,
    compose_latest_versions,
    default_latest_versions_payload,
    default_runtime_lineage_payload,
    load_latest_versions,
    load_runtime_lineage,
    make_target_key,
    next_firmware_version_for_target,
    resolve_runtime_firmware_version_for_target,
    update_latest_version,
    write_latest_versions,
    write_runtime_lineage,
)


def _sample_latest_entry() -> dict[str, str]:
    return {
        "fullVersion": "1.24.0-esp32-general-0.3.0",
        "micropythonVersion": "1.24.0",
        "boardId": "esp32",
        "runtimeId": "general",
        "runtimeFirmwareVersion": "0.3.0",
        "updatedAtUtc": "2026-04-23T00:00:00Z",
    }


def _sample_lineage_entry() -> dict[str, object]:
    return {
        "micropythonVersion": "1.24.0",
        "runtimeSourceVersion": "1.11.0",
        "deviceToolsVersion": "1.2.0",
        "nodePackages": {"core": "1.0.2", "webview": "1.0.0"},
        "createdAtUtc": "2026-04-23T00:00:00Z",
    }


def test_default_payload_factories_are_valid():
    latest = default_latest_versions_payload()
    lineage = default_runtime_lineage_payload()

    assert latest == {"schemaVersion": 1, "targets": {}}
    assert lineage == {"schemaVersion": 2, "lineage": {}}


def test_write_and_load_latest_versions_round_trip(tmp_path: Path):
    payload = default_latest_versions_payload()
    update_latest_version(payload, "esp32-general", _sample_latest_entry())

    output_path = tmp_path / "latest_versions.json"
    write_latest_versions(output_path, payload)
    loaded = load_latest_versions(output_path)

    assert loaded["targets"]["esp32-general"]["channels"]["release"]["version"] == "0.3.0"


def test_write_and_load_runtime_lineage_round_trip(tmp_path: Path):
    payload = default_runtime_lineage_payload()
    add_lineage_entry_for_target(payload, "esp32-general", "0.3.0", _sample_lineage_entry())

    output_path = tmp_path / "runtime_lineage.json"
    write_runtime_lineage(output_path, payload)
    loaded = load_runtime_lineage(output_path)

    assert loaded["lineage"]["esp32-general"]["0.3.0"]["runtimeSourceVersion"] == "1.11.0"


def test_latest_versions_round_trip_with_content_hash(tmp_path: Path):
    payload = default_latest_versions_payload()
    entry = {**_sample_latest_entry(), "contentHash": "0123456789ab"}
    update_latest_version(payload, "esp32-general", entry)

    output_path = tmp_path / "latest_versions.json"
    write_latest_versions(output_path, payload)
    loaded = load_latest_versions(output_path)

    release = loaded["targets"]["esp32-general"]["channels"]["release"]
    assert release["contentHash"] == "0123456789ab"


def test_latest_versions_rejects_invalid_content_hash(tmp_path: Path):
    payload = default_latest_versions_payload()
    entry = {**_sample_latest_entry(), "contentHash": "not-a-hash"}

    with pytest.raises(VersionRegistryError, match="contentHash"):
        update_latest_version(payload, "esp32-general", entry)


def test_runtime_lineage_round_trip_with_content_hash(tmp_path: Path):
    payload = default_runtime_lineage_payload()
    entry = {**_sample_lineage_entry(), "contentHash": "0123456789ab"}
    add_lineage_entry_for_target(payload, "esp32-general", "0.3.0", entry)

    output_path = tmp_path / "runtime_lineage.json"
    write_runtime_lineage(output_path, payload)
    loaded = load_runtime_lineage(output_path)

    assert loaded["lineage"]["esp32-general"]["0.3.0"]["contentHash"] == "0123456789ab"


def test_lineage_entries_are_immutable_once_set():
    payload = default_runtime_lineage_payload()
    add_lineage_entry_for_target(payload, "esp32-general", "0.3.0", _sample_lineage_entry())

    modified_entry = dict(_sample_lineage_entry())
    modified_entry["deviceToolsVersion"] = "1.2.1"

    with pytest.raises(VersionRegistryError, match="immutable"):
        add_lineage_entry_for_target(payload, "esp32-general", "0.3.0", modified_entry)


def test_latest_versions_rejects_invalid_schema(tmp_path: Path):
    path = tmp_path / "latest_versions.json"
    path.write_text(json.dumps({"schemaVersion": 3, "targets": {}}), encoding="utf-8")

    with pytest.raises(VersionRegistryError, match="schemaVersion"):
        load_latest_versions(path)


def test_runtime_lineage_rejects_non_semver_keys(tmp_path: Path):
    path = tmp_path / "runtime_lineage.json"
    payload = {
        "schemaVersion": 2,
        "lineage": {
            "esp32-general": {
                "not-semver": _sample_lineage_entry(),
            },
        },
    }
    path.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(VersionRegistryError, match="semver"):
        load_runtime_lineage(path)


def test_make_target_key_returns_composite():
    assert make_target_key("esp32", "general") == "esp32-general"


def test_validate_rejects_board_only_key():
    payload = default_latest_versions_payload()
    with pytest.raises(VersionRegistryError, match="boardId.*runtimeId|<boardId>-<runtimeId>"):
        update_latest_version(payload, "esp32", _sample_latest_entry())


def test_validate_rejects_triple_segment_key():
    payload = default_latest_versions_payload()
    with pytest.raises(VersionRegistryError):
        update_latest_version(payload, "esp32-s2-general", _sample_latest_entry())


def test_update_preserves_both_runtime_entries():
    payload = default_latest_versions_payload()
    update_latest_version(payload, make_target_key("esp32", "general"), _sample_latest_entry())

    entry2 = dict(_sample_latest_entry())
    entry2["runtimeId"] = "minimal"
    entry2["fullVersion"] = "1.24.0-esp32-minimal-0.3.0"
    update_latest_version(payload, make_target_key("esp32", "minimal"), entry2)

    assert "esp32-general" in payload["targets"]
    assert "esp32-minimal" in payload["targets"]
    assert len(payload["targets"]) == 2


def test_latest_versions_json_key_format():
    path = Path("src/micro_otter/nodes/device/firmware/latest_versions.json")
    loaded = load_latest_versions(path)
    assert "esp32-general" in loaded["targets"], (
        "latest_versions.json must use composite 'esp32-general' key, not bare 'esp32'"
    )


def _sample_lineage_payload(entries: dict) -> dict:
    payload = default_runtime_lineage_payload()
    for fw_ver, entry in entries.items():
        add_lineage_entry_for_target(payload, "esp32-general", fw_ver, entry)
    return payload


def _lineage_entry(
    micropython_version: str = "1.24.0",
    runtime_source_version: str = "1.0.0",
    device_tools_version: str = "1.0.0",
    node_packages: dict | None = None,
) -> dict:
    return {
        "micropythonVersion": micropython_version,
        "runtimeSourceVersion": runtime_source_version,
        "deviceToolsVersion": device_tools_version,
        "nodePackages": node_packages if node_packages is not None else {},
        "createdAtUtc": "2025-01-01T00:00:00Z",
    }


def test_resolve_returns_matching_version():
    payload = _sample_lineage_payload({
        "0.1.0": _lineage_entry(),
    })
    result = resolve_runtime_firmware_version_for_target(
        payload, "esp32-general",
        micropython_version="1.24.0",
        runtime_source_version="1.0.0",
        device_tools_version="1.0.0",
        node_packages={},
    )
    assert result == "0.1.0"


def test_resolve_returns_none_when_no_match():
    payload = _sample_lineage_payload({
        "0.1.0": _lineage_entry(),
    })
    result = resolve_runtime_firmware_version_for_target(
        payload, "esp32-general",
        micropython_version="1.24.0",
        runtime_source_version="2.0.0",
        device_tools_version="1.0.0",
        node_packages={},
    )
    assert result is None


def test_resolve_returns_highest_when_multiple_match():
    payload = _sample_lineage_payload({
        "0.1.0": _lineage_entry(),
        "0.2.0": _lineage_entry(),
        "0.1.5": _lineage_entry(),
    })
    result = resolve_runtime_firmware_version_for_target(
        payload, "esp32-general",
        micropython_version="1.24.0",
        runtime_source_version="1.0.0",
        device_tools_version="1.0.0",
        node_packages={},
    )
    assert result == "0.2.0"


def test_resolve_returns_none_for_unknown_target():
    payload = _sample_lineage_payload({
        "0.1.0": _lineage_entry(),
    })
    result = resolve_runtime_firmware_version_for_target(
        payload, "esp32-minimal",
        micropython_version="1.24.0",
        runtime_source_version="1.0.0",
        device_tools_version="1.0.0",
        node_packages={},
    )
    assert result is None


def test_resolve_ignores_mismatched_micropython_version():
    payload = _sample_lineage_payload({
        "0.1.0": _lineage_entry(micropython_version="1.24.0"),
    })
    result = resolve_runtime_firmware_version_for_target(
        payload, "esp32-general",
        micropython_version="1.25.0",
        runtime_source_version="1.0.0",
        device_tools_version="1.0.0",
        node_packages={},
    )
    assert result is None


def test_resolve_ignores_mismatched_source_version():
    payload = _sample_lineage_payload({
        "0.1.0": _lineage_entry(runtime_source_version="1.0.0"),
    })
    result = resolve_runtime_firmware_version_for_target(
        payload, "esp32-general",
        micropython_version="1.24.0",
        runtime_source_version="1.1.0",
        device_tools_version="1.0.0",
        node_packages={},
    )
    assert result is None


def test_resolve_ignores_mismatched_node_packages():
    payload = _sample_lineage_payload({
        "0.1.0": _lineage_entry(node_packages={"core": "1.0.0"}),
    })
    result = resolve_runtime_firmware_version_for_target(
        payload, "esp32-general",
        micropython_version="1.24.0",
        runtime_source_version="1.0.0",
        device_tools_version="1.0.0",
        node_packages={"core": "1.0.1"},
    )
    assert result is None


def test_lineage_rejects_invalid_target_key_format(tmp_path: Path):
    path = tmp_path / "runtime_lineage.json"
    payload = {
        "schemaVersion": 2,
        "lineage": {
            "esp32": {"0.1.0": _sample_lineage_entry()},
        },
    }
    path.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(VersionRegistryError, match="boardId.*runtimeId|<boardId>-<runtimeId>"):
        load_runtime_lineage(path)


# --- next_firmware_version_for_target ---


def _next(
    payload: dict,
    *,
    mp: str = "1.24.0",
    rt: str = "1.0.0",
    dt: str = "1.0.0",
    pkgs: dict | None = None,
) -> str:
    return next_firmware_version_for_target(
        payload, "esp32-general",
        micropython_version=mp,
        runtime_source_version=rt,
        device_tools_version=dt,
        node_packages=pkgs if pkgs is not None else {},
        fallback="0.1.0",
    )


def test_next_returns_fallback_when_target_is_empty():
    payload = default_runtime_lineage_payload()
    assert _next(payload) == "0.1.0"


def test_next_returns_fallback_for_unknown_target():
    payload = _sample_lineage_payload({"0.1.0": _lineage_entry()})
    result = next_firmware_version_for_target(
        payload, "esp32-lite",
        micropython_version="1.24.0",
        runtime_source_version="1.0.0",
        device_tools_version="1.0.0",
        node_packages={},
        fallback="0.1.0",
    )
    assert result == "0.1.0"


def test_next_patch_bump_on_runtime_source_patch_change():
    payload = _sample_lineage_payload({"0.1.0": _lineage_entry(runtime_source_version="1.0.0")})
    result = _next(payload, rt="1.0.1")
    assert result == "0.1.1"


def test_next_minor_bump_on_runtime_source_minor_change():
    payload = _sample_lineage_payload({"0.1.0": _lineage_entry(runtime_source_version="1.0.0")})
    result = _next(payload, rt="1.1.0")
    assert result == "0.2.0"


def test_next_major_bump_on_micropython_major_change():
    payload = _sample_lineage_payload({"0.1.0": _lineage_entry(micropython_version="1.24.0")})
    result = _next(payload, mp="2.0.0")
    assert result == "1.0.0"


def test_next_max_level_wins_across_constituents():
    # runtime patch change + micropython minor change → minor bump
    payload = _sample_lineage_payload({
        "0.1.0": _lineage_entry(micropython_version="1.24.0", runtime_source_version="1.0.0"),
    })
    result = _next(payload, mp="1.25.0", rt="1.0.1")
    assert result == "0.2.0"


def test_next_package_patch_change_gives_patch_bump():
    payload = _sample_lineage_payload({
        "0.1.0": _lineage_entry(node_packages={"core": "1.0.0"}),
    })
    result = _next(payload, pkgs={"core": "1.0.1"})
    assert result == "0.1.1"


def test_next_package_minor_change_gives_minor_bump():
    payload = _sample_lineage_payload({
        "0.1.0": _lineage_entry(node_packages={"core": "1.0.0"}),
    })
    result = _next(payload, pkgs={"core": "1.1.0"})
    assert result == "0.2.0"


def test_next_package_added_gives_minor_bump():
    payload = _sample_lineage_payload({
        "0.1.0": _lineage_entry(node_packages={"core": "1.0.0"}),
    })
    result = _next(payload, pkgs={"core": "1.0.0", "webview": "1.0.0"})
    assert result == "0.2.0"


def test_next_package_removed_gives_minor_bump():
    payload = _sample_lineage_payload({
        "0.1.0": _lineage_entry(node_packages={"core": "1.0.0", "webview": "1.0.0"}),
    })
    result = _next(payload, pkgs={"core": "1.0.0"})
    assert result == "0.2.0"


def test_next_uses_highest_firmware_version_as_base():
    payload = _sample_lineage_payload({
        "0.1.0": _lineage_entry(runtime_source_version="1.0.0"),
        "0.2.0": _lineage_entry(runtime_source_version="1.1.0"),
        "0.1.5": _lineage_entry(runtime_source_version="1.0.5"),
    })
    # Changing from 1.1.0 (highest entry at 0.2.0) by patch → 0.2.1
    result = _next(payload, rt="1.1.1")
    assert result == "0.2.1"


def test_next_numeric_semver_ordering_not_lexicographic():
    # "0.1.9" < "0.1.10" numerically; ensure max picks 0.1.10
    payload = _sample_lineage_payload({
        "0.1.9": _lineage_entry(runtime_source_version="1.0.9"),
        "0.1.10": _lineage_entry(runtime_source_version="1.0.10"),
    })
    result = _next(payload, rt="1.0.11")
    assert result == "0.1.11"
def test_compose_latest_versions_prefers_newer_history_and_never_mutates() -> None:
    committed = {
        "schemaVersion": 2,
        "targets": {
            "esp32-general": {
                "boardId": "esp32",
                "runtimeId": "general",
                "channels": {
                    "release": {
                        "version": "1.0.0",
                        "fullVersion": "1.29.0-esp32-general-1.0.0",
                        "micropythonVersion": "1.29.0",
                        "versionSource": "git-release-tag",
                        "updatedAtUtc": "2026-11-01T00:00:00Z",
                    }
                },
            }
        },
    }
    history = {
        "schemaVersion": 1,
        "builds": [
            {
                "boardId": "esp32",
                "runtimeId": "general",
                "channel": "release",
                "version": "1.1.0",
                "fullVersion": "1.29.0-esp32-general-1.1.0",
                "contentHash": "0123456789ab",
                "micropythonVersion": "1.29.0",
                "versionSource": "git-release-tag",
                "builtAtUtc": "2026-11-02T00:00:00Z",
                "image": "x.bin",
            }
        ],
    }
    committed_snapshot = json.dumps(committed)

    composed = compose_latest_versions(committed, history)

    release = composed["targets"]["esp32-general"]["channels"]["release"]
    assert release["version"] == "1.1.0"
    assert release["contentHash"] == "0123456789ab"
    assert json.dumps(committed) == committed_snapshot


def test_compose_latest_versions_keeps_committed_when_history_is_older() -> None:
    committed = {
        "schemaVersion": 2,
        "targets": {
            "esp32-general": {
                "boardId": "esp32",
                "runtimeId": "general",
                "channels": {
                    "release": {
                        "version": "1.1.0",
                        "fullVersion": "1.29.0-esp32-general-1.1.0",
                        "micropythonVersion": "1.29.0",
                        "versionSource": "git-release-tag",
                        "updatedAtUtc": "2026-11-02T00:00:00Z",
                    }
                },
            }
        },
    }
    history = {
        "schemaVersion": 1,
        "builds": [
            {
                "boardId": "esp32",
                "runtimeId": "general",
                "channel": "release",
                "version": "1.0.0",
                "fullVersion": "1.29.0-esp32-general-1.0.0",
                "micropythonVersion": "1.29.0",
                "versionSource": "git-release-tag",
                "builtAtUtc": "2026-11-01T00:00:00Z",
                "image": "x.bin",
            }
        ],
    }

    composed = compose_latest_versions(committed, history)

    assert composed["targets"]["esp32-general"]["channels"]["release"]["version"] == "1.1.0"


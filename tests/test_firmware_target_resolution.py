"""Tests for the server-side target derivation resolver (M4x phase 2)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from micro_otter.tools.firmware_compile.target_context import resolve_target_package_context
from micro_otter.tools.firmware_compile.target_mapping import CompileTargetResolution
from micro_otter.tools.firmware_compile.target_resolution import (
    TargetResolutionError,
    load_effective_target_payload,
    resolve_build_base_target_id,
)


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _device_root(tmp_path: Path) -> Path:
    """Create a device root with a base + derived S3 chain and a standalone S2 target."""

    device_root = tmp_path / "device"
    _write_json(
        device_root / "targets" / "index.json",
        {
            "version": 1,
            "targets": [
                {"id": "esp32_s2", "file": "esp32_s2.json"},
                {"id": "esp32_s3", "file": "esp32_s3.json"},
                {"id": "esp32_s3_mini", "file": "esp32_s3_mini.json"},
            ],
        },
    )
    _write_json(
        device_root / "targets" / "esp32_s2.json",
        {
            "targetId": "esp32_s2",
            "displayName": "ESP32-S2",
            "description": "Chip-level S2",
            "pinCapabilities": {
                "17": {
                    "label": "GPIO17",
                    "digital": {"input": True, "output": True},
                    "dac": {"channel": 1, "resolution_bits": 8},
                }
            },
            "generalCapabilities": {"viper": {"supported": True}},
        },
    )
    _write_json(
        device_root / "targets" / "esp32_s3.json",
        {
            "targetId": "esp32_s3",
            "displayName": "ESP32-S3",
            "description": "Chip-level S3",
            "metadata": {"notes": ["base note"]},
            "pinCapabilities": {
                "1": {"label": "GPIO1", "digital": {"input": True, "output": True}},
                "2": {"label": "GPIO2", "digital": {"input": True, "output": True}},
            },
            "generalCapabilities": {"viper": {"supported": True}},
        },
    )
    _write_json(
        device_root / "targets" / "esp32_s3_mini.json",
        {
            "targetId": "esp32_s3_mini",
            "displayName": "ESP32-S3 Mini",
            "description": "Mini board",
            "baseTargetId": "esp32_s3",
            "targetData": {
                "metadata": {"notes": ["mini note"]},
                "pinCapabilities": {"2": None},
            },
        },
    )
    _write_json(
        device_root / "capabilities" / "index.json",
        {"version": 1, "files": ["general.json"]},
    )
    _write_json(
        device_root / "capabilities" / "general.json",
        {"capabilities": [{"id": "viper", "domain": "general"}]},
    )
    return device_root


def _resolution(*allowed: str) -> CompileTargetResolution:
    return CompileTargetResolution(
        web_target_id=allowed[0] if allowed else None,
        allowed_web_target_ids=tuple(allowed),
        compile_board="ESP32_GENERIC_S3",
        compile_port="esp32",
        mapping_rule_id="test-rule",
        mapping_source="test",
        mapping_confidence="exact",
    )


def test_effective_payload_merges_the_chain(tmp_path: Path) -> None:
    device_root = _device_root(tmp_path)

    payload = load_effective_target_payload(device_root, "esp32_s3_mini")

    assert payload is not None
    assert payload["targetId"] == "esp32_s3_mini"
    assert payload["displayName"] == "ESP32-S3 Mini"
    assert payload["description"] == "Mini board"
    assert payload["pinCapabilities"]["1"]["label"] == "GPIO1"
    assert "2" not in payload["pinCapabilities"]
    assert payload["metadata"]["notes"] == ["base note", "mini note"]


def test_build_base_id_is_the_terminal_id(tmp_path: Path) -> None:
    device_root = _device_root(tmp_path)

    assert resolve_build_base_target_id(device_root, "esp32_s2") == "esp32_s2"
    assert resolve_build_base_target_id(device_root, "esp32_s3_mini") == "esp32_s3"
    assert resolve_build_base_target_id(device_root, "esp32_s3") == "esp32_s3"
    assert resolve_build_base_target_id(device_root, "unknown") is None


def test_standalone_s2_payload_needs_no_base(tmp_path: Path) -> None:
    device_root = _device_root(tmp_path)

    payload = load_effective_target_payload(device_root, "esp32_s2")

    assert payload is not None
    assert payload["targetId"] == "esp32_s2"
    assert "baseTargetId" not in payload
    assert payload["pinCapabilities"]["17"]["dac"]["channel"] == 1


def test_unknown_base_raises(tmp_path: Path) -> None:
    device_root = tmp_path / "device"
    _write_json(
        device_root / "targets" / "index.json",
        {"version": 1, "targets": [{"id": "a", "file": "a.json"}]},
    )
    _write_json(
        device_root / "targets" / "a.json",
        {"targetId": "a", "baseTargetId": "nope", "targetData": {}},
    )

    with pytest.raises(TargetResolutionError) as excinfo:
        load_effective_target_payload(device_root, "a")
    assert excinfo.value.code == "ERR_TARGET_BASE_UNKNOWN"


def test_cycle_raises(tmp_path: Path) -> None:
    device_root = tmp_path / "device"
    _write_json(
        device_root / "targets" / "index.json",
        {
            "version": 1,
            "targets": [{"id": "a", "file": "a.json"}, {"id": "b", "file": "b.json"}],
        },
    )
    _write_json(device_root / "targets" / "a.json", {"targetId": "a", "baseTargetId": "b"})
    _write_json(device_root / "targets" / "b.json", {"targetId": "b", "baseTargetId": "a"})

    with pytest.raises(TargetResolutionError) as excinfo:
        resolve_build_base_target_id(device_root, "a")
    assert excinfo.value.code == "ERR_TARGET_CYCLE"


def test_derived_target_gates_on_the_base_payload(tmp_path: Path) -> None:
    device_root = _device_root(tmp_path)

    context = resolve_target_package_context(
        device_root=device_root,
        resolution=_resolution("esp32_s3_mini"),
    )

    assert context.target_id == "esp32_s3_mini"
    assert context.has_general_capability("viper") is True


def test_broken_chain_degrades_to_none_context(tmp_path: Path) -> None:
    device_root = tmp_path / "device"
    _write_json(
        device_root / "targets" / "index.json",
        {"version": 1, "targets": [{"id": "a", "file": "a.json"}]},
    )
    _write_json(
        device_root / "targets" / "a.json",
        {"targetId": "a", "baseTargetId": "nope", "targetData": {}},
    )
    _write_json(
        device_root / "capabilities" / "index.json",
        {"version": 1, "files": ["general.json"]},
    )
    _write_json(
        device_root / "capabilities" / "general.json",
        {"capabilities": [{"id": "viper", "domain": "general"}]},
    )

    context = resolve_target_package_context(
        device_root=device_root,
        resolution=_resolution("a"),
    )

    assert context.has_general_capability("viper") is False


"""Tests for the single target-package context (M4u phase 1)."""

from __future__ import annotations

import json
from pathlib import Path

from micro_otter.tools.firmware_compile.package_resolver import (
    load_package_entries,
    select_variant,
)
from micro_otter.tools.firmware_compile.target_context import (
    TargetPackageContext,
    resolve_target_package_context,
    resolve_target_package_context_for_board,
)
from micro_otter.tools.firmware_compile.target_mapping import CompileTargetResolution


def _write_json(path: Path, payload: object) -> None:
    """Write *payload* as JSON to *path*, creating parents."""

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _device_root(tmp_path: Path, *, wifi: bool, viper: bool) -> Path:
    """Create a device root with one target payload and a minimal registry."""

    device_root = tmp_path / "device"
    _write_json(
        device_root / "capabilities" / "index.json",
        {"version": 1, "files": ["general.json"]},
    )
    _write_json(
        device_root / "capabilities" / "general.json",
        {
            "capabilities": [
                {"id": "wifi", "domain": "general"},
                {"id": "viper", "domain": "general"},
                {"id": "i2s", "domain": "pin", "limitKey": "i2s.controllers"},
            ]
        },
    )
    _write_json(
        device_root / "targets" / "esp32_s3_mini.json",
        {
            "generalCapabilities": {
                "wifi": {"supported": wifi},
                "viper": {"supported": viper},
            },
            "resources": {"i2s": {"controllers": 2}},
        },
    )
    return device_root


def _resolution(*allowed: str) -> CompileTargetResolution:
    """Return a compile-target resolution allowing the given web target ids."""

    return CompileTargetResolution(
        web_target_id=allowed[0] if allowed else None,
        allowed_web_target_ids=tuple(allowed),
        compile_board="esp32",
        compile_port="esp32",
        mapping_rule_id="test-rule",
        mapping_source="test",
        mapping_confidence="exact",
    )


def test_none_context_reports_no_capability() -> None:
    """The unresolved-target context answers ``False`` for everything."""

    context = TargetPackageContext.none()

    assert context.target_id is None
    assert context.is_general("wifi") is False
    assert context.has_general_capability("wifi") is False
    assert context.has_pin_capability("i2s") is False


def test_context_follows_the_target_payload(tmp_path: Path) -> None:
    """The context reads the resolved target's payload and the registry domains."""

    device_root = _device_root(tmp_path, wifi=True, viper=False)
    context = resolve_target_package_context(
        device_root=device_root,
        resolution=_resolution("esp32_s3_mini"),
    )

    assert context.target_id == "esp32_s3_mini"
    assert context.is_general("wifi") is True
    assert context.is_general("i2s") is False
    assert context.has_general_capability("wifi") is True
    assert context.has_general_capability("viper") is False
    assert context.has_pin_capability("i2s") is True
    assert context.has_pin_capability("wifi") is False


def test_empty_allowed_target_ids_yield_the_none_context(tmp_path: Path) -> None:
    """A resolution without a web target degrades instead of raising."""

    device_root = _device_root(tmp_path, wifi=True, viper=True)

    context = resolve_target_package_context(
        device_root=device_root,
        resolution=_resolution(),
    )

    assert context == TargetPackageContext.none()


def test_missing_target_payload_supports_nothing(tmp_path: Path) -> None:
    """A resolved id without a payload file behaves like no target at all."""

    device_root = _device_root(tmp_path, wifi=True, viper=True)

    context = resolve_target_package_context(
        device_root=device_root,
        resolution=_resolution("unknown_target"),
    )

    assert context.target_id == "unknown_target"
    assert context.has_general_capability("wifi") is False
    assert context.has_general_capability("viper") is False


def _mapping_workspace(tmp_path: Path) -> Path:
    """Write a compile-target mapping file that maps one board to one web target."""

    workspace_root = tmp_path / "workspace"
    _write_json(
        workspace_root
        / "src"
        / "micro_otter"
        / "nodes"
        / "device"
        / "targets"
        / "compile_target_mappings.json",
        {
            "schemaVersion": 1,
            "rules": [
                {
                    "id": "esp32-s3",
                    "webTargetId": "esp32_s3_mini",
                    "runtimeIdInclude": ["*"],
                    "runtimeIdExclude": [],
                    "compile": {
                        "board": "ESP32_GENERIC_S3",
                        "backend": "esp-idf",
                        "params": {"port": "esp32"},
                    },
                    "priority": 100,
                }
            ],
        },
    )
    return workspace_root


def test_for_board_resolves_the_mapping(tmp_path: Path) -> None:
    """A board id resolves through the compile-target mapping to its context."""

    device_root = _device_root(tmp_path, wifi=True, viper=True)
    workspace_root = _mapping_workspace(tmp_path)

    context = resolve_target_package_context_for_board(
        workspace_root=workspace_root,
        device_root=device_root,
        runtime_id="general",
        board="ESP32_GENERIC_S3",
    )

    assert context.target_id == "esp32_s3_mini"
    assert context.has_general_capability("viper") is True


def test_for_board_degrades_for_an_unmapped_board(tmp_path: Path) -> None:
    """An unmapped board yields the none context instead of raising."""

    device_root = _device_root(tmp_path, wifi=True, viper=True)
    workspace_root = _mapping_workspace(tmp_path)

    context = resolve_target_package_context_for_board(
        workspace_root=workspace_root,
        device_root=device_root,
        runtime_id="general",
        board="no_such_board",
    )

    assert context == TargetPackageContext.none()


def _write_catalog(workspace_root: Path) -> None:
    """Write a one-board catalog whose slug differs from its board name."""

    _write_json(
        workspace_root
        / "src"
        / "micro_otter"
        / "nodes"
        / "device"
        / "firmware"
        / "boards.json",
        {
            "schemaVersion": 2,
            "boards": [
                {
                    "name": "ESP32_GENERIC_S3",
                    "slug": "esp32_generic_s3",
                    "displayName": "ESP32-S3 (generic)",
                    "buildBackend": "esp-idf",
                    "flashBackend": "esptool",
                    "chip": "esp32s3",
                    "build": {"port": "esp32", "board": "ESP32_GENERIC_S3"},
                    "flash": {"offset": "0"},
                }
            ],
        },
    )


def test_for_board_translates_a_catalog_slug(tmp_path: Path) -> None:
    """A slug from the firmware menu resolves through the catalog to its context."""

    device_root = _device_root(tmp_path, wifi=True, viper=True)
    workspace_root = _mapping_workspace(tmp_path)
    _write_catalog(workspace_root)

    context = resolve_target_package_context_for_board(
        workspace_root=workspace_root,
        device_root=device_root,
        runtime_id="general",
        board="esp32_generic_s3",
    )

    assert context.target_id == "esp32_s3_mini"
    assert context.has_general_capability("viper") is True


def _add_two_variant_package(device_root: Path) -> None:
    """Add one package with a default and a ``viper`` implementation."""

    _write_json(
        device_root / "node_pkgs" / "index.json",
        {"version": 2, "packages": [{"id": "pulse", "manifest": "pulse/manifest.json"}]},
    )
    _write_json(
        device_root / "node_pkgs" / "pulse" / "manifest.json",
        {
            "id": "pulse",
            "version": "1.0.0",
            "manifestVersion": 2,
            "variants": {
                "py": {"precedence": 0, "requiredCapabilities": []},
                "viper": {"precedence": 10, "requiredCapabilities": ["viper"]},
            },
        },
    )


def _selected_variant(
    device_root: Path, context: TargetPackageContext, requested: str
) -> str | None:
    """Return the variant id ``select_variant`` picks for an explicit request."""

    entries = load_package_entries(device_root)
    variant = select_variant(
        entries,
        "pulse",
        device_root=device_root,
        is_general=context.is_general,
        has_general_capability=context.has_general_capability,
        has_pin_capability=context.has_pin_capability,
        requested_variant=requested,
    )
    if variant is None:
        return None
    return variant.variant_id


def test_explicit_variant_selects_the_requested_implementation(tmp_path: Path) -> None:
    """The requested variant is honoured through the context, exactly as staging does."""

    device_root = _device_root(tmp_path, wifi=True, viper=True)
    _add_two_variant_package(device_root)

    capable = resolve_target_package_context(
        device_root=device_root,
        resolution=_resolution("esp32_s3_mini"),
    )
    assert _selected_variant(device_root, capable, "viper") == "viper"

    incapable_root = _device_root(tmp_path / "incapable", wifi=True, viper=False)
    _add_two_variant_package(incapable_root)
    incapable = resolve_target_package_context(
        device_root=incapable_root,
        resolution=_resolution("esp32_s3_mini"),
    )
    assert _selected_variant(incapable_root, incapable, "py") == "py"


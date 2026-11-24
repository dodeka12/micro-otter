from pathlib import Path

import pytest

from micro_otter.tools.firmware_compile.target_mapping import (
  build_target_mapping_warning,
  resolve_compile_target_resolution,
)


def _write_mapping(workspace_root: Path, content: str) -> None:
    mapping_path = (
        workspace_root
        / "src"
        / "micro_otter"
        / "nodes"
        / "device"
        / "targets"
        / "compile_target_mappings.json"
    )
    mapping_path.parent.mkdir(parents=True, exist_ok=True)
    mapping_path.write_text(content, encoding="utf-8")


def test_resolve_compile_target_resolution_exact_rule(tmp_path: Path):
    _write_mapping(
        tmp_path,
        """
{
  "schemaVersion": 1,
  "rules": [
    {
      "id": "esp32-exact",
      "webTargetId": "esp32_wroom",
      "runtimeIdInclude": ["general"],
      "runtimeIdExclude": [],
      "compile": {"board": "esp32", "port": "esp32"},
      "priority": 100
    },
    {
      "id": "generic-fallback",
      "webTargetId": "generic_micropython",
      "runtimeIdInclude": ["*"],
      "runtimeIdExclude": [],
      "compile": {"board": "*", "port": "*"},
      "priority": 10
    }
  ]
}
""".strip(),
    )

    resolved = resolve_compile_target_resolution(
        workspace_root=tmp_path,
        runtime_id="general",
        board="esp32",
    )

    assert resolved.web_target_id is None
    assert resolved.allowed_web_target_ids == ("esp32_wroom",)
    assert resolved.compile_board == "esp32"
    assert resolved.compile_port == "esp32"
    assert resolved.mapping_rule_id == "esp32-exact"
    assert resolved.mapping_confidence == "exact"


def test_resolve_compile_target_resolution_wildcard_fallback(tmp_path: Path):
    _write_mapping(
        tmp_path,
        """
{
  "schemaVersion": 1,
  "rules": [
    {
      "id": "generic-fallback",
      "webTargetId": "generic_micropython",
      "runtimeIdInclude": ["*"],
      "runtimeIdExclude": [],
      "compile": {"board": "*", "port": "*"},
      "priority": 10
    }
  ]
}
""".strip(),
    )

    resolved = resolve_compile_target_resolution(
        workspace_root=tmp_path,
        runtime_id="general",
        board="rp2",
    )

    assert resolved.web_target_id is None
    assert resolved.allowed_web_target_ids == ("generic_micropython",)
    assert resolved.compile_board == "rp2"
    assert resolved.compile_port == "rp2"
    assert resolved.mapping_rule_id == "generic-fallback"
    assert resolved.mapping_confidence == "wildcard"


def test_resolve_compile_target_resolution_ambiguous_priority_raises(tmp_path: Path):
    _write_mapping(
        tmp_path,
        """
{
  "schemaVersion": 1,
  "rules": [
    {
      "id": "generic-a",
      "webTargetId": "generic_micropython",
      "runtimeIdInclude": ["*"],
      "runtimeIdExclude": [],
      "compile": {"board": "*", "port": "*"},
      "priority": 10
    },
    {
      "id": "generic-b",
      "webTargetId": "generic_micropython",
      "runtimeIdInclude": ["*"],
      "runtimeIdExclude": [],
      "compile": {"board": "*", "port": "*"},
      "priority": 10
    }
  ]
}
""".strip(),
    )

    with pytest.raises(ValueError, match="TARGET_MAPPING_AMBIGUOUS"):
        resolve_compile_target_resolution(
            workspace_root=tmp_path,
            runtime_id="general",
            board="esp32",
        )


def test_resolve_compile_target_resolution_no_match_raises_categorized_error(tmp_path: Path):
    _write_mapping(
        tmp_path,
        """
{
  "schemaVersion": 1,
  "rules": [
    {
      "id": "rp2-only",
      "webTargetId": "generic_micropython",
      "runtimeIdInclude": ["general"],
      "runtimeIdExclude": [],
      "compile": {"board": "rp2", "port": "rp2"},
      "priority": 100
    }
  ]
}
""".strip(),
    )

    with pytest.raises(ValueError, match="TARGET_MAPPING_NO_MATCH"):
        resolve_compile_target_resolution(
            workspace_root=tmp_path,
            runtime_id="general",
            board="esp32",
        )


def test_non_exact_warning_describes_constraint_resolution(tmp_path: Path):
    _write_mapping(
        tmp_path,
        """
{
  "schemaVersion": 1,
  "rules": [
    {
      "id": "esp32-default",
      "webTargetId": "esp32_wroom",
      "runtimeIdInclude": ["*"],
      "runtimeIdExclude": [],
      "compile": {"board": "esp32", "port": "esp32"},
      "priority": 100
    }
  ]
}
""".strip(),
    )

    resolved = resolve_compile_target_resolution(
        workspace_root=tmp_path,
        runtime_id="general",
        board="esp32",
    )
    warning = build_target_mapping_warning(resolved)

    assert warning is not None
    assert warning.startswith("TARGET_MAPPING_PARTIAL")
    assert "exact board target remains unset" in warning


def test_resolve_compile_target_resolution_esp32_s2_owns_its_rule(tmp_path: Path):
    _write_mapping(
        tmp_path,
        """
{
  "schemaVersion": 1,
  "rules": [
    {
      "id": "esp32-s2-default",
      "webTargetId": "esp32_s2",
      "runtimeIdInclude": ["general"],
      "runtimeIdExclude": [],
      "compile": {"board": "ESP32_GENERIC_S2", "port": "esp32"},
      "priority": 100
    },
    {
      "id": "generic-fallback",
      "webTargetId": "generic_micropython",
      "runtimeIdInclude": ["*"],
      "runtimeIdExclude": [],
      "compile": {"board": "*", "port": "*"},
      "priority": 10
    }
  ]
}
""".strip(),
    )

    resolved = resolve_compile_target_resolution(
        workspace_root=tmp_path,
        runtime_id="general",
        board="ESP32_GENERIC_S2",
    )

    assert resolved.web_target_id is None
    assert resolved.allowed_web_target_ids == ("esp32_s2",)
    assert resolved.compile_board == "ESP32_GENERIC_S2"
    assert resolved.compile_port == "esp32"
    assert resolved.mapping_rule_id == "esp32-s2-default"
    assert resolved.mapping_confidence == "exact"
    assert build_target_mapping_warning(resolved) is None


def test_resolve_compile_target_resolution_esp32_s3_mini(tmp_path: Path):
    _write_mapping(
        tmp_path,
        """
{
  "schemaVersion": 1,
  "rules": [
    {
      "id": "esp32-s3-mini-default",
      "webTargetId": "esp32_s3_mini",
      "runtimeIdInclude": ["general"],
      "runtimeIdExclude": [],
      "compile": {"board": "ESP32_GENERIC_S3", "port": "esp32"},
      "priority": 100
    },
    {
      "id": "generic-fallback",
      "webTargetId": "generic_micropython",
      "runtimeIdInclude": ["*"],
      "runtimeIdExclude": [],
      "compile": {"board": "*", "port": "*"},
      "priority": 10
    }
  ]
}
""".strip(),
    )

    resolved = resolve_compile_target_resolution(
        workspace_root=tmp_path,
        runtime_id="general",
        board="ESP32_GENERIC_S3",
    )

    assert resolved.web_target_id is None
    assert resolved.allowed_web_target_ids == ("esp32_s3_mini",)
    assert resolved.compile_board == "ESP32_GENERIC_S3"
    assert resolved.compile_port == "esp32"
    assert resolved.mapping_rule_id == "esp32-s3-mini-default"
    assert resolved.mapping_confidence == "exact"

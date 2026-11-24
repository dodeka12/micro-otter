from pathlib import Path

import pytest

from micro_otter.tools.firmware_compile.target_mapping import resolve_compile_target_resolution


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


def test_runtime_list_defaults_include_any_runtime_when_lists_omitted(tmp_path: Path):
    _write_mapping(
        tmp_path,
        """
{
  "schemaVersion": 1,
  "rules": [
    {
      "id": "esp32-default",
      "webTargetId": "esp32_wroom",
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

    assert resolved.web_target_id is None
    assert resolved.allowed_web_target_ids == ("esp32_wroom",)
    assert resolved.mapping_rule_id == "esp32-default"


def test_runtime_exclude_list_overrides_wildcard_include(tmp_path: Path):
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
      "runtimeIdExclude": ["general"],
      "compile": {"board": "esp32", "port": "esp32"},
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


def test_runtime_id_pattern_is_rejected_in_new_model(tmp_path: Path):
    _write_mapping(
        tmp_path,
        """
{
  "schemaVersion": 1,
  "rules": [
    {
      "id": "legacy-pattern",
      "webTargetId": "esp32_wroom",
      "runtimeIdPattern": "general",
      "compile": {"board": "esp32", "port": "esp32"},
      "priority": 100
    }
  ]
}
""".strip(),
    )

    with pytest.raises(
        ValueError, match="runtimeIdPattern is unsupported; use runtimeIdInclude/runtimeIdExclude"
    ):
        resolve_compile_target_resolution(
            workspace_root=tmp_path,
            runtime_id="general",
            board="esp32",
        )

"""Tests for ``resolve_web_target``: the server-side web-target → board/backend lookup."""

from pathlib import Path

import pytest

from micro_otter.tools.firmware_compile.target_mapping import (
    WebTargetResolution,
    WebTargetUnknownError,
    resolve_web_target,
)

REPO_ROOT = Path(__file__).resolve().parents[1]


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


def test_shipped_web_targets_resolve_to_board_and_backend():
    esp32 = resolve_web_target(
        target_id="esp32_wroom", workspace_root=REPO_ROOT, runtime_id="general"
    )
    assert isinstance(esp32, WebTargetResolution)
    assert esp32.target_id == "esp32_wroom"
    assert esp32.board == "esp32"
    assert esp32.backend == "esp-idf"
    assert esp32.params == {"port": "esp32"}

    s3 = resolve_web_target(
        target_id="esp32_s3", workspace_root=REPO_ROOT, runtime_id="general"
    )
    assert s3.board == "ESP32_GENERIC_S3"
    assert s3.backend == "esp-idf"


def test_derived_web_target_resolves_through_its_chain():
    mini = resolve_web_target(
        target_id="esp32_s3_mini", workspace_root=REPO_ROOT, runtime_id="general"
    )
    assert mini.board == "ESP32_GENERIC_S3"
    assert mini.backend == "esp-idf"


def test_shipped_wildcard_targets_resolve_to_no_board():
    for target_id in ("custom", "generic_micropython"):
        resolved = resolve_web_target(
            target_id=target_id, workspace_root=REPO_ROOT, runtime_id="general"
        )
        assert resolved.board is None
        assert resolved.backend is None
        assert resolved.params == {}


def test_unknown_target_raises_target_unknown():
    with pytest.raises(WebTargetUnknownError) as excinfo:
        resolve_web_target(
            target_id="does-not-exist", workspace_root=REPO_ROOT, runtime_id="general"
        )

    assert excinfo.value.code == "target-unknown"
    assert excinfo.value.target_id == "does-not-exist"


def test_runtime_exclude_filters_a_matching_rule(tmp_path: Path):
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
      "compile": {"board": "esp32", "backend": "esp-idf", "params": {"port": "esp32"}},
      "priority": 100
    }
  ]
}
""".strip(),
    )

    with pytest.raises(WebTargetUnknownError):
        resolve_web_target(
            target_id="esp32_wroom", workspace_root=tmp_path, runtime_id="general"
        )


def test_ambiguity_across_same_priority_rules_raises(tmp_path: Path):
    _write_mapping(
        tmp_path,
        """
{
  "schemaVersion": 1,
  "rules": [
    {
      "id": "esp32-a",
      "webTargetId": "esp32_wroom",
      "runtimeIdInclude": ["*"],
      "runtimeIdExclude": [],
      "compile": {"board": "esp32", "backend": "esp-idf", "params": {"port": "esp32"}},
      "priority": 10
    },
    {
      "id": "esp32-b",
      "webTargetId": "esp32_wroom",
      "runtimeIdInclude": ["*"],
      "runtimeIdExclude": [],
      "compile": {"board": "esp32", "backend": "esp-idf", "params": {"port": "esp32"}},
      "priority": 10
    }
  ]
}
""".strip(),
    )

    with pytest.raises(ValueError, match="TARGET_MAPPING_AMBIGUOUS"):
        resolve_web_target(
            target_id="esp32_wroom", workspace_root=tmp_path, runtime_id="general"
        )


def test_web_target_symbols_are_exported_from_the_package():
    from micro_otter.tools import firmware_compile

    assert "WebTargetResolution" in firmware_compile.__all__
    assert "WebTargetUnknownError" in firmware_compile.__all__
    assert "WebBaseTargetUnknownError" in firmware_compile.__all__
    assert "WebBaseTargetNoMappingError" in firmware_compile.__all__
    assert "resolve_web_target" in firmware_compile.__all__


def test_base_target_resolution_uses_the_base_rule():
    resolved = resolve_web_target(
        target_id="derived_s3",
        base_target_id="esp32_s3",
        workspace_root=REPO_ROOT,
        runtime_id="general",
    )

    assert resolved.target_id == "esp32_s3"
    assert resolved.board == "ESP32_GENERIC_S3"
    assert resolved.backend == "esp-idf"


def test_unknown_base_target_raises_base_target_unknown():
    from micro_otter.tools.firmware_compile.target_mapping import (
        WebBaseTargetUnknownError,
    )

    with pytest.raises(WebBaseTargetUnknownError) as excinfo:
        resolve_web_target(
            target_id="derived",
            base_target_id="does-not-exist",
            workspace_root=REPO_ROOT,
            runtime_id="general",
        )

    assert excinfo.value.code == "base-target-unknown"
    assert excinfo.value.base_target_id == "does-not-exist"


def test_wildcard_base_target_raises_base_no_mapping():
    from micro_otter.tools.firmware_compile.target_mapping import (
        WebBaseTargetNoMappingError,
    )

    with pytest.raises(WebBaseTargetNoMappingError) as excinfo:
        resolve_web_target(
            target_id="derived",
            base_target_id="generic_micropython",
            workspace_root=REPO_ROOT,
            runtime_id="general",
        )

    assert excinfo.value.code == "base-no-mapping"
    assert excinfo.value.base_target_id == "generic_micropython"


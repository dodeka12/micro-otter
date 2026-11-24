from pathlib import Path

from micro_otter.tools.firmware_compile.staging_models import (
    EmbeddedHashRecord,
    RuntimePackageAsset,
    RuntimePayload,
    StagingConflict,
    StagingCopyResult,
)


def test_runtime_payload_supports_normalized_collections():
    asset = RuntimePackageAsset(
        package_id="core",
        package_version="1.0.1",
        source_path=Path("/repo/src/micro_otter/nodes/device/node_pkgs/core/libs/core/system.py"),
        target_rel_path="libs/core/system.py",
    )
    payload = RuntimePayload(
        runtime_id="general",
        runtime_version="1.11.0",
        runtime_root=Path("/repo/src/micro_otter/nodes/device/runtime/general"),
        runtime_files=("main.py", "app/main_loop.py"),
        tools_files=("wifi_manager.py",),
        package_assets=(asset,),
    )

    assert payload.runtime_id == "general"
    assert payload.package_assets[0].target_rel_path == "libs/core/system.py"


def test_conflict_defaults_reason():
    conflict = StagingConflict(
        target_rel_path="libs/core/system.py",
        first_source=Path("/a/system.py"),
        second_source=Path("/b/system.py"),
    )

    assert conflict.reason == "duplicate-target-path"


def test_staging_copy_result_defaults():
    result = StagingCopyResult()
    assert result.files_discovered == 0
    assert result.files_copied == 0
    assert result.files_skipped == 0
    assert result.conflicts == []


def test_embedded_hash_record_defaults_source():
    record = EmbeddedHashRecord(
        path="libs/core/system.py",
        file_hash="sha256:abc",
        file_kind="py",
    )

    assert record.source == "embedded"

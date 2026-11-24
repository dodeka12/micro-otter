from __future__ import annotations

import pytest

from micro_otter.tools.firmware_compile.version_identity import (
    BumpDecision,
    MicropythonVersionError,
    VersionIdentityError,
    classify_changed_file,
    decide_runtime_firmware_bump,
    firmware_version_sort_key,
    format_full_firmware_version,
    parse_full_firmware_version,
    resolve_micropython_version,
)


def test_firmware_version_sort_key_orders_semver_numerically():
    assert firmware_version_sort_key("0.13.0") > firmware_version_sort_key("0.2.0")
    assert firmware_version_sort_key("0.10.0") > firmware_version_sort_key("0.9.0")


def test_firmware_version_sort_key_semver_outranks_odd_names():
    assert firmware_version_sort_key("0.0.1") > firmware_version_sort_key("custom")


def test_format_and_parse_full_firmware_version_round_trip():
    value = format_full_firmware_version(
        micropython_version="1.24.0",
        board_id="esp32",
        runtime_id="general",
        runtime_firmware_version="0.3.0",
    )

    parsed = parse_full_firmware_version(value)

    assert value == "1.24.0-esp32-general-0.3.0"
    assert parsed.micropython_version == "1.24.0"
    assert parsed.board_id == "esp32"
    assert parsed.runtime_id == "general"
    assert parsed.runtime_firmware_version == "0.3.0"
    assert parsed.content_hash is None


def test_format_and_parse_five_segment_version_with_content_hash():
    value = format_full_firmware_version(
        micropython_version="1.24.0",
        board_id="esp32",
        runtime_id="general",
        runtime_firmware_version="0.3.0",
        content_hash="0123456789ab",
    )

    parsed = parse_full_firmware_version(value)

    assert value == "1.24.0-esp32-general-0.3.0-0123456789ab"
    assert parsed.content_hash == "0123456789ab"


def test_format_rejects_invalid_content_hash_length():
    with pytest.raises(VersionIdentityError, match="content_hash"):
        format_full_firmware_version(
            micropython_version="1.24.0",
            board_id="esp32",
            runtime_id="general",
            runtime_firmware_version="0.3.0",
            content_hash="abc123",
        )


def test_parse_rejects_invalid_shape():
    with pytest.raises(VersionIdentityError, match="must follow"):
        parse_full_firmware_version("1.24.0-esp32-general")


def test_format_and_parse_prerelease_version() -> None:
    value = format_full_firmware_version(
        micropython_version="1.27.0",
        board_id="esp32",
        runtime_id="general",
        runtime_firmware_version="1.0.1-dev.7.gabc1234",
        content_hash="0123456789ab",
    )

    parsed = parse_full_firmware_version(value)

    assert value == "1.27.0-esp32-general-1.0.1-dev.7.gabc1234-0123456789ab"
    assert parsed.runtime_firmware_version == "1.0.1-dev.7.gabc1234"
    assert parsed.channel == "dev"
    assert parsed.is_prerelease is True
    assert parsed.content_hash == "0123456789ab"


def test_parse_release_version_reports_channel() -> None:
    parsed = parse_full_firmware_version("1.27.0-esp32-general-1.0.0")

    assert parsed.channel == "release"
    assert parsed.is_prerelease is False



def test_classify_changed_file_categories():
    assert (
        classify_changed_file("src/micro_otter/nodes/device/runtime/general/main.py")
        == "runtime-source"
    )
    assert (
        classify_changed_file("src/micro_otter/nodes/device/tools/runtime_info.py")
        == "device-tools"
    )
    assert (
        classify_changed_file("src/micro_otter/nodes/device/node_pkgs/core/manifest.json")
        == "node-package"
    )
    runtime_asset = (
        "src/micro_otter/tools/firmware_compile/runtime_assets/otter_runtime/"
        "embedded_metadata_api.py"
    )
    assert classify_changed_file(runtime_asset) == "runtime-assets"
    assert classify_changed_file("docs/dev/firmware-compile/index.md") == "other"


def test_decide_bump_treats_runtime_assets_as_relevant():
    decision = decide_runtime_firmware_bump(
        commit_message="fix: update bootstrap API",
        changed_paths=["src/micro_otter/tools/firmware_compile/runtime_assets/otter_runtime/embedded_metadata_api.py"],
    )

    assert decision.bump_type == "patch"
    assert "runtime-assets" in decision.file_classes


def test_decide_bump_ignores_irrelevant_changes():
    decision = decide_runtime_firmware_bump(
        commit_message="feat: update docs",
        changed_paths=["docs/dev/index.md"],
    )

    assert decision.bump_type is None
    assert decision.file_classes == ("other",)


def test_decide_bump_maps_feat_to_minor_for_relevant_changes():
    decision = decide_runtime_firmware_bump(
        commit_message="feat: update runtime startup",
        changed_paths=["src/micro_otter/nodes/device/runtime/general/main.py"],
    )

    assert isinstance(decision, BumpDecision)
    assert decision.bump_type == "minor"
    assert "runtime-source" in decision.file_classes


def test_decide_bump_maps_fix_to_patch_for_relevant_changes():
    decision = decide_runtime_firmware_bump(
        commit_message="fix: patch runtime tool",
        changed_paths=["src/micro_otter/nodes/device/tools/runtime_info.py"],
    )

    assert decision.bump_type == "patch"
    assert "device-tools" in decision.file_classes


def test_decide_bump_uses_major_for_breaking_change():
    decision = decide_runtime_firmware_bump(
        commit_message="feat!: rewrite runtime layout",
        changed_paths=["src/micro_otter/nodes/device/node_pkgs/core/manifest.json"],
    )

    assert decision.bump_type == "major"
    assert decision.has_breaking_change is True


def test_decide_bump_rejects_missing_commit_prefix_when_relevant_files_changed():
    with pytest.raises(VersionIdentityError, match="Conventional Commit"):
        decide_runtime_firmware_bump(
            commit_message="update runtime internals",
            changed_paths=["src/micro_otter/nodes/device/runtime/general/main.py"],
        )


def test_format_rejects_hyphenated_board_id():
    with pytest.raises(VersionIdentityError):
        format_full_firmware_version(
            micropython_version="1.27.0",
            board_id="esp32-s2",
            runtime_id="general",
            runtime_firmware_version="0.1.0",
        )


def test_format_rejects_hyphenated_runtime_id():
    with pytest.raises(VersionIdentityError):
        format_full_firmware_version(
            micropython_version="1.27.0",
            board_id="esp32",
            runtime_id="webview-only",
            runtime_firmware_version="0.1.0",
        )


def test_parse_round_trips_valid_version():
    version = "1.27.0-esp32-general-0.1.0"
    parsed = parse_full_firmware_version(version)
    assert format_full_firmware_version(
        micropython_version=parsed.micropython_version,
        board_id=parsed.board_id,
        runtime_id=parsed.runtime_id,
        runtime_firmware_version=parsed.runtime_firmware_version,
    ) == version


def test_resolve_micropython_version_from_env_strips_v_prefix(monkeypatch, tmp_path):
    monkeypatch.setenv("MICROPYTHON_VERSION", "v1.27.0")
    assert resolve_micropython_version(tmp_path) == "1.27.0"


def test_resolve_micropython_version_from_env_accepts_no_prefix(monkeypatch, tmp_path):
    monkeypatch.setenv("MICROPYTHON_VERSION", "1.27.0")
    assert resolve_micropython_version(tmp_path) == "1.27.0"


def test_resolve_micropython_version_env_takes_precedence_over_git(monkeypatch, tmp_path):
    monkeypatch.setenv("MICROPYTHON_VERSION", "v1.27.0")
    # If env var is used, git is never called — even if directory doesn't exist
    assert resolve_micropython_version(tmp_path / "nonexistent") == "1.27.0"


def test_resolve_micropython_version_falls_back_to_git_describe(monkeypatch, tmp_path):
    monkeypatch.delenv("MICROPYTHON_VERSION", raising=False)
    # Create a fake git repo with a tag
    import subprocess as sp
    sp.run(["git", "init"], cwd=tmp_path, check=True, capture_output=True)
    sp.run(
        ["git", "config", "user.email", "test@test.com"],
        cwd=tmp_path,
        check=True,
        capture_output=True,
    )
    sp.run(["git", "config", "user.name", "Test"], cwd=tmp_path, check=True, capture_output=True)
    sp.run(["git", "config", "tag.gpgsign", "false"], cwd=tmp_path, check=True, capture_output=True)
    (tmp_path / "f").write_text("x")
    sp.run(["git", "add", "."], cwd=tmp_path, check=True, capture_output=True)
    sp.run(
        ["git", "commit", "-m", "init", "--no-gpg-sign"],
        cwd=tmp_path,
        check=True,
        capture_output=True,
    )
    sp.run(["git", "tag", "v1.27.0"], cwd=tmp_path, check=True, capture_output=True)
    assert resolve_micropython_version(tmp_path) == "1.27.0"


def test_resolve_micropython_version_raises_when_neither_source_works(monkeypatch, tmp_path):
    monkeypatch.delenv("MICROPYTHON_VERSION", raising=False)
    with pytest.raises(MicropythonVersionError):
        resolve_micropython_version(tmp_path / "nonexistent")


def test_resolve_micropython_version_raises_on_invalid_env_semver(monkeypatch, tmp_path):
    monkeypatch.setenv("MICROPYTHON_VERSION", "latest")
    with pytest.raises(MicropythonVersionError):
        resolve_micropython_version(tmp_path / "nonexistent")

from pathlib import Path

from micro_otter.tools.firmware_compile.local_firmware import (
    latest_version_by_board,
    parse_firmware_filename,
    scan_publish_root,
)


def test_parse_firmware_filename_with_hyphenated_repo_name():
    entry = parse_firmware_filename("micro-otter-1.27.0-esp32-general-0.13.0.bin")

    assert entry is not None
    assert entry.micropython_version == "1.27.0"
    assert entry.board_id == "esp32"
    assert entry.runtime_id == "general"
    assert entry.runtime_firmware_version == "0.13.0"


def test_parse_firmware_filename_with_underscore_board_id():
    entry = parse_firmware_filename("micro-otter-1.27.0-esp32_generic_s3-general-0.1.0.bin")

    assert entry is not None
    assert entry.board_id == "esp32_generic_s3"
    assert entry.runtime_firmware_version == "0.1.0"


def test_parse_firmware_filename_with_content_hash():
    entry = parse_firmware_filename("micro-otter-1.27.0-esp32-general-0.1.0-0123456789ab.bin")

    assert entry is not None
    assert entry.board_id == "esp32"
    assert entry.runtime_firmware_version == "0.1.0"
    assert entry.content_hash == "0123456789ab"


def test_parse_firmware_filename_ignores_non_matching_names():
    assert parse_firmware_filename("firmware.bin") is None
    assert parse_firmware_filename("notes.txt") is None
    assert parse_firmware_filename("micro-otter.bin") is None


def test_scan_publish_root_groups_and_sorts_versions(tmp_path: Path):
    (tmp_path / "micro-otter-1.27.0-esp32-general-0.13.0.bin").write_bytes(b"\x00")
    (tmp_path / "micro-otter-1.27.0-esp32-general-0.10.0.bin").write_bytes(b"\x00")
    (tmp_path / "micro-otter-1.27.0-esp32_generic_s3-general-0.1.0.bin").write_bytes(b"\x00")
    (tmp_path / "notes.txt").write_text("not firmware", encoding="utf-8")
    (tmp_path / "unrelated.bin").write_bytes(b"\x00")

    assert scan_publish_root(tmp_path) == {
        "esp32": ["0.10.0", "0.13.0"],
        "esp32_generic_s3": ["0.1.0"],
    }


def test_scan_publish_root_missing_directory_returns_empty():
    assert scan_publish_root(Path("/nonexistent/micro-otter/firmware")) == {}


def _write_latest_versions(workspace_root: Path, content: str) -> None:
    path = (
        workspace_root
        / "src"
        / "micro_otter"
        / "nodes"
        / "device"
        / "firmware"
        / "latest_versions.json"
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_latest_version_by_board_reads_registry(tmp_path: Path):
    _write_latest_versions(
        tmp_path,
        """\
{
  "schemaVersion": 1,
  "targets": {
    "esp32-general": {
      "boardId": "esp32",
      "fullVersion": "1.27.0-esp32-general-0.13.0",
      "micropythonVersion": "1.27.0",
      "runtimeFirmwareVersion": "0.13.0",
      "runtimeId": "general",
      "updatedAtUtc": "2026-10-22T15:44:10.661408Z"
    },
    "esp32_generic_s3-general": {
      "boardId": "esp32_generic_s3",
      "fullVersion": "1.27.0-esp32_generic_s3-general-0.1.0",
      "micropythonVersion": "1.27.0",
      "runtimeFirmwareVersion": "0.1.0",
      "runtimeId": "general",
      "updatedAtUtc": "2026-10-24T12:35:08.453805Z"
    }
  }
}
""",
    )

    assert latest_version_by_board(tmp_path) == {
        "esp32": "1.27.0-esp32-general-0.13.0",
        "esp32_generic_s3": "1.27.0-esp32_generic_s3-general-0.1.0",
    }


def test_latest_version_by_board_missing_registry_returns_empty(tmp_path: Path):
    assert latest_version_by_board(tmp_path) == {}


def test_latest_version_by_board_invalid_registry_returns_empty(tmp_path: Path):
    _write_latest_versions(tmp_path, "{not valid json")

    assert latest_version_by_board(tmp_path) == {}

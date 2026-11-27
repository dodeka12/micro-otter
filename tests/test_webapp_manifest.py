"""Tests for ``micro_otter.tools.webapp_manifest``.

The manifest is the contract phase 3's upload verifies against, so the hash and size values are
checked against ``hashlib`` directly, and every rejection branch of ``validate_manifest`` is pinned.
"""

from __future__ import annotations

import hashlib
import json
import shutil
from datetime import UTC, datetime
from pathlib import Path

import pytest

from micro_otter.tools.webapp_errors import WebappError
from micro_otter.tools.webapp_manifest import (
    MANIFEST_NAME,
    MANIFEST_SCHEMA,
    collect_files,
    payload,
    read_manifest,
    resolve_built_at,
    sha256_file,
    validate_manifest,
    write_manifest,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "webapp" / "bundle"
"""A tiny built bundle: ``index.html``, ``html/version.json`` and ``html/locales/en.json``."""


def _fixture_tree(tmp_path: Path) -> Path:
    """Copy the fixture bundle into *tmp_path* and return the copy."""

    target = tmp_path / "dist"
    shutil.copytree(FIXTURES, target)
    return target


def _entry(path: str, size: int = 1, sha256: str = "0" * 64) -> dict[str, object]:
    """Return one valid ``files`` entry for the validator tests."""

    return {"path": path, "size": size, "sha256": sha256}


def _document(**overrides: object) -> dict[str, object]:
    """Return a minimal valid manifest document with *overrides* applied."""

    document: dict[str, object] = {
        "schemaVersion": MANIFEST_SCHEMA,
        "appVersion": "1.0.0",
        "hosted": True,
        "builtAt": "2026-11-26T00:00:00Z",
        "publicUrl": None,
        "firmwarePage": None,
        "files": [_entry("index.html")],
    }
    document.update(overrides)
    return document


def test_collect_files_matches_the_bytes_on_disk(tmp_path: Path) -> None:
    tree = _fixture_tree(tmp_path)

    files = collect_files(tree)

    assert [entry["path"] for entry in files] == [
        "html/locales/en.json",
        "html/version.json",
        "index.html",
    ]
    for entry in files:
        path = tree / str(entry["path"])
        assert entry["size"] == path.stat().st_size
        assert entry["sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()
    assert sha256_file(tree / "index.html") == files[2]["sha256"]


def test_collect_files_never_lists_the_manifest(tmp_path: Path) -> None:
    tree = _fixture_tree(tmp_path)
    manifest_path = write_manifest(tree, payload("1.0.0", hosted=True, public_url=None,
                                                 firmware_page=None, files=collect_files(tree)))

    files = collect_files(tree)

    assert manifest_path.name == MANIFEST_NAME
    assert MANIFEST_NAME not in {entry["path"] for entry in files}


def test_collect_files_sorts_by_posix_path(tmp_path: Path) -> None:
    (tmp_path / "a.b").write_text("dot", encoding="utf-8")
    (tmp_path / "a").mkdir()
    (tmp_path / "a" / "b").write_text("slash", encoding="utf-8")

    assert [entry["path"] for entry in collect_files(tmp_path)] == ["a.b", "a/b"]


def test_collect_files_reports_a_broken_symlink(tmp_path: Path) -> None:
    tree = _fixture_tree(tmp_path)
    (tree / "gone.bin").symlink_to(tree / "missing.bin")

    with pytest.raises(WebappError) as raised:
        collect_files(tree)

    assert raised.value.code == "webapp-build-failed"
    assert "gone.bin" in str(raised.value)


def test_payload_records_the_documented_fields() -> None:
    built_at = datetime(2026, 11, 26, 9, 0, 0, tzinfo=UTC)

    document = payload(
        "1.43.0",
        hosted=True,
        public_url="https://example.invalid/",
        firmware_page={"path": "firmware/index.html", "entryCount": 2, "indexSha256": "a" * 64},
        files=[_entry("index.html")],
        built_at=built_at,
    )

    assert document == {
        "schemaVersion": "webapp-build/v1",
        "appVersion": "1.43.0",
        "hosted": True,
        "builtAt": "2026-11-26T09:00:00Z",
        "publicUrl": "https://example.invalid/",
        "firmwarePage": {
            "path": "firmware/index.html",
            "entryCount": 2,
            "indexSha256": "a" * 64,
        },
        "files": [_entry("index.html")],
    }


def test_payload_defaults_to_null_for_public_url_and_firmware_page() -> None:
    document = payload(
        "1.0.0",
        hosted=False,
        public_url=None,
        firmware_page=None,
        files=[_entry("index.html")],
    )

    assert document["publicUrl"] is None
    assert document["firmwarePage"] is None
    assert document["hosted"] is False


def test_build_stamp_honours_source_date_epoch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SOURCE_DATE_EPOCH", "1700000000")

    first = payload("1.0.0", hosted=True, public_url=None, firmware_page=None,
                    files=[_entry("index.html")])
    second = payload("1.0.0", hosted=True, public_url=None, firmware_page=None,
                     files=[_entry("index.html")])

    assert first == second
    assert first["builtAt"] == "2023-11-14T22:13:20Z"


def test_build_stamp_ignores_a_non_integral_epoch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SOURCE_DATE_EPOCH", "not-a-number")

    resolved = resolve_built_at(now=datetime(2026, 11, 26, 9, 0, 0, tzinfo=UTC))

    assert resolved == datetime(2026, 11, 26, 9, 0, 0, tzinfo=UTC)


def test_write_manifest_serialises_sorted_with_a_trailing_newline(tmp_path: Path) -> None:
    document = _document()

    path = write_manifest(tmp_path, document)

    assert path.read_text(encoding="utf-8") == json.dumps(document, indent=2, sort_keys=True) + "\n"


def test_validate_manifest_accepts_a_written_document(tmp_path: Path) -> None:
    path = write_manifest(tmp_path, _document())

    validate_manifest(read_manifest(path))


def test_validate_manifest_accepts_a_firmware_page_block() -> None:
    validate_manifest(
        _document(
            firmwarePage={
                "path": "firmware/index.html",
                "entryCount": 2,
                "indexSha256": "b" * 64,
            }
        )
    )


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        ({"schemaVersion": "webapp-build/v2"}, "schemaVersion"),
        ({"appVersion": ""}, "appVersion"),
        ({"appVersion": 5}, "appVersion"),
        ({"hosted": "yes"}, "hosted"),
        ({"publicUrl": 5}, "publicUrl"),
        ({"firmwarePage": {"path": "firmware/index.html"}}, "firmwarePage"),
        ({"files": []}, "files"),
        ({"files": "index.html"}, "files"),
        ({"files": [_entry("index.html"), _entry("index.html")]}, "twice"),
        ({"files": [_entry("/index.html")]}, "relative POSIX path"),
        ({"files": [_entry("../index.html")]}, "relative POSIX path"),
        ({"files": [_entry("index.html", sha256="A" * 64)]}, "sha256"),
        ({"files": [_entry("index.html", sha256="abc")]}, "sha256"),
        ({"files": [_entry("index.html", size=-1)]}, "non-negative"),
        ({"files": [_entry("index.html", size=True)]}, "non-negative"),
        ({"files": [{"path": "index.html"}]}, "non-negative"),
        ({"files": ["index.html"]}, "object"),
    ],
)
def test_validate_manifest_rejects_invalid_documents(
    overrides: dict[str, object], expected: str
) -> None:
    with pytest.raises(WebappError) as raised:
        validate_manifest(_document(**overrides))

    assert raised.value.code == "webapp-upload-manifest-invalid"
    assert expected in str(raised.value)


def test_validate_manifest_rejects_a_non_object() -> None:
    with pytest.raises(WebappError) as raised:
        validate_manifest(["index.html"])

    assert raised.value.code == "webapp-upload-manifest-invalid"


def test_validate_manifest_uses_the_callers_code() -> None:
    with pytest.raises(WebappError) as raised:
        validate_manifest(_document(schemaVersion="other"), code="webapp-build-manifest-invalid")

    assert raised.value.code == "webapp-build-manifest-invalid"


def test_read_manifest_reports_a_missing_file(tmp_path: Path) -> None:
    with pytest.raises(WebappError) as raised:
        read_manifest(tmp_path / MANIFEST_NAME)

    assert raised.value.code == "webapp-upload-manifest-invalid"
    assert raised.value.hint is not None


def test_read_manifest_reports_invalid_json(tmp_path: Path) -> None:
    path = tmp_path / MANIFEST_NAME
    path.write_text("{not json", encoding="utf-8")

    with pytest.raises(WebappError) as raised:
        read_manifest(path)

    assert raised.value.code == "webapp-upload-manifest-invalid"
    assert "not valid JSON" in str(raised.value)


def test_read_manifest_rejects_a_non_object(tmp_path: Path) -> None:
    path = tmp_path / MANIFEST_NAME
    path.write_text("[]", encoding="utf-8")

    with pytest.raises(WebappError) as raised:
        read_manifest(path)

    assert raised.value.code == "webapp-upload-manifest-invalid"
    assert "JSON object" in str(raised.value)

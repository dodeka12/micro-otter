"""Tests for the imported-binary producer and the shared publish-root helper.

Covers ``firmware_compile/imported_firmware.py`` — the non-building path that lands
one stock MicroPython ``.bin`` (plus a synthesized sidecar) in the publish root under
the canonical ``imported`` identity — and ``local_firmware.ensure_publish_root``,
the helper every producer now shares. Every failure is asserted by its stable
``code``.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from micro_otter.tools.firmware_compile import imported_firmware
from micro_otter.tools.firmware_compile.firmware_package import (
    CODE_IMPORT_DENIED,
    CODE_IMPORT_EXISTS,
    STAGING_DIR,
)
from micro_otter.tools.firmware_compile.imported_firmware import (
    CODE_IMPORT_INVALID,
    IMPORTED_RUNTIME_FIRMWARE_VERSION,
    IMPORTED_RUNTIME_ID,
    IMPORTED_SOURCE,
    MAX_IMPORTED_BINARY_BYTES,
    ImportedFirmwareError,
    build_imported_sidecar,
    detect_micropython_version,
    import_firmware_binary,
    imported_firmware_filename,
)
from micro_otter.tools.firmware_compile.local_firmware import (
    ensure_publish_root,
    parse_firmware_filename,
)

STOCK_NAME = "MicroPython-v1.27.0-esp32.bin"
IMAGE_BYTES = b"\x00\x01\x02stock-image"


def _write_source(tmp_path: Path, *, name: str = STOCK_NAME, data: bytes = IMAGE_BYTES) -> Path:
    """Write a fake stock image under *tmp_path* and return its path."""

    source = tmp_path / name
    source.write_bytes(data)
    return source


def _digest(data: bytes = IMAGE_BYTES) -> str:
    """Return the SHA-256 hex digest of *data*."""

    return hashlib.sha256(data).hexdigest()


def test_ensure_publish_root_creates_and_resolves_a_missing_nested_root(tmp_path: Path):
    """A missing nested publish root is created and returned already resolved."""

    root = ensure_publish_root(tmp_path / "nested" / "publish")

    assert root.is_dir()
    assert root == (tmp_path / "nested" / "publish").resolve()


def test_ensure_publish_root_refuses_a_root_blocked_by_a_file(tmp_path: Path):
    """A file where the publish root belongs raises ``OSError``, not a silent no-op."""

    blocked = tmp_path / "blocked"
    blocked.write_bytes(b"not a folder")

    with pytest.raises(OSError):
        ensure_publish_root(blocked)


def test_ensure_publish_root_refuses_an_unwritable_root(tmp_path: Path, monkeypatch):
    """A root the process cannot write raises ``OSError`` naming the folder."""

    root = tmp_path / "publish"
    root.mkdir()
    monkeypatch.setattr(imported_firmware.os, "access", lambda *args, **kwargs: False)

    with pytest.raises(OSError) as excinfo:
        ensure_publish_root(root)

    assert "not writable" in str(excinfo.value)
    assert str(root.resolve()) in str(excinfo.value)


def test_detect_micropython_version_from_a_stock_name():
    """A stock download name yields its version (the date prefix is not the version)."""

    assert detect_micropython_version("esp32-20240602-v1.23.0.bin") == "1.23.0"


def test_detect_micropython_version_falls_back_when_absent():
    """A name without a version falls back to the placeholder, never raising."""

    assert detect_micropython_version("firmware.bin") == IMPORTED_RUNTIME_FIRMWARE_VERSION
    assert detect_micropython_version("") == IMPORTED_RUNTIME_FIRMWARE_VERSION


def test_detect_micropython_version_drops_a_leading_v():
    """A leading ``v`` is dropped and only a grammar-valid triple is accepted."""

    assert detect_micropython_version("MicroPython-v1.27.0-esp32.bin") == "1.27.0"
    assert detect_micropython_version("v01.02.03.bin") == IMPORTED_RUNTIME_FIRMWARE_VERSION


def test_imported_firmware_filename_round_trips_through_the_parser():
    """The composed name parses back to the imported identity and its digest."""

    name = imported_firmware_filename(
        micropython_version="1.27.0", board_id="esp32", sha256=_digest()
    )

    assert name == f"1.27.0-esp32-imported-0.0.0-{_digest()[:12]}.bin"
    parts = parse_firmware_filename(name)
    assert parts is not None
    assert parts.board_id == "esp32"
    assert parts.runtime_id == IMPORTED_RUNTIME_ID
    assert parts.runtime_firmware_version == IMPORTED_RUNTIME_FIRMWARE_VERSION
    assert parts.content_hash == _digest()[:12]


def test_imported_firmware_filename_separates_two_images_of_one_board():
    """Two different stock images of one board get two names, never one."""

    first = imported_firmware_filename(
        micropython_version="1.27.0", board_id="esp32", sha256="a" * 64
    )
    second = imported_firmware_filename(
        micropython_version="1.27.0", board_id="esp32", sha256="b" * 64
    )

    assert first != second


def test_build_imported_sidecar_records_provenance_without_inventing_identity():
    """The synthesized sidecar omits schemaVersion/contentHash and agrees with the name."""

    sidecar = build_imported_sidecar(
        board_id="esp32",
        micropython_version="1.27.0",
        original_filename=STOCK_NAME,
        target_id="esp32",
        sha256=_digest(),
    )

    assert "schemaVersion" not in sidecar
    assert "contentHash" not in sidecar
    assert sidecar["slug"] == "esp32"
    assert sidecar["runtime"] == {"id": IMPORTED_RUNTIME_ID}
    assert sidecar["runtimeFirmwareVersion"] == IMPORTED_RUNTIME_FIRMWARE_VERSION
    assert sidecar["micropythonVersion"] == "1.27.0"
    assert sidecar["source"] == IMPORTED_SOURCE
    assert sidecar["targetId"] == "esp32"
    assert sidecar["originalFilename"] == STOCK_NAME
    assert sidecar["sha256"] == _digest()
    assert sidecar["embeddedPackages"] == {}
    assert sidecar["notEmbedded"] == []
    assert isinstance(sidecar["importedAt"], str) and sidecar["importedAt"]


def test_import_firmware_binary_installs_image_and_sidecar(tmp_path: Path):
    """The happy path lands the canonical name plus its sidecar and reports it."""

    root = tmp_path / "publish"
    source = _write_source(tmp_path)
    expected = imported_firmware_filename(
        micropython_version="1.27.0", board_id="esp32", sha256=_digest()
    )

    record = import_firmware_binary(source, board_id="esp32", target_id="esp32", publish_root=root)

    assert record["status"] == "installed"
    assert record["filename"] == expected
    assert record["boardId"] == "esp32"
    assert record["targetId"] == "esp32"
    assert record["originalFilename"] == STOCK_NAME
    assert record["micropythonVersion"] == "1.27.0"
    assert record["sha256"] == _digest()
    assert record["boardKnown"] is True
    image = root / expected
    assert image.read_bytes() == IMAGE_BYTES
    sidecar = json.loads((root / Path(expected).with_suffix(".manifest.json").name).read_text())
    assert sidecar["source"] == IMPORTED_SOURCE
    assert sidecar["sha256"] == _digest()
    assert not (root / STAGING_DIR).exists()


def test_import_firmware_binary_is_idempotent_for_identical_bytes(tmp_path: Path):
    """Re-importing the same bytes answers ``already-present`` and keeps one image."""

    root = tmp_path / "publish"
    source = _write_source(tmp_path)
    first = import_firmware_binary(source, board_id="esp32", publish_root=root)

    second = import_firmware_binary(source, board_id="esp32", publish_root=root)

    assert first["status"] == "installed"
    assert second["status"] == "already-present"
    assert second["filename"] == first["filename"]
    assert [path.name for path in root.glob("*.bin")] == [first["filename"]]
    assert not (root / STAGING_DIR).exists()


def test_import_firmware_binary_refuses_to_overwrite_a_different_image(tmp_path: Path):
    """A same-name image with other bytes needs ``force``; forcing replaces it."""

    root = tmp_path / "publish"
    root.mkdir()
    source = _write_source(tmp_path)
    name = imported_firmware_filename(
        micropython_version="1.27.0", board_id="esp32", sha256=_digest()
    )
    (root / name).write_bytes(b"different-bytes")

    with pytest.raises(ImportedFirmwareError) as excinfo:
        import_firmware_binary(source, board_id="esp32", publish_root=root)

    assert excinfo.value.code == CODE_IMPORT_EXISTS
    assert excinfo.value.details == {"path": str(root / name)}
    assert (root / name).read_bytes() == b"different-bytes"

    record = import_firmware_binary(source, board_id="esp32", publish_root=root, force=True)

    assert record["status"] == "installed"
    assert (root / name).read_bytes() == IMAGE_BYTES


@pytest.mark.parametrize("filename", ["firmware.uf2", "firmware.txt"])
def test_import_firmware_binary_rejects_a_non_bin_suffix(tmp_path: Path, filename: str):
    """A ``.uf2`` (or any non-``.bin``) is refused as ``firmware-import-invalid``."""

    source = _write_source(tmp_path, name=filename)

    with pytest.raises(ImportedFirmwareError) as excinfo:
        import_firmware_binary(source, board_id="esp32", publish_root=tmp_path / "publish")

    assert excinfo.value.code == CODE_IMPORT_INVALID
    assert ".firmware.zip" in (excinfo.value.hint or "")


def test_import_firmware_binary_rejects_a_missing_source(tmp_path: Path):
    """A path that does not exist is ``firmware-import-invalid``, not a crash."""

    with pytest.raises(ImportedFirmwareError) as excinfo:
        import_firmware_binary(tmp_path / "absent.bin", board_id="esp32", publish_root=tmp_path)

    assert excinfo.value.code == CODE_IMPORT_INVALID


def test_import_firmware_binary_rejects_an_empty_file(tmp_path: Path):
    """An empty ``.bin`` is refused before anything is written."""

    source = _write_source(tmp_path, data=b"")

    with pytest.raises(ImportedFirmwareError) as excinfo:
        import_firmware_binary(source, board_id="esp32", publish_root=tmp_path / "publish")

    assert excinfo.value.code == CODE_IMPORT_INVALID
    assert excinfo.value.details == {"sizeBytes": 0}


def test_import_firmware_binary_rejects_an_oversize_file(tmp_path: Path, monkeypatch):
    """A file above the size cap is refused with both sizes in ``details``."""

    monkeypatch.setattr(imported_firmware, "MAX_IMPORTED_BINARY_BYTES", 4)
    source = _write_source(tmp_path, data=b"0123456789")

    with pytest.raises(ImportedFirmwareError) as excinfo:
        import_firmware_binary(source, board_id="esp32", publish_root=tmp_path / "publish")

    assert excinfo.value.code == CODE_IMPORT_INVALID
    assert excinfo.value.details == {"sizeBytes": 10, "maxBytes": 4}
    assert MAX_IMPORTED_BINARY_BYTES == 8 * 1024 * 1024


def test_import_firmware_binary_rejects_a_malformed_board_id(tmp_path: Path):
    """The board slug is a programming contract: an empty value raises ``ValueError``."""

    source = _write_source(tmp_path)

    with pytest.raises(ValueError):
        import_firmware_binary(source, board_id="", publish_root=tmp_path / "publish")
    with pytest.raises(ValueError):
        import_firmware_binary(source, board_id="ESP32-S3", publish_root=tmp_path / "publish")


def test_import_firmware_binary_reports_board_known_from_the_catalog(tmp_path: Path):
    """``boardKnown`` reflects the catalog when given and defaults to ``True``."""

    source = _write_source(tmp_path)

    known = import_firmware_binary(
        source,
        board_id="esp32",
        publish_root=tmp_path / "a",
        known_board_ids=frozenset({"esp32"}),
    )
    unknown = import_firmware_binary(
        source,
        board_id="esp32",
        publish_root=tmp_path / "b",
        known_board_ids=frozenset({"esp32_s3"}),
    )
    omitted = import_firmware_binary(source, board_id="esp32", publish_root=tmp_path / "c")

    assert known["boardKnown"] is True
    assert unknown["boardKnown"] is False
    assert omitted["boardKnown"] is True


def test_import_firmware_binary_maps_an_unusable_root_to_denied(tmp_path: Path):
    """A root that cannot be created maps to ``firmware-import-denied``."""

    blocked = tmp_path / "blocked"
    blocked.write_bytes(b"not a folder")
    source = _write_source(tmp_path)

    with pytest.raises(ImportedFirmwareError) as excinfo:
        import_firmware_binary(source, board_id="esp32", publish_root=blocked)

    assert excinfo.value.code == CODE_IMPORT_DENIED
    assert excinfo.value.details == {"publishRoot": str(blocked.resolve())}
    assert "MICRO_OTTER_FIRMWARE_DIR" in (excinfo.value.hint or "")

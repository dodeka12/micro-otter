"""Tests for ``tools/make_release_index.py`` (the release-asset index and release body).

Every case builds a fixture release directory from real exported packages
(:func:`...firmware_package.export_firmware_package_to_directory`) plus hand-written
sidecars, so the generator is exercised against the same names the release runbook
tells a maintainer to collect — no mocked filesystem anywhere.
"""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

import pytest
from tools.make_release_index import (
    INDEX_FILENAME,
    NOTES_FILENAME,
    main,
    render_release_notes,
    serialize_index,
)
from tools.make_release_index import build_release_index as build_document

from micro_otter.tools.firmware_compile.firmware_package import (
    export_firmware_package_to_directory,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
RELEASE_JSON = REPO_ROOT / "src/micro_otter/nodes/device/firmware/release.json"
BOARDS_JSON = REPO_ROOT / "src/micro_otter/nodes/device/firmware/boards.json"

BASE_URL = "https://example.invalid/firmware-v1.0.0"
"""Asset prefix every fixture run quotes; deliberately a host that cannot resolve."""

DEFAULT_BOARD = "esp32"
"""Board slug the single-board fixtures use; it exists in the in-tree catalog."""

DEFAULT_HASH = "0123456789ab"
"""Twelve-hex content hash the filename carries (the sidecar repeats it)."""


def _image_name(
    *,
    board: str = DEFAULT_BOARD,
    version: str = "1.0.0",
    micropython: str = "1.26.0",
    runtime: str = "general",
    content_hash: str = DEFAULT_HASH,
) -> str:
    """Return a published firmware filename for the given identity fields."""

    return f"{micropython}-{board}-{runtime}-{version}-{content_hash}.bin"


def _write_asset(
    release_dir: Path,
    *,
    board: str = DEFAULT_BOARD,
    version: str = "1.0.0",
    micropython: str = "1.26.0",
    runtime: str = "general",
    content_hash: str = DEFAULT_HASH,
    sidecar: dict[str, object] | None = None,
    package: bool = True,
) -> Path:
    """Write one image, its sidecar and (optionally) its exported package.

    Args:
        release_dir: Directory the artifacts are written into.
        board: Board slug encoded in the filename and the sidecar.
        version: Runtime firmware version encoded in the filename.
        micropython: MicroPython version encoded in the filename.
        runtime: Runtime id encoded in the filename.
        content_hash: Twelve-hex content hash appended to the filename.
        sidecar: Sidecar payload; ``None`` writes the default v2 sidecar.
        package: When false the ``.firmware.zip`` is not exported (an orphan image).

    Returns:
        The path of the written ``.bin`` image.
    """

    release_dir.mkdir(parents=True, exist_ok=True)
    image = release_dir / _image_name(
        board=board,
        version=version,
        micropython=micropython,
        runtime=runtime,
        content_hash=content_hash,
    )
    image.write_bytes(f"firmware-bytes:{board}:{version}:{micropython}".encode())
    payload = sidecar if sidecar is not None else _sidecar(board=board, runtime=runtime)
    image.with_suffix(".manifest.json").write_text(json.dumps(payload), encoding="utf-8")
    if package:
        export_firmware_package_to_directory(image, destination_dir=release_dir)
    return image


def _sidecar(*, board: str = DEFAULT_BOARD, runtime: str = "general") -> dict[str, object]:
    """Return a minimal v2 sidecar the inventory treats as a complete identity."""

    return {
        "schemaVersion": 2,
        "slug": board,
        "runtime": {"id": runtime},
        "embeddedPackages": {"core": "1.29.0"},
        "addonPackages": {"led": "0.2.0"},
    }


def _run(
    release_dir: Path, *extra: str, capsys: pytest.CaptureFixture[str]
) -> tuple[int, str, str]:
    """Run ``main`` for *release_dir* and return ``(exit code, stdout, stderr)``."""

    code = main(
        [
            "--release-dir",
            str(release_dir),
            "--base-url",
            BASE_URL,
            "--release-json",
            str(RELEASE_JSON),
            *extra,
        ]
    )
    captured = capsys.readouterr()
    return code, captured.out, captured.err


def _sha256(path: Path) -> str:
    """Return the SHA-256 hex digest of the file at *path*."""

    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_index_describes_every_board(tmp_path: Path) -> None:
    """The document carries one entry per board with absolute URLs and real hashes."""

    release_dir = tmp_path / "release-1.0.0"
    esp32 = _write_asset(release_dir)
    s3 = _write_asset(release_dir, board="esp32_generic_s3")

    document = build_document(
        release_dir=release_dir,
        base_url=BASE_URL + "/",
        release_manifest_path=RELEASE_JSON,
        catalog_path=BOARDS_JSON,
        generated_at="2026-11-26T00:00:00Z",
    )

    assert document["schemaVersion"] == 1
    assert document["generatedAt"] == "2026-11-26T00:00:00Z"
    assert document["release"] == {
        "version": "1.0.0",
        "tag": "firmware-v1.0.0",
        "kind": "stable",
    }
    assert [entry["board"] for entry in document["firmware"]] == ["esp32", "esp32_generic_s3"]

    entry = document["firmware"][0]
    package = esp32.with_name(esp32.stem + ".firmware.zip")
    assert entry == {
        "board": "esp32",
        "boardName": "ESP32 (WROOM / generic)",
        "chip": "esp32",
        "flashOffset": "0x1000",
        "runtime": "general",
        "version": "1.0.0",
        "channel": "release",
        "micropythonVersion": "1.26.0",
        "sha256": _sha256(esp32),
        "size": len(esp32.read_bytes()),
        "url": f"{BASE_URL}/{esp32.name}",
        "package": {
            "sha256": _sha256(package),
            "size": len(package.read_bytes()),
            "url": f"{BASE_URL}/{package.name}",
        },
        "includedPackages": {"core": "1.29.0", "led": "0.2.0"},
    }
    assert document["firmware"][1]["flashOffset"] == "0"
    assert document["firmware"][1]["chip"] == "esp32s3"
    assert document["firmware"][1]["url"] == f"{BASE_URL}/{s3.name}"


def test_hashes_come_from_the_bytes_not_the_sidecar(tmp_path: Path) -> None:
    """A sidecar claiming other checksums and sizes never reaches the document."""

    release_dir = tmp_path / "release-1.0.0"
    sidecar = _sidecar() | {"sha256": "f" * 64, "sizeBytes": 1, "size": 1}
    image = _write_asset(release_dir, sidecar=sidecar)

    document = build_document(
        release_dir=release_dir,
        base_url=BASE_URL,
        release_manifest_path=RELEASE_JSON,
        catalog_path=BOARDS_JSON,
        generated_at="2026-11-26T00:00:00Z",
    )

    entry = document["firmware"][0]
    assert entry["sha256"] == _sha256(image)
    assert entry["size"] == len(image.read_bytes())


def test_two_runs_over_shuffled_input_are_byte_identical(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """Creation order and the clock cannot change a single byte of either output.

    The same artifacts are copied into two directories in opposite order, so the
    directory listing order differs while the bytes stay identical; both runs must then
    write the same ``index.json`` and ``release-notes.md``.
    """

    monkeypatch.setenv("SOURCE_DATE_EPOCH", "1795651200")
    source = tmp_path / "source"
    _write_asset(source)
    _write_asset(source, board="esp32_generic_s3")
    names = sorted(path.name for path in source.iterdir())
    forward = tmp_path / "forward"
    backward = tmp_path / "backward"
    for target, order in ((forward, names), (backward, list(reversed(names)))):
        target.mkdir()
        for name in order:
            shutil.copyfile(source / name, target / name)

    assert _run(forward, capsys=capsys)[0] == 0
    assert _run(backward, capsys=capsys)[0] == 0

    for name in (INDEX_FILENAME, NOTES_FILENAME):
        assert (forward / name).read_bytes() == (backward / name).read_bytes()
    index = json.loads((forward / INDEX_FILENAME).read_text(encoding="utf-8"))
    assert index["generatedAt"] == "2026-11-26T00:00:00Z"


def test_release_notes_carry_a_row_per_board(tmp_path: Path) -> None:
    """The body lists both artifacts, the full hash and the install steps."""

    release_dir = tmp_path / "release-1.0.0"
    esp32 = _write_asset(release_dir)
    s3 = _write_asset(release_dir, board="esp32_generic_s3")

    document = build_document(
        release_dir=release_dir,
        base_url=BASE_URL,
        release_manifest_path=RELEASE_JSON,
        catalog_path=BOARDS_JSON,
        generated_at="2026-11-26T00:00:00Z",
    )
    notes = render_release_notes(document)

    assert notes.splitlines()[0] == "# Firmware 1.0.0"
    rows = [line for line in notes.splitlines() if line.startswith("| ") and "`esp32" in line]
    assert len(rows) == 2
    for image in (esp32, s3):
        assert _sha256(image) in notes
        assert f"{BASE_URL}/{image.name}" in notes
        assert f"{BASE_URL}/{image.stem}.firmware.zip" in notes
    assert "Import from URL" in notes
    assert "mo fw import --url" in notes
    assert "<script" not in notes
    assert not any(line.startswith("<") for line in notes.splitlines())


def test_check_matches_a_fresh_run(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """``--check`` exits ``0`` when both files equal a fresh regeneration."""

    monkeypatch.setenv("SOURCE_DATE_EPOCH", "1795651200")
    release_dir = tmp_path / "release-1.0.0"
    _write_asset(release_dir)

    assert _run(release_dir, capsys=capsys)[0] == 0
    code, _, err = _run(release_dir, "--check", capsys=capsys)

    assert (code, err) == (0, "")


def test_check_reports_drift_after_a_hand_edit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """A hand-edited ``index.json`` makes ``--check`` exit ``1`` and name the file."""

    monkeypatch.setenv("SOURCE_DATE_EPOCH", "1795651200")
    release_dir = tmp_path / "release-1.0.0"
    _write_asset(release_dir)
    assert _run(release_dir, capsys=capsys)[0] == 0

    index_path = release_dir / INDEX_FILENAME
    index_path.write_text(
        index_path.read_text(encoding="utf-8").replace('"board": "esp32"', '"board": "esp32x"'),
        encoding="utf-8",
    )
    code, _, err = _run(release_dir, "--check", capsys=capsys)

    assert code == 1
    assert "release-index-drift" in err
    assert str(index_path) in err


def test_check_treats_a_missing_notes_file_as_drift(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """An absent release body cannot pass ``--check``."""

    monkeypatch.setenv("SOURCE_DATE_EPOCH", "1795651200")
    release_dir = tmp_path / "release-1.0.0"
    _write_asset(release_dir)
    assert _run(release_dir, capsys=capsys)[0] == 0
    (release_dir / NOTES_FILENAME).unlink()

    assert _run(release_dir, "--check", capsys=capsys)[0] == 1


def test_empty_directory_is_refused(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """A directory without artifacts fails with ``release-index-empty``."""

    release_dir = tmp_path / "release-1.0.0"
    release_dir.mkdir()

    code, _, err = _run(release_dir, capsys=capsys)

    assert code == 2
    assert "release-index-empty" in err


def test_missing_directory_is_refused(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """A release directory that does not exist is the same failure."""

    code, _, err = _run(tmp_path / "absent", capsys=capsys)

    assert code == 2
    assert "release-index-empty" in err


def test_base_url_must_be_absolute_https(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """An ``http://`` or relative prefix is rejected instead of producing dead URLs."""

    release_dir = tmp_path / "release-1.0.0"
    _write_asset(release_dir)

    code = main(
        [
            "--release-dir",
            str(release_dir),
            "--base-url",
            "http://example.invalid/firmware-v1.0.0",
            "--release-json",
            str(RELEASE_JSON),
        ]
    )

    assert code == 2
    assert "release-index-base-url-invalid" in capsys.readouterr().err


def test_missing_sidecar_is_an_invalid_artifact(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """An image without a v2/v3 sidecar cannot be described, so the run fails."""

    release_dir = tmp_path / "release-1.0.0"
    image = _write_asset(release_dir)
    image.with_suffix(".manifest.json").unlink()

    code, _, err = _run(release_dir, capsys=capsys)

    assert code == 2
    assert "release-index-artifact-invalid" in err
    assert image.name in err


def test_dev_image_is_a_channel_mismatch(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """A ``-dev.<n>.g<sha>`` image may never enter a release index."""

    release_dir = tmp_path / "release-1.0.0"
    image = _write_asset(release_dir, version="1.0.0-dev.1.gabcdef1")

    code, _, err = _run(release_dir, capsys=capsys)

    assert code == 2
    assert "release-index-channel-mismatch" in err
    assert image.name in err


def test_other_version_is_a_version_mismatch(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """An image of another release version disagrees with ``release.json``."""

    release_dir = tmp_path / "release-1.0.0"
    image = _write_asset(release_dir, version="1.0.1")

    code, _, err = _run(release_dir, capsys=capsys)

    assert code == 2
    assert "release-index-version-mismatch" in err
    assert image.name in err


def test_package_without_image_is_an_orphan(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """A package whose image is missing fails the run instead of shipping half a set."""

    release_dir = tmp_path / "release-1.0.0"
    image = _write_asset(release_dir)
    stray = release_dir / "stray.firmware.zip"
    stray.write_bytes(image.with_name(image.stem + ".firmware.zip").read_bytes())

    code, _, err = _run(release_dir, capsys=capsys)

    assert code == 2
    assert "release-index-orphan" in err
    assert stray.name in err


def test_image_without_package_is_an_orphan(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """A ``.bin`` without its exported package is the other half of the same failure."""

    release_dir = tmp_path / "release-1.0.0"
    image = _write_asset(release_dir, package=False)

    code, _, err = _run(release_dir, capsys=capsys)

    assert code == 2
    assert "release-index-orphan" in err
    assert image.name in err


def test_unknown_board_is_refused(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """A slug the board catalog lacks is a board-unknown failure."""

    release_dir = tmp_path / "release-1.0.0"
    _write_asset(release_dir, board="esp32_c3")

    code, _, err = _run(release_dir, capsys=capsys)

    assert code == 2
    assert "release-index-board-unknown" in err
    assert "esp32_c3" in err


def test_help_lists_every_documented_option(capsys: pytest.CaptureFixture[str]) -> None:
    """``--help`` exits ``0`` and names every option the runbook quotes."""

    with pytest.raises(SystemExit) as excinfo:
        main(["--help"])

    assert excinfo.value.code == 0
    output = capsys.readouterr().out
    for option in (
        "--release-dir",
        "--base-url",
        "--out",
        "--notes-out",
        "--release-json",
        "--channel",
        "--check",
    ):
        assert option in output


def test_serialized_index_is_sorted_with_a_trailing_newline(tmp_path: Path) -> None:
    """The canonical serialization is what makes ``--check`` a byte comparison."""

    release_dir = tmp_path / "release-1.0.0"
    _write_asset(release_dir)

    document = build_document(
        release_dir=release_dir,
        base_url=BASE_URL,
        release_manifest_path=RELEASE_JSON,
        catalog_path=BOARDS_JSON,
        generated_at="2026-11-26T00:00:00Z",
    )
    text = serialize_index(document)

    assert text.endswith("\n") and not text.endswith("\n\n")
    assert text.index('"firmware"') < text.index('"generatedAt"')
    assert json.loads(text) == document

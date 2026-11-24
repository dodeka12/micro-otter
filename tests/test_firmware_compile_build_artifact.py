import json
from pathlib import Path

import pytest

from micro_otter.tools.firmware_compile import (
    ArtifactVerificationError,
    FirmwareArtifactRecord,
    candidate_firmware_paths,
    discover_firmware_artifact,
    publish_firmware_artifact,
    verify_firmware_artifact,
)


def test_candidate_firmware_paths_is_deterministic(tmp_path: Path):
    (tmp_path / "ports" / "esp32").mkdir(parents=True, exist_ok=True)
    paths = candidate_firmware_paths(
        micropython_root=tmp_path, target="esp32", board="ESP32_GENERIC"
    )

    assert len(paths) >= 5
    assert paths[0].as_posix().endswith("ports/esp32/build-ESP32_GENERIC/firmware.bin")


def test_discover_firmware_artifact_finds_existing_candidate(tmp_path: Path):
    artifact_path = tmp_path / "ports" / "esp32" / "build-esp32" / "firmware.bin"
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    artifact_path.write_bytes(b"firmware")

    record = discover_firmware_artifact(
        micropython_root=tmp_path,
        target="esp32",
        board="esp32",
        require_exists=True,
    )

    assert record is not None
    assert record.path == artifact_path.resolve()


def test_discover_firmware_artifact_returns_none_when_not_required(tmp_path: Path):
    record = discover_firmware_artifact(
        micropython_root=tmp_path,
        target="esp32",
        board="esp32",
        require_exists=False,
    )

    assert record is None


def test_verify_firmware_artifact_enriches_hash_and_size(tmp_path: Path):
    artifact_path = tmp_path / "firmware.bin"
    artifact_path.write_bytes(b"abc")

    verified = verify_firmware_artifact(FirmwareArtifactRecord(path=artifact_path, board="esp32"))

    assert verified.size_bytes == 3
    assert verified.sha256 is not None
    assert verified.sha256.startswith("sha256:")


def test_verify_firmware_artifact_rejects_empty_file(tmp_path: Path):
    artifact_path = tmp_path / "firmware.bin"
    artifact_path.write_bytes(b"")

    with pytest.raises(ArtifactVerificationError, match="empty"):
        verify_firmware_artifact(FirmwareArtifactRecord(path=artifact_path, board="esp32"))


def test_publish_firmware_artifact_copies_verified_file(tmp_path: Path):
    source = tmp_path / "source.bin"
    source.write_bytes(b"firmware")
    verified = verify_firmware_artifact(FirmwareArtifactRecord(path=source, board="esp32"))

    published = publish_firmware_artifact(
        artifact=verified,
        publish_root=tmp_path / "publish",
        filename="v1.bin",
    )

    assert published.created is True
    assert published.path == (tmp_path / "publish" / "v1.bin").resolve()
    assert published.sha256 == verified.sha256


def test_publish_firmware_artifact_is_idempotent_when_same_hash_exists(tmp_path: Path):
    source = tmp_path / "source.bin"
    source.write_bytes(b"firmware")
    verified = verify_firmware_artifact(FirmwareArtifactRecord(path=source, board="esp32"))
    publish_root = tmp_path / "publish"
    publish_root.mkdir()
    destination = publish_root / "v1.bin"
    destination.write_bytes(b"firmware")

    published = publish_firmware_artifact(
        artifact=verified,
        publish_root=publish_root,
        filename="v1.bin",
    )

    assert published.created is False
    assert published.path == destination.resolve()


def test_publish_firmware_artifact_rejects_hash_collision(tmp_path: Path):
    source = tmp_path / "source.bin"
    source.write_bytes(b"firmware")
    verified = verify_firmware_artifact(FirmwareArtifactRecord(path=source, board="esp32"))
    publish_root = tmp_path / "publish"
    publish_root.mkdir()
    (publish_root / "v1.bin").write_bytes(b"different")

    with pytest.raises(ArtifactVerificationError, match="hash differs"):
        publish_firmware_artifact(
            artifact=verified,
            publish_root=publish_root,
            filename="v1.bin",
        )


def test_publish_firmware_artifact_writes_sidecar_manifest(tmp_path: Path):
    source = tmp_path / "source.bin"
    source.write_bytes(b"firmware")
    verified = verify_firmware_artifact(FirmwareArtifactRecord(path=source, board="esp32"))
    manifest = {"schemaVersion": 1, "contentHash": "abc123", "slug": "esp32"}

    published = publish_firmware_artifact(
        artifact=verified,
        publish_root=tmp_path / "publish",
        filename="v1.bin",
        manifest=manifest,
    )

    assert published.created is True
    sidecar = (tmp_path / "publish" / "v1.manifest.json").resolve()
    assert sidecar.exists()
    assert json.loads(sidecar.read_text(encoding="utf-8")) == manifest


def test_publish_firmware_artifact_republish_is_noop_for_manifest(tmp_path: Path):
    source = tmp_path / "source.bin"
    source.write_bytes(b"firmware")
    verified = verify_firmware_artifact(FirmwareArtifactRecord(path=source, board="esp32"))
    publish_root = tmp_path / "publish"
    publish_root.mkdir()
    destination = publish_root / "v1.bin"
    destination.write_bytes(b"firmware")

    published = publish_firmware_artifact(
        artifact=verified,
        publish_root=publish_root,
        filename="v1.bin",
        manifest={"schemaVersion": 1, "contentHash": "abc123"},
    )

    assert published.created is False
    assert not (publish_root / "v1.manifest.json").exists()

"""Tests for the self-contained firmware package format.

Covers the ``firmware_compile/firmware_package.py`` module: building a package from
a published image + sidecar, validating and importing it into a publish root, and
pruning stale staging entries. Every failure is asserted by its stable ``code``.
"""

from __future__ import annotations

import hashlib
import json
import os
import zipfile
from pathlib import Path

import pytest

from micro_otter.tools.firmware_compile.content_identity import firmware_content_hash
from micro_otter.tools.firmware_compile.firmware_package import (
    CODE_EXPORT_EXISTS,
    CODE_IMPORT_DENIED,
    CODE_IMPORT_EXISTS,
    CODE_PACKAGE_CHECKSUM_MISMATCH,
    CODE_PACKAGE_IDENTITY_MISMATCH,
    CODE_PACKAGE_INVALID,
    CODE_PACKAGE_TOO_LARGE,
    DESCRIPTOR_NAME,
    MAX_PACKAGE_BYTES,
    FirmwarePackageError,
    _verify_content_hash,
    export_firmware_package,
    export_firmware_package_to_directory,
    import_firmware_package,
    package_firmware_image,
    prune_firmware_staging,
)

IMAGE_NAME = "1.27.0-esp32-general-1.0.1-0123456789ab.bin"
SIDECAR_NAME = "1.27.0-esp32-general-1.0.1-0123456789ab.manifest.json"


def _sidecar() -> dict:
    """Return a minimal v2 sidecar that agrees with ``IMAGE_NAME``."""

    return {
        "schemaVersion": 2,
        "slug": "esp32",
        "runtime": {"id": "general"},
        "runtimeFirmwareVersion": "1.0.1",
        "contentHash": "0123456789ab",
    }


def _write_image(root: Path, *, name: str = IMAGE_NAME, data: bytes = b"image-bytes") -> Path:
    """Write a fake published image and its sidecar, returning the image path."""

    image = root / name
    image.write_bytes(data)
    (root / image.with_suffix(".manifest.json").name).write_text(json.dumps(_sidecar()))
    return image


def _make_zip(root: Path, name: str, members: dict[str, bytes]) -> Path:
    """Write a zip archive at ``root/name`` from a name -> bytes mapping."""

    archive = root / name
    with zipfile.ZipFile(archive, "w") as handle:
        for member, data in members.items():
            handle.writestr(member, data)
    return archive


def _valid_descriptor(image_data: bytes) -> dict:
    """Return a valid descriptor for *image_data* with the shared image/sidecar names."""

    return {
        "schemaVersion": 1,
        "createdAt": "2026-11-11T00:00:00+00:00",
        "image": {
            "filename": IMAGE_NAME,
            "sizeBytes": len(image_data),
            "sha256": hashlib.sha256(image_data).hexdigest(),
        },
        "sidecar": SIDECAR_NAME,
        "tool": {"name": "micro-otter", "version": "0"},
    }


def test_package_roundtrip_installs(tmp_path):
    """Packaging then importing lands the image and sidecar in the publish root."""

    source_root = tmp_path / "source"
    source_root.mkdir()
    image = _write_image(source_root)
    package = package_firmware_image(image)

    publish = tmp_path / "publish"
    result = import_firmware_package(package, publish_root=publish)

    assert result["status"] == "installed"
    assert (publish / IMAGE_NAME).is_file()
    assert (publish / SIDECAR_NAME).is_file()
    assert result["boardKnown"] is True


def test_import_denied_when_the_publish_root_is_not_writable(tmp_path, monkeypatch):
    """The shared publish-root helper keeps the ``firmware-import-denied`` contract."""

    source_root = tmp_path / "source"
    source_root.mkdir()
    package = package_firmware_image(_write_image(source_root))
    publish = tmp_path / "publish"
    publish.mkdir()
    monkeypatch.setattr(os, "access", lambda *args, **kwargs: False)

    with pytest.raises(FirmwarePackageError) as excinfo:
        import_firmware_package(package, publish_root=publish)

    assert excinfo.value.code == CODE_IMPORT_DENIED
    assert excinfo.value.details == {"publishRoot": str(publish.resolve())}
    assert "MICRO_OTTER_FIRMWARE_DIR" in (excinfo.value.hint or "")


def test_package_without_sidecar(tmp_path):
    """An image published without a manifest still packages and imports."""

    image = tmp_path / IMAGE_NAME
    image.write_bytes(b"image-bytes")
    package = package_firmware_image(image)

    publish = tmp_path / "publish"
    result = import_firmware_package(package, publish_root=publish)

    assert result["status"] == "installed"
    assert result["sidecarPath"] is None


def test_descriptor_schema(tmp_path):
    """The package descriptor records schema version, image hash, and tool info."""

    image = _write_image(tmp_path)
    package = package_firmware_image(image)

    with zipfile.ZipFile(package) as archive:
        descriptor = json.loads(archive.read(DESCRIPTOR_NAME))
    assert descriptor["schemaVersion"] == 1
    assert descriptor["image"]["filename"] == IMAGE_NAME
    assert descriptor["image"]["sha256"]
    assert descriptor["sidecar"] == SIDECAR_NAME
    assert descriptor["tool"]["name"] == "micro-otter"


def test_checksum_mismatch(tmp_path):
    """A package whose descriptor hash disagrees with the image is rejected."""

    publish = tmp_path / "publish"
    descriptor = _valid_descriptor(b"image-bytes")
    descriptor["image"]["sha256"] = "0" * 64
    package = _make_zip(
        tmp_path,
        "bad.firmware.zip",
        {
            DESCRIPTOR_NAME: json.dumps(descriptor).encode(),
            IMAGE_NAME: b"image-bytes",
            SIDECAR_NAME: json.dumps(_sidecar()).encode(),
        },
    )
    with pytest.raises(FirmwarePackageError) as excinfo:
        import_firmware_package(package, publish_root=publish)
    assert excinfo.value.code == CODE_PACKAGE_CHECKSUM_MISMATCH

def test_identity_mismatch(tmp_path):
    """A sidecar that disagrees with the filename board is rejected."""

    sidecar = _sidecar()
    sidecar["slug"] = "esp32s3"
    publish = tmp_path / "publish"
    package = _make_zip(
        tmp_path,
        "mismatch.firmware.zip",
        {
            DESCRIPTOR_NAME: json.dumps(_valid_descriptor(b"image-bytes")).encode(),
            IMAGE_NAME: b"image-bytes",
            SIDECAR_NAME: json.dumps(sidecar).encode(),
        },
    )
    with pytest.raises(FirmwarePackageError) as excinfo:
        import_firmware_package(package, publish_root=publish)
    assert excinfo.value.code == CODE_PACKAGE_IDENTITY_MISMATCH


def test_traversal_member_rejected(tmp_path):
    """A package with a parent-traversing member name is refused."""

    publish = tmp_path / "publish"
    package = _make_zip(tmp_path, "evil.firmware.zip", {"../evil.bin": b"x"})
    with pytest.raises(FirmwarePackageError) as excinfo:
        import_firmware_package(package, publish_root=publish)
    assert excinfo.value.code == CODE_PACKAGE_INVALID


def test_too_large_archive_rejected(tmp_path):
    """An archive above the size cap is refused before any unpacking."""

    publish = tmp_path / "publish"
    package = tmp_path / "huge.firmware.zip"
    package.write_bytes(b"\x00" * (MAX_PACKAGE_BYTES + 1))
    with pytest.raises(FirmwarePackageError) as excinfo:
        import_firmware_package(package, publish_root=publish)
    assert excinfo.value.code == CODE_PACKAGE_TOO_LARGE


def test_already_present_on_identical_reimport(tmp_path):
    """Re-importing the same package answers ``already-present`` without writing."""

    source_root = tmp_path / "source"
    source_root.mkdir()
    package = package_firmware_image(_write_image(source_root))

    publish = tmp_path / "publish"
    first = import_firmware_package(package, publish_root=publish)
    second = import_firmware_package(package, publish_root=publish)

    assert first["status"] == "installed"
    assert second["status"] == "already-present"
    assert second["imagePath"] == first["imagePath"]


def test_import_exists_requires_force(tmp_path):
    """Overwriting a different image with the same name needs ``force``."""

    publish = tmp_path / "publish"
    publish.mkdir()

    first_dir = tmp_path / "first"
    first_dir.mkdir()
    second_dir = tmp_path / "second"
    second_dir.mkdir()
    package_a = package_firmware_image(_write_image(first_dir, data=b"first-image"))
    import_firmware_package(package_a, publish_root=publish)

    package_b = package_firmware_image(_write_image(second_dir, data=b"second-image"))
    with pytest.raises(FirmwarePackageError) as excinfo:
        import_firmware_package(package_b, publish_root=publish)
    assert excinfo.value.code == CODE_IMPORT_EXISTS

    result = import_firmware_package(package_b, publish_root=publish, force=True)
    assert result["status"] == "installed"
    assert (publish / IMAGE_NAME).read_bytes() == b"second-image"


def test_board_unknown_flag(tmp_path):
    """An off-catalog board slug reports ``boardKnown`` false but still imports."""

    package = package_firmware_image(_write_image(tmp_path))
    publish = tmp_path / "publish"
    result = import_firmware_package(
        package, publish_root=publish, known_board_ids=frozenset({"esp32s3"})
    )
    assert result["status"] == "installed"
    assert result["boardKnown"] is False


def test_export_is_package_alias(tmp_path):
    """``export_firmware_package`` writes the same archive as ``package``."""

    image = _write_image(tmp_path)
    package = export_firmware_package(image)
    with zipfile.ZipFile(package) as archive:
        assert IMAGE_NAME in archive.namelist()
        assert SIDECAR_NAME in archive.namelist()
        assert DESCRIPTOR_NAME in archive.namelist()


def test_prune_staging_removes_leftovers(tmp_path):
    """``prune_firmware_staging`` deletes stale staging entries, not the root."""

    publish = tmp_path / "publish"
    staging = publish / ".staging"
    stale = staging / "deadbeef"
    stale.mkdir(parents=True)
    (stale / "pkg.zip").write_bytes(b"x")

    removed = prune_firmware_staging(publish_root=publish)

    assert "deadbeef" in removed
    assert not stale.exists()
    assert staging.is_dir()



def test_export_to_directory_writes_the_derived_name(tmp_path):
    image = _write_image(tmp_path)
    destination = tmp_path / "out"
    destination.mkdir()

    written = export_firmware_package_to_directory(image, destination_dir=destination)

    assert written.parent == destination
    assert written.name == f"{image.stem}.firmware.zip"
    with zipfile.ZipFile(written) as archive:
        assert archive.read(image.name) == image.read_bytes()


def test_export_to_directory_refuses_existing_without_force(tmp_path):
    image = _write_image(tmp_path)
    destination = tmp_path / "out"
    destination.mkdir()
    export_firmware_package_to_directory(image, destination_dir=destination)

    with pytest.raises(FirmwarePackageError) as exc:
        export_firmware_package_to_directory(image, destination_dir=destination)

    assert exc.value.code == CODE_EXPORT_EXISTS


def test_export_to_directory_overwrites_with_force(tmp_path):
    image = _write_image(tmp_path)
    destination = tmp_path / "out"
    destination.mkdir()
    written = export_firmware_package_to_directory(image, destination_dir=destination)
    written.write_bytes(b"stale")

    rewritten = export_firmware_package_to_directory(
        image, destination_dir=destination, force=True
    )

    assert rewritten.read_bytes() != b"stale"
    with zipfile.ZipFile(rewritten) as archive:
        assert archive.read(image.name) == image.read_bytes()


def _content_sidecar(
    *, schema_version: int, package_variants: dict[str, str] | None = None
) -> dict:
    """Return a full sidecar whose ``contentHash`` covers *package_variants*."""

    constituents = {"runtime-source": "1.11.0", "device-tools": "0.2.1"}
    embedded = {"core": "1.0.0"}
    hash_kwargs = {
        "slug": "esp32",
        "backend": "esp-idf",
        "platform_version": "1.27.0",
        "runtime_id": "general",
        "constituents": constituents,
        "embedded_packages": embedded,
    }
    if package_variants is not None:
        hash_kwargs["package_variants"] = package_variants
    sidecar = {
        "schemaVersion": schema_version,
        "slug": "esp32",
        "backend": "esp-idf",
        "platformVersion": "1.27.0",
        "runtime": {"id": "general"},
        "constituents": constituents,
        "embeddedPackages": embedded,
        "contentHash": firmware_content_hash(**hash_kwargs),
    }
    if package_variants is not None:
        sidecar["packageVariants"] = package_variants
    return sidecar


def test_verify_content_hash_accepts_a_v2_sidecar():
    """The pre-M4u sidecar keeps verifying exactly as before."""

    _verify_content_hash(_content_sidecar(schema_version=2))


def test_verify_content_hash_accepts_a_v3_sidecar():
    """A v3 sidecar verifies against its recorded variant map."""

    _verify_content_hash(
        _content_sidecar(schema_version=3, package_variants={"pulse": "viper"})
    )


def test_verify_content_hash_rejects_an_edited_v3_variant_map():
    """Editing ``packageVariants`` is detectable exactly where it matters."""

    sidecar = _content_sidecar(schema_version=3, package_variants={"pulse": "viper"})
    sidecar["packageVariants"] = {"pulse": "py"}

    with pytest.raises(FirmwarePackageError) as excinfo:
        _verify_content_hash(sidecar)
    assert excinfo.value.code == CODE_PACKAGE_IDENTITY_MISMATCH


def test_verify_content_hash_rejects_a_v3_sidecar_without_the_map():
    """Dropping a recorded variant map changes the recomputed hash."""

    sidecar = _content_sidecar(schema_version=3, package_variants={"pulse": "viper"})
    del sidecar["packageVariants"]

    with pytest.raises(FirmwarePackageError) as excinfo:
        _verify_content_hash(sidecar)
    assert excinfo.value.code == CODE_PACKAGE_IDENTITY_MISMATCH


def test_verify_content_hash_skips_a_v1_sidecar():
    """A v1 sidecar has no composition contract to re-hash."""

    _verify_content_hash({"schemaVersion": 1, "slug": "esp32"})


# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
"""Self-contained firmware package (``.firmware.zip``) format: package, import, export.

A firmware package pairs one published image with its ``<stem>.manifest.json``
sidecar and a ``firmware-package.json`` descriptor that records the image's
SHA-256, so an image can be distributed and verified without a build backend or
``esp-idf``. Importing only lands a verified image in the publish root — it never
builds or flashes, and deploy keeps resolving images by filename identity
unchanged. This module is the filesystem authority behind the
``firmware.import`` / ``firmware.export`` ``WS /firmware`` frames, and the
``mo firmware package/export/import`` CLI verbs.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import stat
import uuid
import zipfile
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from micro_otter import __version__

from .content_identity import firmware_content_hash
from .local_firmware import ensure_publish_root, parse_firmware_filename, resolve_publish_root

__all__ = [
    "CODE_EXPORT_EXISTS",
    "CODE_IMPORT_DENIED",
    "CODE_IMPORT_EXISTS",
    "CODE_PACKAGE_CHECKSUM_MISMATCH",
    "CODE_PACKAGE_IDENTITY_MISMATCH",
    "CODE_PACKAGE_INVALID",
    "CODE_PACKAGE_TOO_LARGE",
    "DESCRIPTOR_NAME",
    "MAX_ENTRIES",
    "MAX_PACKAGE_BYTES",
    "MAX_UNPACKED_BYTES",
    "PACKAGE_SCHEMA_VERSION",
    "PACKAGE_SUFFIX",
    "STAGING_DIR",
    "FirmwarePackageError",
    "build_firmware_package_bytes",
    "build_package_descriptor",
    "export_firmware_package",
    "export_firmware_package_to_directory",
    "import_firmware_package",
    "package_firmware_image",
    "prune_firmware_staging",
]

PACKAGE_SCHEMA_VERSION = 1
"""Version of the ``firmware-package.json`` descriptor this module writes/reads."""

DESCRIPTOR_NAME = "firmware-package.json"
"""Name of the package descriptor stored at the archive root."""

PACKAGE_SUFFIX = ".firmware.zip"
"""Suffix appended to an image stem to name its package archive."""

MAX_PACKAGE_BYTES = 4 * 1024 * 1024
"""Upper bound on the compressed archive size an import accepts."""

MAX_UNPACKED_BYTES = 8 * 1024 * 1024
"""Upper bound on the total unpacked size of an accepted archive."""

MAX_ENTRIES = 8
"""Upper bound on the number of file members in an accepted archive."""

STAGING_DIR = ".staging"
"""Directory inside the publish root used for atomic import staging."""

CODE_PACKAGE_INVALID = "firmware-package-invalid"
"""Code for an archive that is not a valid firmware package."""

CODE_PACKAGE_IDENTITY_MISMATCH = "firmware-package-identity-mismatch"
"""Code for a package whose filename and sidecar disagree about identity."""

CODE_PACKAGE_CHECKSUM_MISMATCH = "firmware-package-checksum-mismatch"
"""Code for a package whose image SHA-256 does not match the descriptor."""

CODE_PACKAGE_TOO_LARGE = "firmware-package-too-large"
"""Code for an archive or unpacked size above the documented caps."""

CODE_IMPORT_EXISTS = "firmware-import-exists"
"""Code for an import that would overwrite a different existing image."""

CODE_EXPORT_EXISTS = "firmware-export-exists"
"""Code for an export whose derived destination already exists, without ``force``."""

CODE_IMPORT_DENIED = "firmware-import-denied"
"""Code for an import into a publish root that is not writable."""

def _sha256(path: Path) -> str:
    """Return the SHA-256 hex digest of the file at *path*."""

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _hash_bytes(data: bytes) -> str:
    """Return the SHA-256 hex digest of an in-memory byte string."""

    return hashlib.sha256(data).hexdigest()


def _now() -> str:
    """Return the current UTC timestamp as an ISO-8601 string."""

    return datetime.now(UTC).isoformat()


def _read_zip_json(archive: zipfile.ZipFile, name: str) -> dict[str, Any] | None:
    """Return the parsed JSON object of archive member *name*, or ``None``."""

    try:
        with archive.open(name) as handle:
            payload = json.load(handle)
    except (KeyError, OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _archive_members(
    archive: zipfile.ZipFile, source_label: str
) -> tuple[zipfile.ZipInfo, ...]:
    """Return the validated flat file members of *archive*, refusing anything unsafe.

    Refuses, in order: more than :data:`MAX_ENTRIES` file members, a nested or
    directory path, a backslash separator, an absolute or parent-traversing name, a
    symlink member, a duplicate name, and a total unpacked size above
    :data:`MAX_UNPACKED_BYTES`. A firmware package is flat: every member is a file
    at the archive root.
    """

    files = [member for member in archive.infolist() if not member.is_dir()]
    if len(files) > MAX_ENTRIES:
        raise FirmwarePackageError(
            f"{source_label} holds {len(files)} file entries, above the {MAX_ENTRIES} limit",
            code=CODE_PACKAGE_INVALID,
            hint="package only the image, its sidecar manifest, and the descriptor",
        )

    seen: set[str] = set()
    unpacked = 0
    for member in files:
        name = member.filename
        if "\\" in name or name.startswith("/") or "/" in name:
            raise FirmwarePackageError(
                f"{source_label} contains the non-flat path {name!r}",
                code=CODE_PACKAGE_INVALID,
                hint="package members must live at the archive root",
            )
        if not name or name in (".", ".."):
            raise FirmwarePackageError(
                f"{source_label} contains the unsafe path {name!r}",
                code=CODE_PACKAGE_INVALID,
                hint="package members must be plain file names",
            )
        if stat.S_ISLNK(member.external_attr >> 16):
            raise FirmwarePackageError(
                f"{source_label} contains the symlink {name!r}",
                code=CODE_PACKAGE_INVALID,
                hint="replace symlinks with real files before packaging",
            )
        if name in seen:
            raise FirmwarePackageError(
                f"{source_label} lists {name!r} more than once",
                code=CODE_PACKAGE_INVALID,
                hint="re-create the archive; duplicate members are ambiguous",
            )
        seen.add(name)
        unpacked += member.file_size

    if unpacked > MAX_UNPACKED_BYTES:
        raise FirmwarePackageError(
            f"{source_label} unpacks to {unpacked} bytes, above the "
            f"{MAX_UNPACKED_BYTES}-byte limit",
            code=CODE_PACKAGE_TOO_LARGE,
            hint="the package must hold a single image plus its sidecar and descriptor",
        )
    return tuple(files)


def _read_descriptor(archive: zipfile.ZipFile, source_label: str) -> dict[str, Any]:
    """Return the validated package descriptor, or raise ``firmware-package-invalid``."""

    descriptor = _read_zip_json(archive, DESCRIPTOR_NAME)
    if descriptor is None:
        raise FirmwarePackageError(
            f"{source_label} is missing {DESCRIPTOR_NAME}",
            code=CODE_PACKAGE_INVALID,
            hint="re-create the package with `mo firmware package`",
        )
    if descriptor.get("schemaVersion") != PACKAGE_SCHEMA_VERSION:
        raise FirmwarePackageError(
            f"{source_label} descriptor schemaVersion must be {PACKAGE_SCHEMA_VERSION}",
            code=CODE_PACKAGE_INVALID,
            hint="re-create the package with the current micro-otter version",
        )
    return descriptor

def build_package_descriptor(
    image_path: Path, sidecar_path: Path | None, *, now: str | None = None
) -> dict[str, Any]:
    """Return the ``firmware-package.json`` payload for one image.

    *sidecar_path* may be ``None`` for an image published without a manifest; the
    descriptor then records ``sidecar: null`` and identity comes from the filename
    alone. The SHA-256 is of the raw image bytes, so a consumer can detect a
    truncated or swapped image that the sidecar's composition hash cannot.
    """

    return {
        "schemaVersion": PACKAGE_SCHEMA_VERSION,
        "createdAt": now or _now(),
        "image": {
            "filename": image_path.name,
            "sizeBytes": image_path.stat().st_size,
            "sha256": _sha256(image_path),
        },
        "sidecar": sidecar_path.name if sidecar_path is not None else None,
        "tool": {"name": "micro-otter", "version": __version__},
    }


def _find_package_files(
    archive: zipfile.ZipFile, descriptor: Mapping[str, Any], source_label: str
) -> tuple[str, str | None]:
    """Return ``(image_name, sidecar_name_or_none)`` for a validated descriptor.

    Refuses an archive with any member beyond the descriptor, the declared image,
    and the declared sidecar, so an unknown file can never ride along.
    """

    members = {member.filename for member in archive.infolist() if not member.is_dir()}
    image = descriptor.get("image")
    image_name = image.get("filename") if isinstance(image, Mapping) else None
    if not isinstance(image_name, str) or not image_name.strip():
        raise FirmwarePackageError(
            f"{source_label} descriptor does not declare an image filename",
            code=CODE_PACKAGE_INVALID,
            hint="re-create the package with `mo firmware package`",
        )
    sidecar = descriptor.get("sidecar")
    sidecar_name = sidecar if isinstance(sidecar, str) and sidecar else None

    expected = {DESCRIPTOR_NAME, image_name}
    if sidecar_name is not None:
        expected.add(sidecar_name)
    unexpected = members - expected
    if unexpected:
        raise FirmwarePackageError(
            f"{source_label} contains unexpected members: {sorted(unexpected)!r}",
            code=CODE_PACKAGE_INVALID,
            hint="package only the image, its sidecar manifest, and the descriptor",
        )
    if image_name not in members:
        raise FirmwarePackageError(
            f"{source_label} is missing the declared image {image_name!r}",
            code=CODE_PACKAGE_INVALID,
            hint="re-create the package with `mo firmware package`",
        )
    if sidecar_name is not None and sidecar_name not in members:
        raise FirmwarePackageError(
            f"{source_label} is missing the declared sidecar {sidecar_name!r}",
            code=CODE_PACKAGE_INVALID,
            hint="re-create the package with `mo firmware package`",
        )
    return image_name, sidecar_name

def _verify_content_hash(sidecar: Mapping[str, Any]) -> None:
    """Reject a v2 or v3 sidecar whose recorded ``contentHash`` does not recompute.

    Only a sidecar with every composition field can be re-hashed; a v1 or partial
    sidecar is skipped (identity already agreed on the fields it declares). The
    recomputation reuses :func:`...content_identity.firmware_content_hash` so a
    hand-edited sidecar is caught, while ``build`` metadata stays out of the hash.

    A ``schemaVersion: 3`` sidecar recorded the frozen package variants, so the map is
    forwarded to the hash: without it, editing ``packageVariants`` would be
    undetectable exactly where variant-explicit identity matters. A v3 sidecar whose
    key is absent re-hashes as an empty map — the same payload its producer wrote when
    the image froze no variant, and a mismatch for one that did.
    """

    schema_version = sidecar.get("schemaVersion")
    if schema_version not in (2, 3):
        return
    required = (
        "slug",
        "backend",
        "platformVersion",
        "runtime",
        "constituents",
        "embeddedPackages",
    )
    if not all(key in sidecar for key in required):
        return
    runtime = sidecar["runtime"]
    if not isinstance(runtime, Mapping) or "id" not in runtime:
        return
    constituents = sidecar["constituents"]
    embedded = sidecar["embeddedPackages"]
    if not isinstance(constituents, Mapping) or not isinstance(embedded, Mapping):
        return
    hash_inputs: dict[str, Any] = {}
    if schema_version == 3:
        recorded = sidecar.get("packageVariants")
        hash_inputs["package_variants"] = dict(recorded) if isinstance(recorded, Mapping) else {}
    expected = firmware_content_hash(
        slug=str(sidecar["slug"]),
        backend=str(sidecar["backend"]),
        platform_version=str(sidecar["platformVersion"]),
        runtime_id=str(runtime["id"]),
        constituents=dict(constituents),
        embedded_packages=dict(embedded),
        addon_packages=dict(sidecar.get("addonPackages") or {}),
        selection=sidecar.get("selection"),
        **hash_inputs,
    )
    if sidecar.get("contentHash") != expected:
        raise FirmwarePackageError(
            "sidecar contentHash does not match the manifest contents",
            code=CODE_PACKAGE_IDENTITY_MISMATCH,
            hint="the package sidecar was edited or corrupted; re-package the image",
        )


def _verify_package(
    archive: zipfile.ZipFile,
    descriptor: Mapping[str, Any],
    image_name: str,
    sidecar_name: str | None,
    source_label: str,
) -> None:
    """Verify the archive's integrity and its filename/sidecar identity agreement.

    Raises
    ------
    FirmwarePackageError
        ``firmware-package-invalid``, ``firmware-package-checksum-mismatch``, or
        ``firmware-package-identity-mismatch``.
    """

    image = descriptor.get("image")
    declared_hash = image.get("sha256") if isinstance(image, Mapping) else None
    if not isinstance(declared_hash, str) or not declared_hash.strip():
        raise FirmwarePackageError(
            f"{source_label} descriptor image is missing a sha256",
            code=CODE_PACKAGE_INVALID,
            hint="re-create the package with `mo firmware package`",
        )
    with archive.open(image_name) as handle:
        actual = _hash_bytes(handle.read())
    if actual != declared_hash:
        raise FirmwarePackageError(
            f"{source_label} image sha256 does not match the descriptor",
            code=CODE_PACKAGE_CHECKSUM_MISMATCH,
            details={"declared": declared_hash, "actual": actual},
            hint="re-download or re-package the image",
        )

    parts = parse_firmware_filename(image_name)
    if parts is None:
        raise FirmwarePackageError(
            f"{source_label} image name {image_name!r} is not a published firmware name",
            code=CODE_PACKAGE_IDENTITY_MISMATCH,
            hint="import only packages of published firmware images",
        )

    if sidecar_name is None:
        return
    sidecar = _read_zip_json(archive, sidecar_name)
    if sidecar is None:
        raise FirmwarePackageError(
            f"{source_label} sidecar {sidecar_name!r} is not a JSON object",
            code=CODE_PACKAGE_IDENTITY_MISMATCH,
            hint="re-create the package with `mo firmware package`",
        )
    runtime = sidecar.get("runtime")
    runtime_id = runtime.get("id") if isinstance(runtime, Mapping) else None
    if sidecar.get("slug") != parts.board_id:
        raise FirmwarePackageError(
            f"{source_label} sidecar slug {sidecar.get('slug')!r} does not match the "
            f"filename board {parts.board_id!r}",
            code=CODE_PACKAGE_IDENTITY_MISMATCH,
            hint="re-package the image with its own sidecar",
        )
    if runtime_id != parts.runtime_id:
        raise FirmwarePackageError(
            f"{source_label} sidecar runtime {runtime_id!r} does not match the "
            f"filename runtime {parts.runtime_id!r}",
            code=CODE_PACKAGE_IDENTITY_MISMATCH,
            hint="re-package the image with its own sidecar",
        )
    if sidecar.get("runtimeFirmwareVersion") != parts.runtime_firmware_version:
        raise FirmwarePackageError(
            f"{source_label} sidecar version {sidecar.get('runtimeFirmwareVersion')!r} "
            f"does not match the filename {parts.runtime_firmware_version!r}",
            code=CODE_PACKAGE_IDENTITY_MISMATCH,
            hint="re-package the image with its own sidecar",
        )
    if parts.content_hash and sidecar.get("contentHash") and parts.content_hash != sidecar.get(
        "contentHash"
    ):
        raise FirmwarePackageError(
            f"{source_label} sidecar contentHash {sidecar.get('contentHash')!r} does not "
            f"match the filename {parts.content_hash!r}",
            code=CODE_PACKAGE_IDENTITY_MISMATCH,
            hint="re-package the image with its own sidecar",
        )
    _verify_content_hash(sidecar)

def build_firmware_package_bytes(image_path: Path) -> bytes:
    """Return the ``.firmware.zip`` bytes for *image_path*, without touching disk.

    Builds the archive into an in-memory buffer so the HTTP download route can
    serve a package without the server writing or deleting any file. The image,
    its sidecar (when present), and the descriptor are written exactly as
    :func:`package_firmware_image` writes them to a destination.
    """

    image_path = image_path.resolve()
    if not image_path.is_file() or image_path.suffix != ".bin":
        raise FirmwarePackageError(
            f"{image_path} is not a published firmware image (.bin)",
            code=CODE_PACKAGE_INVALID,
            hint="point at the published .bin image to package",
        )
    sidecar_path = image_path.with_suffix(".manifest.json")
    if not sidecar_path.is_file():
        sidecar_path = None

    descriptor = build_package_descriptor(image_path, sidecar_path)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(DESCRIPTOR_NAME, json.dumps(descriptor, indent=2))
        archive.write(image_path, arcname=image_path.name)
        if sidecar_path is not None:
            archive.write(sidecar_path, arcname=sidecar_path.name)
    return buffer.getvalue()


def package_firmware_image(image_path: Path, *, destination: Path | None = None) -> Path:
    """Write a ``.firmware.zip`` for *image_path* and return its path.

    The archive holds the image, its ``<stem>.manifest.json`` sidecar when present,
    and the descriptor. *destination* defaults to ``<image-stem>.firmware.zip`` next
    to the image.
    """

    image_path = image_path.resolve()
    destination = (destination or image_path.with_name(image_path.stem + PACKAGE_SUFFIX)).resolve()
    destination.write_bytes(build_firmware_package_bytes(image_path))
    return destination


def export_firmware_package(image_path: Path, *, destination: Path | None = None) -> Path:
    """Return the ``.firmware.zip`` for *image_path* (alias of :func:`package_firmware_image`).

    ``export`` is the name the CLI uses; it writes exactly the same self-contained
    package as ``package``.
    """

    return package_firmware_image(image_path, destination=destination)


def export_firmware_package_to_directory(
    image_path: Path,
    *,
    destination_dir: Path,
    force: bool = False,
) -> Path:
    """Write ``<image-stem>.firmware.zip`` into *destination_dir* and return its path.

    The name is always derived from the image stem, so the server — not the browser
    — names the file. An existing destination raises ``firmware-export-exists``
    until the caller confirms and re-sends with ``force: true``; the bytes are then
    written by :func:`export_firmware_package` so they stay exactly what the CLI
    produced.
    """

    destination = destination_dir.resolve() / (image_path.stem + PACKAGE_SUFFIX)
    if destination.exists() and not force:
        raise FirmwarePackageError(
            f"{destination} already exists",
            code=CODE_EXPORT_EXISTS,
            hint="Pick another folder or confirm the overwrite.",
        )
    return export_firmware_package(image_path, destination=destination)

def import_firmware_package(
    source: Path,
    *,
    publish_root: Path | None = None,
    force: bool = False,
    known_board_ids: frozenset[str] | None = None,
) -> dict[str, Any]:
    """Validate *source* and land its image + sidecar in the publish root.

    *source* must be a ``.firmware.zip`` under :data:`MAX_PACKAGE_BYTES`. The image
    is verified (SHA-256, filename identity, sidecar agreement) before anything is
    written: the archive is extracted into ``<root>/.staging/<uuid>/`` and each file
    is then moved into place with :func:`os.replace`, so a failed import never leaves
    a half-installed image. An identical re-import answers ``already-present``; an
    import that would overwrite a *different* image requires ``force``.

    *known_board_ids* (the catalog slugs, when the caller has them) makes the
    returned ``boardKnown`` a real answer; when omitted it defaults to ``True`` so a
    catalog-less caller never mislabels an image as unknown.
    """

    source = Path(source)
    if not source.is_file():
        raise FirmwarePackageError(
            f"package not found: {source}",
            code=CODE_PACKAGE_INVALID,
            hint="point at the .firmware.zip to import",
        )
    if source.stat().st_size > MAX_PACKAGE_BYTES:
        raise FirmwarePackageError(
            f"{source.name} is {source.stat().st_size} bytes, above the "
            f"{MAX_PACKAGE_BYTES}-byte cap",
            code=CODE_PACKAGE_TOO_LARGE,
            hint="the package must hold a single image plus its sidecar and descriptor",
        )

    root = resolve_publish_root(publish_root).resolve()
    try:
        root = ensure_publish_root(root).resolve()
    except OSError as error:
        raise FirmwarePackageError(
            str(error),
            code=CODE_IMPORT_DENIED,
            details={"publishRoot": str(root)},
            hint="set MICRO_OTTER_FIRMWARE_DIR to a writable folder",
        ) from error

    with zipfile.ZipFile(source) as archive:
        _archive_members(archive, source.name)
        descriptor = _read_descriptor(archive, source.name)
        image_name, sidecar_name = _find_package_files(archive, descriptor, source.name)
        _verify_package(archive, descriptor, image_name, sidecar_name, source.name)

    parts = parse_firmware_filename(image_name)
    assert parts is not None  # _verify_package already proved the name parses
    image_target = root / image_name
    sidecar_target = root / sidecar_name if sidecar_name is not None else None
    declared_hash = descriptor["image"]["sha256"]

    if image_target.is_file() and _sha256(image_target) == declared_hash:
        return {
            "status": "already-present",
            "filename": image_name,
            "imagePath": str(image_target),
            "sidecarPath": str(sidecar_target) if sidecar_target is not None else None,
            "sha256": declared_hash,
            "boardKnown": known_board_ids is None or parts.board_id in known_board_ids,
        }
    if image_target.exists() and not force:
        raise FirmwarePackageError(
            f"{image_name} already exists in the publish root",
            code=CODE_IMPORT_EXISTS,
            details={"path": str(image_target)},
            hint="pass --force (CLI) or confirm the overwrite (web app) to replace it",
        )

    staging = root / STAGING_DIR / uuid.uuid4().hex
    staging.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(source) as archive:
            for name in (image_name, sidecar_name):
                if name is None:
                    continue
                member = archive.getinfo(name)
                with archive.open(member) as reader, (staging / name).open("wb") as writer:
                    shutil.copyfileobj(reader, writer)
        os.replace(staging / image_name, image_target)
        if sidecar_target is not None:
            os.replace(staging / sidecar_name, sidecar_target)
    finally:
        shutil.rmtree(staging, ignore_errors=True)

    return {
        "status": "installed",
        "filename": image_name,
        "imagePath": str(image_target),
        "sidecarPath": str(sidecar_target) if sidecar_target is not None else None,
        "sha256": declared_hash,
        "boardKnown": known_board_ids is None or parts.board_id in known_board_ids,
    }


def prune_firmware_staging(publish_root: Path | None = None) -> tuple[str, ...]:
    """Remove leftover ``.staging`` entries under the publish root and return their names.

    Every entry inside the tool-owned staging directory is deleted best-effort, so a
    crash mid-import cannot grow the publish root unbounded. The directory itself
    stays, and the publish root is never created here.
    """

    root = resolve_publish_root(publish_root)
    staging = root / STAGING_DIR
    if not staging.is_dir():
        return ()
    removed: list[str] = []
    for entry in staging.iterdir():
        try:
            if entry.is_dir():
                shutil.rmtree(entry)
            else:
                entry.unlink()
            removed.append(entry.name)
        except OSError:
            continue
    return tuple(removed)







class FirmwarePackageError(RuntimeError):
    """Structured firmware-package failure.

    Mirrors :class:`...firmware_inventory.FirmwareInventoryError` so the server and
    the CLI can serialise this family identically: ``code`` is stable, ``exit_code``
    maps to the CLI process code, and ``hint``/``details`` carry the remediation.
    """

    def __init__(
        self,
        message: str,
        *,
        code: str,
        hint: str | None = None,
        details: Mapping[str, object] | None = None,
        exit_code: int = 2,
    ) -> None:
        """Record the message plus the code, hint, details, and exit category."""

        super().__init__(message)
        self.code = code
        self.message = message
        self.hint = hint
        self.details = dict(details) if details is not None else None
        self.exit_code = exit_code

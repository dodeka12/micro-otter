# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
"""Imported raw MicroPython firmware images (``.bin``) in the publish root.

A user can bring a stock MicroPython image into the local firmware inventory
instead of only images Micro Otter compiled itself. This module validates one
``.bin``, gives it a canonical *imported* identity, and lands it plus a small
sidecar in the publish root, so the existing deploy path resolves and flashes it
unchanged.

The platform (the request's ``targetId``) is a flash-path decision only: the
handler resolves it to a board slug, and that slug becomes part of the filename.
An imported image carries no Micro Otter runtime and no device-target
configuration — that is created later, when the runtime is installed on the
connected device. Importing never builds and never flashes.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import uuid
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .firmware_package import CODE_IMPORT_DENIED, CODE_IMPORT_EXISTS, STAGING_DIR
from .local_firmware import ensure_publish_root, resolve_publish_root
from .version_identity import format_full_firmware_version
from .version_semver import VERSION_RE

__all__ = [
    "CODE_IMPORT_INVALID",
    "IMPORTED_RUNTIME_FIRMWARE_VERSION",
    "IMPORTED_RUNTIME_ID",
    "IMPORTED_SOURCE",
    "MAX_IMPORTED_BINARY_BYTES",
    "ImportedFirmwareError",
    "build_imported_sidecar",
    "detect_micropython_version",
    "import_firmware_binary",
    "imported_firmware_filename",
]

IMPORTED_RUNTIME_ID = "imported"
"""Runtime id every imported image carries, keeping it in its own inventory group.

Imported images therefore never compete with built images for ``isLatest`` and
never become the deploy default; re-importing identical bytes is idempotent.
"""

IMPORTED_SOURCE = "imported-binary"
"""Sidecar ``source`` marker that identifies an imported image to the inventory and UI."""

IMPORTED_RUNTIME_FIRMWARE_VERSION = "0.0.0"
"""Placeholder runtime firmware version; the content hash is the real discriminator."""

MAX_IMPORTED_BINARY_BYTES = 8 * 1024 * 1024
"""Upper bound on one user-supplied binary (same order as ``MAX_PACKAGE_BYTES``)."""

CODE_IMPORT_INVALID = "firmware-import-invalid"
"""Code for a source that is not an acceptable ``.bin`` (wrong suffix, empty, oversize)."""

_IMAGE_SUFFIX = ".bin"
"""Suffix an imported source must carry, compared case-insensitively."""

_VERSION_CANDIDATE_RE = re.compile(r"\d+\.\d+\.\d+")
"""A semver-shaped candidate inside a source filename (a leading ``v`` yields ``1.2.3``)."""

_BOARD_ID_RE = re.compile(r"^[a-z0-9_]+$")
"""The board-slug grammar shared with published filenames and sidecars."""


class ImportedFirmwareError(RuntimeError):
    """Structured imported-binary failure.

    Mirrors :class:`...firmware_package.FirmwarePackageError` so the server
    serialises both import paths identically: ``code`` is stable, ``exit_code``
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


def _now() -> str:
    """Return the current UTC timestamp as an ISO-8601 string."""

    return datetime.now(UTC).isoformat()


def _sha256(path: Path) -> str:
    """Return the SHA-256 hex digest of the file at *path*, streamed in chunks."""

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def detect_micropython_version(name: str) -> str:
    """Return the first semver-shaped version in *name*, else the placeholder.

    A leading ``v`` is dropped by the candidate pattern itself
    (``esp32-20240602-v1.23.0.bin`` yields ``1.23.0``). This never raises: a
    version in a filename is a hint, not a contract, and a name without one (or
    with a ``01.02.03``-style value the shared grammar rejects) falls back to
    :data:`IMPORTED_RUNTIME_FIRMWARE_VERSION`. The content hash, not the version,
    is what distinguishes two imported images of one board.
    """

    if isinstance(name, str):
        for match in _VERSION_CANDIDATE_RE.finditer(name):
            candidate = match.group(0)
            if VERSION_RE.fullmatch(candidate):
                return candidate
    return IMPORTED_RUNTIME_FIRMWARE_VERSION


def imported_firmware_filename(*, micropython_version: str, board_id: str, sha256: str) -> str:
    """Return the published name for one imported image.

    The name is the normal full-firmware name built with
    :func:`...version_identity.format_full_firmware_version`, using the imported
    runtime id, the placeholder version, and the first 12 hex characters of the
    image digest as the content-hash segment. This function is the only place the
    name is composed, so the importer, the inventory, and the tests cannot drift.
    """

    full_version = format_full_firmware_version(
        micropython_version=micropython_version,
        board_id=board_id,
        runtime_id=IMPORTED_RUNTIME_ID,
        runtime_firmware_version=IMPORTED_RUNTIME_FIRMWARE_VERSION,
        content_hash=sha256[:12],
    )
    return f"{full_version}{_IMAGE_SUFFIX}"


def build_imported_sidecar(
    *,
    board_id: str,
    micropython_version: str,
    original_filename: str,
    target_id: str | None,
    sha256: str,
) -> dict[str, Any]:
    """Return the sidecar manifest for one imported image.

    ``schemaVersion`` is deliberately omitted, so the inventory keeps
    ``identity_complete=False`` and the UI says "details unavailable" instead of
    inventing package contents. ``slug``, ``runtime.id``, and
    ``runtimeFirmwareVersion`` still agree with the filename, so an exported then
    re-imported package passes the package verifier. ``contentHash`` is omitted
    too: the filename segment already is the digest, and a duplicate that could
    disagree with it would only fail that verifier.
    """

    return {
        "slug": board_id,
        "micropythonVersion": micropython_version,
        "runtime": {"id": IMPORTED_RUNTIME_ID},
        "runtimeFirmwareVersion": IMPORTED_RUNTIME_FIRMWARE_VERSION,
        "embeddedPackages": {},
        "notEmbedded": [],
        "source": IMPORTED_SOURCE,
        "targetId": target_id,
        "originalFilename": original_filename,
        "sha256": sha256,
        "importedAt": _now(),
    }


def _import_record(
    status: str,
    *,
    image_target: Path,
    sidecar_target: Path,
    sha256: str,
    board_known: bool,
    board_id: str,
    target_id: str | None,
    original_filename: str,
    micropython_version: str,
) -> dict[str, Any]:
    """Return the import record the ``firmware.import-binary`` result carries."""

    return {
        "status": status,
        "filename": image_target.name,
        "imagePath": str(image_target),
        "sidecarPath": str(sidecar_target),
        "sha256": sha256,
        "boardKnown": board_known,
        "boardId": board_id,
        "targetId": target_id,
        "originalFilename": original_filename,
        "micropythonVersion": micropython_version,
    }


def import_firmware_binary(
    source: Path,
    *,
    board_id: str,
    target_id: str | None = None,
    publish_root: Path | None = None,
    force: bool = False,
    known_board_ids: frozenset[str] | None = None,
) -> dict[str, Any]:
    """Validate *source* as a raw ``.bin`` and land it plus its sidecar in the root.

    The image gets the canonical imported identity (see
    :func:`imported_firmware_filename`), so the inventory lists it beside the built
    images of the same board while deploy keeps resolving it by filename. The bytes
    are copied into ``<root>/.staging/<uuid>/``, re-hashed, and moved into place
    with :func:`os.replace`, so a failed import never leaves a half-installed
    image. An identical re-import answers ``already-present``; an import that would
    overwrite a *different* image requires *force*.

    *board_id* is the resolved board slug (the handler maps ``targetId`` to it); it
    is a programming error — :class:`ValueError` — when blank or malformed.
    *target_id* is recorded as provenance only, never as device configuration.

    *known_board_ids* (the catalog slugs, when the caller has them) makes the
    returned ``boardKnown`` a real answer; when omitted it defaults to ``True``, so
    a catalog-less caller never mislabels an image as unknown.
    """

    source = Path(source)
    if not source.is_file() or source.suffix.lower() != _IMAGE_SUFFIX:
        raise ImportedFirmwareError(
            f"{source} is not a MicroPython firmware image (.bin)",
            code=CODE_IMPORT_INVALID,
            details={"path": str(source)},
            hint="import one .bin image here, or a .firmware.zip through the package import",
        )

    size = source.stat().st_size
    if size == 0:
        raise ImportedFirmwareError(
            f"{source.name} is empty",
            code=CODE_IMPORT_INVALID,
            details={"sizeBytes": 0},
            hint="pick a MicroPython image (.bin) with content",
        )
    if size > MAX_IMPORTED_BINARY_BYTES:
        raise ImportedFirmwareError(
            f"{source.name} is {size} bytes, above the {MAX_IMPORTED_BINARY_BYTES}-byte cap",
            code=CODE_IMPORT_INVALID,
            details={"sizeBytes": size, "maxBytes": MAX_IMPORTED_BINARY_BYTES},
            hint="a stock MicroPython image is about 1.5 MB",
        )

    if not isinstance(board_id, str) or not _BOARD_ID_RE.fullmatch(board_id):
        raise ValueError(f"board_id must match [a-z0-9_]+ and be non-empty; got {board_id!r}")

    root = resolve_publish_root(publish_root).resolve()
    try:
        ensure_publish_root(root)
    except OSError as error:
        raise ImportedFirmwareError(
            str(error),
            code=CODE_IMPORT_DENIED,
            details={"publishRoot": str(root)},
            hint="set MICRO_OTTER_FIRMWARE_DIR to a writable folder",
        ) from error

    digest = _sha256(source)
    micropython_version = detect_micropython_version(source.name)
    image_name = imported_firmware_filename(
        micropython_version=micropython_version, board_id=board_id, sha256=digest
    )
    image_target = root / image_name
    sidecar_target = root / Path(image_name).with_suffix(".manifest.json").name
    board_known = known_board_ids is None or board_id in known_board_ids
    record_kwargs: dict[str, Any] = {
        "image_target": image_target,
        "sidecar_target": sidecar_target,
        "sha256": digest,
        "board_known": board_known,
        "board_id": board_id,
        "target_id": target_id,
        "original_filename": source.name,
        "micropython_version": micropython_version,
    }

    if image_target.is_file() and _sha256(image_target) == digest:
        return _import_record("already-present", **record_kwargs)
    if image_target.exists() and not force:
        raise ImportedFirmwareError(
            f"{image_name} already exists in the publish root",
            code=CODE_IMPORT_EXISTS,
            details={"path": str(image_target)},
            hint="confirm the overwrite in the web app to replace it",
        )

    sidecar = build_imported_sidecar(
        board_id=board_id,
        micropython_version=micropython_version,
        original_filename=source.name,
        target_id=target_id,
        sha256=digest,
    )

    staging = root / STAGING_DIR / uuid.uuid4().hex
    staging.mkdir(parents=True, exist_ok=True)
    try:
        staged_image = staging / image_name
        with source.open("rb") as reader, staged_image.open("wb") as writer:
            shutil.copyfileobj(reader, writer)
        if _sha256(staged_image) != digest:
            raise ImportedFirmwareError(
                f"{source.name} changed while it was being imported",
                code=CODE_IMPORT_INVALID,
                hint="re-run the import once the file stops changing",
            )
        (staging / sidecar_target.name).write_text(
            json.dumps(sidecar, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        os.replace(staged_image, image_target)
        os.replace(staging / sidecar_target.name, sidecar_target)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
        # Drop the shared staging root when this import leaves it empty, so a
        # finished import leaves the publish root exactly as it found it. A
        # concurrent import may still occupy it, which must not fail this one.
        try:
            (root / STAGING_DIR).rmdir()
        except OSError:
            pass

    return _import_record("installed", **record_kwargs)

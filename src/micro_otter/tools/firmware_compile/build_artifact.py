"""Firmware artifact boundary models for phase-4 output verification."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path


class ArtifactVerificationError(ValueError):
    """Artifact verification failed after build completion."""


_FROZEN_LIST_ITEM_RE = re.compile(r'MICROPY_FROZEN_LIST_ITEM\("([^"]*)"')

_ABSOLUTE_FROZEN_NAME_HINT = (
    "mpy-cross must embed a relative source name (-s <path>) — see "
    "docs/dev/firmware-compile/firmware-runtime-payload-contract.md"
)


@dataclass(frozen=True)
class FirmwareArtifactRecord:
    """Discovered firmware artifact and lightweight traceability fields."""

    path: Path
    board: str
    size_bytes: int | None = None
    sha256: str | None = None
    source_revision: str | None = None


@dataclass(frozen=True)
class PublishedArtifactRecord:
    """Published artifact record returned by publish operation."""

    path: Path
    size_bytes: int
    sha256: str
    created: bool


def normalize_artifact_path(path: Path) -> Path:
    """Return canonical absolute artifact path representation."""

    return path.resolve()


def candidate_firmware_paths(
    *, micropython_root: Path, target: str, board: str
) -> tuple[Path, ...]:
    """Return deterministic candidate artifact paths for board/target builds."""

    root = micropython_root.resolve()
    normalized_board = board.lower()
    target_root = root / "ports" / target

    candidates: list[Path] = [
        target_root / f"build-{board}" / "firmware.bin",
        target_root / f"build-{normalized_board}" / "firmware.bin",
        target_root / "build-GENERIC" / "firmware.bin",
        target_root / "build-generic" / "firmware.bin",
        target_root / "build" / "firmware.bin",
    ]

    if target_root.is_dir():
        fallback = sorted(
            path / "firmware.bin"
            for path in target_root.iterdir()
            if path.is_dir() and path.name.startswith("build-")
        )
        candidates.extend(fallback)

    deduped: list[Path] = []
    seen: set[Path] = set()
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        deduped.append(candidate)

    return tuple(deduped)


def discover_firmware_artifact(
    *,
    micropython_root: Path,
    target: str,
    board: str,
    require_exists: bool,
) -> FirmwareArtifactRecord | None:
    """Discover firmware artifact path for the given build context."""

    for candidate in candidate_firmware_paths(
        micropython_root=micropython_root,
        target=target,
        board=board,
    ):
        path = candidate.resolve()
        if path.exists() and path.is_file():
            return FirmwareArtifactRecord(path=path, board=board)

    if require_exists:
        raise FileNotFoundError(
            f"Firmware artifact not found for target={target}, board={board}"
        )

    return None


def verify_firmware_artifact(record: FirmwareArtifactRecord) -> FirmwareArtifactRecord:
    """Verify artifact exists and return enriched metadata record."""

    path = record.path.resolve()
    if not path.exists() or not path.is_file():
        raise ArtifactVerificationError(f"Firmware artifact not found: {path}")

    size = path.stat().st_size
    if size <= 0:
        raise ArtifactVerificationError(f"Firmware artifact is empty: {path}")

    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return FirmwareArtifactRecord(
        path=path,
        board=record.board,
        size_bytes=size,
        sha256=f"sha256:{digest}",
        source_revision=record.source_revision,
    )


def frozen_module_names(frozen_content: str) -> tuple[str, ...]:
    """Return every ``MICROPY_FROZEN_LIST_ITEM("<name>")`` entry in *frozen_content*.

    The name is what ``import <name>`` must be able to resolve on the device, so it
    has to be a relative module path. ``ports/esp32/boards/manifest.py`` freezes
    ``$(PORT_DIR)/modules``, and ``tools/mpy-tool.py freeze`` takes each ``.mpy``
    module's name from its header — the value ``mpy-cross -s`` wrote there.
    """

    return tuple(_FROZEN_LIST_ITEM_RE.findall(frozen_content))


def verify_frozen_module_names(frozen_content_path: Path) -> tuple[str, ...]:
    """Return the frozen module names in *frozen_content_path*, refusing absolute ones.

    A name that starts with ``/``, matches a Windows drive prefix, or contains a
    backslash can never be imported and means an ``.mpy`` was compiled without a
    relative ``-s`` source name. A missing file returns ``()``: a board with no
    frozen manifest (or a cleaned build directory) has nothing to verify.

    Raises ``ArtifactVerificationError`` — which ``compile_command`` maps to exit
    code ``8`` / ``ARTIFACT_VERIFICATION_ERROR`` / category ``artifact-verification``
    — listing up to five offending names and the total count.
    """

    if not frozen_content_path.is_file():
        return ()

    content = frozen_content_path.read_text(encoding="utf-8", errors="replace")
    names = frozen_module_names(content)
    absolute = [
        name
        for name in names
        if name.startswith("/") or "\\" in name or re.match(r"^[A-Za-z]:", name)
    ]
    if not absolute:
        return names

    preview = ", ".join(repr(name) for name in absolute[:5])
    raise ArtifactVerificationError(
        f"Frozen module names are not importable ({len(absolute)} absolute): {preview}. "
        f"Hint: {_ABSOLUTE_FROZEN_NAME_HINT}"
    )


def publish_firmware_artifact(
    *,
    artifact: FirmwareArtifactRecord,
    publish_root: Path,
    filename: str,
    manifest: Mapping[str, object] | None = None,
) -> PublishedArtifactRecord:
    """Publish verified artifact to deterministic destination with collision safety.

    If destination exists and content hash matches, no copy is performed and
    `created=False` is returned. When *manifest* is given, a sidecar
    ``<name>.manifest.json`` is written next to the ``.bin`` (only when the image
    is actually created, so a re-publish of identical content is a no-op for both).
    """

    if artifact.size_bytes is None or artifact.sha256 is None:
        raise ArtifactVerificationError("Artifact must be verified before publishing")

    publish_root = publish_root.resolve()
    publish_root.mkdir(parents=True, exist_ok=True)
    destination = publish_root / filename

    if destination.exists():
        existing = verify_firmware_artifact(
            FirmwareArtifactRecord(path=destination, board=artifact.board)
        )
        if existing.sha256 != artifact.sha256:
            raise ArtifactVerificationError(
                f"Firmware artifact already exists at {destination} but its hash differs from "
                f"the newly built binary. This can happen when rebuilding the same version "
                f"(firmware builds are not perfectly reproducible). "
                f"Delete the existing file to allow the new build to be published."
            )
        return PublishedArtifactRecord(
            path=destination,
            size_bytes=existing.size_bytes or 0,
            sha256=existing.sha256 or "",
            created=False,
        )

    shutil.copy2(artifact.path, destination)
    published = verify_firmware_artifact(
        FirmwareArtifactRecord(path=destination, board=artifact.board)
    )
    if manifest is not None:
        sidecar = destination.with_suffix(".manifest.json")
        sidecar.write_text(
            json.dumps(dict(manifest), sort_keys=True, indent=2) + "\n",
            encoding="utf-8",
        )
    return PublishedArtifactRecord(
        path=destination,
        size_bytes=published.size_bytes or 0,
        sha256=published.sha256 or "",
        created=True,
    )

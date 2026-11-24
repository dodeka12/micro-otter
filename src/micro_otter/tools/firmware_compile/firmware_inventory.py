"""Server-side firmware inventory over the publish root.

This module answers "which firmware images already exist locally, what do their
sidecar manifests say they contain, and which one is the newest per target". It is
the filesystem authority behind the ``firmware.list`` / ``firmware.delete`` frames
in ``WS /firmware``: the client renders what this module reports and never picks a
"latest" file itself.

It is strictly filesystem-only and read-mostly. ``delete`` is the single write and
is guarded by a path-containment check, so a hostile path can never delete
anything outside the publish root. Nothing here touches node-package *source*
upload: the collection-deploy ``missing`` / ``override-required`` fallback stays
independent of the inventory.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .local_firmware import parse_firmware_filename, resolve_publish_root
from .version_identity import firmware_version_sort_key
from .version_semver import channel_of, is_prerelease

__all__ = [
    "FirmwareInventoryEntry",
    "FirmwareInventoryError",
    "build_firmware_inventory_payload",
    "delete_firmware_entry",
    "latest_firmware_ids",
    "list_firmware_inventory",
    "read_firmware_sidecar",
    "resolve_inventory_image",
]

CODE_FIRMWARE_NOT_FOUND = "firmware-not-found"
"""Code for a requested image that does not exist on disk."""

CODE_FIRMWARE_PATH_INVALID = "firmware-path-invalid"
"""Code for a path that escapes the publish root (a traversal attempt)."""

CODE_FIRMWARE_IMAGE_UNAVAILABLE = "firmware-image-unavailable"
"""Code for a path that resolves to something other than a published image file."""


class FirmwareInventoryError(RuntimeError):
    """Structured firmware-inventory failure.

    Mirrors :class:`...local_package_scan.LocalPackageScanError` so the server can
    serialise either family identically: ``code`` is stable, ``exit_code`` maps to
    the CLI process code, and ``hint``/``details`` carry the remediation.
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


@dataclass(frozen=True)
class FirmwareInventoryEntry:
    """One published firmware image plus its sidecar-derived contents.

    ``path`` is the absolute path the client echoes back for ``firmware.delete``;
    ``embedded_packages`` / ``not_embedded`` come from the sidecar manifest and are
    empty when the image has no (or no readable) sidecar. ``addon_packages``,
    ``selection``, ``channel`` and ``version_source`` are populated from a v2 or v3
    sidecar; ``package_variants`` is populated from a v3 sidecar and stays empty for a
    v2 one (nothing is invented for an image that never recorded it);
    ``identity_complete`` is ``False`` for a v1 or missing sidecar so the view can say
    "details unavailable" instead of guessing. ``source`` / ``target_id`` /
    ``original_filename`` are the import provenance an imported binary records
    (``source="imported-binary"``); a built image reports ``""`` and ``None``.
    """

    path: Path
    filename: str
    board_id: str
    runtime_id: str
    micropython_version: str
    runtime_firmware_version: str
    content_hash: str | None
    size_bytes: int
    modified_at: str
    has_manifest: bool
    embedded_packages: dict[str, str]
    not_embedded: tuple[str, ...]
    addon_packages: dict[str, str] = field(default_factory=dict)
    package_variants: dict[str, str] = field(default_factory=dict)
    selection: dict[str, Any] = field(default_factory=dict)
    channel: str = ""
    version_source: str | None = None
    is_prerelease: bool = False
    identity_complete: bool = False
    source: str = ""
    target_id: str | None = None
    original_filename: str | None = None


def read_firmware_sidecar(image_path: Path) -> dict[str, object] | None:
    """Return the parsed ``<stem>.manifest.json`` sidecar, or ``None``.

    A missing, unreadable, or invalid-JSON sidecar (or one that is not a JSON
    object) never raises: the inventory treats a broken sidecar exactly like an
    absent one and reports ``has_manifest=False``.
    """

    sidecar = image_path.with_suffix(".manifest.json")
    if not sidecar.is_file():
        return None
    try:
        payload = json.loads(sidecar.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    return payload


def _embedded_packages(sidecar: dict[str, object] | None) -> dict[str, str]:
    """Return the ``embeddedPackages`` object from *sidecar*, tolerating garbage."""

    if sidecar is None:
        return {}
    raw = sidecar.get("embeddedPackages")
    if not isinstance(raw, dict):
        return {}
    return {
        key: value
        for key, value in raw.items()
        if isinstance(key, str) and isinstance(value, str)
    }


def _not_embedded(sidecar: dict[str, object] | None) -> tuple[str, ...]:
    """Return the ``notEmbedded`` list from *sidecar*, tolerating garbage."""

    if sidecar is None:
        return ()
    raw = sidecar.get("notEmbedded")
    if not isinstance(raw, list):
        return ()
    return tuple(item for item in raw if isinstance(item, str))


def _addon_packages(sidecar: dict[str, object] | None) -> dict[str, str]:
    """Return the ``addonPackages`` object from *sidecar*, tolerating garbage."""

    if sidecar is None:
        return {}
    raw = sidecar.get("addonPackages")
    if not isinstance(raw, dict):
        return {}
    return {
        key: value
        for key, value in raw.items()
        if isinstance(key, str) and isinstance(value, str)
    }


def _package_variants(sidecar: dict[str, object] | None) -> dict[str, str]:
    """Return the ``packageVariants`` map from a v3 *sidecar*, tolerating garbage.

    A v2 sidecar (or a broken ``packageVariants`` value) yields ``{}``: an image that
    never recorded its variants must not be described as if it had.
    """

    if sidecar is None:
        return {}
    raw = sidecar.get("packageVariants")
    if not isinstance(raw, dict):
        return {}
    return {
        key: value
        for key, value in raw.items()
        if isinstance(key, str) and isinstance(value, str)
    }


def _selection(sidecar: dict[str, object] | None) -> dict[str, Any]:
    """Return the ``selection`` object from *sidecar*, tolerating garbage."""

    if sidecar is None:
        return {}
    raw = sidecar.get("selection")
    return dict(raw) if isinstance(raw, dict) else {}


def _version_field(sidecar: dict[str, object] | None, key: str) -> str | None:
    """Return a ``version.<key>`` string from a v2 *sidecar*, or ``None``."""

    if sidecar is None:
        return None
    version = sidecar.get("version")
    if not isinstance(version, dict):
        return None
    value = version.get(key)
    return value if isinstance(value, str) else None


def _sidecar_str(sidecar: dict[str, object] | None, key: str) -> str | None:
    """Return a non-empty top-level string field *key* from *sidecar*, or ``None``.

    Used for the import provenance fields (``source``, ``targetId``,
    ``originalFilename``), which only an imported image records: a missing key, an
    absent sidecar, or a non-string/empty value all read as "not recorded" instead
    of failing the whole listing.
    """

    if sidecar is None:
        return None
    value = sidecar.get(key)
    return value if isinstance(value, str) and value else None


def list_firmware_inventory(*, publish_root: Path | None = None) -> list[FirmwareInventoryEntry]:
    """Return every published image in the publish root, sorted deterministically.

    Sorting is ``(board_id, runtime_id)`` ascending, then runtime-firmware version
    descending via :func:`...version_identity.firmware_version_sort_key`, so the
    newest image for each target appears first within its group.
    """

    root = resolve_publish_root(publish_root)
    if not root.is_dir():
        return []

    grouped: dict[tuple[str, str], list[FirmwareInventoryEntry]] = {}
    for path in sorted(root.iterdir()):
        if not path.is_file() or path.suffix != ".bin":
            continue
        parsed = parse_firmware_filename(path.name)
        if parsed is None:
            continue
        sidecar = read_firmware_sidecar(path)
        stat = path.stat()
        schema_version = sidecar.get("schemaVersion") if sidecar is not None else None
        entry = FirmwareInventoryEntry(
            path=path,
            filename=path.name,
            board_id=parsed.board_id,
            runtime_id=parsed.runtime_id,
            micropython_version=parsed.micropython_version,
            runtime_firmware_version=parsed.runtime_firmware_version,
            content_hash=parsed.content_hash,
            size_bytes=stat.st_size,
            modified_at=datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat(),
            has_manifest=sidecar is not None,
            embedded_packages=_embedded_packages(sidecar),
            not_embedded=_not_embedded(sidecar),
            addon_packages=_addon_packages(sidecar),
            package_variants=_package_variants(sidecar),
            selection=_selection(sidecar),
            source=_sidecar_str(sidecar, "source") or "",
            target_id=_sidecar_str(sidecar, "targetId"),
            original_filename=_sidecar_str(sidecar, "originalFilename"),
            channel=channel_of(parsed.runtime_firmware_version),
            version_source=_version_field(sidecar, "versionSource"),
            is_prerelease=is_prerelease(parsed.runtime_firmware_version),
            identity_complete=schema_version in (2, 3),
        )
        grouped.setdefault((entry.board_id, entry.runtime_id), []).append(entry)

    ordered: list[FirmwareInventoryEntry] = []
    for key in sorted(grouped):
        grouped[key].sort(
            key=lambda entry: firmware_version_sort_key(entry.runtime_firmware_version),
            reverse=True,
        )
        ordered.extend(grouped[key])
    return ordered


def _best_by_channel(
    entries: Iterable[FirmwareInventoryEntry],
) -> dict[tuple[str, str], dict[str, tuple[tuple, str]]]:
    """Return ``(board_id, runtime_id) -> {channel: (sort_key, path)}``."""

    best: dict[tuple[str, str], dict[str, tuple[tuple, str]]] = {}
    for entry in entries:
        key = (entry.board_id, entry.runtime_id)
        sort_key = firmware_version_sort_key(entry.runtime_firmware_version)
        channels = best.setdefault(key, {})
        current = channels.get(entry.channel)
        if current is None or sort_key > current[0]:
            channels[entry.channel] = (sort_key, str(entry.path))
    return best


def latest_firmware_ids_by_channel(
    entries: Iterable[FirmwareInventoryEntry],
) -> dict[tuple[str, str], dict[str, str]]:
    """Return ``(board_id, runtime_id) -> {channel: newest image path}``."""

    return {
        key: {channel: value[1] for channel, value in channels.items()}
        for key, channels in _best_by_channel(entries).items()
    }


def latest_firmware_ids(
    entries: Iterable[FirmwareInventoryEntry],
    *,
    channel: str | None = None,
) -> dict[tuple[str, str], str]:
    """Return ``(board_id, runtime_id) -> newest image path`` for *entries*.

    ``channel=None`` picks the newest across channels; a channel narrows to that
    channel only. "Newest" uses :func:`...version_identity.firmware_version_sort_key`,
    the same key :func:`...firmware_deploy.resolve_latest_firmware_for_board` uses,
    so the two surfaces can never disagree on what "latest" means.
    """

    best = _best_by_channel(entries)
    result: dict[tuple[str, str], str] = {}
    for key, channels in best.items():
        if not channels:
            continue
        if channel is not None:
            entry = channels.get(channel)
            if entry is not None:
                result[key] = entry[1]
            continue
        result[key] = max(channels.values(), key=lambda value: value[0])[1]
    return result



def build_firmware_inventory_payload(
    *,
    publish_root: Path,
    entries: list[FirmwareInventoryEntry],
    latest: Mapping[tuple[str, str], str],
    latest_by_channel: Mapping[tuple[str, str], Mapping[str, str]] | None = None,
) -> dict[str, Any]:
    """Serialize *entries* into the ``firmware.list`` result payload (v2).

    ``latest`` is the ``(board_id, runtime_id) -> path`` mapping computed by
    :func:`latest_firmware_ids`; ``isLatest`` is therefore always the server's
    answer, never a client-side guess. ``latest_by_channel`` (optional) adds the
    per-channel leader map keyed by ``<boardId>:<runtimeId>``.
    """

    entry_objects: list[dict[str, Any]] = []
    for entry in entries:
        entry_objects.append(
            {
                "path": str(entry.path),
                "filename": entry.filename,
                "boardId": entry.board_id,
                "runtimeId": entry.runtime_id,
                "micropythonVersion": entry.micropython_version,
                "runtimeFirmwareVersion": entry.runtime_firmware_version,
                "contentHash": entry.content_hash,
                "sizeBytes": entry.size_bytes,
                "modifiedAt": entry.modified_at,
                "hasManifest": entry.has_manifest,
                "embeddedPackages": dict(entry.embedded_packages),
                "notEmbedded": list(entry.not_embedded),
                "addonPackages": dict(entry.addon_packages),
                "packageVariants": dict(entry.package_variants),
                "selection": dict(entry.selection),
                "channel": entry.channel,
                "versionSource": entry.version_source,
                "isPrerelease": entry.is_prerelease,
                "isLatest": str(entry.path) == latest.get((entry.board_id, entry.runtime_id)),
                "source": entry.source,
                "targetId": entry.target_id,
                "originalFilename": entry.original_filename,
            }
        )

    payload: dict[str, Any] = {
        "schemaVersion": 2,
        "publishRoot": str(publish_root),
        "entries": entry_objects,
    }
    if latest_by_channel is not None:
        payload["latestByChannel"] = {
            f"{board_id}:{runtime_id}": dict(channels)
            for (board_id, runtime_id), channels in latest_by_channel.items()
        }
    return payload


def resolve_inventory_image(*, path: Path, publish_root: Path | None = None) -> Path:
    """Resolve *path* to one published image inside the publish root.

    Shared by :func:`delete_firmware_entry` and the export job so delete and export
    can never disagree about which paths are inside the publish root. A path outside
    the root raises ``firmware-path-invalid``; a path that is not a file raises
    ``firmware-image-unavailable``.
    """

    root = resolve_publish_root(publish_root).resolve()
    target = path.resolve()

    if root != target and root not in target.parents:
        raise FirmwareInventoryError(
            f"refusing to resolve firmware outside the publish root: {target}",
            code=CODE_FIRMWARE_PATH_INVALID,
            hint="Export only images listed by the firmware inventory.",
            details={"path": str(target), "publishRoot": str(root)},
        )

    if not target.is_file():
        raise FirmwareInventoryError(
            f"{target} is not a published firmware image",
            code=CODE_FIRMWARE_IMAGE_UNAVAILABLE,
            hint="Export only images listed by the firmware inventory.",
            details={"path": str(target)},
        )
    return target


def delete_firmware_entry(
    *,
    path: Path,
    publish_root: Path | None = None,
) -> dict[str, list[str]]:
    """Delete one image (and its sidecar), returning ``removed`` / ``absent`` paths.

    The image must live inside the resolved publish root; anything else raises
    :class:`FirmwareInventoryError` with ``firmware-path-invalid`` (re-checked by
    :func:`resolve_inventory_image`, which export also shares). A missing image is
    reported through ``absent`` (never raised) and a missing sidecar is ignored, so
    deleting an image that was published without a manifest still succeeds.
    """

    target = path.resolve()
    try:
        resolve_inventory_image(path=target, publish_root=publish_root)
    except FirmwareInventoryError as error:
        if error.code == CODE_FIRMWARE_IMAGE_UNAVAILABLE:
            return {"removed": [], "absent": [str(target)]}
        raise

    target.unlink()
    sidecar = target.with_suffix(".manifest.json")
    if sidecar.is_file():
        sidecar.unlink()

    return {"removed": [str(target)], "absent": []}


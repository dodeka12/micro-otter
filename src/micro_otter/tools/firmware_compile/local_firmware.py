"""Local firmware inventory scanning for published firmware artifacts.

This module discovers locally published firmware files and the latest known
version per board, so interactive tooling can show what is available without
querying a remote source.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

from micro_otter.config import SYSTEM_PREFIX, resolve_firmware_publish_root

from .version_registry import LATEST_VERSIONS_DEFAULT_PATH, load_latest_versions
from .version_semver import VERSION_RE

SYSTEM_FIRMWARE_PUBLISH_ROOT = SYSTEM_PREFIX.joinpath("micro_otter", "firmware")
"""``/opt`` discovery fallback for published firmware artifacts.

Handed to :func:`micro_otter.config.resolve_firmware_publish_root` as its *fallback*
argument, so an explicit ``MICRO_OTTER_FIRMWARE_DIR`` or a ``micro-otter.toml`` value
always wins while the devcontainer layout keeps working. The value is assembled from
:data:`micro_otter.config.SYSTEM_PREFIX` instead of a literal so the grep gate in
``tests/test_config.py`` can prove no ``/opt`` string is hardcoded outside the
resolver.
"""

_IDENTIFIER_RE = re.compile(r"^[a-z0-9_]+$")
_MPY_RE = re.compile(r"^\d+\.\d+\.\d+$")
_CONTENT_HASH_RE = re.compile(r"^[0-9a-f]{12}$")


@dataclass(frozen=True)
class FirmwareFilenameParts:
    """Parsed version tuple from a published firmware filename."""

    micropython_version: str
    board_id: str
    runtime_id: str
    runtime_firmware_version: str
    content_hash: str | None = None


# Backwards-compatible alias for the pre-M4j name.
LocalFirmwareEntry = FirmwareFilenameParts


def split_firmware_filename(name: str) -> FirmwareFilenameParts | None:
    """Parse a published firmware filename tail-first into its components.

    Strips one trailing ``-<12 hex>`` group, then resolves the runtime firmware
    version (which may itself carry a pre-release/build tail) by scanning
    version-shaped suffixes from the right, so the legacy four-segment name and
    the pre-release form both parse. Returns ``None`` for a non-firmware name.
    """

    if not isinstance(name, str) or not name.endswith(".bin"):
        return None
    body = name[:-4]
    parts = body.split("-")

    content_hash: str | None = None
    if len(parts) > 1 and _CONTENT_HASH_RE.fullmatch(parts[-1]):
        content_hash = parts[-1]
        parts = parts[:-1]

    for idx in range(3, len(parts)):
        candidate = "-".join(parts[idx:])
        if VERSION_RE.fullmatch(candidate):
            micropython_version = parts[idx - 3]
            board_id = parts[idx - 2]
            runtime_id = parts[idx - 1]
            if (
                _MPY_RE.fullmatch(micropython_version)
                and _IDENTIFIER_RE.fullmatch(board_id)
                and _IDENTIFIER_RE.fullmatch(runtime_id)
            ):
                return FirmwareFilenameParts(
                    micropython_version=micropython_version,
                    board_id=board_id.lower(),
                    runtime_id=runtime_id,
                    runtime_firmware_version=candidate,
                    content_hash=content_hash,
                )
    return None


def parse_firmware_filename(name: str) -> FirmwareFilenameParts | None:
    """Parse the trailing version tuple from a published firmware filename.

    Both the legacy four-segment name and the five-segment name that appends the
    content hash parse; the four-segment form yields ``content_hash=None``. The
    runtime firmware version may carry a pre-release tail (``1.0.1-dev.7.gabc1234``).
    """

    return split_firmware_filename(name)


def resolve_publish_root(publish_root: Path | None = None) -> Path:
    """Return the firmware publish root, resolving the default when omitted.

    ``publish_root=None`` resolves the root through
    :func:`micro_otter.config.resolve_firmware_publish_root`, which honours
    ``MICRO_OTTER_FIRMWARE_DIR`` and ``micro-otter.toml`` before falling back to the
    documented system-wide location (:data:`SYSTEM_FIRMWARE_PUBLISH_ROOT`). Passing a
    path keeps the previous behaviour for every explicit caller.

    Callers that need the files themselves (rather than the version inventory
    :func:`scan_publish_root` returns) resolve the folder here instead of
    re-deriving the search order.
    """

    if publish_root is not None:
        return publish_root
    return resolve_firmware_publish_root(fallback=SYSTEM_FIRMWARE_PUBLISH_ROOT)


def ensure_publish_root(publish_root: Path | None = None) -> Path:
    """Return the publish root, creating it when missing and proving it is writable.

    :func:`resolve_publish_root` only *resolves* the folder; this helper also
    *prepares* it, so both import paths that write into the publish root (package
    import, binary import) prepare it identically instead of each re-deriving the
    ``mkdir`` plus writability check.

    Failures raise :class:`OSError` with the offending path in the message and the
    original error chained, never a feature-specific error: each caller maps that
    into its own error family (``firmware-import-denied`` for both import paths).
    """

    root = resolve_publish_root(publish_root).resolve()
    if not root.is_dir():
        try:
            root.mkdir(parents=True, exist_ok=True)
        except OSError as error:
            raise OSError(f"cannot create the firmware publish root {root}") from error
    if not os.access(root, os.W_OK):
        raise OSError(f"the firmware publish root is not writable: {root}")
    return root


def scan_publish_root(publish_root: Path | None = None) -> dict[str, list[str]]:
    """Return ``board id -> sorted runtime firmware versions`` available locally.

    The root is resolved by :func:`resolve_publish_root`, so the inventory and a
    direct file scan of the same folder always agree.
    """

    root = resolve_publish_root(publish_root)
    if not root.is_dir():
        return {}

    versions: dict[str, set[str]] = {}
    for path in root.iterdir():
        if not path.is_file() or path.suffix != ".bin":
            continue
        entry = parse_firmware_filename(path.name)
        if entry is None:
            continue
        versions.setdefault(entry.board_id, set()).add(entry.runtime_firmware_version)

    return {board_id: sorted(board_versions) for board_id, board_versions in versions.items()}


def latest_version_by_board(workspace_root: Path) -> dict[str, str]:
    """Return ``board id -> latest fullVersion`` from the latest-versions registry."""
    registry_path = (workspace_root / LATEST_VERSIONS_DEFAULT_PATH).resolve()
    if not registry_path.is_file():
        return {}

    try:
        payload = load_latest_versions(registry_path)
    except ValueError:
        return {}

    latest: dict[str, str] = {}
    targets = payload.get("targets", {})
    for entry in targets.values():
        if not isinstance(entry, dict):
            continue
        board_id = entry.get("boardId")
        if not isinstance(board_id, str):
            continue
        channels = entry.get("channels")
        release = channels.get("release") if isinstance(channels, dict) else None
        full_version = (
            release.get("fullVersion") if isinstance(release, dict) else None
        )
        if not isinstance(full_version, str):
            full_version = entry.get("fullVersion")
        if isinstance(full_version, str):
            latest[board_id.lower()] = full_version

    return latest


__all__ = [
    "SYSTEM_FIRMWARE_PUBLISH_ROOT",
    "FirmwareFilenameParts",
    "LocalFirmwareEntry",
    "ensure_publish_root",
    "latest_version_by_board",
    "parse_firmware_filename",
    "resolve_publish_root",
    "scan_publish_root",
    "split_firmware_filename",
]

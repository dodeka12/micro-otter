"""Firmware staleness detection comparing current source vs. latest lineage builds.

This module computes the current constituent versions for a runtime target and
compares them against the latest entry in the runtime lineage registry, so the
CLI can flag which board targets have obsolete firmware that needs a rebuild.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .content_identity import firmware_content_hash
from .firmware_deploy import resolve_latest_firmware_for_board
from .firmware_inventory import read_firmware_sidecar
from .local_firmware import parse_firmware_filename, scan_publish_root
from .package_resolver import VariantNotSelectedError
from .package_versions import (
    collect_package_versions,
    read_device_tools_version,
)
from .staging_runtime_assets import read_packaged_runtime_assets_version
from .target_context import (
    TargetPackageContext,
    resolve_target_package_context_for_board,
)
from .version_identity import resolve_micropython_version
from .version_registry import RUNTIME_LINEAGE_DEFAULT_PATH, load_runtime_lineage
from .version_semver import try_parse_version, version_sort_key


@dataclass(frozen=True)
class FirmwareBuildStatus:
    """Staleness result for a single board + runtime target."""

    board_id: str
    target_key: str
    latest_firmware_version: str | None
    is_stale: bool
    reason: str
    channel: str | None = None
    reference_content_hash: str | None = None
    current_content_hash: str | None = None


def _semver_or_fallback(value: str | None, fallback: str = "0.0.0") -> str:
    return value if isinstance(value, str) and try_parse_version(value) else fallback


def _read_runtime_assets_version() -> str | None:
    """Read the compile-owned runtime assets version shipped with this package."""
    return read_packaged_runtime_assets_version()


def collect_current_constituent_versions(
    *,
    device_root: Path,
    runtime_id: str,
    micropython_root: Path,
    context: TargetPackageContext | None = None,
    addons_root: Path | None = None,
    requested_variants: Mapping[str, str] | None = None,
) -> dict[str, Any] | None:
    """Return the current source constituent versions, or ``None`` when unresolvable.

    *context* answers the capability question exactly as the build does; a
    multi-variant package therefore needs an explicit choice through
    *requested_variants* (the build raises ``variant-not-selected`` without one, and
    staleness surfaces that the same way). *context* defaults to
    :meth:`...target_context.TargetPackageContext.none`. ``addons_root=None`` keeps
    the built-in-only behaviour for callers that pass nothing; the firmware menu
    passes the configured add-ons folder so an installed, upgraded or removed add-on
    changes the result.

    ``nodePackages`` stays built-ins only so the lineage comparison keeps its meaning;
    add-ons are reported through ``addonPackages`` and the frozen implementations
    through ``packageVariants``.
    """

    try:
        micropython_version = resolve_micropython_version(micropython_root)
    except (ValueError, OSError):
        return None

    runtime_manifest_path = device_root / "runtime" / runtime_id / "manifest.json"
    try:
        runtime_payload = json.loads(runtime_manifest_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        runtime_payload = {}
    if not isinstance(runtime_payload, dict):
        runtime_payload = {}

    try:
        inventory = collect_package_versions(
            device_root=device_root,
            runtime_payload=runtime_payload,
            context=context if context is not None else TargetPackageContext.none(),
            addons_root=addons_root,
            requested_variants=requested_variants,
        )
    except VariantNotSelectedError:
        # A multi-variant package without an explicit choice cannot be compared; the
        # build would ask for it, so staleness treats the board as unresolvable
        # rather than crashing the menu.
        return None

    return {
        "micropythonVersion": micropython_version,
        "runtimeSourceVersion": _semver_or_fallback(runtime_payload.get("version")),
        "deviceToolsVersion": _semver_or_fallback(read_device_tools_version(device_root)),
        "nodePackages": dict(inventory.builtin),
        "addonPackages": dict(inventory.addons),
        "packageVariants": dict(inventory.variants),
        "runtimeAssetsVersion": _read_runtime_assets_version(),
    }


def _semver_key(version: str) -> tuple:
    return version_sort_key(version)


def _latest_firmware_version(lineage: dict[str, Any], target_key: str) -> str | None:
    target_lineage = lineage.get("lineage", {}).get(target_key, {})
    valid_versions = [v for v in target_lineage if isinstance(v, str) and try_parse_version(v)]
    if not valid_versions:
        return None
    return max(valid_versions, key=_semver_key)


def _optional_match(recorded: Any, current: Any) -> bool:
    """Return whether a lineage value matches, treating ``None`` as "not recorded".

    Lineage entries written before variant-explicit identity store neither
    ``addonPackages`` nor ``packageVariants``; the comparison must not read that
    absence as a mismatch (it would mark every older image ``source-changed``).
    """

    if recorded is None:
        return True
    return recorded == current


def _constituents_match(entry: Any, current: dict[str, Any]) -> bool:
    """Return whether a lineage entry proves the current sources are unchanged.

    The keys a pre-M4u entry does not record are compared through
    :func:`_optional_match`, so an entry without ``addonPackages`` /
    ``packageVariants`` still matches on the fields it does declare.
    """

    if not isinstance(entry, dict):
        return False
    return (
        entry.get("micropythonVersion") == current.get("micropythonVersion")
        and entry.get("runtimeSourceVersion") == current.get("runtimeSourceVersion")
        and entry.get("deviceToolsVersion") == current.get("deviceToolsVersion")
        and entry.get("nodePackages") == current.get("nodePackages")
        and entry.get("runtimeAssetsVersion") == current.get("runtimeAssetsVersion")
        and _optional_match(entry.get("addonPackages"), current.get("addonPackages"))
        and _optional_match(entry.get("packageVariants"), current.get("packageVariants"))
    )


def _string_map(value: Any) -> dict[str, str]:
    """Return *value* as a ``str → str`` mapping, tolerating garbage."""

    if not isinstance(value, Mapping):
        return {}
    return {
        key: item
        for key, item in value.items()
        if isinstance(key, str) and isinstance(item, str)
    }


def _v3_identity_matches(
    sidecar: Mapping[str, Any] | None, current: dict[str, Any]
) -> bool | None:
    """Compare a v3 sidecar with the current sources **field by field**.

    Returns ``None`` when *sidecar* is not a ``schemaVersion: 3`` record, so the
    caller keeps its hash-first behaviour for older images. A v3 sidecar is compared
    on its constituents and on the three composition maps (including
    ``packageVariants``), never on ``contentHash``: a hash written by an older
    variant-blind build cannot prove variant equality, and identity is exactly what
    this comparison is about.
    """

    if not isinstance(sidecar, Mapping) or sidecar.get("schemaVersion") != 3:
        return None
    constituents = sidecar.get("constituents")
    recorded_constituents = constituents if isinstance(constituents, Mapping) else {}
    expected_constituents = {
        "runtime-source": current.get("runtimeSourceVersion"),
        "device-tools": current.get("deviceToolsVersion"),
        "runtime-assets": current.get("runtimeAssetsVersion"),
    }
    recorded = {
        "runtime-source": recorded_constituents.get("runtime-source"),
        "device-tools": recorded_constituents.get("device-tools"),
        "runtime-assets": recorded_constituents.get("runtime-assets"),
    }
    if recorded != expected_constituents:
        return False
    return (
        _string_map(sidecar.get("embeddedPackages")) == _string_map(current.get("nodePackages"))
        and _string_map(sidecar.get("addonPackages"))
        == _string_map(current.get("addonPackages"))
        and _string_map(sidecar.get("packageVariants"))
        == _string_map(current.get("packageVariants"))
    )


def _sidecar_content_hash(sidecar: Mapping[str, Any] | None) -> str | None:
    """Return the sidecar's recorded ``contentHash``, or ``None``."""

    if not isinstance(sidecar, Mapping):
        return None
    content_hash = sidecar.get("contentHash")
    return content_hash if isinstance(content_hash, str) else None


def _current_content_hash(
    current: dict[str, Any],
    board_id: str,
    runtime_id: str,
    *,
    include_variants: bool = True,
) -> str | None:
    """Return a best-effort content hash for the current source constituents.

    Add-ons and the frozen variant map are part of the hash, so the diagnostic value
    on :class:`FirmwareBuildStatus` is the hash a rebuild would produce.
    ``include_variants=False`` reproduces the pre-M4u v2 payload (no top-level
    ``packageVariants`` key), which is what a sidecar written before this milestone
    hashed with; v2 images are compared on that value.
    """

    try:
        constituents: dict[str, str] = {
            "runtime-source": str(current.get("runtimeSourceVersion") or ""),
            "device-tools": str(current.get("deviceToolsVersion") or ""),
        }
        if current.get("runtimeAssetsVersion"):
            constituents["runtime-assets"] = str(current["runtimeAssetsVersion"])
        variants: dict[str, Any] = {}
        if include_variants:
            variants["package_variants"] = dict(current.get("packageVariants") or {})
        return firmware_content_hash(
            slug=board_id,
            backend="esp-idf",
            platform_version=str(current.get("micropythonVersion") or ""),
            runtime_id=runtime_id,
            constituents=constituents,
            embedded_packages=current.get("nodePackages") or {},
            addon_packages=current.get("addonPackages") or {},
            **variants,
        )
    except Exception:
        return None


def _reference_version(reference: Path) -> str | None:
    """Return the runtime firmware version of a published reference image."""

    entry = parse_firmware_filename(reference.name)
    return entry.runtime_firmware_version if entry is not None else None


def check_firmware_staleness(
    *,
    workspace_root: Path,
    micropython_root: Path,
    device_root: Path | None = None,
    runtime_id: str = "general",
    board_ids: Sequence[str],
    publish_root: Path | None = None,
    channel: str | None = None,
    addons_root: Path | None = None,
    package_variants: Mapping[str, str] | None = None,
) -> dict[str, FirmwareBuildStatus]:
    """Return a staleness status per board id.

    The status compares the current source constituents against the newest
    published image of the requested channel (default: newest across channels). A
    ``schemaVersion: 3`` sidecar is compared **field by field** (constituents,
    embedded packages, add-on packages, package variants) and never through its
    ``contentHash``: a hash written by an older variant-blind build cannot prove
    variant equality. A v2 sidecar keeps the hash-first behaviour (a rebuild that only
    moved the git distance is ``up-to-date``; a differing hash is
    ``content-changed``), and when either side lacks a hash the lineage/constituent
    comparison keeps legacy images behaving as before.

    The current constituents are collected **per board**, because the variant a
    target offers depends on its capabilities; results are memoized by normalized
    board id. ``addons_root`` is forwarded to the collector so an installed, upgraded
    or removed add-on changes the comparison.
    """
    resolved_device_root = (
        (workspace_root / "src" / "micro_otter" / "nodes" / "device")
        if device_root is None
        else device_root
    ).resolve()

    current_by_board: dict[str, dict[str, Any] | None] = {}

    def _current_for(board: str) -> dict[str, Any] | None:
        """Return (and memoize) the current constituents of one normalized board id."""

        if board not in current_by_board:
            current_by_board[board] = collect_current_constituent_versions(
                device_root=resolved_device_root,
                runtime_id=runtime_id,
                micropython_root=micropython_root,
                context=resolve_target_package_context_for_board(
                    workspace_root=workspace_root,
                    device_root=resolved_device_root,
                    runtime_id=runtime_id,
                    board=board,
                ),
                addons_root=addons_root,
                requested_variants=package_variants,
            )
        return current_by_board[board]

    lineage_path = (workspace_root / RUNTIME_LINEAGE_DEFAULT_PATH).resolve()
    try:
        lineage = load_runtime_lineage(lineage_path) if lineage_path.exists() else {"lineage": {}}
    except ValueError:
        lineage = {"lineage": {}}

    published_versions = scan_publish_root(publish_root)

    statuses: dict[str, FirmwareBuildStatus] = {}
    for board_id in board_ids:
        normalized_board = board_id.strip().lower()
        target_key = f"{normalized_board}-{runtime_id}"
        latest_version = _latest_firmware_version(lineage, target_key)
        current = _current_for(normalized_board)

        if current is None:
            status = FirmwareBuildStatus(
                board_id=normalized_board,
                target_key=target_key,
                latest_firmware_version=latest_version,
                is_stale=False,
                reason="unavailable",
                channel=channel,
            )
        else:
            reference = resolve_latest_firmware_for_board(
                board_id=normalized_board,
                runtime_id=runtime_id,
                channel=channel,
                publish_root=publish_root,
            )
            reference_sidecar = (
                read_firmware_sidecar(reference) if reference is not None else None
            )
            reference_hash = _sidecar_content_hash(reference_sidecar)
            current_hash = _current_content_hash(current, normalized_board, runtime_id)
            v3_match = _v3_identity_matches(reference_sidecar, current)

            if (
                channel is not None
                and reference is None
                and published_versions.get(normalized_board)
            ):
                status = FirmwareBuildStatus(
                    board_id=normalized_board,
                    target_key=target_key,
                    latest_firmware_version=None,
                    is_stale=True,
                    reason="no-image",
                    channel=channel,
                )
            elif v3_match is not None:
                status = FirmwareBuildStatus(
                    board_id=normalized_board,
                    target_key=target_key,
                    latest_firmware_version=_reference_version(reference),
                    is_stale=not v3_match,
                    reason="up-to-date" if v3_match else "content-changed",
                    channel=channel,
                    reference_content_hash=reference_hash,
                    current_content_hash=current_hash,
                )
            elif (
                reference is not None
                and reference_hash is not None
                and current_hash is not None
            ):
                comparison_hash = _current_content_hash(
                    current, normalized_board, runtime_id, include_variants=False
                )
                if reference_hash == comparison_hash:
                    status = FirmwareBuildStatus(
                        board_id=normalized_board,
                        target_key=target_key,
                        latest_firmware_version=_reference_version(reference),
                        is_stale=False,
                        reason="up-to-date",
                        channel=channel,
                        reference_content_hash=reference_hash,
                        current_content_hash=current_hash,
                    )
                else:
                    status = FirmwareBuildStatus(
                        board_id=normalized_board,
                        target_key=target_key,
                        latest_firmware_version=_reference_version(reference),
                        is_stale=True,
                        reason="content-changed",
                        channel=channel,
                        reference_content_hash=reference_hash,
                        current_content_hash=current_hash,
                    )
            elif latest_version is None:
                status = FirmwareBuildStatus(
                    board_id=normalized_board,
                    target_key=target_key,
                    latest_firmware_version=None,
                    is_stale=True,
                    reason="never-built",
                    channel=channel,
                )
            elif _constituents_match(lineage["lineage"][target_key][latest_version], current):
                status = FirmwareBuildStatus(
                    board_id=normalized_board,
                    target_key=target_key,
                    latest_firmware_version=latest_version,
                    is_stale=False,
                    reason="up-to-date",
                    channel=channel,
                )
            else:
                status = FirmwareBuildStatus(
                    board_id=normalized_board,
                    target_key=target_key,
                    latest_firmware_version=latest_version,
                    is_stale=True,
                    reason="source-changed",
                    channel=channel,
                )

        if status.reason == "up-to-date" and not published_versions.get(normalized_board):
            status = FirmwareBuildStatus(
                board_id=normalized_board,
                target_key=target_key,
                latest_firmware_version=latest_version,
                is_stale=True,
                reason="artifact-missing",
                channel=channel,
                reference_content_hash=status.reference_content_hash,
                current_content_hash=status.current_content_hash,
            )

        statuses[normalized_board] = status

    return statuses


__all__ = [
    "FirmwareBuildStatus",
    "check_firmware_staleness",
    "collect_current_constituent_versions",
]

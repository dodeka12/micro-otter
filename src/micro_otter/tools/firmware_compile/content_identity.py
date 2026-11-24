"""Deterministic firmware content identity: hash and sidecar manifest.

The content hash distinguishes *what* a firmware contains without depending on
non-reproducible build bytes, so "same logical contents ⇒ same name" survives
two builds of identical sources. Timestamps, paths, and git source are never
hashed — they belong to the manifest only.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from typing import Any

__all__ = [
    "build_firmware_manifest",
    "firmware_content_hash",
]


def _normalize_selection(selection: Mapping[str, Any] | None) -> dict[str, Any]:
    """Return a stable, JSON-safe selection mapping.

    ``packageIds`` is sorted, ``packageVariants`` is sorted by key, and absent or
    empty values are omitted so a caller can pass ``None`` for any field.
    """

    if not selection:
        return {}
    normalized: dict[str, Any] = {}
    package_ids = selection.get("packageIds")
    if isinstance(package_ids, list | tuple):
        normalized["packageIds"] = sorted(str(package_id) for package_id in package_ids)
    package_variants = selection.get("packageVariants")
    if isinstance(package_variants, Mapping):
        normalized["packageVariants"] = dict(sorted(package_variants.items()))
    module_packaging_mode = selection.get("modulePackagingMode")
    if module_packaging_mode is not None:
        normalized["modulePackagingMode"] = module_packaging_mode
    optimization_level = selection.get("optimizationLevel")
    if optimization_level is not None:
        normalized["optimizationLevel"] = optimization_level
    return normalized


def _content_payload(
    *,
    slug: str,
    backend: str,
    platform_version: str,
    runtime_id: str,
    constituents: Mapping[str, str],
    embedded_packages: Mapping[str, str],
    addon_packages: Mapping[str, str] | None = None,
    selection: Mapping[str, Any] | None = None,
    package_variants: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Return the exact payload ``firmware_content_hash`` hashes.

    ``runtimeFirmwareVersion``, ``versionSource``, ``gitSource``, timestamps,
    file hashes and paths are deliberately absent: the hash names composition
    only, never the version or the build metadata.

    ``package_variants`` — the effective ``packageId → variantId`` map — is the
    *outcome* of variant selection and joins the payload behind ``schemaVersion: 3``.
    ``selection.packageVariants`` stays the *request* the caller made, so a request
    that the target could not honour never describes an image. Passing ``None`` keeps
    the payload byte-identical to the v2 schema (no ``packageVariants`` key at all),
    which is what lets every existing ``contentHash`` keep verifying; an empty mapping
    is still a v3 payload, because the producer recorded "no packages" deliberately.
    """

    payload: dict[str, Any] = {
        "schemaVersion": 2,
        "slug": slug,
        "backend": backend,
        "platformVersion": platform_version,
        "runtimeId": runtime_id,
        "constituents": dict(constituents),
        "embeddedPackages": dict(embedded_packages),
        "addonPackages": dict(addon_packages or {}),
        "selection": _normalize_selection(selection),
    }
    if package_variants is not None:
        payload["schemaVersion"] = 3
        payload["packageVariants"] = dict(sorted(package_variants.items()))
    return payload


def firmware_content_hash(
    *,
    slug: str,
    backend: str,
    platform_version: str,
    runtime_id: str,
    constituents: Mapping[str, str],
    embedded_packages: Mapping[str, str],
    addon_packages: Mapping[str, str] | None = None,
    selection: Mapping[str, Any] | None = None,
    package_variants: Mapping[str, str] | None = None,
) -> str:
    """Return a deterministic 12-hex-char hash over the logical firmware contents.

    *constituents* is a per-backend ``str → str`` mapping (for ``esp-idf`` the
    runtime-source/device-tools/runtime-assets versions); *embedded_packages* and
    *addon_packages* are the sorted ``package id → version`` mappings of the
    packages frozen into the image; *selection* records the package selection,
    variants, packaging mode and optimisation level; *package_variants* is the
    effective ``package id → variant id`` map the image froze (``None`` keeps the
    byte-identical v2 payload). The payload is serialized with ``sort_keys=True`` so
    input ordering never changes the hash, and truncated to 12 hex chars for
    filenames and registry keys.

    The runtime firmware version, its derivation source, git metadata, timestamps,
    file hashes and any filesystem path are never hashed, so the same composition
    at a different commit keeps the same name.
    """

    payload = _content_payload(
        slug=slug,
        backend=backend,
        platform_version=platform_version,
        runtime_id=runtime_id,
        constituents=constituents,
        embedded_packages=embedded_packages,
        addon_packages=addon_packages,
        selection=selection,
        package_variants=package_variants,
    )
    serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()[:12]


def build_firmware_manifest(
    *,
    backend: str,
    board: str,
    slug: str,
    platform_version: str,
    runtime_id: str,
    runtime_version: str,
    runtime_firmware_version: str,
    content_hash: str,
    constituents: Mapping[str, str],
    embedded_packages: Mapping[str, str],
    addon_packages: Mapping[str, str] | None = None,
    selection: Mapping[str, Any] | None = None,
    base_version: str | None = None,
    channel: str | None = None,
    version_source: str | None = None,
    not_embedded: tuple[str, ...] | list[str] = (),
    module_packaging_mode: str | None = None,
    optimization_level: int | None = None,
    file_hashes: Mapping[str, str] | None = None,
    git_source: Mapping[str, Any] | None = None,
    finished_at: str | None = None,
    package_variants: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Build the sidecar ``firmware-manifest.json`` payload for one image.

    The manifest is the self-describing record of what a firmware contains and
    travels next to the ``.bin`` (``<name>.manifest.json``). Everything except
    ``build`` (git source, finished-at timestamp) participates in
    :func:`firmware_content_hash`; the ``content_hash`` argument must therefore be
    the hash of the same ``constituents``/``embedded_packages``/``addon_packages``/
    ``selection``/``package_variants`` passed here, and a mismatch raises
    ``ValueError``.

    Passing *package_variants* records the effective ``packageId → variantId`` map
    at the top level behind ``schemaVersion: 3``; leaving it ``None`` keeps the v2
    sidecar byte-identical (no ``packageVariants`` key at all).
    """

    expected_hash = firmware_content_hash(
        slug=slug,
        backend=backend,
        platform_version=platform_version,
        runtime_id=runtime_id,
        constituents=constituents,
        embedded_packages=embedded_packages,
        addon_packages=addon_packages,
        selection=selection,
        package_variants=package_variants,
    )
    if content_hash != expected_hash:
        raise ValueError(
            f"content_hash {content_hash!r} does not match the manifest inputs "
            f"(expected {expected_hash!r})"
        )

    manifest: dict[str, Any] = {
        "schemaVersion": 3 if package_variants is not None else 2,
        "backend": backend,
        "board": board,
        "slug": slug,
        "platformVersion": platform_version,
        "runtime": {"id": runtime_id, "version": runtime_version},
        "runtimeFirmwareVersion": runtime_firmware_version,
        "contentHash": content_hash,
        "constituents": dict(constituents),
        "embeddedPackages": dict(embedded_packages),
        "addonPackages": dict(addon_packages or {}),
        "selection": _normalize_selection(selection),
        "notEmbedded": list(not_embedded),
        "build": {
            "gitSource": dict(git_source) if git_source is not None else None,
            "finishedAt": finished_at,
        },
    }
    if package_variants is not None:
        manifest["packageVariants"] = dict(sorted(package_variants.items()))
    if base_version is not None or channel is not None or version_source is not None:
        manifest["version"] = {
            "version": runtime_firmware_version,
            "baseVersion": base_version,
            "channel": channel,
            "versionSource": version_source,
        }
    if module_packaging_mode is not None:
        manifest["modulePackagingMode"] = module_packaging_mode
    if optimization_level is not None:
        manifest["optimizationLevel"] = optimization_level
    if file_hashes is not None:
        manifest["fileHashes"] = dict(file_hashes)
    return manifest

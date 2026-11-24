"""Package-level compile-runtime command entrypoint.

The CLI layer should delegate into this module so compile behavior has a single
source of truth that can also be reused by future server wrappers.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import threading
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter
from typing import Any

from micro_otter.config import (
    SYSTEM_PREFIX,
    resolve_firmware_publish_root,
    resolve_micropython_root,
)

from .board_target import BoardTarget, resolve_board_target
from .build_artifact import (
    ArtifactVerificationError,
    FirmwareArtifactRecord,
    publish_firmware_artifact,
    verify_firmware_artifact,
)
from .build_identity import PackageVersionInventory, resolve_build_identity
from .build_orchestration import (
    BuildCancelled,
    BuildTimeout,
    LogCallback,
    StageCallback,
    run_build_orchestration,
)
from .build_profile import BuildProfile, normalize_build_profile
from .content_identity import build_firmware_manifest
from .firmware_history import append_firmware_history
from .package_resolver import (
    VariantCapabilitiesUnsatisfiedError,
    VariantNotSelectedError,
    VariantUnknownError,
)
from .package_versions import (
    _package_provenance_payload,
    collect_package_versions,
    read_device_tools_version,
)
from .staging_models import ConstituentVersions, StagingExecutionReport
from .staging_resolver import (
    PackageNotStagedError,
    UnknownPackageIdError,
    VariantPackageNotSelectedError,
)
from .target_context import TargetPackageContext, resolve_target_package_context
from .target_mapping import (
    CompileTargetResolution,
    build_target_mapping_warning,
    resolve_compile_target_resolution,
)
from .version_identity import (
    MicropythonVersionError,
    parse_full_firmware_version,
    resolve_micropython_version,
)
from .version_registry import (
    LATEST_VERSIONS_DEFAULT_PATH,
    RUNTIME_LINEAGE_DEFAULT_PATH,
    add_lineage_entry_for_target,
    default_latest_versions_payload,
    default_runtime_lineage_payload,
    load_latest_versions,
    load_runtime_lineage,
    make_target_key,
    update_latest_version,
    write_latest_versions,
    write_runtime_lineage,
)
from .version_semver import try_parse_version

SYSTEM_MICROPYTHON_ROOT = SYSTEM_PREFIX.joinpath("micropython")
"""``/opt`` discovery fallback for the MicroPython checkout.

This is the *fallback* handed to :func:`micro_otter.config.resolve_micropython_root`,
not the primary source: an explicit CLI flag, ``MICRO_OTTER_MICROPYTHON_ROOT``, or
``micro-otter.toml`` always wins. Keeping the value out of a literal is what lets
``tests/test_config.py`` assert that no ``/opt`` string is hardcoded outside the
resolver.
"""

SYSTEM_FIRMWARE_PUBLISH_ROOT = SYSTEM_PREFIX.joinpath("micro_otter", "firmware")
"""``/opt`` discovery fallback for published firmware artifacts.

Consumed as the *fallback* argument of
:func:`micro_otter.config.resolve_firmware_publish_root`; see
:data:`SYSTEM_MICROPYTHON_ROOT` for why the value is assembled at runtime.
"""


@dataclass(frozen=True)
class CompileRuntimeRequest:
    """Input contract for compile-runtime command execution."""

    runtime_id: str
    board: str
    workspace_root: Path
    micropython_root: Path | None = None
    modules_path: Path | None = None
    device_root: Path | None = None
    addons_root: Path | None = None
    build_dir: Path | None = None
    clean_staging: bool = False
    clean_build: bool = False
    module_packaging_mode: str | None = None
    package_ids: tuple[str, ...] | None = None
    package_variants: Mapping[str, str] | None = None
    optimization_level: int | None = None
    json_output: bool = False
    embedded_inventory_output: Path | None = None
    verbose: bool = False
    request_id: str | None = None
    timeout_seconds: int | None = None
    dry_run: bool = False
    force_overwrite: bool = False


@dataclass(frozen=True)
class NormalizedCompileRuntimeRequest:
    """Canonical request representation used by package-owned execution."""

    runtime_id: str
    board: str
    slug: str
    target: BoardTarget
    workspace_root: Path
    micropython_root: Path
    modules_path: Path | None
    device_root: Path
    addons_root: Path | None
    build_dir: Path | None
    clean_staging: bool
    clean_build: bool
    build_profile: BuildProfile
    target_resolution: CompileTargetResolution
    package_ids: tuple[str, ...] | None
    package_variants: Mapping[str, str] | None
    json_output: bool
    embedded_inventory_output: Path | None
    verbose: bool
    request_id: str | None
    timeout_seconds: int | None
    dry_run: bool
    force_overwrite: bool


@dataclass(frozen=True)
class CompileRuntimeExecutionResult:
    """Structured execution result with deterministic exit code and payload."""

    exit_code: int
    payload: dict[str, Any]


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def build_error_object(
    *,
    code: str,
    category: str,
    message: str,
    details: dict[str, Any] | None = None,
    hint: str | None = None,
) -> dict[str, Any]:
    """Return the shared structured-error entry every command payload embeds.

    The shape is the contract clients branch on: ``code`` is the stable machine
    identifier, ``category`` a coarse bucket, ``message`` human text, while
    ``details`` and ``hint`` are only present when the caller has something to
    add. Keeping one builder here means the compile payload, the deploy payload,
    and the server error frames cannot drift apart.
    """

    error: dict[str, Any] = {
        "code": code,
        "category": category,
        "message": message,
    }
    if details:
        error["details"] = details
    if hint:
        error["hint"] = hint
    return error


def _base_payload(normalized: NormalizedCompileRuntimeRequest) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "status": "failed",
        "requestId": normalized.request_id,
        "runtime": {
            "id": normalized.runtime_id,
            "version": "unknown",
        },
        "target": {
            "board": normalized.board,
            "slug": normalized.slug,
            "backend": normalized.target.build_backend,
            "port": normalized.target_resolution.compile_port,
            "webTargetId": normalized.target_resolution.web_target_id,
            "mappingRuleId": normalized.target_resolution.mapping_rule_id,
            "mappingSource": normalized.target_resolution.mapping_source,
            "mappingConfidence": normalized.target_resolution.mapping_confidence,
        },
        "paths": {
            "micropythonRoot": str(normalized.micropython_root),
            "modulesPath": str(normalized.modules_path) if normalized.modules_path else None,
            "addonsRoot": str(normalized.addons_root) if normalized.addons_root else None,
            "firmwareArtifact": None,
            "firmwarePublishedArtifact": None,
            "firmwareHistory": None,
        },
        "staging": {
            "filesDiscovered": 0,
            "filesCopied": 0,
            "filesByPackage": {},
            "conflicts": [],
            "detailedFiles": [],
            "embeddedInventoryPath": None,
            "embeddedInventoryHash": None,
            "embeddedMetadataRoot": "otter/",
            "staticAssetFilesEmbedded": 0,
            "staticAssetRawBytes": 0,
            "staticAssetCompressedBytes": 0,
        },
        "build": {
            "startedAt": None,
            "finishedAt": None,
            "durationMs": 0,
            "command": "staging-only",
            "exitCode": None,
        },
        "metadata": {
            "embeddedMode": True,
            "packagesIncluded": [],
            "sourceRevision": None,
            "canonicalLibsPathRule": "otter_<pkg-name>/<module> | moa_<id>/<module>",
            "dynamicOverlayCompatibility": True,
            "firmwarePublishStatus": "not-run",
        },
        "warnings": [],
        "errors": [],
    }


def _collect_constituent_versions(
    *,
    device_root: Path,
    runtime_payload: dict,
    package_ids: tuple[str, ...] | None = None,
    addons_root: Path | None = None,
    target_resolution: CompileTargetResolution | None = None,
    requested_variants: Mapping[str, str] | None = None,
) -> tuple[str, PackageVersionInventory]:
    """Return ``(device_tools_version, packages)`` gathered from the device directory.

    ``packages`` splits built-ins from add-ons (``.merged()`` restores the flat
    mapping for legacy callers) and carries the effective ``packageId → variantId``
    map, so the identity names the implementation the image froze. ``package_ids``
    narrows the collected versions to the packages frozen into the image. The lineage
    therefore changes when the selection changes — that is intended, matching how
    removing a package already changes the image hash and version. Installed add-ons
    join the collected set when *addons_root* is given, because they are staged (and
    therefore part of the image) even though the shipped runtime manifest cannot list
    them.

    *target_resolution* is the resolution the build already holds; it supplies the
    target's capability predicates so variant selection matches staging. Without it
    the collector degrades to ``TargetPackageContext.none()``, which keeps a
    single-variant package tree behaving exactly as before. ``requested_variants`` is
    the normalized request's override map. Identity collection no longer raises on a
    multi-variant package: :func:`...package_versions.collect_package_versions`
    selects the variant the same way staging does.
    """

    context = (
        TargetPackageContext.none()
        if target_resolution is None
        else resolve_target_package_context(
            device_root=device_root, resolution=target_resolution
        )
    )
    inventory = collect_package_versions(
        device_root=device_root,
        runtime_payload=runtime_payload,
        context=context,
        package_ids=package_ids,
        addons_root=addons_root,
        requested_variants=requested_variants,
    )
    return read_device_tools_version(device_root), inventory


def _embedded_file_hashes(report: StagingExecutionReport) -> dict[str, str]:
    """Return ``path → sha256:<hex>`` from the staged embedded hash table, if any.

    The embedded hash table is written by staging as ``embedded_hashes.json``; the
    sidecar manifest reuses it rather than re-hashing the staged files.
    """

    if report.embedded_hashes_path is None or not report.embedded_hashes_path.exists():
        return {}
    try:
        payload = json.loads(report.embedded_hashes_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    files = payload.get("files") if isinstance(payload, dict) else None
    if not isinstance(files, list):
        return {}
    result: dict[str, str] = {}
    for record in files:
        if not isinstance(record, dict):
            continue
        path = record.get("path")
        file_hash = record.get("fileHash")
        if isinstance(path, str) and isinstance(file_hash, str):
            result[path] = file_hash
    return result


def _update_runtime_lineage(
    *,
    workspace_root: Path,
    target_key: str,
    firmware_version: str,
    micropython_version: str,
    runtime_source_version: str,
    device_tools_version: str,
    node_packages: dict[str, str],
    runtime_assets_version: str | None = None,
    content_hash: str | None = None,
    git_source: dict | None = None,
) -> None:
    """Append a new entry to the runtime lineage file and persist it."""
    lineage_path = (workspace_root / RUNTIME_LINEAGE_DEFAULT_PATH).resolve()
    if lineage_path.exists():
        lineage_payload = load_runtime_lineage(lineage_path)
    else:
        lineage_payload = default_runtime_lineage_payload()

    entry: dict[str, Any] = {
        "micropythonVersion": micropython_version,
        "runtimeSourceVersion": runtime_source_version,
        "deviceToolsVersion": device_tools_version,
        "nodePackages": node_packages,
        "createdAtUtc": _utc_now_iso(),
    }
    if runtime_assets_version is not None:
        entry["runtimeAssetsVersion"] = runtime_assets_version
    if content_hash is not None:
        entry["contentHash"] = content_hash
    if git_source is not None:
        entry["gitSource"] = git_source

    # If the entry already exists for this target+version the lineage is already
    # correct — skip the write rather than hitting the immutability guard.
    existing = lineage_payload.get("lineage", {}).get(target_key, {}).get(firmware_version)
    if existing is not None:
        return

    add_lineage_entry_for_target(lineage_payload, target_key, firmware_version, entry)
    write_runtime_lineage(lineage_path, lineage_payload)


def _map_failure_to_exit_code(error: Exception) -> tuple[int, dict[str, Any]]:
    if isinstance(error, UnknownPackageIdError):
        return (
            2,
            build_error_object(
                code=error.code,
                category="package-selection",
                message=str(error),
                details={"requested": list(error.requested), "known": list(error.known)},
                hint=error.hint,
            ),
        )

    if isinstance(error, PackageNotStagedError):
        return (
            2,
            build_error_object(
                code=error.code,
                category="package-selection",
                message=str(error),
                details={"packageIds": list(error.package_ids)},
                hint=error.hint,
            ),
        )

    if isinstance(error, VariantUnknownError):
        return (
            2,
            build_error_object(
                code=error.code,
                category="package-selection",
                message=str(error),
                details={
                    "packageId": error.package_id,
                    "variant": error.requested,
                    "known": list(error.known),
                },
                hint=error.hint,
            ),
        )

    if isinstance(error, VariantNotSelectedError):
        return (
            2,
            build_error_object(
                code=error.code,
                category="package-selection",
                message=str(error),
                details={
                    "packageId": error.package_id,
                    "known": list(error.known),
                },
                hint=error.hint,
            ),
        )

    if isinstance(error, VariantCapabilitiesUnsatisfiedError):
        return (
            2,
            build_error_object(
                code=error.code,
                category="package-selection",
                message=str(error),
                details={
                    "packageId": error.package_id,
                    "variant": error.variant,
                    "missing": [list(group) for group in error.missing],
                },
                hint=error.hint,
            ),
        )

    if isinstance(error, VariantPackageNotSelectedError):
        return (
            2,
            build_error_object(
                code=error.code,
                category="package-selection",
                message=str(error),
                details={"packageIds": list(error.package_ids)},
                hint=error.hint,
            ),
        )

    if isinstance(error, MicropythonVersionError):
        return (
            5,
            build_error_object(
                code="MICROPYTHON_CONFIG_ERROR",
                category="micropython-config",
                message=str(error),
            ),
        )

    if isinstance(error, ArtifactVerificationError):
        return (
            8,
            build_error_object(
                code="ARTIFACT_VERIFICATION_ERROR",
                category="artifact-verification",
                message=str(error),
            ),
        )

    if isinstance(error, subprocess.CalledProcessError):
        return (
            7,
            build_error_object(
                code="BUILD_COMMAND_FAILED",
                category="build-command-failed",
                message=str(error),
            ),
        )

    if isinstance(error, OSError):
        return (
            6,
            build_error_object(
                code="TOOLCHAIN_INVOCATION_ERROR",
                category="build-toolchain-invocation",
                message=str(error),
            ),
        )

    if isinstance(error, ValueError):
        message = str(error)
        lowered = message.lower()
        if "modules-path" in lowered or "device-root" in lowered or "build-dir" in lowered:
            return (
                2,
                build_error_object(
                    code="VALIDATION_ERROR",
                    category="input-validation",
                    message=message,
                ),
            )
        return (
            2,
            build_error_object(
                code="VALIDATION_ERROR",
                category="input-validation",
                message=message,
            ),
        )

    if isinstance(error, FileNotFoundError):
        return (
            3,
            build_error_object(
                code="RUNTIME_RESOLUTION_ERROR",
                category="manifest-resolution",
                message=str(error),
            ),
        )

    return (
        9,
        build_error_object(
            code="INTERNAL_ERROR",
            category="unexpected-internal",
            message=str(error),
        ),
    )


def _require_within_root(*, root: Path, candidate: Path, label: str) -> None:
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"{label} must be within {root}") from exc


def _default_micropython_root(workspace_root: Path) -> Path:
    """Return the preferred MicroPython root through the configuration resolver.

    ``SYSTEM_MICROPYTHON_ROOT`` is read from the module globals at call time (never
    captured in a default argument) because tests patch it to simulate a host
    without ``/opt``.
    """

    return resolve_micropython_root(workspace_root, fallback=SYSTEM_MICROPYTHON_ROOT)


def _normalize_package_ids(values: tuple[str, ...] | None) -> tuple[str, ...] | None:
    """Normalize caller-supplied package ids into a stable selection.

    Entries are stripped, blanks dropped, and repeats removed while preserving
    first-seen order. An empty result collapses to ``None`` so "no selection" has
    exactly one representation. Ids are deliberately not validated here: the
    runtime manifest is the authority, which keeps normalization free of device-tree
    I/O so ``--dry-run`` stays cheap.
    """

    if values is None:
        return None

    normalized: list[str] = []
    for value in values:
        if not isinstance(value, str):
            raise ValueError("package-ids must contain package identifiers")
        candidate = value.strip()
        if not candidate or candidate in normalized:
            continue
        normalized.append(candidate)
    return tuple(normalized) if normalized else None


def _normalize_package_variants(
    values: Mapping[str, str] | None,
) -> Mapping[str, str] | None:
    """Normalize caller-supplied package-variant overrides.

    Blank variant ids are dropped and the result collapses to ``None`` when empty so
    "no override" has one representation. Keys are not validated here: the selected
    package ids are the authority, and :func:`resolve_runtime_payload` raises for an
    override that names an unselected or unknown package.
    """

    if values is None:
        return None
    normalized: dict[str, str] = {}
    for key, value in values.items():
        candidate = value.strip() if isinstance(value, str) else ""
        if candidate:
            normalized[key] = candidate
    return normalized or None


def normalize_compile_runtime_request(
    request: CompileRuntimeRequest,
) -> NormalizedCompileRuntimeRequest:
    """Normalize caller input and enforce shared command invariants."""

    runtime_id = request.runtime_id.strip()
    if not runtime_id:
        raise ValueError("runtime-id must not be empty")

    board_input = request.board.strip()
    if not board_input:
        raise ValueError("board must not be empty")

    workspace_root = request.workspace_root.resolve()
    micropython_root = (
        request.micropython_root.resolve()
        if request.micropython_root is not None
        else _default_micropython_root(workspace_root)
    )
    board_target = resolve_board_target(
        name=board_input,
        runtime_id=runtime_id,
        workspace_root=workspace_root,
        micropython_root=micropython_root,
    )
    board = board_target.name
    modules_path = request.modules_path.resolve() if request.modules_path is not None else None
    build_dir = request.build_dir.resolve() if request.build_dir is not None else None
    device_root = (
        request.device_root.resolve()
        if request.device_root is not None
        else (workspace_root / "src" / "micro_otter" / "nodes" / "device")
    )
    addons_root = (
        request.addons_root.resolve() if request.addons_root is not None else None
    )
    embedded_inventory_output = (
        request.embedded_inventory_output.resolve()
        if request.embedded_inventory_output is not None
        else None
    )

    request_id = request.request_id.strip() if request.request_id is not None else None
    if request_id == "":
        request_id = None

    if request.timeout_seconds is not None and request.timeout_seconds <= 0:
        raise ValueError("timeout-seconds must be a positive integer")

    build_profile = normalize_build_profile(
        runtime_id=runtime_id,
        board=board,
        packaging_mode=request.module_packaging_mode,
        optimization_level=request.optimization_level,
        include_all_compatible_packages=True,
    )
    target_resolution = resolve_compile_target_resolution(
        workspace_root=workspace_root,
        runtime_id=runtime_id,
        board=build_profile.board,
    )
    package_ids = _normalize_package_ids(request.package_ids)
    package_variants = _normalize_package_variants(request.package_variants)

    if request.modules_path is not None:
        _require_within_root(
            root=micropython_root,
            candidate=modules_path,
            label="modules-path",
        )

    _require_within_root(root=workspace_root, candidate=device_root, label="device-root")

    if build_dir is not None:
        _require_within_root(root=workspace_root, candidate=build_dir, label="build-dir")

    if embedded_inventory_output is not None:
        _require_within_root(
            root=workspace_root,
            candidate=embedded_inventory_output,
            label="embedded-inventory-output",
        )

    return NormalizedCompileRuntimeRequest(
        runtime_id=runtime_id,
        board=board,
        slug=board_target.slug,
        target=board_target,
        workspace_root=workspace_root,
        micropython_root=micropython_root,
        modules_path=modules_path,
        device_root=device_root,
        addons_root=addons_root,
        build_dir=build_dir,
        clean_staging=request.clean_staging,
        clean_build=request.clean_build,
        build_profile=build_profile,
        target_resolution=target_resolution,
        package_ids=package_ids,
        package_variants=package_variants,
        json_output=request.json_output,
        embedded_inventory_output=embedded_inventory_output,
        verbose=request.verbose,
        request_id=request_id,
        timeout_seconds=request.timeout_seconds,
        dry_run=request.dry_run,
        force_overwrite=request.force_overwrite,
    )


def run_compile_runtime_command(request: CompileRuntimeRequest) -> int:
    """Execute compile-runtime request through package-owned orchestration."""

    return execute_compile_runtime_request(request).exit_code


def _normalize_runtime_semver(value: str | None) -> str:
    if isinstance(value, str) and try_parse_version(value) is not None:
        return value
    import warnings
    warnings.warn(
        f"Runtime version {value!r} is not a valid semver; falling back to '0.0.0'. "
        "Check that the runtime manifest has a valid 'version' field.",
        RuntimeWarning,
        stacklevel=2,
    )
    return "0.0.0"


def _update_latest_versions_registry(
    *,
    normalized: NormalizedCompileRuntimeRequest,
    report_runtime_id: str,
    micropython_version: str,
    runtime_firmware_version: str,
    full_version: str,
    content_hash: str | None = None,
) -> Path:
    registry_path = (normalized.workspace_root / LATEST_VERSIONS_DEFAULT_PATH).resolve()
    if registry_path.exists():
        payload = load_latest_versions(registry_path)
    else:
        payload = default_latest_versions_payload()

    target_key = make_target_key(normalized.slug, report_runtime_id)
    entry: dict[str, Any] = {
        "fullVersion": full_version,
        "micropythonVersion": micropython_version,
        "boardId": normalized.slug,
        "runtimeId": report_runtime_id,
        "runtimeFirmwareVersion": runtime_firmware_version,
        "updatedAtUtc": _utc_now_iso(),
    }
    if content_hash is not None:
        entry["contentHash"] = content_hash
    update_latest_version(payload, target_key, entry)
    write_latest_versions(registry_path, payload)
    return registry_path


def _resolve_pre_build_publish_target(
    normalized: NormalizedCompileRuntimeRequest,
) -> tuple[str, Path] | None:
    """Try to compute the expected firmware publish path before the build runs.

    Returns ``(full_version, publish_path)`` when the version can be resolved
    from static manifest files alone, or ``None`` if any required information is
    not yet available (e.g. MicroPython root not mounted). The identity resolver
    derives the name from the same inputs the publish step will use, so the
    guard reserves exactly the file the build will publish.
    """
    try:
        micropython_version = resolve_micropython_version(normalized.micropython_root)
    except Exception:
        return None

    runtime_manifest_path = (
        normalized.device_root / "runtime" / normalized.runtime_id / "manifest.json"
    )
    try:
        runtime_manifest_payload: dict = json.loads(
            runtime_manifest_path.read_text(encoding="utf-8")
        )
    except (FileNotFoundError, json.JSONDecodeError):
        return None

    try:
        identity = resolve_build_identity(
            request=normalized,
            runtime_payload=runtime_manifest_payload,
            micropython_version=micropython_version,
        )
    except Exception:
        return None

    publish_path = resolve_firmware_publish_root(fallback=SYSTEM_FIRMWARE_PUBLISH_ROOT) / (
        identity.filename
    )
    return identity.full_version, publish_path


def _firmware_version_is_recorded(
    *,
    workspace_root: Path,
    target_key: str,
    full_version: str,
) -> bool:
    """Return whether ``full_version`` has a runtime lineage entry for ``target_key``.

    Publishing is bookkeeping-driven: the runtime lineage is what marks a built
    binary as released. A ``.bin`` whose runtime firmware version never reached the
    lineage is a leftover from a build that was interrupted (or failed) between
    publishing and recording, so it must not be reported as already published —
    replacing it is the only way to recover.

    Returns ``True`` when the version cannot be inspected, which keeps the
    conservative "already published" behavior for unexpected inputs.
    """
    try:
        parsed = parse_full_firmware_version(full_version)
    except ValueError:
        return True

    lineage_path = (workspace_root / RUNTIME_LINEAGE_DEFAULT_PATH).resolve()
    if not lineage_path.exists():
        return False

    try:
        lineage = load_runtime_lineage(lineage_path)
    except ValueError:
        return True

    if not isinstance(lineage, dict):
        return True
    targets = lineage.get("lineage")
    if not isinstance(targets, dict):
        return True
    target_lineage = targets.get(target_key)
    if not isinstance(target_lineage, dict):
        return False
    return parsed.runtime_firmware_version in target_lineage


def execute_compile_runtime_request(
    request: CompileRuntimeRequest,
    *,
    stage_callback: StageCallback | None = None,
    log_callback: LogCallback | None = None,
    cancel_event: threading.Event | None = None,
    timeout_seconds: float | None = None,
) -> CompileRuntimeExecutionResult:
    """Run compile-runtime request and produce contract-ready payload.

    ``stage_callback``, ``log_callback``, ``cancel_event``, and ``timeout_seconds``
    are forwarded verbatim to :func:`run_build_orchestration`, so a server caller
    reuses the CLI's request path (normalization, lineage, publish target, failure
    mapping) and streams the same stages instead of rebuilding a payload. All four
    default to ``None``, which keeps the CLI branch identical.

    ``BuildCancelled`` and ``BuildTimeout`` are re-raised instead of being mapped
    to a payload error, because only the caller knows whether a cancelled or
    timed-out job should answer a result frame or an error frame.
    """

    start_perf = perf_counter()
    started_at = _utc_now_iso()

    try:
        normalized = normalize_compile_runtime_request(request)
    except Exception as error:  # pragma: no cover - covered via mapping behavior tests
        fallback_request = CompileRuntimeRequest(
            runtime_id=request.runtime_id or "unknown",
            board=request.board or "unknown",
            workspace_root=request.workspace_root,
            request_id=request.request_id,
        )
        normalized = normalize_compile_runtime_request(fallback_request)
        exit_code, error_payload = _map_failure_to_exit_code(error)
        payload = _base_payload(normalized)
        payload["build"]["startedAt"] = started_at
        payload["build"]["finishedAt"] = _utc_now_iso()
        payload["build"]["durationMs"] = int((perf_counter() - start_perf) * 1000)
        payload["build"]["exitCode"] = exit_code
        payload["errors"] = [error_payload]
        return CompileRuntimeExecutionResult(exit_code=exit_code, payload=payload)

    payload = _base_payload(normalized)
    payload["build"]["startedAt"] = started_at
    if normalized.modules_path is not None:
        payload["paths"]["modulesPath"] = str(normalized.modules_path)
    payload["metadata"]["modulePackagingMode"] = normalized.build_profile.packaging_mode.value
    payload["metadata"]["buildProfile"] = {
        "runtimeId": normalized.build_profile.runtime_id,
        "board": normalized.build_profile.board,
        "packagingMode": normalized.build_profile.packaging_mode.value,
        "optimizationLevel": normalized.build_profile.optimization_level,
        "includeAllCompatiblePackages": normalized.build_profile.include_all_compatible_packages,
    }
    target_mapping_warning = build_target_mapping_warning(normalized.target_resolution)
    if target_mapping_warning is not None:
        payload["warnings"].append(target_mapping_warning)

    if not normalized.dry_run:
        pre_build_target = _resolve_pre_build_publish_target(normalized)
        if pre_build_target is not None:
            pre_full_version, pre_publish_path = pre_build_target
            if pre_publish_path.exists():
                pre_target_key = make_target_key(normalized.slug, normalized.runtime_id)
                recorded = _firmware_version_is_recorded(
                    workspace_root=normalized.workspace_root,
                    target_key=pre_target_key,
                    full_version=pre_full_version,
                )
                if recorded and not normalized.force_overwrite:
                    exit_code = 9
                    payload["build"]["finishedAt"] = _utc_now_iso()
                    payload["build"]["durationMs"] = int((perf_counter() - start_perf) * 1000)
                    payload["build"]["exitCode"] = exit_code
                    payload["errors"] = [
                        build_error_object(
                            code="FIRMWARE_ALREADY_PUBLISHED",
                            category="firmware-already-published",
                            message=(
                                f"{pre_publish_path.name} already exists; "
                                "re-run with --force-overwrite to rebuild."
                            ),
                            details={
                                "existingPath": str(pre_publish_path),
                                "fullVersion": pre_full_version,
                            },
                        )
                    ]
                    return CompileRuntimeExecutionResult(exit_code=exit_code, payload=payload)

                pre_publish_path.unlink()
                if not recorded:
                    payload["warnings"].append(
                        f"Replaced unrecorded firmware artifact {pre_publish_path.name}: "
                        "no runtime lineage entry exists for this version, so it was treated "
                        "as a leftover from an interrupted build."
                    )

    # Pre-compute the build identity so the constituent versions can be baked into
    # device.json and the publish step reuses the identical tuple.
    _pre_identity = None
    try:
        _pre_upy_version = resolve_micropython_version(normalized.micropython_root)
        _pre_runtime_manifest_path = (
            normalized.device_root / "runtime" / normalized.runtime_id / "manifest.json"
        )
        _pre_runtime_manifest: dict = json.loads(
            _pre_runtime_manifest_path.read_text(encoding="utf-8")
        )
        _pre_identity = resolve_build_identity(
            request=normalized,
            runtime_payload=_pre_runtime_manifest,
            micropython_version=_pre_upy_version,
        )
    except Exception:
        _pre_identity = None  # graceful fallback: bake without version info

    _pre_constituent_versions: ConstituentVersions | None = None
    if _pre_identity is not None:
        _pre_constituent_versions = ConstituentVersions(
            micropython_version=_pre_identity.micropython_version,
            runtime_source_version=_pre_identity.runtime_source_version,
            runtime_firmware_version=_pre_identity.runtime_firmware_version,
            device_tools_version=_pre_identity.device_tools_version,
            node_packages=_pre_identity.packages.merged(),
            runtime_assets_version=_pre_identity.runtime_assets_version,
            addon_packages=dict(_pre_identity.packages.addons),
            package_variants=dict(_pre_identity.package_variants or {}),
            frozen_addons={
                addon_id: {
                    "variant": _pre_identity.package_variants.get(addon_id, "py")
                    if _pre_identity.package_variants
                    else "py",
                    "version": version,
                }
                for addon_id, version in _pre_identity.packages.addons.items()
            },
        )
        payload["warnings"].extend(_pre_identity.warnings)

    try:
        orchestration = run_build_orchestration(
            profile=normalized.build_profile,
            workspace_root=normalized.workspace_root,
            runtime_id=normalized.runtime_id,
            target=normalized.target_resolution.compile_port,
            micropython_root=normalized.micropython_root,
            modules_path=normalized.modules_path,
            device_root=normalized.device_root,
            embedded_inventory_output=normalized.embedded_inventory_output,
            clean_build=normalized.clean_build,
            dry_run=normalized.dry_run,
            package_ids=normalized.package_ids,
            package_variants=normalized.package_variants,
            constituent_versions=_pre_constituent_versions,
            addons_root=normalized.addons_root,
            stage_callback=stage_callback,
            log_callback=log_callback,
            cancel_event=cancel_event,
            timeout_seconds=timeout_seconds,
        )

        payload["build"]["command"] = " ".join(orchestration.plan.command.argv)
        payload["warnings"].extend(orchestration.preflight.warnings)
        payload["metadata"]["precompiledFiles"] = orchestration.precompile.files_compiled
        payload["metadata"]["mpySourcesRemoved"] = orchestration.precompile.sources_removed
        payload["metadata"]["packageIds"] = (
            list(normalized.package_ids) if normalized.package_ids else None
        )
        payload["metadata"]["packageVariants"] = (
            dict(_pre_identity.package_variants or {})
            if _pre_identity is not None
            else (dict(normalized.package_variants) if normalized.package_variants else None)
        )
        if normalized.package_variants:
            payload["metadata"]["requestedPackageVariants"] = dict(
                normalized.package_variants
            )
        payload["metadata"]["packageProvenance"] = _package_provenance_payload(
            normalized.device_root, normalized.addons_root
        )
        if orchestration.precompile.compiler_path is not None:
            payload["metadata"]["mpyCrossPath"] = str(orchestration.precompile.compiler_path)
        report = orchestration.staging_report
    except (BuildCancelled, BuildTimeout):
        raise
    except Exception as error:
        exit_code, error_payload = _map_failure_to_exit_code(error)
        if isinstance(error, subprocess.CalledProcessError):
            if isinstance(error.cmd, list | tuple):
                payload["build"]["command"] = " ".join(str(part) for part in error.cmd)
            else:
                payload["build"]["command"] = str(error.cmd)
        payload["build"]["finishedAt"] = _utc_now_iso()
        payload["build"]["durationMs"] = int((perf_counter() - start_perf) * 1000)
        payload["build"]["exitCode"] = exit_code
        payload["errors"] = [error_payload]
        return CompileRuntimeExecutionResult(exit_code=exit_code, payload=payload)

    payload["runtime"]["id"] = report.runtime_id
    payload["runtime"]["version"] = report.runtime_version or "unknown"
    payload["paths"]["modulesPath"] = str(report.modules_path)
    payload["staging"]["filesDiscovered"] = report.files_discovered
    payload["staging"]["filesCopied"] = report.files_copied
    payload["staging"]["staticAssetFilesEmbedded"] = report.static_asset_files_embedded
    payload["staging"]["staticAssetRawBytes"] = report.static_asset_raw_bytes
    payload["staging"]["staticAssetCompressedBytes"] = report.static_asset_compressed_bytes
    payload["staging"]["conflicts"] = [
        {
            "targetRelPath": conflict.target_rel_path,
            "firstSource": str(conflict.first_source),
            "secondSource": str(conflict.second_source),
            "reason": conflict.reason,
        }
        for conflict in report.conflicts
    ]

    if normalized.verbose:
        payload["staging"]["detailedFiles"] = [
            {
                "origin": "summary",
                "targetRelPath": "*",
                "count": report.files_discovered,
            }
        ]

    if report.embedded_manifest_path is not None:
        payload["staging"]["embeddedInventoryPath"] = str(report.embedded_manifest_path)
        if report.embedded_manifest_path.exists():
            digest = hashlib.sha256(report.embedded_manifest_path.read_bytes()).hexdigest()
            payload["staging"]["embeddedInventoryHash"] = (
                f"sha256:{digest}"
            )

    if report.conflicts:
        exit_code = 4
        payload["status"] = "failed"
        payload["errors"] = [
            build_error_object(
                code="STAGING_CONFLICT",
                category="staging-conflict",
                message="Conflicting staged target paths detected",
                details={"conflictCount": len(report.conflicts)},
            )
        ]
    else:
        exit_code = 0
        payload["status"] = "success"

    payload["build"]["finishedAt"] = _utc_now_iso()
    payload["build"]["durationMs"] = int((perf_counter() - start_perf) * 1000)
    payload["build"]["exitCode"] = orchestration.build_exit_code

    published_record: Any | None = None
    try:
        artifact_path = orchestration.artifact_path
        artifact = (
            FirmwareArtifactRecord(path=artifact_path, board=normalized.board)
            if artifact_path is not None
            else None
        )

        should_require_artifact = (
            exit_code == 0 and not normalized.dry_run and not report.conflicts
        )
        if should_require_artifact and artifact is None:
            raise ArtifactVerificationError(
                "Firmware artifact not found after successful build command"
            )

        if artifact is not None:
            verified = verify_firmware_artifact(artifact)
            payload["paths"]["firmwareArtifact"] = str(verified.path)
            payload["metadata"]["firmwareArtifactSizeBytes"] = verified.size_bytes
            payload["metadata"]["firmwareArtifactHash"] = verified.sha256

            micropython_version = resolve_micropython_version(normalized.micropython_root)
            runtime_manifest_path = (
                normalized.device_root / "runtime" / report.runtime_id / "manifest.json"
            )
            runtime_manifest_payload: dict = {}
            try:
                runtime_manifest_payload = json.loads(
                    runtime_manifest_path.read_text(encoding="utf-8")
                )
            except (FileNotFoundError, json.JSONDecodeError):
                pass

            identity = resolve_build_identity(
                request=normalized,
                runtime_payload=runtime_manifest_payload,
                micropython_version=micropython_version,
                staged_runtime_assets_version=report.runtime_assets_version,
            )
            payload["warnings"].extend(identity.warnings)

            runtime_source_version = identity.runtime_source_version
            runtime_firmware_version = identity.runtime_firmware_version
            constituents = dict(identity.constituents)
            embedded_packages = identity.packages.builtin
            addon_packages = dict(identity.packages.addons)
            content_hash = identity.content_hash
            full_version = identity.full_version
            payload["metadata"]["runtimeFirmwareVersion"] = runtime_firmware_version
            payload["metadata"]["fullVersion"] = full_version
            payload["metadata"]["contentHash"] = content_hash
            payload["metadata"]["packageVariants"] = dict(identity.package_variants or {})
            payload["metadata"]["versionSource"] = identity.version_source
            payload["metadata"]["gitSource"] = {
                "commit": identity.commit,
                "distance": identity.distance,
                "branch": identity.branch,
                "tag": identity.tag,
                "shallow": identity.shallow,
            }

            manifest = build_firmware_manifest(
                backend=normalized.target.build_backend,
                board=normalized.target.name,
                slug=normalized.slug,
                platform_version=micropython_version,
                runtime_id=report.runtime_id,
                runtime_version=runtime_source_version,
                runtime_firmware_version=runtime_firmware_version,
                content_hash=content_hash,
                constituents=constituents,
                embedded_packages=embedded_packages,
                addon_packages=addon_packages,
                selection=identity.selection,
                base_version=identity.base_version,
                channel=identity.channel,
                version_source=identity.version_source,
                not_embedded=(),
                module_packaging_mode=normalized.build_profile.packaging_mode.value,
                optimization_level=normalized.build_profile.optimization_level,
                file_hashes=_embedded_file_hashes(report),
                git_source=report.git_source,
                finished_at=payload["build"]["finishedAt"],
                package_variants=dict(identity.package_variants or {}),
            )

            if not normalized.dry_run and exit_code == 0:
                published = publish_firmware_artifact(
                    artifact=verified,
                    publish_root=resolve_firmware_publish_root(
                        fallback=SYSTEM_FIRMWARE_PUBLISH_ROOT
                    ),
                    filename=identity.filename.replace(".bin", verified.path.suffix),
                    manifest=manifest,
                )
                published_record = published
                payload["paths"]["firmwarePublishedArtifact"] = str(published.path)
                payload["metadata"]["firmwarePublishStatus"] = (
                    "published" if published.created else "already-present"
                )

                if published.created:
                    history_path = append_firmware_history(
                        publish_root=resolve_firmware_publish_root(
                            fallback=SYSTEM_FIRMWARE_PUBLISH_ROOT
                        ),
                        record={
                            "version": runtime_firmware_version,
                            "baseVersion": identity.base_version,
                            "channel": identity.channel,
                            "versionSource": identity.version_source,
                            "contentHash": content_hash,
                            "boardId": normalized.slug,
                            "slug": normalized.slug,
                            "runtimeId": report.runtime_id,
                            "micropythonVersion": micropython_version,
                            "constituents": constituents,
                            "embeddedPackages": dict(embedded_packages),
                            "addonPackages": addon_packages,
                            "packageVariants": dict(identity.package_variants or {}),
                            "selection": dict(identity.selection),
                            "gitSource": {
                                "commit": identity.commit,
                                "distance": identity.distance,
                                "branch": identity.branch,
                                "tag": identity.tag,
                                "shallow": identity.shallow,
                            },
                            "builtAtUtc": payload["build"]["finishedAt"],
                            "image": published.path.name,
                        },
                    )
                    payload["paths"]["firmwareHistory"] = str(history_path)
            else:
                payload["metadata"]["firmwarePublishStatus"] = "skipped"
    except Exception as error:
        if published_record is not None and getattr(published_record, "created", False):
            # Recording the version in the lineage happens after publication; when that
            # bookkeeping fails, drop the fresh artifact so the next run does not trip
            # over an unrecorded ``.bin``.
            recorded_full_version = payload.get("metadata", {}).get("fullVersion")
            if not _firmware_version_is_recorded(
                workspace_root=normalized.workspace_root,
                target_key=make_target_key(normalized.slug, normalized.runtime_id),
                full_version=(
                    recorded_full_version if isinstance(recorded_full_version, str) else ""
                ),
            ):
                try:
                    published_record.path.unlink()
                except OSError:
                    pass
        mapped_exit_code, error_payload = _map_failure_to_exit_code(error)
        payload["status"] = "failed"
        payload["errors"] = [error_payload]
        payload["build"]["exitCode"] = orchestration.build_exit_code
        return CompileRuntimeExecutionResult(exit_code=mapped_exit_code, payload=payload)

    return CompileRuntimeExecutionResult(exit_code=exit_code, payload=payload)


def render_result_json(result: CompileRuntimeExecutionResult) -> str:
    """Render compact JSON output for CLI --json-output mode."""

    return json.dumps(result.payload, separators=(",", ":"), ensure_ascii=True)

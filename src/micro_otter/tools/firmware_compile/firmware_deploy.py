"""Headless firmware deploy helper: one image, one board, one port.

This module flashes a finished firmware image. It never builds, never stages,
and never uploads node-package source: a deploy carries an image path only, so
the collection-deploy source fallback stays entirely inside the web app.

The helper is a thin orchestration layer over the :mod:`...flash` seam. It adds
image resolution, one structured error family, and a report object; the actual
``esptool`` invocation belongs to the flash backend adapter, so no tool argv is
duplicated here. Everything is synchronous because the flash seam is
synchronous — the server runs this in a worker thread.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .backends.base import StreamCallback
from .board_registry import BoardSpec
from .build_artifact import (
    ArtifactVerificationError,
    FirmwareArtifactRecord,
    verify_firmware_artifact,
)
from .compile_command import build_error_object
from .flash import (
    FlashBackend,
    FlashBackendError,
    FlashRequest,
    select_flash_backend_for_board,
)
from .local_firmware import parse_firmware_filename, resolve_publish_root
from .process_stream import LogCallback
from .version_identity import firmware_version_sort_key
from .version_semver import channel_of

__all__ = [
    "FLASH_ERROR_CODES",
    "FirmwareBoardUnsupportedError",
    "FirmwareDeployError",
    "FirmwareDeployReport",
    "FirmwareDeployRequest",
    "FirmwareImageInvalidError",
    "FirmwareImageUnavailableError",
    "build_deploy_payload",
    "flash_firmware",
    "resolve_firmware_image",
    "resolve_latest_firmware_for_board",
]

FLASH_ERROR_CODES: tuple[str, ...] = (
    "flash-backend",
    "flash-error",
    "flash-firmware-image-not-found",
    "flash-tool-missing",
    "flash-monitor-not-supported",
    "flash-command",
    "flash-backend-unavailable",
    "flash-unsupported-chip",
    "flash-no-available-backend",
    "flash-unknown-backend",
)
"""Every code :func:`_flash_error_code` can derive from one adapter exception.

Listed explicitly so the protocol document and the invariant test in iteration-3
phase 6 can assert set equality instead of re-deriving the naming rule.
"""

_CAMEL_WORD_RE = re.compile(r"(?<!^)(?=[A-Z])")
"""Split a ``CamelCase`` class name into words."""

_FLASH_ERROR_DETAIL_FIELDS = (
    "backend_id",
    "tool",
    "chip",
    "returncode",
    "detail",
    "supported_chips",
    "known_backend_ids",
    "considered_backend_ids",
)
"""Structured attributes a flash backend error may expose to a payload."""


class FirmwareDeployError(ValueError):
    """Structured firmware deploy failure with a stable code and exit category.

    The attributes mirror the ``code``/``category``/``message``/``details``/
    ``hint`` shape :func:`...compile_command.build_error_object` emits, so the CLI
    and the server can serialise a deploy failure without re-deriving categories.
    ``code`` and ``exit_code`` may be overridden per instance, which is how a
    flash backend failure keeps its own ``flash-*`` identity.
    """

    code: str = "firmware-deploy-failed"
    """Stable machine-readable failure code."""

    category: str = "deploy"
    """Coarse failure category shared with the compile payloads."""

    exit_code: int = 1
    """Process exit code the CLI maps for this failure."""

    def __init__(
        self,
        message: str,
        *,
        hint: str | None = None,
        details: Mapping[str, object] | None = None,
        code: str | None = None,
        exit_code: int | None = None,
    ) -> None:
        """Record the message plus the optional hint, details, and code overrides."""

        super().__init__(message)
        self.message = message
        self.hint = hint
        self.details = dict(details) if details is not None else None
        if code is not None:
            self.code = code
        if exit_code is not None:
            self.exit_code = exit_code


class FirmwareImageUnavailableError(FirmwareDeployError):
    """Raised when the local inventory holds no image for the requested board."""

    code = "firmware-image-unavailable"
    exit_code = 3


class FirmwareImageInvalidError(FirmwareDeployError):
    """Raised when the image is missing, empty, or otherwise unverifiable."""

    code = "firmware-image-invalid"
    exit_code = 3


class FirmwareBoardUnsupportedError(FirmwareDeployError):
    """Raised when a board carries no flashable chip in the catalog."""

    code = "board-not-flashable"
    exit_code = 2


@dataclass(frozen=True)
class FirmwareDeployRequest:
    """Normalized inputs for one headless firmware deploy.

    This dataclass *is* the normalized form, so no separate normalizer exists;
    callers build it directly. ``monitor`` is deliberately absent: monitoring is
    a build-directory feature (``MonitorNotSupportedError`` already encodes that
    rule), so the helper rejects it by construction instead of carrying a flag it
    can never honour. The request also carries no package or source-upload
    fields, mirroring the documented :class:`...flash.base.FlashRequest`
    invariant.
    """

    board_spec: BoardSpec
    port: str
    firmware_path: Path
    backend_id: str | None = None
    wipe_filesystem: bool = False
    timeout_seconds: float | None = None
    log_callback: LogCallback | None = None


@dataclass(frozen=True)
class FirmwareDeployReport:
    """Structured outcome of one headless firmware deploy.

    A non-zero ``exit_code`` is a completed-but-failed flash (the backend
    reported it, the image is still what was written). Nothing in the helper
    raises for it, because the CLI wants the code and the server wants to send a
    failed-but-terminal result frame.
    """

    exit_code: int
    board_id: str
    port: str
    backend_id: str
    firmware_path: Path
    size_bytes: int
    sha256: str
    message: str | None = None


def resolve_latest_firmware_for_board(
    *,
    board_id: str,
    runtime_id: str | None = None,
    content_hash: str | None = None,
    channel: str | None = None,
    publish_root: Path | None = None,
) -> Path | None:
    """Return the newest published image for ``board_id``, or ``None``.

    ``content_hash``, when given, narrows the result to the exact content
    combination recorded in the filename. ``channel`` narrows to that channel
    (``release`` / ``dev``); ``None`` keeps the newest-across-channels behaviour.
    The folder comes from :func:`...local_firmware.resolve_publish_root`, so
    ``MICRO_OTTER_FIRMWARE_DIR`` and ``micro-otter.toml`` keep working. This is a
    pure filesystem read: no device access, no subprocess.
    """

    root = resolve_publish_root(publish_root)
    if not root.is_dir():
        return None

    normalized_board = board_id.strip().lower()
    candidates: list[tuple[tuple[int, int, int, int, str], Path]] = []
    for path in sorted(root.iterdir()):
        if not path.is_file() or path.suffix != ".bin":
            continue
        entry = parse_firmware_filename(path.name)
        if entry is None or entry.board_id != normalized_board:
            continue
        if runtime_id is not None and entry.runtime_id != runtime_id:
            continue
        if content_hash is not None and entry.content_hash != content_hash:
            continue
        if channel is not None and channel_of(entry.runtime_firmware_version) != channel:
            continue
        candidates.append((firmware_version_sort_key(entry.runtime_firmware_version), path))

    if not candidates:
        return None
    return max(candidates, key=lambda candidate: candidate[0])[1]


def resolve_firmware_image(
    *,
    board_spec: BoardSpec,
    firmware_path: Path | None = None,
    runtime_id: str | None = None,
    channel: str | None = None,
    publish_root: Path | None = None,
) -> Path:
    """Return the image to flash, preferring an explicit path over the inventory.

    An explicit ``firmware_path`` always wins. Otherwise the newest published image
    for the board (optionally narrowed to one runtime and/or channel) is used, and
    when nothing matches the call raises :class:`FirmwareImageUnavailableError` with
    the search coordinates and a hint naming both the build command and the
    inventory override.
    """

    if firmware_path is not None:
        return Path(firmware_path).resolve()

    resolved = resolve_latest_firmware_for_board(
        board_id=board_spec.slug,
        runtime_id=runtime_id,
        channel=channel,
        publish_root=publish_root,
    )
    if resolved is not None:
        return resolved

    root = resolve_publish_root(publish_root)
    details: dict[str, object] = {
        "boardId": board_spec.slug,
        "runtimeId": runtime_id,
        "publishRoot": str(root),
    }
    if channel is not None:
        details["channel"] = channel
    raise FirmwareImageUnavailableError(
        f"No firmware image found for board {board_spec.slug!r} in {root}",
        hint=(
            "Build and publish an image with 'mo cr', or point "
            "MICRO_OTTER_FIRMWARE_DIR at the folder holding published .bin files."
        ),
        details=details,
    )


def _flash_error_code(error: FlashBackendError) -> str:
    """Return the stable ``flash-*`` code for one backend error.

    The class name is split on camel-case, the trailing ``Error`` and the
    redundant ``flash`` token are dropped, and a single ``flash-`` prefix is
    added::

        FlashToolMissingError      -> flash-tool-missing
        FlashCommandError          -> flash-command
        UnsupportedFlashChipError  -> flash-unsupported-chip
        UnknownFlashBackendError   -> flash-unknown-backend
    """

    name = type(error).__name__
    if name.endswith("Error"):
        name = name[: -len("Error")]
    words = [word.lower() for word in _CAMEL_WORD_RE.split(name) if word]
    remaining = [word for word in words if word != "flash"]
    return "-".join(["flash", *remaining]) if remaining else "flash-error"


def _flash_error_details(error: FlashBackendError) -> dict[str, object] | None:
    """Return the documented structured attributes ``error`` exposes, if any.

    Only the fields named in ``_FLASH_ERROR_DETAIL_FIELDS`` are copied, so an
    adapter cannot leak arbitrary object state into a payload a client reads.
    """

    details: dict[str, object] = {}
    for field_name in _FLASH_ERROR_DETAIL_FIELDS:
        value = getattr(error, field_name, None)
        if value is None:
            continue
        details[field_name] = list(value) if isinstance(value, tuple | list) else value
    return details or None


def _wrap_flash_error(error: FlashBackendError) -> FirmwareDeployError:
    """Wrap a backend failure in the deploy error family, keeping the cause.

    The wrapper keeps the backend's own ``exit_code`` and derives a ``flash-*``
    code from the adapter exception class, so callers only ever handle one
    exception family while a traceback still shows the adapter that failed.
    """

    return FirmwareDeployError(
        str(error) or type(error).__name__,
        details=_flash_error_details(error),
        code=_flash_error_code(error),
        exit_code=getattr(error, "exit_code", 1),
    )


def _verify_image(path: Path, *, board_id: str) -> FirmwareArtifactRecord:
    """Verify ``path`` and return its size/hash record.

    Verification stays in :func:`...build_artifact.verify_firmware_artifact` so the
    empty-file and missing-file rules have exactly one implementation.
    """

    try:
        return verify_firmware_artifact(FirmwareArtifactRecord(path=path, board=board_id))
    except ArtifactVerificationError as error:
        raise FirmwareImageInvalidError(str(error), details={"path": str(path)}) from error


def _select_backend(
    request: FirmwareDeployRequest,
    *,
    environ: Mapping[str, str] | None,
) -> FlashBackend:
    """Return the flash backend for ``request``, mapping registry failures.

    Selection precedence (requested → ``MICRO_OTTER_FLASH_BACKEND`` → board
    default → auto) is owned by :func:`...flash.select_flash_backend_for_board`;
    the helper only translates the failure into its own error family.
    """

    try:
        return select_flash_backend_for_board(
            request.board_spec,
            requested=request.backend_id,
            environ=environ,
        )
    except FlashBackendError as error:
        raise _wrap_flash_error(error) from error


def flash_firmware(
    request: FirmwareDeployRequest,
    *,
    on_event: StreamCallback | None = None,
    environ: Mapping[str, str] | None = None,
) -> FirmwareDeployReport:
    """Flash the image in ``request`` and report the outcome.

    The steps are: verify the image, reject an unflashable board, select the
    backend, then delegate to ``backend.flash``. ``on_event`` is forwarded
    verbatim — the same ``FlashEventKind`` values reach the CLI and the server, so
    nothing here renames, buffers, or filters events.

    A non-zero ``FlashResult.exit_code`` is reported, never raised: the CLI needs
    the process exit code, and the server sends a failed-but-terminal result frame
    instead of an error frame. Only unrecoverable setup problems raise
    :class:`FirmwareDeployError`.

    Everything stays synchronous. The server runs this in a worker thread, which
    keeps the seam free of event-loop concerns, matching ``FlashBackend``'s
    documented synchronous contract.
    """

    image_path = Path(request.firmware_path).resolve()
    board_id = request.board_spec.name
    verified = _verify_image(image_path, board_id=board_id)

    if not request.board_spec.chip.strip():
        raise FirmwareBoardUnsupportedError(
            f"Board {board_id!r} has no flashable chip in the catalog",
            details={"boardId": board_id},
        )

    backend = _select_backend(request, environ=environ)
    flash_request = FlashRequest(
        board_spec=request.board_spec,
        port=request.port,
        firmware_path=image_path,
        wipe_filesystem=request.wipe_filesystem,
        timeout_seconds=request.timeout_seconds,
        monitor=False,
        log_callback=request.log_callback,
    )

    try:
        result = backend.flash(flash_request, on_event)
    except FlashBackendError as error:
        raise _wrap_flash_error(error) from error

    return FirmwareDeployReport(
        exit_code=result.exit_code,
        board_id=board_id,
        port=result.port,
        backend_id=result.backend_id,
        firmware_path=Path(result.firmware_path).resolve(),
        size_bytes=verified.size_bytes or 0,
        sha256=verified.sha256 or "",
        message=result.message,
    )


def build_deploy_payload(
    outcome: FirmwareDeployReport | FirmwareDeployError,
    *,
    request: FirmwareDeployRequest | None = None,
) -> dict[str, Any]:
    """Serialize one deploy ``outcome`` into the shared deploy payload.

    This is the only serializer for the deploy surface: the CLI prints exactly
    what the server sends, so a client cannot see a different shape depending on
    which entry point produced it. ``request`` supplies the board, port, backend,
    and image coordinates that a failure cannot carry on its own. Unknown
    hardware detail is reported as ``null``, and ``warnings`` stays empty because
    the deploy path has no advisory findings today.
    """

    report = outcome if isinstance(outcome, FirmwareDeployReport) else None
    error = outcome if isinstance(outcome, FirmwareDeployError) else None
    exit_code = outcome.exit_code

    board_id = report.board_id if report is not None else None
    if board_id is None and request is not None:
        board_id = request.board_spec.name
    chip = request.board_spec.chip if request is not None else None
    port = report.port if report is not None else None
    if port is None and request is not None:
        port = request.port
    backend_id = report.backend_id if report is not None else None
    if backend_id is None and error is not None and error.details is not None:
        reported_backend = error.details.get("backend_id")
        backend_id = reported_backend if isinstance(reported_backend, str) else None
    if backend_id is None and request is not None:
        backend_id = request.backend_id

    firmware_path = report.firmware_path if report is not None else None
    if firmware_path is None and request is not None:
        firmware_path = request.firmware_path

    errors: list[dict[str, Any]] = []
    if error is not None:
        errors.append(
            build_error_object(
                code=error.code,
                category=error.category,
                message=error.message,
                details=error.details,
                hint=error.hint,
            )
        )

    return {
        "schemaVersion": 1,
        "status": "succeeded" if exit_code == 0 else "failed",
        "board": {"id": board_id, "chip": chip},
        "port": port,
        "backend": backend_id,
        "firmware": {
            "path": str(firmware_path) if firmware_path is not None else None,
            "sizeBytes": report.size_bytes if report is not None else None,
            "sha256": report.sha256 if report is not None else None,
        },
        "exitCode": exit_code,
        "errors": errors,
        "warnings": [],
    }

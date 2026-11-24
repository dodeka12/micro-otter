# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
"""``WS /firmware`` job endpoint: frame contract, validation, and job runner.

One connection drives one job at a time: a compile, a deploy, a read-only
local-package scan, a firmware-inventory list/delete, a firmware-package import, or
an add-on package install/uninstall. Besides jobs, the same connection answers an
``fs.list`` read-only side channel on the read loop (never as a job), so a file
picker can browse the server's filesystem while a job holds the job slot. The
endpoint streams the stages and output lines of that job, honours a ``cancel``
frame, enforces a timeout, rejects a second concurrent job, and reports every
failure as a stable ``code`` + ``hint`` + ``details`` error frame. The frame table
itself lives in ``docs/dev/firmware-compile/firmware-build-websocket-protocol.md``;
this module is its implementation.

Fixed boundaries, in the order the module enforces them:

- A job never touches node-package *source* upload. ``compile.start`` returns a
  firmware artifact and nothing else, and ``packageIds`` narrows what an image
  embeds — the editor's ``runtime-deployment.ts`` path still decides
  ``missing`` / ``override-required`` uploads independently.
- The server's compile/deploy enablement answers *whether* a job is accepted. It
  never gates, delays, or reorders a source upload.
- Frame ``type`` values are the ones the parent contract already defines; this
  module only adds fields.
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Self

from websockets.exceptions import ConnectionClosed

from micro_otter.config import Config, clear_config_cache, load_config
from micro_otter.tools.addon_archive import (
    MAX_ARCHIVE_BYTES,
    AddonInstallError,
    install_addon,
    uninstall_addon,
)
from micro_otter.tools.addon_store import addon_inventory_payload, builtin_package_ids
from micro_otter.tools.archive_source import (
    ARCHIVE_SOURCE_ERROR_CODES,
    ArchiveSourceError,
    resolve_archive_source,
)
from micro_otter.tools.firmware_compile import (
    BuildCancelled,
    BuildTimeout,
    CompileRuntimeRequest,
    FirmwareDeployError,
    FirmwareDeployRequest,
    FirmwareInventoryError,
    FirmwarePackageError,
    LocalPackageScanError,
    WebBaseTargetNoMappingError,
    WebBaseTargetUnknownError,
    WebTargetUnknownError,
    build_deploy_payload,
    build_error_object,
    build_firmware_inventory_payload,
    build_package_scan_payload,
    delete_firmware_entry,
    discover_firmware_artifact,
    execute_compile_runtime_request,
    export_firmware_package_to_directory,
    flash_firmware,
    import_firmware_binary,
    import_firmware_package,
    latest_firmware_ids,
    latest_firmware_ids_by_channel,
    list_firmware_inventory,
    resolve_firmware_image,
    resolve_inventory_image,
    resolve_publish_root,
    resolve_web_target,
    scan_local_packages,
)
from micro_otter.tools.firmware_compile.backends import BuildEvent
from micro_otter.tools.firmware_compile.board_registry import (
    BOARD_CATALOG_DEFAULT_PATH,
    BoardCatalogError,
    BoardSpec,
    find_board,
    load_board_catalog,
)
from micro_otter.tools.firmware_compile.firmware_deploy import FLASH_ERROR_CODES
from micro_otter.tools.firmware_compile.firmware_package import MAX_PACKAGE_BYTES
from micro_otter.tools.firmware_compile.imported_firmware import (
    CODE_IMPORT_INVALID,
    MAX_IMPORTED_BINARY_BYTES,
    ImportedFirmwareError,
)
from micro_otter.tools.local_files import (
    CODE_FS_NOT_ALLOWED,
    LOCAL_FILE_ERROR_CODES,
    LocalFileError,
    default_start_directory,
    known_roots,
    list_directory,
    validate_destination_directory,
)

from .server_capabilities import (
    FEATURE_FIRMWARE_COMPILE,
    FEATURE_FIRMWARE_DEPLOY,
    FEATURE_LOCAL_FILE_ACCESS,
    build_server_capabilities,
)

__all__ = [
    "ADDON_ERROR_CODES",
    "ERROR_CODES",
    "FIRMWARE_PATH",
    "FirmwareFrameError",
    "FirmwareJobRunner",
    "build_error_frame",
    "build_fs_list_error",
    "build_fs_list_result",
    "build_output_frame",
    "build_result_frame",
    "build_status_frame",
    "parse_client_frame",
]

FIRMWARE_PATH = "/firmware"
"""WebSocket path of the firmware job endpoint (sibling of ``/serial``)."""

DEFAULT_JOB_TIMEOUT_SECONDS = 900.0
"""Default per-job timeout when a frame does not carry ``timeoutSeconds``."""

_TIMEOUT_BACKSTOP_SECONDS = 30.0
"""Extra wait before the async backstop gives up on a wedged worker thread."""

COMPILE_FRAME = "compile.start"
DEPLOY_FRAME = "deploy.start"
SCAN_FRAME = "scan-local"
LIST_FRAME = "firmware.list"
DELETE_FRAME = "firmware.delete"
IMPORT_FRAME = "firmware.import"
IMPORT_BINARY_FRAME = "firmware.import-binary"
EXPORT_FRAME = "firmware.export"
ADDON_INSTALL_FRAME = "addon.install"
"""Install one add-on package archive into ``Config.addons_dir``."""

ADDON_UNINSTALL_FRAME = "addon.uninstall"
"""Remove installed add-on packages from ``Config.addons_dir``."""

CANCEL_FRAME = "cancel"

FS_LIST_FRAME = "fs.list"
FS_LIST_RESULT_FRAME = "fs.list.result"
FS_LIST_ERROR_FRAME = "fs.list.error"

JobKind = Literal[
    "compile",
    "deploy",
    "scan",
    "list",
    "delete",
    "import",
    "export",
    "addon-install",
    "addon-uninstall",
]
"""The things one connection may ask for."""

CODE_INVALID_FRAME = "invalid-frame"
CODE_UNKNOWN_FRAME_TYPE = "unknown-frame-type"
CODE_JOB_BUSY = "job-busy"
CODE_COMPILE_DISABLED = "compile-disabled"
CODE_DEPLOY_DISABLED = "deploy-disabled"
CODE_RUNTIME_NOT_FOUND = "runtime-not-found"
CODE_BOARD_UNKNOWN = "board-unknown"
CODE_TARGET_UNKNOWN = "target-unknown"
CODE_BASE_TARGET_UNKNOWN = "base-target-unknown"
CODE_BASE_NO_MAPPING = "base-no-mapping"
CODE_BUILD_TIMEOUT = "build-timeout"
CODE_INTERNAL_ERROR = "internal-error"
CODE_UNKNOWN_PACKAGE_ID = "unknown-package-id"
CODE_PACKAGE_NOT_STAGED = "package-not-staged"
CODE_FIRMWARE_NOT_FOUND = "firmware-not-found"
CODE_FIRMWARE_PATH_INVALID = "firmware-path-invalid"

ADDON_ERROR_CODES: tuple[str, ...] = (
    "addon-already-installed",
    "addon-archive-invalid",
    "addon-archive-no-manifest",
    "addon-archive-not-found",
    "addon-archive-symlink",
    "addon-archive-too-large",
    "addon-archive-too-many-entries",
    "addon-archive-unpacked-too-large",
    "addon-archive-unsafe-path",
    "addon-id-conflicts-builtin",
    "addon-id-invalid",
    "addon-id-mismatch",
    "addon-manifest-forbidden-asset",
    "addon-manifest-invalid",
    "addon-manifest-missing-asset",
    "addon-manifest-missing-version",
    "addon-module-root-invalid",
    "addon-not-installed",
    "addon-variant-capabilities-missing",
    "addon-variant-hardware-missing",
    "addon-variant-manifest-invalid",
    "addon-variant-precedence-duplicate",
)
"""Every stable code :class:`...addon_archive.AddonInstallError` can raise.

The add-on jobs answer with these verbatim, so the CLI exit message, the
``--json-output`` payload, and the tab's translated sentence all name one code.
"""

ERROR_CODES: tuple[str, ...] = (
    CODE_INVALID_FRAME,
    CODE_UNKNOWN_FRAME_TYPE,
    CODE_JOB_BUSY,
    CODE_COMPILE_DISABLED,
    CODE_DEPLOY_DISABLED,
    CODE_RUNTIME_NOT_FOUND,
    CODE_BOARD_UNKNOWN,
    CODE_TARGET_UNKNOWN,
    CODE_BASE_TARGET_UNKNOWN,
    CODE_BASE_NO_MAPPING,
    CODE_BUILD_TIMEOUT,
    CODE_INTERNAL_ERROR,
    CODE_UNKNOWN_PACKAGE_ID,
    CODE_PACKAGE_NOT_STAGED,
    CODE_FIRMWARE_NOT_FOUND,
    CODE_FIRMWARE_PATH_INVALID,
    "firmware-package-invalid",
    "firmware-package-identity-mismatch",
    "firmware-package-checksum-mismatch",
    "firmware-package-too-large",
    "firmware-import-exists",
    "firmware-import-denied",
    CODE_IMPORT_INVALID,
    "firmware-export-exists",
    "firmware-image-unavailable",
    "firmware-image-invalid",
    "board-not-flashable",
    "runtime-manifest-invalid",
    *ARCHIVE_SOURCE_ERROR_CODES,
    *LOCAL_FILE_ERROR_CODES,
    *FLASH_ERROR_CODES,
    *ADDON_ERROR_CODES,
)
"""Every ``error.code`` this endpoint can emit.

Four source modules contribute their own code families verbatim:
``firmware_deploy.py`` (:data:`FLASH_ERROR_CODES`), ``addon_archive.py``
(:data:`ADDON_ERROR_CODES`), ``archive_source.py``
(:data:`ARCHIVE_SOURCE_ERROR_CODES`), and ``local_files.py``
(:data:`LOCAL_FILE_ERROR_CODES`), so a helper can never invent a code this endpoint
does not advertise. The protocol document lists the same set;
``tests/test_firmware_contract_invariants.py`` asserts equality so neither side can
drift silently.
"""

_LOGGER = logging.getLogger(__name__)

_LOG_STREAM_STDOUT = "stdout"
_LOG_STREAM_STDERR = "stderr"


class FirmwareFrameError(RuntimeError):
    """A client frame that cannot be turned into a request.

    ``code`` is one of the stable codes in :data:`ERROR_CODES`; ``details`` names
    the offending field so a client can highlight it without parsing the message.
    """

    def __init__(
        self,
        message: str,
        *,
        code: str = CODE_INVALID_FRAME,
        hint: str | None = None,
        details: Mapping[str, object] | None = None,
    ) -> None:
        """Record the message plus the code, hint, and structured details."""

        super().__init__(message)
        self.code = code
        self.hint = hint
        self.details = dict(details) if details is not None else None


def _field_error(field: str, expected: str) -> FirmwareFrameError:
    """Return the ``invalid-frame`` error for a missing or mistyped *field*."""

    return FirmwareFrameError(
        f"field {field!r} must be {expected}",
        details={"field": field},
    )


def _require_str(payload: Mapping[str, object], field: str) -> str:
    """Return a non-empty string *field* or raise ``invalid-frame``."""

    value = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        raise _field_error(field, "a non-empty string")
    return value.strip()


def _optional_str(payload: Mapping[str, object], field: str) -> str | None:
    """Return an optional string *field*, ``None`` when absent, or raise."""

    value = payload.get(field)
    if value is None:
        return None
    if not isinstance(value, str):
        raise _field_error(field, "a string")
    return value.strip() or None


def _board_selector(payload: Mapping[str, object], target_id: str | None) -> str | None:
    """Return the board, or ``None`` when only ``targetId`` selects it.

    A frame with neither ``board`` nor ``targetId`` keeps the existing
    missing-field error on ``board``; ``board`` becomes optional only when
    ``targetId`` is present.
    """

    board = _optional_str(payload, "board")
    if board is None and target_id is None:
        raise _field_error("board", "a non-empty string when 'targetId' is absent")
    return board


def _optional_bool(payload: Mapping[str, object], field: str, *, default: bool = False) -> bool:
    """Return an optional boolean *field*, falling back to *default*."""

    value = payload.get(field)
    if value is None:
        return default
    if not isinstance(value, bool):
        raise _field_error(field, "a boolean")
    return value


def _optional_float(payload: Mapping[str, object], field: str) -> float | None:
    """Return an optional positive number *field*, or ``None`` when absent."""

    value = payload.get(field)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise _field_error(field, "a positive number")
    seconds = float(value)
    if seconds <= 0:
        raise _field_error(field, "a positive number")
    return seconds


def _optional_str_tuple(payload: Mapping[str, object], field: str) -> tuple[str, ...] | None:
    """Return an optional list-of-strings *field* as a tuple, or ``None``."""

    value = payload.get(field)
    if value is None:
        return None
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise _field_error(field, "a list of strings")
    entries = tuple(item.strip() for item in value if item.strip())
    return entries or None


def _optional_str_map(
    payload: Mapping[str, object], field: str
) -> tuple[tuple[str, str], ...] | None:
    """Return an optional object-of-string-pairs *field* as a tuple, or ``None``."""

    value = payload.get(field)
    if value is None:
        return None
    if not isinstance(value, dict) or any(
        not isinstance(key, str) or not isinstance(item, str) for key, item in value.items()
    ):
        raise _field_error(field, "an object of string pairs")
    entries = tuple(
        (key.strip(), item.strip()) for key, item in value.items() if item.strip()
    )
    return entries or None


@dataclass(frozen=True)
class CompileJobRequest:
    """One ``compile.start`` request.

    ``board`` is ``None`` when the frame selected the target by ``targetId``; the
    runner resolves it server-side. ``target_id`` otherwise only helps pick a
    backend when several advertise the same board. ``package_ids`` narrows what an
    image embeds; it carries no upload instruction.
    """

    runtime_id: str
    board: str | None
    target_id: str | None = None
    base_target_id: str | None = None
    package_ids: tuple[str, ...] | None = None
    package_variants: tuple[tuple[str, str], ...] | None = None
    module_packaging_mode: str | None = None
    clean_build: bool = False
    timeout_seconds: float | None = None

    @classmethod
    def from_frame(cls, payload: Mapping[str, object]) -> Self:
        """Build the request from one validated frame object."""

        target_id = _optional_str(payload, "targetId")
        return cls(
            runtime_id=_require_str(payload, "runtimeId"),
            board=_board_selector(payload, target_id),
            target_id=target_id,
            base_target_id=_optional_str(payload, "baseTargetId"),
            package_ids=_optional_str_tuple(payload, "packageIds"),
            package_variants=_optional_str_map(payload, "packageVariants"),
            module_packaging_mode=_optional_str(payload, "modulePackagingMode"),
            clean_build=_optional_bool(payload, "cleanBuild"),
            timeout_seconds=_optional_float(payload, "timeoutSeconds"),
        )


@dataclass(frozen=True)
class DeployJobRequest:
    """One ``deploy.start`` request.

    ``board`` is ``None`` when the frame selected the target by ``targetId``; the
    runner resolves it server-side (a deploy frame has no runtime, so resolution
    ignores runtime filtering).
    """

    board: str | None
    port: str
    target_id: str | None = None
    base_target_id: str | None = None
    firmware_path: str | None = None
    backend_id: str | None = None
    wipe_filesystem: bool = False
    timeout_seconds: float | None = None
    channel: str | None = None

    @classmethod
    def from_frame(cls, payload: Mapping[str, object]) -> Self:
        """Build the request from one validated frame object."""

        target_id = _optional_str(payload, "targetId")
        return cls(
            board=_board_selector(payload, target_id),
            port=_require_str(payload, "port"),
            target_id=target_id,
            base_target_id=_optional_str(payload, "baseTargetId"),
            firmware_path=_optional_str(payload, "firmwarePath"),
            backend_id=_optional_str(payload, "backendId"),
            wipe_filesystem=_optional_bool(payload, "wipeFilesystem"),
            channel=_optional_str(payload, "channel"),
            timeout_seconds=_optional_float(payload, "timeoutSeconds"),
        )


@dataclass(frozen=True)
class ScanJobRequest:
    """One read-only ``scan-local`` request."""

    runtime_id: str

    @classmethod
    def from_frame(cls, payload: Mapping[str, object]) -> Self:
        """Build the request from one validated frame object."""

        return cls(runtime_id=_require_str(payload, "runtimeId"))


@dataclass(frozen=True)
class ListRequest:
    """One read-only ``firmware.list`` request.

    It carries no fields: the server returns every published image and computes
    ``isLatest`` itself, so a client never filters or orders on its own.
    """

    @classmethod
    def from_frame(cls, payload: Mapping[str, object]) -> Self:
        """Ignore every field and return the field-less request."""

        return cls()


@dataclass(frozen=True)
class DeleteRequest:
    """One destructive ``firmware.delete`` request.

    ``firmware_path`` is the absolute path the ``firmware.list`` payload handed
    back; the server re-checks it against the publish root before deleting.
    """

    firmware_path: str

    @classmethod
    def from_frame(cls, payload: Mapping[str, object]) -> Self:
        """Build the request from one validated frame object."""

        return cls(firmware_path=_require_str(payload, "firmwarePath"))


@dataclass(frozen=True)
class ImportRequest:
    """One ``firmware.import`` request naming a location, not bytes.

    The frame names a server path or a URL the server may fetch; the client never
    sends archive bytes. The size rule now lives in ``resolve_archive_source``
    (``archive-too-large``), while the package-format caps
    (``firmware-package-too-large``, ``MAX_ENTRIES``, ``MAX_UNPACKED_BYTES``) stay
    where they are. ``force`` permits overwriting a different existing image with
    the same name.
    """

    path: str | None
    url: str | None
    force: bool = False

    @classmethod
    def from_frame(cls, payload: Mapping[str, object]) -> Self:
        """Build the request from one validated frame object."""

        path = _optional_str(payload, "path")
        url = _optional_str(payload, "url")
        if (path is None) == (url is None):
            raise FirmwareFrameError(
                "firmware.import needs exactly one of 'path' or 'url'",
                details={"field": "path"},
            )
        return cls(path=path, url=url, force=_optional_bool(payload, "force"))


@dataclass(frozen=True)
class ImportBinaryRequest:
    """One ``firmware.import-binary`` request naming a raw ``.bin`` and a platform.

    The frame names a server path or a URL the server may fetch; the client never
    sends image bytes. ``targetId`` is required only because the board slug becomes
    part of the published filename and the deploy target; the imported image itself
    carries no device configuration (Locked Decision 5). ``force`` permits
    overwriting a different existing image that resolves to the same name.
    """

    path: str | None
    url: str | None
    target_id: str
    force: bool = False

    @classmethod
    def from_frame(cls, payload: Mapping[str, object]) -> Self:
        """Build the request from one validated frame object."""

        path = _optional_str(payload, "path")
        url = _optional_str(payload, "url")
        if (path is None) == (url is None):
            raise FirmwareFrameError(
                "firmware.import-binary needs exactly one of 'path' or 'url'",
                details={"field": "path"},
            )
        return cls(
            path=path,
            url=url,
            target_id=_require_str(payload, "targetId"),
            force=_optional_bool(payload, "force"),
        )


@dataclass(frozen=True)
class ExportRequest:
    """One ``firmware.export`` request naming an image and a destination directory.

    The image must be one the inventory lists and the directory must be one the
    caller picked through ``fs.list``; the server names the file (``<stem>.firmware.zip``),
    so the browser never invents a path.
    """

    firmware_path: str
    destination_dir: str
    force: bool = False

    @classmethod
    def from_frame(cls, payload: Mapping[str, object]) -> Self:
        """Build the request from one validated frame object."""

        return cls(
            firmware_path=_require_str(payload, "firmwarePath"),
            destination_dir=_require_str(payload, "destinationDir"),
            force=_optional_bool(payload, "force"),
        )


@dataclass(frozen=True)
class AddonInstallRequest:
    """One ``addon.install`` request naming a location, not bytes.

    The frame names a server path or a URL the server may fetch; the client never
    sends archive bytes. The archive cap stays
    :data:`micro_otter.tools.addon_archive.MAX_ARCHIVE_BYTES`, now enforced by
    ``resolve_archive_source``, so a too-large local file answers
    ``archive-too-large`` while an oversized extracted tree still answers
    ``addon-archive-unpacked-too-large`` (two different codes for two different
    stages — do not "fix" one by renaming it). ``force`` replaces an installed
    package that carries the same id.
    """

    path: str | None
    url: str | None
    force: bool = False

    @classmethod
    def from_frame(cls, payload: Mapping[str, object]) -> Self:
        """Build the request from one validated frame object."""

        path = _optional_str(payload, "path")
        url = _optional_str(payload, "url")
        if (path is None) == (url is None):
            raise FirmwareFrameError(
                "addon.install needs exactly one of 'path' or 'url'",
                details={"field": "path"},
            )
        return cls(path=path, url=url, force=_optional_bool(payload, "force"))


@dataclass(frozen=True)
class AddonUninstallRequest:
    """One ``addon.uninstall`` request naming the packages to remove.

    ``package_ids`` is required and must name at least one id: a frame without ids
    would ask for a no-op job, which the contract refuses with ``invalid-frame``
    instead of answering an empty ``removed`` list.
    """

    package_ids: tuple[str, ...]

    @classmethod
    def from_frame(cls, payload: Mapping[str, object]) -> Self:
        """Build the request from one validated frame object."""

        package_ids = _optional_str_tuple(payload, "packageIds")
        if package_ids is None:
            raise FirmwareFrameError(
                "field 'packageIds' must list at least one add-on id",
                details={"field": "packageIds"},
            )
        return cls(package_ids=package_ids)


@dataclass(frozen=True)
class CancelRequest:
    """One ``cancel`` request; it carries no fields."""

    @classmethod
    def from_frame(cls, payload: Mapping[str, object]) -> Self:
        """Ignore every field and return the field-less request."""

        return cls()


@dataclass(frozen=True)
class FsListRequest:
    """One read-only ``fs.list`` side-channel request.

    Answered on the connection read loop, never as a job, so it can run while a
    build or deploy holds the connection's job slot. ``path`` defaults to the
    server's start directory and ``extensions`` to ``()`` (every file).
    """

    request_id: str
    path: str
    extensions: tuple[str, ...]
    show_hidden: bool = False

    @classmethod
    def from_frame(cls, payload: Mapping[str, object]) -> Self:
        """Build the request from one validated frame object."""

        request_id = _require_str(payload, "requestId")
        path = _optional_str(payload, "path") or str(default_start_directory())
        extensions = _optional_str_tuple_or_empty(payload, "extensions")
        return cls(
            request_id=request_id,
            path=path,
            extensions=extensions,
            show_hidden=_optional_bool(payload, "showHidden"),
        )


def _optional_str_tuple_or_empty(payload: Mapping[str, object], field: str) -> tuple[str, ...]:
    """Return an optional list-of-strings as a tuple, defaulting to ``()``.

    Unlike :func:`_optional_str_tuple`, an absent or empty list is an empty tuple
    (not ``None``), because ``fs.list``'s ``extensions`` means "list every file".
    """

    value = payload.get(field)
    if value is None:
        return ()
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise _field_error(field, "a list of strings")
    return tuple(item.strip() for item in value if item.strip())


ClientFrame = (
    CompileJobRequest
    | DeployJobRequest
    | ScanJobRequest
    | ListRequest
    | DeleteRequest
    | ImportRequest
    | ImportBinaryRequest
    | ExportRequest
    | AddonInstallRequest
    | AddonUninstallRequest
    | CancelRequest
    | FsListRequest
)

_FRAME_BUILDERS: dict[str, Any] = {
    COMPILE_FRAME: CompileJobRequest.from_frame,
    DEPLOY_FRAME: DeployJobRequest.from_frame,
    SCAN_FRAME: ScanJobRequest.from_frame,
    LIST_FRAME: ListRequest.from_frame,
    DELETE_FRAME: DeleteRequest.from_frame,
    IMPORT_FRAME: ImportRequest.from_frame,
    IMPORT_BINARY_FRAME: ImportBinaryRequest.from_frame,
    EXPORT_FRAME: ExportRequest.from_frame,
    ADDON_INSTALL_FRAME: AddonInstallRequest.from_frame,
    ADDON_UNINSTALL_FRAME: AddonUninstallRequest.from_frame,
    CANCEL_FRAME: CancelRequest.from_frame,
    FS_LIST_FRAME: FsListRequest.from_frame,
}
"""Frame ``type`` to request builder; the only place a type is dispatched."""


def _job_kind(request: ClientFrame) -> JobKind:
    """Return the job kind of *request*, for a ``cancel`` the last started job.

    An :class:`FsListRequest` is answered on the read loop, not as a job, so asking
    for its job kind is a programming error.
    """

    if isinstance(request, CompileJobRequest):
        return "compile"
    if isinstance(request, DeployJobRequest):
        return "deploy"
    if isinstance(request, ScanJobRequest):
        return "scan"
    if isinstance(request, DeleteRequest):
        return "delete"
    if isinstance(request, ImportRequest):
        return "import"
    if isinstance(request, ImportBinaryRequest):
        return "import"
    if isinstance(request, ExportRequest):
        return "export"
    if isinstance(request, AddonInstallRequest):
        return "addon-install"
    if isinstance(request, AddonUninstallRequest):
        return "addon-uninstall"
    if isinstance(request, FsListRequest):
        raise TypeError("fs.list is answered on the read loop, not as a job")
    return "list"


def parse_client_frame(raw: str) -> ClientFrame:
    """Return the request a raw client frame describes.

    Unknown *extra* fields are ignored on purpose: later iterations add fields
    without a new frame version, and a strict reader would reject a newer client.
    An unknown ``type`` is still an error, because that is a different contract.

    Raises
    ------
    FirmwareFrameError
        ``invalid-frame`` for non-JSON or non-object payloads and for a missing or
        mistyped required field, ``unknown-frame-type`` for an unrecognised ``type``.
    """

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as error:
        raise FirmwareFrameError(
            "frame is not valid JSON", details={"reason": str(error)}
        ) from error

    if not isinstance(payload, dict):
        raise FirmwareFrameError("frame must be a JSON object")

    frame_type = payload.get("type")
    if not isinstance(frame_type, str) or not frame_type.strip():
        raise FirmwareFrameError("frame is missing a 'type'", details={"type": frame_type})
    builder = _FRAME_BUILDERS.get(frame_type.strip())
    if builder is None:
        raise FirmwareFrameError(
            f"unknown frame type: {frame_type!r}",
            code=CODE_UNKNOWN_FRAME_TYPE,
            details={"type": frame_type},
        )
    return builder(payload)


def build_error_frame(
    code: str,
    message: str,
    *,
    hint: str | None = None,
    details: Mapping[str, object] | None = None,
    job: JobKind | None = None,
) -> str:
    """Return one ``error`` frame as compact JSON.

    ``job`` is omitted when the failure happened before a job started (an invalid
    frame), so a client can tell "your request was rejected" from "your job
    failed". Codes, hints, and details come from :func:`build_error_object`, the
    same shape the CLI payloads use.
    """

    frame: dict[str, Any] = {"type": "error"}
    if job is not None:
        frame["job"] = job
    frame.update(
        build_error_object(
            code=code,
            category="firmware",
            message=message,
            details=details,
            hint=hint,
        )
    )
    return json.dumps(frame, separators=(",", ":"))


def build_fs_list_result(request: FsListRequest, listing: Mapping[str, object]) -> str:
    """Return one ``fs.list.result`` frame for *request* and *listing*.

    Carries ``type``, ``requestId``, ``path``, ``parent``, ``roots`` (from
    :func:`local_files.known_roots`), and ``entries`` so the client can route the
    answer to the pending promise and render the directory.
    """

    frame: dict[str, Any] = {
        "type": FS_LIST_RESULT_FRAME,
        "requestId": request.request_id,
        "path": listing["path"],
        "parent": listing.get("parent"),
        "roots": list(known_roots()),
        "entries": listing["entries"],
    }
    return json.dumps(frame, separators=(",", ":"))


def build_fs_list_error(
    code: str,
    message: str,
    *,
    request_id: str,
    hint: str | None = None,
) -> str:
    """Return one ``fs.list.error`` frame mirroring :func:`build_error_object`.

    Carries ``code`` / ``message`` / ``hint`` plus ``requestId`` (and deliberately
    no ``job`` key, because it is not a job error), so the client can route it to
    the pending promise.
    """

    frame: dict[str, Any] = {
        "type": FS_LIST_ERROR_FRAME,
        "requestId": request_id,
    }
    frame.update(
        build_error_object(
            code=code,
            category="firmware",
            message=message,
            hint=hint,
        )
    )
    return json.dumps(frame, separators=(",", ":"))


def build_status_frame(
    job: JobKind,
    state: Literal["queued", "running", "done"],
    *,
    stage: str | None = None,
    message: str | None = None,
) -> str:
    """Return one ``status`` frame as compact JSON."""

    frame: dict[str, Any] = {"type": "status", "job": job, "state": state}
    if stage is not None:
        frame["stage"] = stage
    if message is not None:
        frame["message"] = message
    return json.dumps(frame, separators=(",", ":"))


def build_output_frame(job: JobKind, stream: str, text: str) -> str:
    """Return one ``output`` frame as compact JSON."""

    return json.dumps(
        {"type": "output", "job": job, "stream": stream, "text": text},
        separators=(",", ":"),
    )


def build_result_frame(
    job: JobKind,
    status: Literal["succeeded", "failed", "cancelled", "timeout"],
    payload: Mapping[str, Any] | None,
    *,
    cleanup: Mapping[str, object] | None = None,
) -> str:
    """Return the single terminal ``result`` frame of one job.

    ``cleanup`` reports a removed partial artifact (``{"removedArtifact": path}``)
    and is omitted entirely when a job did not remove anything, so a client can
    distinguish "nothing to clean" from "cleaning was not attempted".
    """

    frame: dict[str, Any] = {
        "type": "result",
        "job": job,
        "status": status,
        "payload": dict(payload) if payload is not None else None,
    }
    if cleanup is not None:
        frame["cleanup"] = dict(cleanup)
    return json.dumps(frame, separators=(",", ":"))


SendFrame = Callable[[str], None]
"""Callable that delivers one already-serialised frame to the client."""


def _device_root(workspace_root: Path) -> Path:
    """Return the device tree root inside *workspace_root*."""

    return (workspace_root / "src" / "micro_otter" / "nodes" / "device").resolve()


def _job_request_id() -> str:
    """Return a fresh correlation id for one compile job."""

    return f"ws-{uuid.uuid4().hex[:12]}"


def _resolve_board_spec(workspace_root: Path, board: str) -> BoardSpec:
    """Return the catalog entry for *board*.

    Raises
    ------
    BoardCatalogError
        When the board is not in the catalog; the runner answers ``board-unknown``
        and never spawns a build.
    """

    catalog = load_board_catalog((workspace_root / BOARD_CATALOG_DEFAULT_PATH).resolve())
    spec = find_board(board, catalog)
    if spec is None:
        known = ", ".join(item.name for item in catalog) or "none"
        raise BoardCatalogError(f"Unknown board: {board!r} (known boards: {known})")
    return spec


def _resolve_board_name(
    *,
    board: str | None,
    target_id: str | None,
    workspace_root: Path,
    runtime_id: str | None,
    base_target_id: str | None = None,
) -> str:
    """Return the board name for a job request, resolving ``targetId`` when needed.

    When ``board`` is absent the server resolves the target through the mapping
    rules, on ``baseTargetId`` when a derived target names one. A wildcard target
    (no concrete board) or an unknown id raises :class:`WebTargetUnknownError`
    (mapped to ``target-unknown``); an unknown base raises
    :class:`WebBaseTargetUnknownError` and a wildcard base raises
    :class:`WebBaseTargetNoMappingError`.
    """

    if board is not None:
        return board
    resolution = resolve_web_target(
        target_id=target_id or "",
        workspace_root=workspace_root,
        runtime_id=runtime_id,
        base_target_id=base_target_id,
    )
    if resolution.board is None:
        raise WebTargetUnknownError(resolution.target_id)
    return resolution.board


@dataclass(frozen=True)
class _ArtifactBaseline:
    """Firmware artifact state captured before a compile job starts."""

    path: Path | None
    mtime: float | None


def _artifact_baseline(micropython_root: Path, board_spec: BoardSpec) -> _ArtifactBaseline:
    """Return the artifact that existed before the job, if any."""

    record = discover_firmware_artifact(
        micropython_root=micropython_root,
        target=board_spec.build_params["port"],
        board=board_spec.name,
        require_exists=False,
    )
    if record is None:
        return _ArtifactBaseline(path=None, mtime=None)
    try:
        return _ArtifactBaseline(path=record.path, mtime=record.path.stat().st_mtime)
    except OSError:
        return _ArtifactBaseline(path=None, mtime=None)


def _discard_partial_artifact(
    baseline: _ArtifactBaseline,
    micropython_root: Path,
    board_spec: BoardSpec,
    *,
    job_started_at: float,
) -> Path | None:
    """Remove a firmware binary this job wrote, and return the removed path.

    A cancel, timeout, or failure can leave a half-written image that a later
    deploy would happily flash. Only an artifact whose modification time is at or
    after ``job_started_at`` is removed, so a pre-existing good binary (the
    ``baseline``) always survives.
    """

    record = discover_firmware_artifact(
        micropython_root=micropython_root,
        target=board_spec.build_params["port"],
        board=board_spec.name,
        require_exists=False,
    )
    if record is None:
        return None
    if baseline.path is not None and baseline.path == record.path:
        try:
            if record.path.stat().st_mtime < job_started_at:
                return None
        except OSError:
            return None
    try:
        if record.path.stat().st_mtime < job_started_at:
            return None
        record.path.unlink()
    except OSError:
        return None
    return record.path


def _deploy_event_callback(job: JobKind, send: SendFrame) -> Callable[[BuildEvent], None]:
    """Return a flash-event callback that renders events as ``status``/``output`` frames."""

    def on_event(event: BuildEvent) -> None:
        """Translate one flash event into the frame a client already understands."""

        if event.kind == "stage":
            send(build_status_frame(job, "running", stage=event.message))
            return
        if event.kind == "status":
            send(build_status_frame(job, "running", message=event.message))
            return
        payload_stream = (event.payload or {}).get("stream")
        if payload_stream in (_LOG_STREAM_STDOUT, _LOG_STREAM_STDERR):
            stream = payload_stream
        else:
            stream = _LOG_STREAM_STDERR if event.kind == "error" else _LOG_STREAM_STDOUT
        send(build_output_frame(job, stream, f"{event.message}\n"))

    return on_event


def _request_timeout(request: ClientFrame) -> float:
    """Return the per-job timeout budget of *request*."""

    timeout = getattr(request, "timeout_seconds", None)
    if isinstance(timeout, int | float) and timeout > 0:
        return float(timeout)
    return DEFAULT_JOB_TIMEOUT_SECONDS


def _compile_failure_frame(payload: Mapping[str, Any], job: JobKind) -> str:
    """Return the terminal frame for a failed compile job.

    A failure the payload can describe becomes an ``error`` frame carrying the
    stable code, the hint, and the payload's own details plus ``exitCode``; a
    failure without a structured entry falls back to a ``failed`` result so the
    client still gets exactly one terminal frame.
    """

    errors = payload.get("errors")
    entry = (
        errors[0]
        if isinstance(errors, list) and errors and isinstance(errors[0], Mapping)
        else None
    )
    if entry is None:
        return build_result_frame(job, "failed", payload)

    details: dict[str, Any] = dict(entry.get("details") or {})
    build = payload.get("build")
    if isinstance(build, Mapping):
        details["exitCode"] = build.get("exitCode")
    code = str(entry.get("code") or CODE_INTERNAL_ERROR)
    if code == CODE_UNKNOWN_PACKAGE_ID:
        requested = details.get("requested")
        if isinstance(requested, list) and requested:
            details["packageId"] = requested[0]
    return build_error_frame(
        code,
        str(entry.get("message") or "firmware compile failed"),
        hint=entry.get("hint"),
        details=details,
        job=job,
    )


class FirmwareJobRunner:
    """One ``WS /firmware`` connection: a frame loop plus at most one active job.

    Every job runs synchronously inside a worker thread, because the compile and
    flash seams are synchronous. Only the terminal frame is unique: a job sends
    exactly one ``result`` or ``error`` frame, in addition to any number of
    ``status`` and ``output`` frames.
    """

    def __init__(self, websocket: Any) -> None:
        """Store the socket and this connection's job state."""

        self._websocket = websocket
        self._send_lock = asyncio.Lock()
        self._active: asyncio.Task[None] | None = None
        self._cancel = threading.Event()
        self._job: JobKind | None = None

    async def serve(self) -> None:
        """Receive and dispatch frames until the client disconnects.

        A malformed frame answers one ``error`` frame and keeps the connection
        open; only a closed socket ends the loop.
        """

        try:
            async for raw in self._websocket:
                if isinstance(raw, bytes):
                    await self._send(
                        build_error_frame(
                            CODE_INVALID_FRAME,
                            "binary frames are not supported on /firmware",
                        )
                    )
                    continue
                try:
                    request = parse_client_frame(raw)
                except FirmwareFrameError as error:
                    await self._send(
                        build_error_frame(
                            error.code,
                            str(error),
                            hint=error.hint,
                            details=error.details,
                        )
                    )
                    continue
                if isinstance(request, CancelRequest):
                    # With no job running there is nothing to cancel, and answering
                    # would invent a frame-contract case the client cannot need: it
                    # already knows its own job state.
                    if self._job is not None:
                        self._cancel.set()
                    continue
                if isinstance(request, FsListRequest):
                    # Answered on the read loop, never as a job, so a picker may
                    # browse while a build or deploy holds the job slot.
                    await self._handle_fs_list(request)
                    continue
                await self._start_job(request)
        except ConnectionClosed:
            return
        finally:
            # A disconnect cancels whatever is still running: the worker thread
            # observes the event at its next poll and kills the child process group.
            self._cancel.set()

    async def _send(self, frame: str) -> None:
        """Send *frame*, serialising concurrent writers through one lock."""

        async with self._send_lock:
            try:
                await self._websocket.send(frame)
            except ConnectionClosed:
                pass

    def _refusal(self, job: JobKind) -> tuple[str, str, str | None] | None:
        """Return ``(code, message, hint)`` when *job* is not enabled here, else ``None``.

        The capability payload is rebuilt per job and the config cache is cleared
        first, so an edited ``micro-otter.toml`` takes effect without a restart.
        ``scan`` and ``list`` are read-only and always available. The two add-on jobs
        are write jobs that are still always available, because they touch only
        ``Config.addons_dir`` — user state that needs no toolchain, and the
        ``node-package-addons`` feature is advertised only *while* an add-on is
        installed, so gating the first install on it would deadlock. ``delete``,
        ``import``, and ``export`` reuse the ``firmware-compile`` gate because the
        producer owns the publish root; the ``firmware.import`` package frame and
        the ``firmware.import-binary`` frame share the single job-kind ``import``
        gate, so a binary import needs no new feature key. ``export`` additionally
        needs ``local-file-access``, because it writes only into a folder the caller
        picked.
        """

        if job in ("scan", "list", "addon-install", "addon-uninstall"):
            return None
        clear_config_cache()
        features = build_server_capabilities(config=load_config()).get("features") or []
        if job == "compile" and FEATURE_FIRMWARE_COMPILE not in features:
            return (
                CODE_COMPILE_DISABLED,
                "firmware compile is disabled on this server",
                "the server does not advertise firmware-compile; enable compile support in "
                "micro-otter.toml (see docs/dev/deployment/configuration.md) and reload "
                "the server.",
            )
        if job == "deploy" and FEATURE_FIRMWARE_DEPLOY not in features:
            return (
                CODE_DEPLOY_DISABLED,
                "firmware deploy is disabled on this server",
                "the server does not advertise firmware-deploy; enable deploy support in "
                "micro-otter.toml (see docs/dev/deployment/configuration.md) and reload "
                "the server.",
            )
        if job == "delete" and FEATURE_FIRMWARE_COMPILE not in features:
            return (
                CODE_COMPILE_DISABLED,
                "firmware delete is disabled on this server",
                "the server does not advertise firmware-compile; the firmware producer owns "
                "the publish root, so deleting images requires it (see "
                "docs/dev/deployment/configuration.md) and reload the server.",
            )
        if job == "import" and FEATURE_FIRMWARE_COMPILE not in features:
            return (
                CODE_COMPILE_DISABLED,
                "firmware import is disabled on this server",
                "the server does not advertise firmware-compile; the firmware producer owns "
                "the publish root, so importing images requires it (see "
                "docs/dev/deployment/configuration.md) and reload the server.",
            )
        if job == "export" and FEATURE_FIRMWARE_COMPILE not in features:
            return (
                CODE_COMPILE_DISABLED,
                "firmware export is disabled on this server",
                "the server does not advertise firmware-compile; the firmware producer owns "
                "the publish root, so exporting images requires it (see "
                "docs/dev/deployment/configuration.md) and reload the server.",
            )
        if job == "export" and FEATURE_LOCAL_FILE_ACCESS not in features:
            return (
                CODE_FS_NOT_ALLOWED,
                "firmware export is disabled on this server",
                "the server does not advertise local-file-access; export writes only into a "
                "folder the caller picked, so bind the server to a loopback host to enable it.",
            )
        return None

    def _local_file_access_refusal(self) -> tuple[str, str, str | None] | None:
        """Return an ``fs-not-allowed`` refusal when ``local-file-access`` is absent.

        The capability payload is rebuilt (and the config cache cleared) before the
        decision, the same rule :meth:`_refusal` documents: an edited
        ``micro-otter.toml`` takes effect without a restart, and the answer never
        comes from a value cached at connection time.
        """

        clear_config_cache()
        features = build_server_capabilities(config=load_config()).get("features") or []
        if FEATURE_LOCAL_FILE_ACCESS not in features:
            return (
                CODE_FS_NOT_ALLOWED,
                "local file access is disabled on this server",
                "the server does not advertise local-file-access; bind it to a loopback "
                "host to enable the file picker (see docs/dev/deployment/configuration.md).",
            )
        return None

    async def _handle_fs_list(self, request: FsListRequest) -> None:
        """Answer one ``fs.list`` request on the read loop.

        Never reads or writes ``self._job`` / ``self._cancel`` / ``self._active``
        and never sends a ``status`` frame — that is what makes the channel safe
        while a job is running.
        """

        refusal = self._local_file_access_refusal()
        if refusal is not None:
            code, message, hint = refusal
            await self._send(
                build_fs_list_error(
                    code, message, request_id=request.request_id, hint=hint
                )
            )
            return
        try:
            listing = list_directory(
                path=request.path,
                extensions=request.extensions,
                show_hidden=request.show_hidden,
            )
        except LocalFileError as error:
            await self._send(
                build_fs_list_error(
                    error.code, str(error), request_id=request.request_id, hint=error.hint
                )
            )
            return
        await self._send(build_fs_list_result(request, listing))

    async def _start_job(self, request: ClientFrame) -> None:
        """Start *request* unless a job is running or its feature is disabled."""

        if self._active is not None and not self._active.done():
            await self._send(
                build_error_frame(
                    CODE_JOB_BUSY,
                    "a firmware job is already running on this connection",
                    hint="wait for the running job's result frame before starting another job.",
                    job=self._job,
                )
            )
            return

        job = _job_kind(request)
        refusal = self._refusal(job)
        if refusal is not None:
            code, message, hint = refusal
            await self._send(build_error_frame(code, message, hint=hint, job=job))
            return

        self._job = job
        self._cancel.clear()
        await self._send(build_status_frame(job, "queued"))
        self._active = asyncio.create_task(self._run(request, job))

    async def _run(self, request: ClientFrame, job: JobKind) -> None:
        """Run one job in a worker thread and guarantee a terminal frame."""

        loop = asyncio.get_running_loop()

        def send(frame: str) -> None:
            """Deliver a frame from the worker thread.

            ``websocket.send`` is not thread-safe, so this is the one place in the
            server where a worker thread talks to the socket: every frame hops
            back onto the event loop through ``run_coroutine_threadsafe``, and
            ``_send`` serialises the actual write.
            """

            asyncio.run_coroutine_threadsafe(self._send(frame), loop)

        backstop = _request_timeout(request) + _TIMEOUT_BACKSTOP_SECONDS
        try:
            await asyncio.wait_for(
                asyncio.to_thread(self._run_sync, request, job, send),
                backstop,
            )
        except TimeoutError:
            # The sync path enforces its own timeout by killing the child group;
            # this branch only fires when that path itself wedged, so it is a
            # server fault with its own code rather than a `timeout` result (which
            # would claim a cleanup this path could not verify).
            _LOGGER.warning("firmware job %s exceeded the %.0fs backstop", job, backstop)
            send(
                build_error_frame(
                    CODE_BUILD_TIMEOUT,
                    f"the firmware job did not return within {backstop:.0f}s",
                    hint=(
                        "the server-side guard fired because the build worker stopped responding; "
                        "check the build log, then start the job again."
                    ),
                    details={"timeoutSeconds": backstop},
                    job=job,
                )
            )
        except Exception as error:  # pragma: no cover - _run_sync maps its own failures
            _LOGGER.exception("firmware job %s failed", job)
            send(
                build_error_frame(
                    CODE_INTERNAL_ERROR,
                    "internal error while running the firmware job",
                    details={"exception": type(error).__name__},
                    job=job,
                )
            )
        finally:
            self._job = None
            self._cancel.clear()

    def _run_sync(self, request: ClientFrame, job: JobKind, send: SendFrame) -> None:
        """Run one job body synchronously inside the worker thread.

        Every failure is mapped to a stable ``error`` code here, so the async
        caller never has to translate an exception (and never leaks a traceback to
        the client).
        """

        config = load_config()
        try:
            if isinstance(request, ScanJobRequest):
                self._run_scan_job(request, job, send, config)
            elif isinstance(request, DeployJobRequest):
                self._run_deploy_job(request, job, send, config)
            elif isinstance(request, CompileJobRequest):
                self._run_compile_job(request, job, send, config)
            elif isinstance(request, ListRequest | DeleteRequest):
                self._run_inventory_job(request, job, send, config)
            elif isinstance(request, ImportRequest):
                self._run_import_job(request, job, send, config)
            elif isinstance(request, ImportBinaryRequest):
                self._run_import_binary_job(request, job, send, config)
            elif isinstance(request, ExportRequest):
                self._run_export_job(request, job, send, config)
            elif isinstance(request, AddonInstallRequest):
                self._run_addon_install_job(request, job, send, config)
            elif isinstance(request, AddonUninstallRequest):
                self._run_addon_uninstall_job(request, job, send, config)
        except (
            FirmwareDeployError,
            LocalPackageScanError,
            FirmwareInventoryError,
            FirmwarePackageError,
            ImportedFirmwareError,
        ) as error:
            send(
                build_error_frame(
                    error.code,
                    error.message,
                    hint=error.hint,
                    details=error.details,
                    job=job,
                )
            )
        except AddonInstallError as error:
            # An add-on operation carries a stable ``code`` and a hint but no
            # ``details``, so it cannot join the payload-error tuple above.
            send(
                build_error_frame(
                    error.code,
                    str(error),
                    hint=error.hint,
                    job=job,
                )
            )
        except ArchiveSourceError as error:
            # A path/URL resolution failure carries a stable code plus a hint and no
            # ``details``; report it so it never surfaces as ``internal-error``.
            send(
                build_error_frame(
                    error.code,
                    str(error),
                    hint=error.hint,
                    job=job,
                )
            )
        except LocalFileError as error:
            # A destination-folder failure carries a stable code plus a hint and no
            # ``details``; report it so an unwritable folder is never internal-error.
            send(
                build_error_frame(
                    error.code,
                    str(error),
                    hint=error.hint,
                    job=job,
                )
            )
        except BoardCatalogError as error:
            send(
                build_error_frame(
                    CODE_BOARD_UNKNOWN,
                    str(error),
                    hint="Pick a board from the server's advertised firmware targets.",
                    job=job,
                )
            )
        except WebTargetUnknownError as error:
            send(
                build_error_frame(
                    CODE_TARGET_UNKNOWN,
                    f"Unknown or non-buildable web target: {error.target_id!r}",
                    hint="Pick a target with a concrete build board from the advertised targets.",
                    details={"targetId": error.target_id},
                    job=job,
                )
            )
        except WebBaseTargetUnknownError as error:
            send(
                build_error_frame(
                    CODE_BASE_TARGET_UNKNOWN,
                    f"Unknown base target: {error.base_target_id!r}",
                    hint="Pick a shipped target as the derived target's base.",
                    details={"baseTargetId": error.base_target_id},
                    job=job,
                )
            )
        except WebBaseTargetNoMappingError as error:
            send(
                build_error_frame(
                    CODE_BASE_NO_MAPPING,
                    f"Base target has no concrete build board: {error.base_target_id!r}",
                    hint="Pick a shipped target with a concrete compile board as the base.",
                    details={"baseTargetId": error.base_target_id},
                    job=job,
                )
            )
        except Exception as error:
            _LOGGER.exception("firmware job %s failed", job)
            send(
                build_error_frame(
                    CODE_INTERNAL_ERROR,
                    "internal error while running the firmware job",
                    details={"exception": type(error).__name__},
                    job=job,
                )
            )

    def _run_scan_job(
        self,
        request: ScanJobRequest,
        job: JobKind,
        send: SendFrame,
        config: Config,
    ) -> None:
        """Answer ``scan-local`` with the read-only inventory payload.

        The server never writes the runtime manifest: ``update_runtime_local_packages``
        stays a CLI-only bookkeeping step, so a scan frame is read-only for every
        connected client.
        """

        send(build_status_frame(job, "running", stage="scan"))
        scan = scan_local_packages(
            device_root=_device_root(config.workspace_root),
            runtime_id=request.runtime_id,
            addons_root=config.addons_dir,
        )
        send(build_status_frame(job, "done"))
        send(build_result_frame(job, "succeeded", build_package_scan_payload(scan)))

    def _inventory_payload(self, publish_root: Path) -> dict[str, Any]:
        """Return the serialised inventory payload shared by the list/import jobs.

        ``latest`` and ``latestByChannel`` are recomputed from the same entries so
        ``firmware.list``, ``firmware.delete``, ``firmware.import``, and
        ``firmware.import-binary`` results carry an identical payload.
        """

        entries = list_firmware_inventory(publish_root=publish_root)
        return build_firmware_inventory_payload(
            publish_root=publish_root,
            entries=entries,
            latest=latest_firmware_ids(entries),
            latest_by_channel=latest_firmware_ids_by_channel(entries),
        )

    def _run_inventory_job(
        self,
        request: ListRequest | DeleteRequest,
        job: JobKind,
        send: SendFrame,
        config: Config,
    ) -> None:
        """Answer ``firmware.list`` / ``firmware.delete`` with the inventory payload.

        A delete result carries the refreshed inventory *and* the ``removed`` /
        ``absent`` lists, so the client refreshes from the single result frame
        instead of issuing a second ``firmware.list``.
        """

        publish_root = resolve_publish_root()
        if isinstance(request, DeleteRequest):
            send(build_status_frame(job, "running", stage="delete"))
            removal = delete_firmware_entry(
                path=Path(request.firmware_path),
                publish_root=publish_root,
            )
        else:
            send(build_status_frame(job, "running", stage="inventory"))

        payload = self._inventory_payload(publish_root)
        if isinstance(request, DeleteRequest):
            payload["removed"] = removal["removed"]
            payload["absent"] = removal["absent"]

        send(build_status_frame(job, "done"))
        send(build_result_frame(job, "succeeded", payload))

    def _run_import_job(
        self,
        request: ImportRequest,
        job: JobKind,
        send: SendFrame,
        config: Config,
    ) -> None:
        """Resolve, validate, and install one firmware package, then refresh the inventory.

        The package is a file the server resolves itself (a path it can already
        see, or a URL fetched into a temp file the resolver owns). Staging and the
        atomic move are unchanged. The result carries the refreshed inventory
        payload plus the ``imported`` record, so the client refreshes from the
        single terminal frame instead of issuing a second ``firmware.list``.
        """

        send(build_status_frame(job, "running", stage="import"))
        publish_root = resolve_publish_root()
        known_board_ids = self._known_board_ids(config)
        with resolve_archive_source(
            path=request.path,
            url=request.url,
            max_bytes=MAX_PACKAGE_BYTES,
            label="firmware",
        ) as archive_path:
            imported = import_firmware_package(
                archive_path,
                publish_root=publish_root,
                force=request.force,
                known_board_ids=known_board_ids,
            )

        payload = self._inventory_payload(publish_root)
        payload["imported"] = imported
        send(build_status_frame(job, "done"))
        send(build_result_frame(job, "succeeded", payload))


    def _run_import_binary_job(
        self,
        request: ImportBinaryRequest,
        job: JobKind,
        send: SendFrame,
        config: Config,
    ) -> None:
        """Resolve a raw ``.bin`` and land it in the publish root, then refresh the inventory.

        The board is resolved from ``targetId`` exactly as deploy does, so a
        wildcard or unknown target answers ``target-unknown`` through the existing
        mapping. The binary is a file the server resolves itself (a path, or a URL
        fetched into a temp file the resolver owns) and then validated, named, and
        installed by :func:`import_firmware_binary`. The result carries the
        refreshed inventory payload plus the ``imported`` record.
        """

        send(build_status_frame(job, "running", stage="import"))
        board_name = _resolve_board_name(
            board=None,
            target_id=request.target_id,
            workspace_root=config.workspace_root,
            runtime_id=None,
        )
        publish_root = resolve_publish_root()
        with resolve_archive_source(
            path=request.path,
            url=request.url,
            max_bytes=MAX_IMPORTED_BINARY_BYTES,
            label="firmware image",
            suffixes=(".bin",),
        ) as source:
            imported = import_firmware_binary(
                source,
                board_id=board_name,
                target_id=request.target_id,
                publish_root=publish_root,
                force=request.force,
                known_board_ids=self._known_board_ids(config),
            )

        payload = self._inventory_payload(publish_root)
        payload["imported"] = imported
        send(build_status_frame(job, "done"))
        send(build_result_frame(job, "succeeded", payload))


    def _run_export_job(
        self,
        request: ExportRequest,
        job: JobKind,
        send: SendFrame,
        config: Config,
    ) -> None:
        """Package one published image into a caller-picked folder and report the path.

        The image must pass the shared inventory containment rule and the folder
        must pass :func:`local_files.validate_destination_directory`. The inventory
        is untouched, so the terminal result carries only the ``exported`` record
        (`path`, `imagePath`, `bytes`) — the client does not re-list after an export.
        """

        send(build_status_frame(job, "running", stage="export"))
        image = resolve_inventory_image(
            path=Path(request.firmware_path), publish_root=resolve_publish_root()
        )
        destination_dir = validate_destination_directory(request.destination_dir)
        written = export_firmware_package_to_directory(
            image, destination_dir=destination_dir, force=request.force
        )
        send(build_status_frame(job, "done"))
        send(
            build_result_frame(
                job,
                "succeeded",
                {
                    "exported": {
                        "path": str(written),
                        "imagePath": str(image),
                        "bytes": written.stat().st_size,
                    }
                },
            )
        )

    def _run_addon_install_job(
        self,
        request: AddonInstallRequest,
        job: JobKind,
        send: SendFrame,
        config: Config,
    ) -> None:
        """Install one add-on archive and answer with the refreshed add-on inventory.

        The archive is now a file the server can already see, or one the resolver
        fetched into a temp file. Only ``Config.addons_dir`` is written: no firmware
        image, device filesystem, or collection source upload is touched, and the
        temp file is removed by the resolver, not by this method. The result carries
        the shared inventory payload plus the ``installed`` record, so the client
        refreshes the add-on table from the single terminal frame.
        """

        send(build_status_frame(job, "running", stage="addon-install"))
        device_root = _device_root(config.workspace_root)
        with resolve_archive_source(
            path=request.path,
            url=request.url,
            max_bytes=MAX_ARCHIVE_BYTES,
            label="addon",
        ) as archive_path:
            installed = install_addon(
                archive_path,
                addons_root=config.addons_dir,
                builtin_ids=builtin_package_ids(device_root),
                force=request.force,
            )

        payload = addon_inventory_payload(device_root, config.addons_dir)
        payload["installed"] = {
            "id": installed.id,
            "version": installed.version,
            "replaced": installed.replaced,
            "archiveSha256": installed.archive_sha256,
            "packageDir": str(installed.package_dir),
        }
        send(build_status_frame(job, "done"))
        send(build_result_frame(job, "succeeded", payload))

    def _run_addon_uninstall_job(
        self,
        request: AddonUninstallRequest,
        job: JobKind,
        send: SendFrame,
        config: Config,
    ) -> None:
        """Remove installed add-on packages one id at a time, then refresh the inventory.

        Every id is announced by its own ``running`` status frame with the id in
        ``message``, so a failure on a later id still leaves the ids already removed
        visible before the error frame answers. The result carries the shared
        inventory payload plus the ``removed`` records.
        """

        send(build_status_frame(job, "running", stage="addon-uninstall"))
        device_root = _device_root(config.workspace_root)
        removed: list[dict[str, object]] = []
        for package_id in request.package_ids:
            send(
                build_status_frame(
                    job, "running", stage="addon-uninstall", message=package_id
                )
            )
            result = uninstall_addon(package_id, addons_root=config.addons_dir)
            removed.append({"id": result.id, "version": result.version})

        payload = addon_inventory_payload(device_root, config.addons_dir)
        payload["removed"] = removed
        send(build_status_frame(job, "done"))
        send(build_result_frame(job, "succeeded", payload))

    @staticmethod
    def _known_board_ids(config: Config) -> frozenset[str] | None:
        """Return the catalog slugs, or ``None`` when the catalog cannot be loaded."""

        try:
            catalog = load_board_catalog(
                (config.workspace_root / BOARD_CATALOG_DEFAULT_PATH).resolve()
            )
        except BoardCatalogError:
            return None
        return frozenset(spec.slug for spec in catalog)

    def _run_compile_job(
        self,
        request: CompileJobRequest,
        job: JobKind,
        send: SendFrame,
        config: Config,
    ) -> None:
        """Run one compile job through the CLI request path and stream its progress."""

        workspace_root = config.workspace_root
        board_name = _resolve_board_name(
            board=request.board,
            target_id=request.target_id,
            workspace_root=workspace_root,
            runtime_id=request.runtime_id,
            base_target_id=request.base_target_id,
        )
        board_spec = _resolve_board_spec(workspace_root, board_name)
        baseline = _artifact_baseline(config.micropython_root, board_spec)
        started_at = time.time()

        def stage_callback(stage: str, payload: Mapping[str, Any]) -> None:
            """Render one orchestration stage boundary as a ``status`` frame."""

            send(build_status_frame(job, "running", stage=stage))

        def log_callback(stream: str, text: str) -> None:
            """Render one build output line as an ``output`` frame."""

            name = _LOG_STREAM_STDERR if stream == _LOG_STREAM_STDERR else _LOG_STREAM_STDOUT
            send(build_output_frame(job, name, text))

        timeout = _request_timeout(request)
        try:
            result = execute_compile_runtime_request(
                CompileRuntimeRequest(
                    runtime_id=request.runtime_id,
                    board=board_spec.name,
                    workspace_root=workspace_root,
                    micropython_root=config.micropython_root,
                    device_root=_device_root(workspace_root),
                    addons_root=config.addons_dir,
                    clean_build=request.clean_build,
                    module_packaging_mode=request.module_packaging_mode,
                    package_ids=request.package_ids,
                    package_variants=(
                        dict(request.package_variants) if request.package_variants else None
                    ),
                    request_id=_job_request_id(),
                    timeout_seconds=(
                        int(request.timeout_seconds)
                        if request.timeout_seconds is not None
                        else None
                    ),
                ),
                stage_callback=stage_callback,
                log_callback=log_callback,
                cancel_event=self._cancel,
                timeout_seconds=timeout,
            )
        except BuildCancelled:
            removed = _discard_partial_artifact(
                baseline,
                config.micropython_root,
                board_spec,
                job_started_at=started_at,
            )
            self._report_cleanup(send, job, removed)
            send(
                build_result_frame(
                    job,
                    "cancelled",
                    {"exitCode": None},
                    cleanup={"removedArtifact": str(removed) if removed else None},
                )
            )
            return
        except BuildTimeout as error:
            removed = _discard_partial_artifact(
                baseline,
                config.micropython_root,
                board_spec,
                job_started_at=started_at,
            )
            self._report_cleanup(send, job, removed)
            send(
                build_result_frame(
                    job,
                    "timeout",
                    {"exitCode": None, "timeoutSeconds": error.timeout_seconds},
                    cleanup={"removedArtifact": str(removed) if removed else None},
                )
            )
            return

        send(build_status_frame(job, "done"))
        if result.exit_code == 0:
            send(build_result_frame(job, "succeeded", result.payload))
            return
        send(_compile_failure_frame(result.payload, job))

    def _report_cleanup(self, send: SendFrame, job: JobKind, removed: Path | None) -> None:
        """Tell the client about a removed partial artifact, if there was one."""

        if removed is None:
            return
        send(
            build_output_frame(job, _LOG_STREAM_STDOUT, f"removed partial artifact {removed}\n")
        )

    def _run_deploy_job(
        self,
        request: DeployJobRequest,
        job: JobKind,
        send: SendFrame,
        config: Config,
    ) -> None:
        """Resolve an image, flash the board, and report the deploy payload."""

        board_name = _resolve_board_name(
            board=request.board,
            target_id=request.target_id,
            workspace_root=config.workspace_root,
            runtime_id=None,
            base_target_id=request.base_target_id,
        )
        board_spec = _resolve_board_spec(config.workspace_root, board_name)
        send(build_status_frame(job, "running", stage="deploy-resolve"))
        image = resolve_firmware_image(
            board_spec=board_spec,
            firmware_path=Path(request.firmware_path) if request.firmware_path else None,
            channel=request.channel,
        )

        def log_callback(stream: str, text: str) -> None:
            """Forward one line streamed by the flash tool as an ``output`` frame."""

            name = _LOG_STREAM_STDERR if stream == _LOG_STREAM_STDERR else _LOG_STREAM_STDOUT
            send(build_output_frame(job, name, text))

        deploy_request = FirmwareDeployRequest(
            board_spec=board_spec,
            port=request.port,
            firmware_path=image,
            backend_id=request.backend_id,
            wipe_filesystem=request.wipe_filesystem,
            timeout_seconds=request.timeout_seconds,
            log_callback=log_callback,
        )
        report = flash_firmware(
            deploy_request,
            on_event=_deploy_event_callback(job, send),
        )

        send(build_status_frame(job, "done"))
        payload = build_deploy_payload(report, request=deploy_request)
        status = "succeeded" if report.exit_code == 0 else "failed"
        send(build_result_frame(job, status, payload))

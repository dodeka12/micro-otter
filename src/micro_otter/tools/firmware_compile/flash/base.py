"""Flash backend protocol and the value types that cross the seam.

A flash backend writes one firmware image to one board over one transport
(esptool today, another toolchain later). It owns nothing else: collection
package source upload belongs to the web-app deployment path and must never
move behind this seam.

Only contract types live here. Concrete adapters (for example ``esptool``) must
never be imported from this module, so importing the contract stays free of
tool-side effects.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, runtime_checkable

from ..backends.base import BackendStatus, BuildEventKind, StreamCallback
from ..board_registry import BoardSpec
from ..process_stream import LogCallback

__all__ = [
    "FlashBackend",
    "FlashBackendError",
    "FlashBackendUnavailableError",
    "FlashCommandError",
    "FlashEventKind",
    "FlashRequest",
    "FlashResult",
    "FlashToolMissingError",
    "FirmwareImageNotFoundError",
    "MonitorNotSupportedError",
    "NoAvailableFlashBackendError",
    "UnknownFlashBackendError",
    "UnsupportedFlashChipError",
]

FlashEventKind = BuildEventKind
"""Flash backends reuse the build event vocabulary instead of a second type."""


class FlashBackendError(RuntimeError):
    """Base class for structured flash failures.

    ``exit_code`` mirrors the mapping the CLI already applies to ``mo dr``, so a
    future CLI or server integration can translate an exception without
    re-deriving categories: missing tool and failed subprocess map to ``1`` (or
    the subprocess code), a missing firmware image maps to ``3``, and an
    unsupported ``--monitor`` request maps to ``2``.
    """

    exit_code: int = 1


class FirmwareImageNotFoundError(FlashBackendError):
    """Raised when the firmware image a caller asked to flash does not exist."""

    exit_code = 3

    def __init__(self, firmware_path: Path) -> None:
        """Record the missing image path."""

        self.firmware_path = Path(firmware_path)
        super().__init__(f"Firmware file not found: {self.firmware_path}")


class FlashToolMissingError(FlashBackendError):
    """Raised when the flash tool is not installed or not on ``PATH``."""

    exit_code = 1

    def __init__(self, tool: str, *, detail: str | None = None) -> None:
        """Record the missing tool name and an optional environment detail."""

        self.tool = tool
        self.detail = detail
        message = f"Required tool not found: {tool}"
        if detail:
            message = f"{message} ({detail})"
        super().__init__(message)


class MonitorNotSupportedError(FlashBackendError):
    """Raised when a caller combines image flashing with a serial monitor."""

    exit_code = 2

    def __init__(self) -> None:
        """Explain that monitoring is a build-directory deploy feature."""

        super().__init__("--monitor is not supported with --firmware.")


class FlashCommandError(FlashBackendError):
    """Raised when the flash tool exits with a failure status."""

    def __init__(self, tool: str, returncode: int, *, argv: Sequence[str] = ()) -> None:
        """Record the tool, its return code, and the argv that failed."""

        self.tool = tool
        self.returncode = returncode
        self.argv = tuple(argv)
        self.exit_code = returncode if returncode > 0 else 1
        super().__init__(f"{tool} failed with exit code {self.exit_code}")


class UnknownFlashBackendError(FlashBackendError):
    """Raised when a backend id does not resolve to a known flash backend."""

    def __init__(self, backend_id: str, *, known_backend_ids: Iterable[str] = ()) -> None:
        """Record the rejected id and the ids that were known at lookup time."""

        self.backend_id = backend_id
        self.known_backend_ids = tuple(known_backend_ids)
        known_text = ", ".join(self.known_backend_ids) or "none"
        super().__init__(f"Unknown flash backend: {backend_id!r} (known backends: {known_text})")


class FlashBackendUnavailableError(FlashBackendError):
    """Raised when a hard-selected flash backend reports that it cannot run."""

    def __init__(self, backend_id: str, *, detail: str | None = None) -> None:
        """Record the unavailable backend and the reported detail, if any."""

        self.backend_id = backend_id
        self.detail = detail
        message = f"Flash backend {backend_id!r} is unavailable"
        if detail:
            message = f"{message}: {detail}"
        super().__init__(message)


class UnsupportedFlashChipError(FlashBackendError):
    """Raised when the selected backend cannot flash the requested chip."""

    def __init__(
        self,
        backend_id: str,
        chip: str,
        *,
        supported_chips: Iterable[str] = (),
    ) -> None:
        """Record the rejected chip and the chips the backend does support."""

        self.backend_id = backend_id
        self.chip = chip
        self.supported_chips = tuple(supported_chips)
        supported_text = ", ".join(self.supported_chips) or "none"
        super().__init__(
            f"Flash backend {backend_id!r} does not support chip {chip!r} "
            f"(supported chips: {supported_text})"
        )


class NoAvailableFlashBackendError(FlashBackendError):
    """Raised when ``auto`` selection finds no backend that can flash a chip."""

    def __init__(self, chip: str, *, considered_backend_ids: Iterable[str] = ()) -> None:
        """Record the unserved chip and the backends that were considered."""

        self.chip = chip
        self.considered_backend_ids = tuple(considered_backend_ids)
        considered_text = ", ".join(self.considered_backend_ids) or "none"
        super().__init__(
            f"No available flash backend supports chip {chip!r} "
            f"(considered backends: {considered_text})"
        )


@dataclass(frozen=True)
class FlashRequest:
    """Normalized inputs for one backend flash.

    The request carries firmware images only. It deliberately has no collection,
    package, or source-upload fields: node-package source deployment is decided
    in the web app and never travels through this seam.

    ``log_callback`` is the same ``(stream, text)`` sink the build path uses, so a
    streaming caller receives the tool's output line by line while the flash runs.
    The protocol stays synchronous: the backend blocks until the tool exits.
    """

    board_spec: BoardSpec
    port: str
    firmware_path: Path
    wipe_filesystem: bool = False
    timeout_seconds: float | None = None
    monitor: bool = False
    log_callback: LogCallback | None = None


@dataclass(frozen=True)
class FlashResult:
    """Outcome of one backend flash."""

    exit_code: int
    backend_id: str
    port: str
    firmware_path: Path
    message: str | None = None


@runtime_checkable
class FlashBackend(Protocol):
    """Structural contract every firmware flash backend implements.

    Implementations are synchronous: ``flash()`` blocks until the tool exits and
    reports progress exclusively through the ``on_event`` callback, which keeps
    the protocol free of event-loop concerns.
    """

    id: str

    def status(self) -> BackendStatus:
        """Return an availability snapshot without touching a device."""

        ...

    def supported_chips(self) -> tuple[str, ...]:
        """Return the normalized chip ids this backend can flash."""

        ...

    def flash(
        self,
        request: FlashRequest,
        on_event: StreamCallback | None = None,
    ) -> FlashResult:
        """Flash the image in *request*, reporting progress to *on_event*."""

        ...

"""Build backend protocol and the value types that cross the seam.

A build backend turns one :class:`BuildRequest` into a firmware image with one
toolchain family (ESP-IDF today). The seam exists so the compile pipeline can
gain further toolchains without touching the CLI contract documented in
``docs/dev/firmware-compile/backend-compile-interface-contract.md``.

Only contract types live here. Concrete adapters (for example ``esp_idf``) must
never be imported from this module so that importing the contract stays free of
toolchain-side effects.
"""

from __future__ import annotations

import threading
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal, Protocol, runtime_checkable

from ..build_profile import ModulePackagingMode
from ..resolved_contents import ResolvedContents

if TYPE_CHECKING:  # pragma: no cover - typing only, keeps the adapter graph flat
    from ..board_target import BoardTarget
    from ..build_orchestration import BuildOrchestrationResult
    from ..staging_models import ConstituentVersions

BuildEventKind = Literal["status", "stage", "log", "artifact", "error"]

StreamCallback = Callable[["BuildEvent"], None]


class BuildBackendError(RuntimeError):
    """Base class for structured build-backend selection failures."""


class UnknownBuildBackendError(BuildBackendError):
    """Raised when a backend id does not resolve to a known backend."""

    def __init__(self, backend_id: str, *, known_backend_ids: Iterable[str] = ()) -> None:
        """Record the rejected id and the ids that were known at lookup time."""

        self.backend_id = backend_id
        self.known_backend_ids = tuple(known_backend_ids)
        known_text = ", ".join(self.known_backend_ids) or "none"
        super().__init__(f"Unknown build backend: {backend_id!r} (known backends: {known_text})")


class BuildBackendUnavailableError(BuildBackendError):
    """Raised when a hard-selected backend reports that it cannot run."""

    def __init__(self, backend_id: str, *, detail: str | None = None) -> None:
        """Record the unavailable backend and the reported detail, if any."""

        self.backend_id = backend_id
        self.detail = detail
        message = f"Build backend {backend_id!r} is unavailable"
        if detail:
            message = f"{message}: {detail}"
        super().__init__(message)


class UnsupportedBuildTargetError(BuildBackendError):
    """Raised when the selected backend cannot build the requested target."""

    def __init__(
        self,
        backend_id: str,
        target: str,
        *,
        supported_targets: Iterable[str] = (),
    ) -> None:
        """Record the rejected target and the targets the backend does support."""

        self.backend_id = backend_id
        self.target = target
        self.supported_targets = tuple(supported_targets)
        supported_text = ", ".join(self.supported_targets) or "none"
        super().__init__(
            f"Build backend {backend_id!r} does not support target {target!r} "
            f"(supported targets: {supported_text})"
        )


class NoAvailableBuildBackendError(BuildBackendError):
    """Raised when ``auto`` selection finds no backend that can build a target."""

    def __init__(self, target: str, *, considered_backend_ids: Iterable[str] = ()) -> None:
        """Record the unserved target and the backends that were considered."""

        self.target = target
        self.considered_backend_ids = tuple(considered_backend_ids)
        considered_text = ", ".join(self.considered_backend_ids) or "none"
        super().__init__(
            f"No available build backend supports target {target!r} "
            f"(considered backends: {considered_text})"
        )


@dataclass(frozen=True)
class BackendStatus:
    """Cheap availability snapshot for one backend.

    ``status()`` implementations must not start a build or require a populated
    workspace; they report what the local environment offers right now.
    """

    backend_id: str
    available: bool
    version: str | None = None
    detail: str | None = None
    missing_requirements: tuple[str, ...] = ()


@dataclass(frozen=True)
class BuildRequest:
    """Normalized inputs for one backend build.

    ``target`` is the backend-typed board; ``contents`` is the backend-agnostic
    content inventory. The remaining fields are build inputs the backend owns:
    it derives the staging destination, the precompile decision, the toolchain
    command, and the artifact location from them.
    """

    target: BoardTarget
    contents: ResolvedContents
    workspace_root: Path
    micropython_root: Path
    device_root: Path
    packaging_mode: ModulePackagingMode
    optimization_level: int | None
    modules_path: Path | None = None
    embedded_inventory_output: Path | None = None
    clean_build: bool = False
    dry_run: bool = False
    package_ids: tuple[str, ...] | None = None
    package_variants: Mapping[str, str] | None = None
    constituent_versions: ConstituentVersions | None = None
    addons_root: Path | None = None
    log_callback: Callable[[str, str], None] | None = None
    cancel_event: threading.Event | None = None
    timeout_seconds: float | None = None


@dataclass(frozen=True)
class BuildResult:
    """Outcome of one backend build."""

    exit_code: int
    backend_id: str
    artifact_path: Path | None = None
    orchestration: BuildOrchestrationResult | None = None


@dataclass(frozen=True)
class BuildEvent:
    """One progress notification emitted by a backend during ``build()``.

    ``kind`` is one of ``status``, ``stage``, ``log``, ``artifact``, or
    ``error``. Iteration-1 backends emit ``stage`` events for pipeline
    boundaries and a single ``error`` event before re-raising; ``log`` and
    ``artifact`` streaming arrive with the M3 server-side work.
    """

    kind: BuildEventKind
    message: str
    payload: Mapping[str, Any] | None = None


@runtime_checkable
class BuildBackend(Protocol):
    """Structural contract every firmware build backend implements.

    Implementations are synchronous: ``build()`` blocks until the toolchain
    completes and reports progress exclusively through the ``on_event``
    callback, which keeps the protocol free of event-loop concerns.
    """

    id: str

    def status(self) -> BackendStatus:
        """Return an availability snapshot without starting a build."""

        ...

    def supported_targets(self) -> tuple[str, ...]:
        """Return the compile targets this backend can build."""

        ...

    def embedding(self) -> Literal["mpy-freeze", "none"]:
        """Return how this backend embeds node packages into firmware.

        ``mpy-freeze`` backends freeze package sources into the image; ``none``
        backends cannot embed packages, so every declared package flows through
        the source-upload path instead.
        """

        ...

    def resolve_name(self, name: str, *, micropython_root: Path) -> BoardTarget | None:
        """Return a backend-typed target for an off-catalog *name*, or ``None``.

        This is the backend-owned fallback for board names that are not in the
        board catalog. A backend that has no naming convention beyond the
        catalog returns ``None``.
        """

        ...

    def build(
        self,
        request: BuildRequest,
        on_event: StreamCallback | None = None,
    ) -> BuildResult:
        """Run one build for *request*, reporting progress to *on_event*."""

        ...

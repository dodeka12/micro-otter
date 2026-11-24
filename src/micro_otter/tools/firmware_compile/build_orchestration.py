"""Shared build orchestration: resolve, select, delegate.

This module is the shared, backend-agnostic half of the compile pipeline. It
resolves the backend-typed board target and the content inventory, selects the
build backend, and delegates the actual build. The streamed-subprocess plumbing
lives in ``process_stream`` so the flash path shares it; the MicroPython-specific
staging, toolchain command, and artifact discovery live in the ``esp-idf``
backend.
"""

from __future__ import annotations

import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .backends import select_backend
from .backends.base import BuildEvent, BuildRequest, StreamCallback
from .board_target import resolve_board_target
from .build_profile import BuildProfile
from .process_stream import LogCallback, ProcessCancelled, ProcessTimeout
from .resolved_contents import build_resolved_contents
from .staging_models import ConstituentVersions, StagingExecutionReport
from .staging_resolver import resolve_runtime_payload

StageCallback = Callable[[str, Mapping[str, Any]], None]
"""Signature for stage-boundary notifications emitted during orchestration."""

class BuildCancelled(ProcessCancelled):
    """Raised when a build was cancelled through ``cancel_event``.

    Cancellation is best effort at the process boundary: ``staging`` and
    ``precompile`` run in-process and are not interruptible, so a cancel that
    arrives during staging is observed only when the subprocess starts.
    """

    def __init__(self) -> None:
        """Record the canonical cancellation message."""

        super().__init__("build cancelled")


class BuildTimeout(ProcessTimeout):
    """Raised when a build exceeded its ``timeout_seconds`` budget."""

    def __init__(self, timeout_seconds: float) -> None:
        """Record the budget that was exceeded."""

        super().__init__(timeout_seconds, f"build timed out after {timeout_seconds:g}s")


@dataclass(frozen=True)
class BuildOrchestrationPlan:
    """High-level plan object for one compile pipeline execution."""

    profile: BuildProfile
    command: Any


@dataclass(frozen=True)
class BuildOrchestrationResult:
    """Composite result for the orchestration sequence.

    ``preflight`` and ``precompile`` are backend-owned result types, so they are
    kept untyped here to avoid importing the MicroPython pipeline modules into
    this shared, backend-agnostic layer.
    """

    plan: BuildOrchestrationPlan
    preflight: Any
    staging_report: StagingExecutionReport
    precompile: Any
    build_exit_code: int | None
    artifact_path: Path | None = None


def _notify_stage(
    callback: StageCallback | None,
    stage: str,
    payload: Mapping[str, Any],
) -> None:
    """Forward one stage boundary to *callback* when a callback is configured."""

    if callback is None:
        return
    callback(stage, payload)


def _stage_event_adapter(stage_callback: StageCallback | None) -> StreamCallback | None:
    """Return an ``on_event`` sink that forwards backend ``stage`` events."""

    if stage_callback is None:
        return None

    def on_event(event: BuildEvent) -> None:
        """Forward one backend stage event to the caller's stage callback."""

        if event.kind == "stage":
            stage_callback(event.message, dict(event.payload or {}))

    return on_event



def run_build_orchestration(
    *,
    profile: BuildProfile,
    runtime_id: str,
    target: str,
    workspace_root: Path,
    micropython_root: Path,
    modules_path: Path | None,
    device_root: Path,
    embedded_inventory_output: Path | None,
    clean_build: bool,
    dry_run: bool,
    package_ids: tuple[str, ...] | None = None,
    package_variants: Mapping[str, str] | None = None,
    constituent_versions: ConstituentVersions | None = None,
    addons_root: Path | None = None,
    stage_callback: StageCallback | None = None,
    log_callback: LogCallback | None = None,
    cancel_event: threading.Event | None = None,
    timeout_seconds: float | None = None,
) -> BuildOrchestrationResult:
    """Resolve the target and contents, select the backend, and delegate the build.

    The shared layer resolves *what* goes into the firmware and hands the
    backend-typed target plus the content inventory to the selected backend; the
    backend owns staging, precompile, the toolchain command, and artifact
    discovery. ``stage_callback`` is bridged to the backend's ``on_event``
    stream, while ``log_callback``/``cancel_event``/``timeout_seconds`` are
    passed through the request to the backend's subprocess execution.
    """

    board_target = resolve_board_target(
        name=profile.board,
        runtime_id=runtime_id,
        workspace_root=workspace_root,
        micropython_root=micropython_root,
    )

    backend = select_backend(
        target=board_target.chip or board_target.build_params.get("port") or target,
        board_default=board_target.build_backend,
    )

    payload = resolve_runtime_payload(
        workspace_root=workspace_root,
        runtime_id=runtime_id,
        target=target,
        board=profile.board,
        package_ids=package_ids,
        package_variants=package_variants,
        device_root=device_root,
        addons_root=addons_root,
    )
    contents = build_resolved_contents(
        payload,
        embedding=backend.embedding(),
        constituent_versions=constituent_versions,
    )

    request = BuildRequest(
        target=board_target,
        contents=contents,
        workspace_root=workspace_root,
        micropython_root=micropython_root,
        device_root=device_root,
        packaging_mode=profile.packaging_mode,
        optimization_level=profile.optimization_level,
        modules_path=modules_path,
        embedded_inventory_output=embedded_inventory_output,
        clean_build=clean_build,
        dry_run=dry_run,
        package_ids=package_ids,
        package_variants=package_variants,
        constituent_versions=constituent_versions,
        addons_root=addons_root,
        log_callback=log_callback,
        cancel_event=cancel_event,
        timeout_seconds=timeout_seconds,
    )

    result = backend.build(request, on_event=_stage_event_adapter(stage_callback))
    if result.orchestration is None:
        raise RuntimeError(f"build backend {backend.id!r} returned no orchestration result")
    return result.orchestration


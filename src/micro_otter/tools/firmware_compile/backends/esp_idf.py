"""ESP-IDF/MicroPython build backend.

This adapter owns every MicroPython-specific behaviour of the compile pipeline:
the ``make`` command, the staging destination, the optional ``.mpy`` precompile,
and the ``build-*/firmware.bin`` artifact discovery. The shared orchestration
layer only resolves the backend-typed target and the content inventory and then
delegates here.
"""

from __future__ import annotations

import os
import shutil
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

from micro_otter.config import ConfigError, get_config
from micro_otter.toolchain import ToolchainAssetsNotFound

from ..board_target import BoardTarget
from ..build_artifact import discover_firmware_artifact, verify_frozen_module_names
from ..build_orchestration import (
    BuildCancelled,
    BuildOrchestrationPlan,
    BuildOrchestrationResult,
    BuildTimeout,
    StageCallback,
    _notify_stage,
)
from ..build_precompile import PrecompileResult, run_optional_mpy_precompile
from ..build_preflight import run_build_preflight
from ..build_profile import BuildProfile
from ..build_toolchain import build_micropython_command, prepend_clean_target
from ..process_stream import discard_log, run_streamed_process
from ..staging_runner import run_staging
from .base import BackendStatus, BuildEvent, BuildRequest, BuildResult, StreamCallback

BACKEND_ID = "esp-idf"

SUPPORTED_TARGETS: tuple[str, ...] = ("esp32", "esp32s2", "esp32s3")


def _is_port_directory(candidate: Path) -> bool:
    """Return True when *candidate* is a real MicroPython port directory.

    MicroPython port directories always ship a ``Makefile``; requiring it keeps
    stray staging artifacts (for example ``ports/<board>/modules``) from being
    mistaken for a port when a board name collides with a directory name.
    """

    return candidate.is_dir() and (candidate / "Makefile").is_file()


def _resolve_idf_py() -> str | None:
    """Return the resolved ``idf.py`` command, preferring the repository launcher.

    The repository-owned launcher wins over a ``PATH`` lookup so a checkout works
    without a container shim; ``shutil.which`` stays as the fallback for
    toolchains installed by other means. ``None`` means no launcher is available
    at all.
    """

    try:
        launcher = get_config().idf_py
    except (ConfigError, ToolchainAssetsNotFound):
        launcher = None
    if launcher is not None and launcher.is_file():
        return str(launcher)
    return shutil.which("idf.py")


def _detect_idf_version() -> str | None:
    """Return the ESP-IDF version from ``<idf_path>/version.txt`` when readable.

    Reading the pinned checkout avoids spawning ``idf.py --version`` (and the
    Python environment it would initialise) from a status probe.
    """

    try:
        idf_path = get_config().idf_path
    except ConfigError:
        return None
    try:
        version_text = (idf_path / "version.txt").read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return version_text or None


def _emit(callback: StreamCallback | None, event: BuildEvent) -> None:
    """Deliver *event* to *callback* when one is configured."""

    if callback is None:
        return
    callback(event)


def _make_stage_sink(on_event: StreamCallback) -> Callable[[str, Mapping[str, Any]], None]:
    """Return an orchestration stage callback that emits ``stage`` events."""

    def stage_sink(stage: str, payload: Mapping[str, Any]) -> None:
        """Forward one orchestration stage boundary as a build event."""

        _emit(on_event, BuildEvent(kind="stage", message=stage, payload=payload))

    return stage_sink


def _require_idf_launcher() -> None:
    """Raise ``OSError`` when no ``idf.py`` launcher can be resolved."""

    if _resolve_idf_py() is None:
        raise OSError(
            "Required ESP-IDF tool not found: idf.py. Source your ESP-IDF environment "
            "(for example: '. $IDF_PATH/export.sh') before running esp32 firmware compile. "
            "hint: micro-otter toolchain install"
        )


def _build_command_env(target: str) -> dict[str, str] | None:
    """Return environment overrides needed for deterministic target builds.

    Only esp32 builds get an override, and only when the caller's environment
    does not already carry ``IDF_PATH`` from an activated ESP-IDF shell.
    """

    if target.lower() != "esp32":
        return None
    if os.environ.get("IDF_PATH"):
        return None
    try:
        return get_config().toolchain_env()
    except (ConfigError, ToolchainAssetsNotFound):
        return None


def _discover_artifact(request: BuildRequest) -> Path | None:
    """Return the produced ``firmware.bin`` for *request*, or ``None`` when absent."""

    port = request.target.build_params.get("port", request.target.name)
    record = discover_firmware_artifact(
        micropython_root=request.micropython_root,
        target=port,
        board=request.target.name,
        require_exists=False,
    )
    return record.path if record is not None else None


def _run_esp_idf_pipeline(
    request: BuildRequest,
    stage_callback: StageCallback | None,
) -> BuildOrchestrationResult:
    """Run the esp-idf pipeline: preflight → staging → precompile → make.

    This is the backend-owned body that the shared orchestration used to hold:
    it derives the ``make`` command from the backend-typed target, stages the
    content, optionally precompiles it, and executes the toolchain.
    """

    target = request.target
    profile = BuildProfile(
        runtime_id=request.contents.runtime_id,
        board=target.name,
        packaging_mode=request.packaging_mode,
        optimization_level=request.optimization_level,
    )
    port = target.build_params.get("port", target.name)
    micropython_root = request.micropython_root

    if port.lower() == "esp32":
        _require_idf_launcher()

    command = build_micropython_command(profile=profile, micropython_root=micropython_root)
    if request.clean_build:
        command = prepend_clean_target(command)

    plan = BuildOrchestrationPlan(profile=profile, command=command)

    def _precompile_hook(
        modules_path: Path,
        source_excludes: tuple[str, ...],
        staged_paths: tuple[str, ...],
    ) -> PrecompileResult:
        """Run the optional mpy precompile step inside staging."""

        _notify_stage(
            stage_callback,
            "precompile",
            {"packaging_mode": profile.packaging_mode.value, "dry_run": request.dry_run},
        )
        return run_optional_mpy_precompile(
            profile=profile,
            micropython_root=micropython_root,
            modules_path=modules_path,
            dry_run=request.dry_run,
            source_excludes=source_excludes,
            staged_paths=staged_paths,
        )

    _notify_stage(stage_callback, "preflight", {"target": port, "board": target.name})
    preflight = run_build_preflight(
        profile=profile,
        micropython_root=micropython_root,
        port=port,
    )

    _notify_stage(
        stage_callback,
        "staging",
        {"runtime_id": request.contents.runtime_id, "dry_run": request.dry_run},
    )
    staging_report = run_staging(
        workspace_root=request.workspace_root,
        runtime_id=request.contents.runtime_id,
        target=port,
        board=target.name,
        micropython_root=micropython_root,
        modules_path=request.modules_path,
        device_root=request.device_root,
        embedded_inventory_output=request.embedded_inventory_output,
        dry_run=request.dry_run,
        constituent_versions=request.constituent_versions,
        package_ids=request.package_ids,
        package_variants=request.package_variants,
        mpy_precompile_hook=_precompile_hook,
        addons_root=request.addons_root,
    )

    precompile = staging_report.precompile or PrecompileResult(
        files_compiled=0,
        sources_removed=0,
        compiler_path=None,
    )

    build_exit_code: int | None = None
    if request.dry_run or staging_report.conflicts:
        _notify_stage(
            stage_callback,
            "build-skip",
            {"reason": "dry-run" if request.dry_run else "staging-conflicts"},
        )
    else:
        _notify_stage(
            stage_callback,
            "build-start",
            {"argv": list(plan.command.argv), "cwd": str(plan.command.cwd)},
        )
        command_env = _build_command_env(port)
        build_exit_code = run_streamed_process(
            argv=list(plan.command.argv),
            cwd=plan.command.cwd,
            env=command_env,
            log_callback=request.log_callback or discard_log,
            cancel_event=request.cancel_event,
            timeout_seconds=request.timeout_seconds,
            cancelled_error=BuildCancelled,
            timeout_error=BuildTimeout,
        )
        _notify_stage(stage_callback, "build-finish", {"exit_code": build_exit_code})

    artifact_path: Path | None = None
    if build_exit_code == 0 and not request.dry_run and not staging_report.conflicts:
        artifact = _discover_artifact(request)
        if artifact is not None:
            verify_frozen_module_names(artifact.parent / "frozen_content.c")
            artifact_path = artifact

    return BuildOrchestrationResult(
        plan=plan,
        preflight=preflight,
        staging_report=staging_report,
        precompile=precompile,
        build_exit_code=build_exit_code,
        artifact_path=artifact_path,
    )



class EspIdfBackend:
    """Build backend adapter over the MicroPython/ESP-IDF make pipeline."""

    id = BACKEND_ID

    def status(self) -> BackendStatus:
        """Return an availability snapshot from the resolved ``idf.py``."""

        idf_py = _resolve_idf_py()
        if idf_py is None:
            return BackendStatus(
                backend_id=self.id,
                available=False,
                detail=(
                    "idf.py not found; run 'micro-otter toolchain install' or source the "
                    "ESP-IDF environment (for example: '. $IDF_PATH/export.sh')"
                ),
                missing_requirements=("idf.py",),
            )
        return BackendStatus(
            backend_id=self.id,
            available=True,
            version=_detect_idf_version(),
            detail=idf_py,
        )

    def supported_targets(self) -> tuple[str, ...]:
        """Return the ESP32 compile targets the MicroPython port supports."""

        return SUPPORTED_TARGETS

    def embedding(self) -> str:
        """Return ``mpy-freeze``: esp-idf freezes package sources into the image."""

        return "mpy-freeze"

    def resolve_name(self, name: str, *, micropython_root: Path) -> BoardTarget | None:
        """Return a target for an off-catalog MicroPython board name, or ``None``.

        Reproduces the MicroPython port probe: a name that names a port directory
        (exactly, or lower-cased) becomes the port; otherwise the segment before
        the first ``_`` is tried as the port with ``BOARD=<name>``.
        """

        ports_root = (micropython_root / "ports").resolve()
        direct = ports_root / name
        lower = ports_root / name.lower()
        if _is_port_directory(direct):
            port = name
        elif _is_port_directory(lower):
            port = name.lower()
        else:
            hint = name.split("_", 1)[0].lower()
            if (ports_root / hint).is_dir():
                port = hint
            else:
                return None
        return BoardTarget.from_board_name(name, port=port)

    def build(
        self,
        request: BuildRequest,
        on_event: StreamCallback | None = None,
    ) -> BuildResult:
        """Run the MicroPython/ESP-IDF pipeline for *request*.

        Orchestration exceptions (missing ``idf.py``, unknown MicroPython
        targets, staging conflicts, subprocess failures) propagate unchanged so
        CLI exit-code mapping keeps working; the adapter only adds an ``error``
        event before re-raising.
        """

        stage_callback = None if on_event is None else _make_stage_sink(on_event)
        try:
            orchestration = _run_esp_idf_pipeline(request, stage_callback)
        except Exception as error:
            _emit(
                on_event,
                BuildEvent(
                    kind="error",
                    message=str(error) or type(error).__name__,
                    payload={"exception": type(error).__name__},
                ),
            )
            raise

        return BuildResult(
            exit_code=orchestration.build_exit_code or 0,
            backend_id=self.id,
            artifact_path=orchestration.artifact_path,
            orchestration=orchestration,
        )


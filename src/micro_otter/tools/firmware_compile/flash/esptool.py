"""esptool flash backend adapter.

The adapter is a thin translation layer: it reproduces the exact ``esptool``
command sequence the CLI already uses for ``mo dr --firmware`` and converts the
existing failure categories into :class:`FlashBackendError` subclasses that keep
the same exit codes. It flashes firmware images only; collection package source
upload is never routed through here.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from ..backends.base import BackendStatus, BuildEvent, StreamCallback
from ..process_stream import (
    LogCallback,
    ProcessTimeout,
    discard_log,
    emit_event,
    run_streamed_process,
)
from .base import (
    FirmwareImageNotFoundError,
    FlashCommandError,
    FlashRequest,
    FlashResult,
    FlashToolMissingError,
    MonitorNotSupportedError,
)

BACKEND_ID = "esptool"

TOOL_NAME = "esptool"

SUPPORTED_CHIPS: tuple[str, ...] = ("esp32", "esp32s2", "esp32s3")


def _run_tool(
    argv: list[str],
    *,
    timeout_seconds: float | None,
    log_callback: LogCallback | None,
) -> None:
    """Run one flash tool invocation, streaming its output through the tool sink.

    The call goes through the shared process seam, so a flash reports its output
    line by line exactly like a build does, and every line reaches *log_callback*
    verbatim — including each progress-bar redraw. Nothing here parses the tool's
    wording: the sink is a console transcript, and an adapter that filtered or
    rewrote lines would hide what the tool actually did.

    ``ProcessTimeout`` is raised on a timeout and ``subprocess.CalledProcessError``
    on a non-zero exit; ``flash()`` maps both onto the structured flash errors.
    """

    run_streamed_process(
        argv=argv,
        log_callback=log_callback or discard_log,
        timeout_seconds=timeout_seconds,
    )


class EsptoolFlashBackend:
    """Flash backend adapter over a direct ``esptool write-flash`` invocation."""

    id = BACKEND_ID

    def status(self) -> BackendStatus:
        """Report whether ``esptool`` is on ``PATH`` without probing a device."""

        tool_path = shutil.which(TOOL_NAME)
        if tool_path is None:
            return BackendStatus(
                backend_id=self.id,
                available=False,
                detail=(
                    "esptool not found on PATH; install the toolchain "
                    "(see deploy/toolchain/bootstrap.sh) before flashing"
                ),
                missing_requirements=(TOOL_NAME,),
            )
        return BackendStatus(backend_id=self.id, available=True, detail=tool_path)

    def supported_chips(self) -> tuple[str, ...]:
        """Return the chips the esptool adapter flashes firmware images for."""

        return SUPPORTED_CHIPS

    def flash(
        self,
        request: FlashRequest,
        on_event: StreamCallback | None = None,
    ) -> FlashResult:
        """Flash ``request.firmware_path`` to ``request.port`` with esptool.

        Validation happens before the tool runs: a missing image raises
        :class:`FirmwareImageNotFoundError` and a monitor request raises
        :class:`MonitorNotSupportedError`. Every failure also emits one ``error``
        event so a streaming caller sees the category without catching.
        """

        firmware_path = Path(request.firmware_path).resolve()
        if not firmware_path.is_file():
            error = FirmwareImageNotFoundError(firmware_path)
            self._emit_error(on_event, error)
            raise error
        if request.monitor:
            monitor_error = MonitorNotSupportedError()
            self._emit_error(on_event, monitor_error)
            raise monitor_error

        board_spec = request.board_spec
        base_argv = [TOOL_NAME, "--chip", board_spec.chip, "--port", request.port]

        try:
            if request.wipe_filesystem:
                self._erase(base_argv, request, on_event)
            self._write(base_argv, firmware_path, request, on_event)
        except FileNotFoundError as error:
            missing = FlashToolMissingError(TOOL_NAME, detail=str(error))
            self._emit_error(on_event, missing)
            raise missing from error
        except ProcessTimeout as error:
            timed_out = FlashCommandError(TOOL_NAME, -1, argv=base_argv)
            self._emit_error(on_event, timed_out)
            raise timed_out from error
        except subprocess.CalledProcessError as error:
            failed = FlashCommandError(TOOL_NAME, error.returncode, argv=base_argv)
            self._emit_error(on_event, failed)
            raise failed from error

        emit_event(
            on_event,
            BuildEvent(
                kind="stage",
                message="write-finish",
                payload={
                    "port": request.port,
                    "chip": board_spec.chip,
                    "offset": board_spec.flash_params.get("offset", "0x1000"),
                },
            ),
        )
        message = f"Flashed {firmware_path.name} to {request.port}."
        emit_event(
            on_event,
            BuildEvent(
                kind="status",
                message="done",
                payload={
                    "port": request.port,
                    "chip": board_spec.chip,
                    "firmware": str(firmware_path),
                },
            ),
        )
        return FlashResult(
            exit_code=0,
            backend_id=self.id,
            port=request.port,
            firmware_path=firmware_path,
            message=message,
        )

    def _erase(
        self,
        base_argv: list[str],
        request: FlashRequest,
        on_event: StreamCallback | None,
    ) -> None:
        """Erase the whole flash when the request asks for a filesystem wipe."""

        payload = {"port": request.port, "chip": request.board_spec.chip}
        emit_event(on_event, BuildEvent(kind="stage", message="erase-start", payload=payload))
        _run_tool(
            [*base_argv, "erase-flash"],
            timeout_seconds=request.timeout_seconds,
            log_callback=request.log_callback,
        )
        emit_event(on_event, BuildEvent(kind="stage", message="erase-finish", payload=payload))

    def _write(
        self,
        base_argv: list[str],
        firmware_path: Path,
        request: FlashRequest,
        on_event: StreamCallback | None,
    ) -> None:
        """Write the merged firmware image at the board's catalog offset."""

        offset = request.board_spec.flash_params.get("offset", "0x1000")
        emit_event(
            on_event,
            BuildEvent(
                kind="stage",
                message="write-start",
                payload={
                    "port": request.port,
                    "chip": request.board_spec.chip,
                    "offset": offset,
                    "firmware": str(firmware_path),
                },
            ),
        )
        _run_tool(
            [*base_argv, "write-flash", "-z", offset, str(firmware_path)],
            timeout_seconds=request.timeout_seconds,
            log_callback=request.log_callback,
        )

    def _emit_error(self, on_event: StreamCallback | None, error: Exception) -> None:
        """Emit one ``error`` event for *error* before it is raised."""

        exit_code = getattr(error, "exit_code", 1)
        emit_event(
            on_event,
            BuildEvent(
                kind="error",
                message=str(error) or type(error).__name__,
                payload={"exception": type(error).__name__, "exit_code": exit_code},
            ),
        )

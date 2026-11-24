"""Tests for ``WS /firmware``: frame validation, serializers, and the job runner.

The validation half is pure and fast. The runner half starts the real bridge on
an ephemeral port and drives it with the real ``websockets`` client, while every
job collaborator (compile path, flash helper, scan) is patched, so no build, tool,
or device is touched.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import socket
import threading
import time
from collections.abc import AsyncIterator
from dataclasses import replace
from pathlib import Path
from unittest import mock

import pytest
from websockets.asyncio.client import connect as ws_connect

from micro_otter.config import load_config
from micro_otter.tools import serial_bridge
from micro_otter.tools.addon_archive import AddonInstallError, AddonInstallResult
from micro_otter.tools.firmware_compile import (
    CompileRuntimeExecutionResult,
    FirmwareArtifactRecord,
    FirmwareInventoryEntry,
    FirmwareInventoryError,
)
from micro_otter.tools.firmware_compile.backends import BuildEvent
from micro_otter.tools.firmware_compile.board_registry import BoardSpec
from micro_otter.tools.firmware_compile.build_orchestration import BuildCancelled, BuildTimeout
from micro_otter.tools.firmware_compile.firmware_deploy import FirmwareDeployReport
from micro_otter.tools.firmware_compile.local_package_scan import (
    LocalPackageRecord,
    LocalPackageScan,
)
from micro_otter.tools.firmware_compile.target_mapping import (
    WebBaseTargetNoMappingError,
    WebBaseTargetUnknownError,
    WebTargetResolution,
    WebTargetUnknownError,
)
from micro_otter.tools.firmware_ws_handler import (
    ADDON_ERROR_CODES,
    CODE_BASE_NO_MAPPING,
    CODE_BASE_TARGET_UNKNOWN,
    CODE_COMPILE_DISABLED,
    CODE_FIRMWARE_PATH_INVALID,
    CODE_INTERNAL_ERROR,
    CODE_INVALID_FRAME,
    CODE_JOB_BUSY,
    CODE_TARGET_UNKNOWN,
    CODE_UNKNOWN_FRAME_TYPE,
    ERROR_CODES,
    FIRMWARE_PATH,
    AddonInstallRequest,
    AddonUninstallRequest,
    CancelRequest,
    CompileJobRequest,
    DeleteRequest,
    DeployJobRequest,
    ExportRequest,
    FirmwareFrameError,
    FsListRequest,
    ImportBinaryRequest,
    ImportRequest,
    ListRequest,
    ScanJobRequest,
    _device_root,
    _job_kind,
    build_error_frame,
    build_output_frame,
    build_result_frame,
    build_status_frame,
    parse_client_frame,
)

_HANDLER_MODULE = "micro_otter.tools.firmware_ws_handler"


def _frame(**fields: object) -> str:
    """Serialize one client frame from keyword fields."""

    return json.dumps(fields)


# --- 5.1 frame contract ------------------------------------------------------


def test_compile_frame_requires_runtime_and_board():
    with pytest.raises(FirmwareFrameError) as excinfo:
        parse_client_frame(_frame(type="compile.start", board="esp32"))

    assert excinfo.value.code == CODE_INVALID_FRAME
    assert excinfo.value.details == {"field": "runtimeId"}

    with pytest.raises(FirmwareFrameError) as excinfo:
        parse_client_frame(_frame(type="compile.start", runtimeId="general"))

    assert excinfo.value.details == {"field": "board"}


def test_compile_frame_accepts_target_id_instead_of_board():
    request = parse_client_frame(
        _frame(type="compile.start", runtimeId="general", targetId="esp32_s3_mini")
    )

    assert isinstance(request, CompileJobRequest)
    assert request.board is None
    assert request.target_id == "esp32_s3_mini"


def test_deploy_frame_accepts_target_id_instead_of_board():
    request = parse_client_frame(
        _frame(type="deploy.start", targetId="esp32_s3_mini", port="/dev/ttyUSB0")
    )

    assert isinstance(request, DeployJobRequest)
    assert request.board is None
    assert request.target_id == "esp32_s3_mini"


def test_deploy_frame_with_neither_board_nor_target_id_errors():
    with pytest.raises(FirmwareFrameError) as excinfo:
        parse_client_frame(_frame(type="deploy.start", port="/dev/ttyUSB0"))

    assert excinfo.value.details == {"field": "board"}


def test_compile_frame_parses_optional_fields():
    request = parse_client_frame(
        _frame(
            type="compile.start",
            runtimeId=" general ",
            board="esp32",
            targetId="esp32",
            packageIds=["core", " ", "audio"],
            modulePackagingMode="compiled-mpy",
            cleanBuild=True,
            timeoutSeconds=120,
        )
    )

    assert isinstance(request, CompileJobRequest)
    assert request.runtime_id == "general"
    assert request.target_id == "esp32"
    assert request.package_ids == ("core", "audio")
    assert request.module_packaging_mode == "compiled-mpy"
    assert request.clean_build is True
    assert request.timeout_seconds == 120.0


def test_compile_frame_parses_package_variants():
    request = parse_client_frame(
        _frame(
            type="compile.start",
            runtimeId="general",
            board="esp32",
            packageVariants={"pulse": "py", "audio": " ", "core": ""},
        )
    )

    assert isinstance(request, CompileJobRequest)
    assert request.package_variants == (("pulse", "py"),)


def test_compile_frame_rejects_a_non_string_package_variants_map():
    with pytest.raises(FirmwareFrameError):
        parse_client_frame(
            _frame(
                type="compile.start",
                runtimeId="general",
                board="esp32",
                packageVariants={"pulse": 7},
            )
        )


def test_deploy_frame_parses_port_and_flags():
    request = parse_client_frame(
        _frame(
            type="deploy.start",
            board="esp32",
            port="/dev/ttyUSB0",
            firmwarePath="/tmp/image.bin",
            backendId="esptool",
            wipeFilesystem=True,
            timeoutSeconds=30.5,
        )
    )

    assert isinstance(request, DeployJobRequest)
    assert request.port == "/dev/ttyUSB0"
    assert request.firmware_path == "/tmp/image.bin"
    assert request.backend_id == "esptool"
    assert request.wipe_filesystem is True
    assert request.timeout_seconds == 30.5


def test_scan_frame_parses_runtime():
    request = parse_client_frame(_frame(type="scan-local", runtimeId="general"))

    assert isinstance(request, ScanJobRequest)
    assert request.runtime_id == "general"


def test_cancel_frame_has_no_fields():
    request = parse_client_frame(_frame(type="cancel", ignored="value"))

    assert isinstance(request, CancelRequest)


def test_unknown_type_is_rejected():
    with pytest.raises(FirmwareFrameError) as excinfo:
        parse_client_frame(_frame(type="firmware.explode"))

    assert excinfo.value.code == CODE_UNKNOWN_FRAME_TYPE
    assert excinfo.value.details == {"type": "firmware.explode"}


def test_malformed_json_is_invalid_frame():
    with pytest.raises(FirmwareFrameError) as excinfo:
        parse_client_frame("{not json")

    assert excinfo.value.code == CODE_INVALID_FRAME

    with pytest.raises(FirmwareFrameError):
        parse_client_frame("[]")


def test_wrong_field_type_is_invalid_frame():
    with pytest.raises(FirmwareFrameError) as excinfo:
        parse_client_frame(_frame(type="compile.start", runtimeId=7, board="esp32"))

    assert excinfo.value.details == {"field": "runtimeId"}

    with pytest.raises(FirmwareFrameError) as excinfo:
        parse_client_frame(
            _frame(type="deploy.start", board="esp32", port="/dev/x", wipeFilesystem="yes")
        )

    assert excinfo.value.details == {"field": "wipeFilesystem"}

    with pytest.raises(FirmwareFrameError) as excinfo:
        parse_client_frame(
            _frame(type="compile.start", runtimeId="general", board="esp32", timeoutSeconds=0)
        )

    assert excinfo.value.details == {"field": "timeoutSeconds"}


def test_unknown_extra_fields_are_ignored():
    request = parse_client_frame(
        _frame(type="scan-local", runtimeId="general", futureField={"nested": True})
    )

    assert isinstance(request, ScanJobRequest)


def test_error_frame_shape_is_stable():
    frame = json.loads(build_error_frame("job-busy", "busy", hint="wait", job="compile"))

    assert frame["type"] == "error"
    assert frame["job"] == "compile"
    assert frame["code"] == "job-busy"
    assert frame["category"] == "firmware"
    assert frame["message"] == "busy"
    assert frame["hint"] == "wait"
    assert "details" not in frame

    without_job = json.loads(build_error_frame(CODE_INVALID_FRAME, "bad"))
    assert "job" not in without_job


def test_status_output_and_result_frames_are_compact_json():
    status = json.loads(build_status_frame("compile", "running", stage="staging"))
    output = json.loads(build_output_frame("compile", "stdout", "line\n"))
    with_cleanup = json.loads(
        build_result_frame("scan", "succeeded", {"ok": True}, cleanup={"removedArtifact": None})
    )
    without_cleanup = json.loads(build_result_frame("scan", "succeeded", {"ok": True}))

    assert status == {"type": "status", "job": "compile", "state": "running", "stage": "staging"}
    assert output == {"type": "output", "job": "compile", "stream": "stdout", "text": "line\n"}
    assert with_cleanup["cleanup"] == {"removedArtifact": None}
    assert "cleanup" not in without_cleanup


def test_error_codes_are_unique_and_path_is_documented():
    assert len(ERROR_CODES) == len(set(ERROR_CODES))
    assert FIRMWARE_PATH == "/firmware"


def test_addon_error_codes_are_the_twenty_two_stable_codes():
    """The add-on family is a fixed contract: 22 codes, all part of the endpoint's set."""

    assert len(ADDON_ERROR_CODES) == 22
    assert len(set(ADDON_ERROR_CODES)) == 22
    assert set(ADDON_ERROR_CODES) <= set(ERROR_CODES)
    assert all(code.startswith("addon-") for code in ADDON_ERROR_CODES)


# --- runner harness ----------------------------------------------------------


def _free_port() -> int:
    """Return a port that is free right now on loopback."""

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@contextlib.asynccontextmanager
async def _firmware_socket() -> AsyncIterator[object]:
    """Serve the real bridge on an ephemeral port and open ``/firmware``."""

    bridge = serial_bridge._SerialBridge()
    port = _free_port()
    async with serial_bridge.serve(
        bridge._handler, "127.0.0.1", port, process_request=bridge._process_request
    ):
        async with ws_connect(f"ws://127.0.0.1:{port}/firmware") as websocket:
            yield websocket


async def _recv(websocket: object, *, wait_seconds: float = 10.0) -> dict:
    """Receive and parse one frame."""

    raw = await asyncio.wait_for(websocket.recv(), timeout=wait_seconds)
    return json.loads(raw)


async def _recv_until_terminal(
    websocket: object,
    *,
    wait_seconds: float = 10.0,
    collected: list[dict] | None = None,
) -> list[dict]:
    """Collect frames until the single terminal ``result`` or ``error`` frame."""

    frames: list[dict] = [] if collected is None else collected
    deadline = time.monotonic() + wait_seconds
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise AssertionError(f"no terminal frame within {wait_seconds}s; got {frames}")
        frame = await _recv(websocket, wait_seconds=remaining)
        frames.append(frame)
        if frame["type"] in ("result", "error"):
            return frames


async def _run_single_job(frame: dict, *, wait_seconds: float = 10.0) -> list[dict]:
    """Send one frame on a fresh connection and collect through the terminal frame."""

    async with _firmware_socket() as websocket:
        await websocket.send(json.dumps(frame))
        return await _recv_until_terminal(websocket, wait_seconds=wait_seconds)


def _config(tmp_path: Path) -> object:
    """Return a Config pointing every path at *tmp_path*."""

    return replace(
        load_config(env={}),
        workspace_root=tmp_path.resolve(),
        micropython_root=tmp_path.resolve(),
        addons_dir=(tmp_path / "addons").resolve(),
    )


def _board_spec() -> BoardSpec:
    """Return the esp32 catalog entry used by the runner tests."""

    return BoardSpec(
        name="esp32",
        slug="esp32",
        display_name="ESP32",
        chip="esp32",
        build_backend="esp-idf",
        flash_backend="esptool",
        build_params={"port": "esp32", "board": "esp32", "buildDirName": "build-ESP32_GENERIC"},
        flash_params={"offset": "0x1000"},
    )


def _s3_board_spec() -> BoardSpec:
    """Return the ESP32_GENERIC_S3 catalog entry used by the target-resolution tests."""

    return BoardSpec(
        name="ESP32_GENERIC_S3",
        slug="esp32_generic_s3",
        display_name="ESP32-S3",
        chip="esp32s3",
        build_backend="esp-idf",
        flash_backend="esptool",
        build_params={
            "port": "esp32",
            "board": "ESP32_GENERIC_S3",
            "buildDirName": "build-ESP32_GENERIC_S3",
        },
        flash_params={"offset": "0"},
    )


@contextlib.contextmanager
def _handler_env(config: object) -> AsyncIterator[None]:
    """Patch the handler's config lookup and board resolution for one test."""

    with (
        mock.patch(f"{_HANDLER_MODULE}.load_config", return_value=config),
        mock.patch(f"{_HANDLER_MODULE}.clear_config_cache"),
        mock.patch(f"{_HANDLER_MODULE}._resolve_board_spec", return_value=_board_spec()),
    ):
        yield


def _compile_result(*, exit_code: int = 0, errors: list[dict] | None = None) -> object:
    """Return a compile execution result shaped like the real payload."""

    entries = errors or []
    return CompileRuntimeExecutionResult(
        exit_code=exit_code,
        payload={
            "schemaVersion": 1,
            "status": "success" if exit_code == 0 else "failed",
            "errors": entries,
            "build": {"exitCode": exit_code},
        },
    )


def _compile_stub(**kwargs: object):
    """Return a fake ``execute_compile_runtime_request`` that streams and returns a result."""

    exit_code = int(kwargs.get("exit_code", 0))
    errors = kwargs.get("errors") or []
    events = kwargs.get("events") or (
        ("stage", "preflight"),
        ("stage", "staging"),
        ("stage", "build-start"),
        ("output", "make[1]: compiling\n"),
        ("stage", "build-finish"),
    )

    def fake_execute(
        request, *, stage_callback=None, log_callback=None, cancel_event=None, timeout_seconds=None
    ):
        """Replay the configured events, then return the configured result."""

        for kind, value in events:
            if kind == "stage" and stage_callback is not None:
                stage_callback(value, {})
            elif kind == "output" and log_callback is not None:
                log_callback("stdout", value)
        return _compile_result(exit_code=exit_code, errors=list(errors))

    return fake_execute


# --- 5.3 runner --------------------------------------------------------------


def test_compile_job_streams_status_and_output(tmp_path: Path):
    compile_frame = {
        "type": "compile.start",
        "runtimeId": "general",
        "board": "esp32",
        "packageIds": ["core"],
    }

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.execute_compile_runtime_request",
        side_effect=_compile_stub(),
    ):
        frames = asyncio.run(_run_single_job(compile_frame))

    stages = [frame["stage"] for frame in frames if "stage" in frame]
    assert stages == ["preflight", "staging", "build-start", "build-finish"]
    outputs = [frame for frame in frames if frame["type"] == "output"]
    assert [frame["text"] for frame in outputs] == ["make[1]: compiling\n"]
    terminals = [frame for frame in frames if frame["type"] in ("result", "error")]
    assert len(terminals) == 1
    assert terminals[0]["type"] == "result"
    assert terminals[0]["status"] == "succeeded"
    assert terminals[0]["payload"]["status"] == "success"
    assert frames[0] == {"type": "status", "job": "compile", "state": "queued"}


def test_target_id_only_compile_resolves_and_forwards_board(tmp_path: Path):
    resolution = WebTargetResolution(
        target_id="esp32_s3_mini",
        board="ESP32_GENERIC_S3",
        backend="esp-idf",
        params={"port": "esp32"},
        rule_id="esp32-s3-mini-default",
        source="compile_target_mappings.json",
        confidence="exact",
    )
    compile_frame = {
        "type": "compile.start",
        "runtimeId": "general",
        "targetId": "esp32_s3_mini",
        "packageIds": ["core"],
    }
    resolved_boards: list[str] = []

    def fake_resolve_spec(workspace_root, board):
        resolved_boards.append(board)
        return _s3_board_spec()

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.execute_compile_runtime_request", side_effect=_compile_stub()
    ) as execute_mock, mock.patch(
        f"{_HANDLER_MODULE}.resolve_web_target", return_value=resolution
    ), mock.patch(
        f"{_HANDLER_MODULE}._resolve_board_spec", side_effect=fake_resolve_spec
    ):
        frames = asyncio.run(_run_single_job(compile_frame))

    assert resolved_boards == ["ESP32_GENERIC_S3"]
    assert execute_mock.call_args.args[0].board == "ESP32_GENERIC_S3"
    terminal = frames[-1]
    assert terminal["type"] == "result"
    assert terminal["status"] == "succeeded"


def test_unknown_target_id_produces_target_unknown(tmp_path: Path):
    compile_frame = {
        "type": "compile.start",
        "runtimeId": "general",
        "targetId": "does-not-exist",
    }

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.resolve_web_target",
        side_effect=WebTargetUnknownError("does-not-exist"),
    ):
        frames = asyncio.run(_run_single_job(compile_frame))

    terminal = frames[-1]
    assert terminal["type"] == "error"
    assert terminal["code"] == CODE_TARGET_UNKNOWN
    assert terminal["details"]["targetId"] == "does-not-exist"


def test_wildcard_target_id_produces_target_unknown(tmp_path: Path):
    resolution = WebTargetResolution(
        target_id="custom",
        board=None,
        backend=None,
        params={},
        rule_id="custom-all-boards",
        source="compile_target_mappings.json",
        confidence="wildcard",
    )
    compile_frame = {"type": "compile.start", "runtimeId": "general", "targetId": "custom"}

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.resolve_web_target", return_value=resolution
    ):
        frames = asyncio.run(_run_single_job(compile_frame))

    terminal = frames[-1]
    assert terminal["type"] == "error"
    assert terminal["code"] == CODE_TARGET_UNKNOWN


def test_base_target_id_resolves_through_the_base(tmp_path: Path):
    resolution = WebTargetResolution(
        target_id="esp32_s3_mini",
        board="ESP32_GENERIC_S3",
        backend="esp-idf",
        params={"port": "esp32"},
        rule_id="esp32-s3-mini-default",
        source="compile_target_mappings.json",
        confidence="exact",
    )
    compile_frame = {
        "type": "compile.start",
        "runtimeId": "general",
        "targetId": "derived_s3",
        "baseTargetId": "esp32_s3_mini",
        "packageIds": ["core"],
    }
    resolved_boards: list[str] = []

    def fake_resolve_spec(workspace_root, board):
        resolved_boards.append(board)
        return _s3_board_spec()

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.execute_compile_runtime_request", side_effect=_compile_stub()
    ), mock.patch(
        f"{_HANDLER_MODULE}.resolve_web_target", return_value=resolution
    ) as resolve_mock, mock.patch(
        f"{_HANDLER_MODULE}._resolve_board_spec", side_effect=fake_resolve_spec
    ):
        frames = asyncio.run(_run_single_job(compile_frame))

    assert resolve_mock.call_args.kwargs["base_target_id"] == "esp32_s3_mini"
    assert resolved_boards == ["ESP32_GENERIC_S3"]
    terminal = frames[-1]
    assert terminal["type"] == "result"
    assert terminal["status"] == "succeeded"


def test_unknown_base_target_produces_base_target_unknown(tmp_path: Path):
    compile_frame = {
        "type": "compile.start",
        "runtimeId": "general",
        "targetId": "derived",
        "baseTargetId": "does-not-exist",
    }

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.resolve_web_target",
        side_effect=WebBaseTargetUnknownError("does-not-exist"),
    ):
        frames = asyncio.run(_run_single_job(compile_frame))

    terminal = frames[-1]
    assert terminal["type"] == "error"
    assert terminal["code"] == CODE_BASE_TARGET_UNKNOWN
    assert terminal["details"]["baseTargetId"] == "does-not-exist"


def test_wildcard_base_target_produces_base_no_mapping(tmp_path: Path):
    compile_frame = {
        "type": "compile.start",
        "runtimeId": "general",
        "targetId": "derived",
        "baseTargetId": "generic_micropython",
    }

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.resolve_web_target",
        side_effect=WebBaseTargetNoMappingError("generic_micropython"),
    ):
        frames = asyncio.run(_run_single_job(compile_frame))

    terminal = frames[-1]
    assert terminal["type"] == "error"
    assert terminal["code"] == CODE_BASE_NO_MAPPING
    assert terminal["details"]["baseTargetId"] == "generic_micropython"


def test_deploy_job_returns_payload(tmp_path: Path):
    image = tmp_path / "image.bin"
    image.write_bytes(b"\x00" * 16)
    report = FirmwareDeployReport(
        exit_code=0,
        board_id="esp32",
        port="/dev/ttyUSB0",
        backend_id="esptool",
        firmware_path=image,
        size_bytes=16,
        sha256="sha256:deadbeef",
        message="Flashed image.bin to /dev/ttyUSB0.",
    )

    def fake_flash(request, *, on_event=None, environ=None):
        """Replay the events and streamed lines the esptool adapter emits."""

        assert request.log_callback is not None, "the flash request carries the tool sink"
        request.log_callback("stdout", "Writing at 0x00010000...\n")
        request.log_callback("stderr", "flash warning\n")
        if on_event is not None:
            on_event(BuildEvent(kind="stage", message="write-start"))
            on_event(BuildEvent(kind="status", message="done"))
        return report

    deploy_frame = {"type": "deploy.start", "board": "esp32", "port": "/dev/ttyUSB0"}

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.resolve_firmware_image", return_value=image
    ), mock.patch(f"{_HANDLER_MODULE}.flash_firmware", side_effect=fake_flash):
        frames = asyncio.run(_run_single_job(deploy_frame))

    stages = [frame["stage"] for frame in frames if "stage" in frame]
    assert stages == ["deploy-resolve", "write-start"]
    outputs = [frame for frame in frames if frame["type"] == "output"]
    assert [(frame["stream"], frame["text"]) for frame in outputs] == [
        ("stdout", "Writing at 0x00010000...\n"),
        ("stderr", "flash warning\n"),
    ]
    terminal = frames[-1]
    assert terminal["type"] == "result"
    assert frames.index(outputs[-1]) < len(frames) - 1, "output streams before the result"
    assert terminal["status"] == "succeeded"
    assert terminal["payload"]["firmware"]["sha256"] == "sha256:deadbeef"
    assert terminal["payload"]["board"] == {"id": "esp32", "chip": "esp32"}
    assert terminal["payload"]["port"] == "/dev/ttyUSB0"


def test_deploy_tool_lines_become_output_frames_verbatim(tmp_path: Path):
    """Every line the flash tool writes reaches the client as one `output` frame.

    The log is the tool's own transcript, so a progress-bar line is forwarded with
    its text unchanged instead of being turned into a percentage.
    """

    image = tmp_path / "image.bin"
    image.write_bytes(b"\x00" * 16)
    report = FirmwareDeployReport(
        exit_code=0,
        board_id="esp32",
        port="/dev/ttyUSB0",
        backend_id="esptool",
        firmware_path=image,
        size_bytes=16,
        sha256="sha256:deadbeef",
        message="Flashed image.bin to /dev/ttyUSB0.",
    )
    bar_line = "Writing at 0x00001000 [==>     ]  33.3% 4096/12000 bytes... \n"

    def fake_flash(request, *, on_event=None, environ=None):
        """Replay the events and lines the esptool adapter emits for one write step."""

        assert on_event is not None
        assert request.log_callback is not None
        on_event(BuildEvent(kind="stage", message="write-start"))
        request.log_callback("stdout", bar_line)
        on_event(BuildEvent(kind="status", message="done"))
        return report

    deploy_frame = {"type": "deploy.start", "board": "esp32", "port": "/dev/ttyUSB0"}

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.resolve_firmware_image", return_value=image
    ), mock.patch(f"{_HANDLER_MODULE}.flash_firmware", side_effect=fake_flash):
        frames = asyncio.run(_run_single_job(deploy_frame))

    assert [frame for frame in frames if frame["type"] == "output"] == [
        {"type": "output", "job": "deploy", "stream": "stdout", "text": bar_line}
    ]
    assert [frame for frame in frames if "progress" in frame] == []
    assert frames[-1]["type"] == "result"


def test_second_job_while_busy_gets_job_busy(tmp_path: Path):
    release = threading.Event()

    def blocking_execute(request, **kwargs):
        """Block until the test releases the job."""

        release.wait(timeout=10)
        return _compile_result()

    compile_frame = json.dumps({"type": "compile.start", "runtimeId": "general", "board": "esp32"})

    async def main() -> list[dict]:
        async with _firmware_socket() as websocket:
            await websocket.send(compile_frame)
            collected = [await _recv(websocket)]
            await websocket.send(compile_frame)
            busy = await _recv(websocket)
            release.set()
            return await _recv_until_terminal(websocket, collected=collected + [busy])

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.execute_compile_runtime_request", side_effect=blocking_execute
    ):
        frames = asyncio.run(main())

    busy_frames = [frame for frame in frames if frame.get("code") == CODE_JOB_BUSY]
    assert len(busy_frames) == 1
    assert busy_frames[0]["type"] == "error"
    assert busy_frames[0]["hint"]
    # The first job still finished with a result frame after being released.
    assert frames[-1]["type"] == "result"
    assert frames[-1]["status"] == "succeeded"


def test_cancel_sets_event_and_reports_cancelled(tmp_path: Path):
    def cancellable_execute(
        request, *, stage_callback=None, log_callback=None, cancel_event=None, timeout_seconds=None
    ):
        """Wait for the cancel event like a running build would."""

        if stage_callback is not None:
            stage_callback("build-start", {})
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if cancel_event is not None and cancel_event.is_set():
                raise BuildCancelled()
            time.sleep(0.02)
        raise AssertionError("cancel was never observed")

    compile_frame = json.dumps({"type": "compile.start", "runtimeId": "general", "board": "esp32"})

    async def main() -> list[dict]:
        async with _firmware_socket() as websocket:
            await websocket.send(compile_frame)
            collected: list[dict] = []
            while True:
                frame = await _recv(websocket)
                collected.append(frame)
                if frame.get("stage") == "build-start":
                    break
            await websocket.send(json.dumps({"type": "cancel"}))
            return await _recv_until_terminal(websocket, collected=collected)

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.execute_compile_runtime_request", side_effect=cancellable_execute
    ):
        frames = asyncio.run(main())

    terminal = frames[-1]
    assert terminal["type"] == "result"
    assert terminal["status"] == "cancelled"
    assert terminal["cleanup"] == {"removedArtifact": None}


def test_timeout_reports_timeout_status(tmp_path: Path):
    def timing_out_execute(
        request, *, stage_callback=None, log_callback=None, cancel_event=None, timeout_seconds=None
    ):
        """Start the build stage and then report the timeout the seam raises."""

        if stage_callback is not None:
            stage_callback("build-start", {})
        raise BuildTimeout(0.2)

    compile_frame = {"type": "compile.start", "runtimeId": "general", "board": "esp32"}

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.execute_compile_runtime_request", side_effect=timing_out_execute
    ):
        frames = asyncio.run(_run_single_job(compile_frame))

    terminal = frames[-1]
    assert terminal["type"] == "result"
    assert terminal["status"] == "timeout"
    assert terminal["payload"]["timeoutSeconds"] == 0.2
    assert terminal["cleanup"] == {"removedArtifact": None}


def test_timeout_removes_artifact_written_by_the_job(tmp_path: Path):
    artifact = tmp_path / "ports" / "esp32" / "build-ESP32_GENERIC" / "firmware.bin"
    artifact.parent.mkdir(parents=True)
    artifact.write_bytes(b"partial")
    record = FirmwareArtifactRecord(path=artifact, board="esp32")

    def timing_out_execute(request, **kwargs):
        """Report a timeout for a job that wrote the artifact mid-run."""

        # Stamp the file as written after the job started, which is what a build
        # in progress looks like to the cleanup rule.
        later = time.time() + 5
        os.utime(artifact, (later, later))
        raise BuildTimeout(0.2)

    compile_frame = {"type": "compile.start", "runtimeId": "general", "board": "esp32"}

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.execute_compile_runtime_request", side_effect=timing_out_execute
    ), mock.patch(
        f"{_HANDLER_MODULE}.discover_firmware_artifact", return_value=record
    ):
        frames = asyncio.run(_run_single_job(compile_frame))

    terminal = frames[-1]
    assert terminal["status"] == "timeout"
    assert terminal["cleanup"] == {"removedArtifact": str(artifact.resolve())}
    assert not artifact.exists()
    assert any("removed partial artifact" in frame.get("text", "") for frame in frames)


def test_compile_disabled_when_feature_missing(tmp_path: Path):
    scan = LocalPackageScan(
        runtime_id="general",
        packages=(
            LocalPackageRecord(
                id="core",
                name="Core Nodes",
                version="1.9.0",
                source="global",
                staged=True,
                gated_out=False,
                missing_capabilities=(),
                manifest_path=None,
            ),
        ),
        warnings=(),
    )

    async def main() -> list[dict]:
        async with _firmware_socket() as websocket:
            await websocket.send(
                json.dumps({"type": "compile.start", "runtimeId": "general", "board": "esp32"})
            )
            refused = await _recv(websocket)
            await websocket.send(json.dumps({"type": "scan-local", "runtimeId": "general"}))
            frames = await _recv_until_terminal(websocket, collected=[refused])
            return frames

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.build_server_capabilities", return_value={"features": []}
    ), mock.patch(f"{_HANDLER_MODULE}.scan_local_packages", return_value=scan):
        frames = asyncio.run(main())

    assert frames[0]["type"] == "error"
    assert frames[0]["code"] == CODE_COMPILE_DISABLED
    assert "firmware-compile" in frames[0]["hint"]
    assert "micro-otter.toml" in frames[0]["hint"]
    assert frames[-1]["type"] == "result"
    assert frames[-1]["status"] == "succeeded"
    assert frames[-1]["payload"]["packages"][0]["id"] == "core"


def test_compile_failure_reports_stable_code_with_exit_code(tmp_path: Path):
    errors = [
        {
            "code": "unknown-package-id",
            "category": "package-selection",
            "message": "Unknown node package id: does-not-exist",
            "details": {"requested": ["does-not-exist"], "known": ["core"]},
            "hint": "Known ids: core",
        }
    ]
    compile_frame = {
        "type": "compile.start",
        "runtimeId": "general",
        "board": "esp32",
        "packageIds": ["does-not-exist"],
    }

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.execute_compile_runtime_request",
        side_effect=_compile_stub(exit_code=2, errors=errors, events=()),
    ):
        frames = asyncio.run(_run_single_job(compile_frame))

    terminal = frames[-1]
    assert terminal["type"] == "error"
    assert terminal["code"] == "unknown-package-id"
    assert terminal["hint"] == "Known ids: core"
    assert terminal["details"]["packageId"] == "does-not-exist"
    assert terminal["details"]["exitCode"] == 2
    assert len([frame for frame in frames if frame["type"] == "error"]) == 1


def test_scan_job_returns_package_payload(tmp_path: Path):
    scan = LocalPackageScan(
        runtime_id="general",
        packages=(
            LocalPackageRecord(
                id="core",
                name="Core Nodes",
                version="1.9.0",
                source="global",
                staged=True,
                gated_out=False,
                missing_capabilities=(),
                manifest_path=tmp_path / "core" / "manifest.json",
            ),
        ),
        warnings=("one warning",),
    )

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.scan_local_packages", return_value=scan
    ) as scan_mock:
        frames = asyncio.run(_run_single_job({"type": "scan-local", "runtimeId": "general"}))

    scan_mock.assert_called_once()
    payload = frames[-1]["payload"]
    assert frames[-1]["status"] == "succeeded"
    assert payload["runtime"] == {"id": "general"}
    assert payload["packages"][0]["staged"] is True
    assert payload["warnings"] == ["one warning"]


def test_internal_error_does_not_leak_traceback(tmp_path: Path):
    def exploding_execute(request, **kwargs):
        """Fail with a message that must never reach the client."""

        raise RuntimeError("super secret detail")

    compile_frame = {"type": "compile.start", "runtimeId": "general", "board": "esp32"}

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.execute_compile_runtime_request", side_effect=exploding_execute
    ):
        frames = asyncio.run(_run_single_job(compile_frame))

    terminal = frames[-1]
    assert terminal["type"] == "error"
    assert terminal["code"] == CODE_INTERNAL_ERROR
    assert terminal["details"] == {"exception": "RuntimeError"}
    assert "super secret detail" not in json.dumps(frames)
    assert "Traceback" not in json.dumps(frames)


def test_artifact_cleanup_keeps_a_pre_existing_binary(tmp_path: Path):
    from micro_otter.tools.firmware_ws_handler import (
        _artifact_baseline,
        _discard_partial_artifact,
    )

    artifact = tmp_path / "ports" / "esp32" / "build-ESP32_GENERIC" / "firmware.bin"
    artifact.parent.mkdir(parents=True)
    artifact.write_bytes(b"good")
    board = _board_spec()
    baseline = _artifact_baseline(tmp_path, board)

    assert baseline.path == artifact.resolve()
    # A job that started after the binary was written never deletes it.
    assert (
        _discard_partial_artifact(
            baseline, tmp_path, board, job_started_at=artifact.stat().st_mtime + 1
        )
        is None
    )
    assert artifact.exists()
    # A job that wrote it while running does clean it up.
    removed = _discard_partial_artifact(
        baseline, tmp_path, board, job_started_at=artifact.stat().st_mtime - 1
    )
    assert removed == artifact.resolve()
    assert not artifact.exists()


# --- iteration-11 firmware inventory frames ------------------------------------


def _inventory_entry(tmp_path: Path) -> FirmwareInventoryEntry:
    """Return one firmware inventory entry pointing into *tmp_path*."""

    return FirmwareInventoryEntry(
        path=(tmp_path / "micro-otter-1.27.0-esp32-general-0.13.0.bin").resolve(),
        filename="micro-otter-1.27.0-esp32-general-0.13.0.bin",
        board_id="esp32",
        runtime_id="general",
        micropython_version="1.27.0",
        runtime_firmware_version="0.13.0",
        content_hash=None,
        size_bytes=1,
        modified_at="2026-01-01T00:00:00+00:00",
        has_manifest=False,
        embedded_packages={},
        not_embedded=(),
    )


def _inventory_payload(tmp_path: Path) -> dict:
    """Return a minimal inventory result payload."""

    return {"schemaVersion": 1, "publishRoot": str(tmp_path), "entries": []}


def test_list_frame_parses_with_no_fields():
    request = parse_client_frame(_frame(type="firmware.list"))

    assert isinstance(request, ListRequest)


def test_list_frame_ignores_extra_fields():
    request = parse_client_frame(_frame(type="firmware.list", runtimeId="general"))

    assert isinstance(request, ListRequest)


def test_delete_frame_requires_firmware_path():
    with pytest.raises(FirmwareFrameError) as excinfo:
        parse_client_frame(_frame(type="firmware.delete"))

    assert excinfo.value.code == CODE_INVALID_FRAME
    assert excinfo.value.details == {"field": "firmwarePath"}


def test_delete_frame_parses_firmware_path():
    request = parse_client_frame(
        _frame(type="firmware.delete", firmwarePath="/opt/micro_otter/firmware/a.bin")
    )

    assert isinstance(request, DeleteRequest)
    assert request.firmware_path == "/opt/micro_otter/firmware/a.bin"


def test_import_frame_parses_a_path() -> None:
    request = parse_client_frame(_frame(type="firmware.import", path="/tmp/a.firmware.zip"))

    assert isinstance(request, ImportRequest)
    assert request.path == "/tmp/a.firmware.zip"
    assert request.url is None
    assert request.force is False


def test_import_frame_parses_a_url() -> None:
    request = parse_client_frame(_frame(type="firmware.import", url="https://x/a.firmware.zip"))

    assert isinstance(request, ImportRequest)
    assert request.path is None
    assert request.url == "https://x/a.firmware.zip"


def test_import_frame_requires_exactly_one_of_path_and_url() -> None:
    with pytest.raises(FirmwareFrameError) as excinfo:
        parse_client_frame(_frame(type="firmware.import"))
    assert excinfo.value.code == CODE_INVALID_FRAME
    assert excinfo.value.details == {"field": "path"}

    with pytest.raises(FirmwareFrameError) as excinfo:
        parse_client_frame(
            _frame(type="firmware.import", path="/tmp/a.zip", url="https://x/a.zip")
        )
    assert excinfo.value.code == CODE_INVALID_FRAME
    assert excinfo.value.details == {"field": "path"}


def test_import_frame_ignores_the_removed_archive_base64_field() -> None:
    """``archiveBase64`` is no longer read, so a frame with only it is ``invalid-frame``."""

    with pytest.raises(FirmwareFrameError) as excinfo:
        parse_client_frame(_frame(type="firmware.import", archiveBase64="emlw"))
    assert excinfo.value.code == CODE_INVALID_FRAME
    assert excinfo.value.details == {"field": "path"}


def test_import_frame_parses_force_flag() -> None:
    request = parse_client_frame(
        _frame(type="firmware.import", path="/tmp/a.firmware.zip", force=True)
    )

    assert request.force is True


def test_import_binary_frame_parses_a_path_and_target() -> None:
    request = parse_client_frame(
        _frame(type="firmware.import-binary", path="/tmp/esp32.bin", targetId="esp32_s3_mini")
    )

    assert isinstance(request, ImportBinaryRequest)
    assert request.path == "/tmp/esp32.bin"
    assert request.url is None
    assert request.target_id == "esp32_s3_mini"
    assert request.force is False


def test_import_binary_frame_parses_a_url_and_force() -> None:
    request = parse_client_frame(
        _frame(
            type="firmware.import-binary",
            url="https://x/esp32.bin",
            targetId="esp32_s3_mini",
            force=True,
        )
    )

    assert isinstance(request, ImportBinaryRequest)
    assert request.path is None
    assert request.url == "https://x/esp32.bin"
    assert request.force is True


def test_import_binary_frame_requires_exactly_one_of_path_and_url() -> None:
    with pytest.raises(FirmwareFrameError) as excinfo:
        parse_client_frame(_frame(type="firmware.import-binary", targetId="esp32"))
    assert excinfo.value.code == CODE_INVALID_FRAME
    assert excinfo.value.details == {"field": "path"}

    with pytest.raises(FirmwareFrameError) as excinfo:
        parse_client_frame(
            _frame(
                type="firmware.import-binary",
                path="/tmp/a.bin",
                url="https://x/a.bin",
                targetId="esp32",
            )
        )
    assert excinfo.value.code == CODE_INVALID_FRAME
    assert excinfo.value.details == {"field": "path"}


def test_import_binary_frame_requires_a_nonempty_target_id() -> None:
    for target_id in (None, "", "   "):
        with pytest.raises(FirmwareFrameError) as excinfo:
            parse_client_frame(
                _frame(type="firmware.import-binary", path="/tmp/a.bin", targetId=target_id)
            )
        assert excinfo.value.code == CODE_INVALID_FRAME
        assert excinfo.value.details == {"field": "targetId"}


def test_import_binary_frame_ignores_extra_keys() -> None:
    request = parse_client_frame(
        _frame(
            type="firmware.import-binary",
            path="/tmp/a.bin",
            targetId="esp32",
            archiveBase64="emlw",
        )
    )

    assert isinstance(request, ImportBinaryRequest)
    assert request.force is False


def test_job_kind_maps_the_import_binary_frame() -> None:
    request = parse_client_frame(
        _frame(type="firmware.import-binary", path="/tmp/a.bin", targetId="esp32")
    )

    assert _job_kind(request) == "import"



def test_export_frame_parses_paths_and_force() -> None:
    request = parse_client_frame(
        _frame(
            type="firmware.export",
            firmwarePath="/opt/fw/a.bin",
            destinationDir="/tmp/out",
            force=True,
        )
    )

    assert isinstance(request, ExportRequest)
    assert request.firmware_path == "/opt/fw/a.bin"
    assert request.destination_dir == "/tmp/out"
    assert request.force is True


def test_export_frame_requires_its_paths() -> None:
    with pytest.raises(FirmwareFrameError) as excinfo:
        parse_client_frame(_frame(type="firmware.export", destinationDir="/tmp/out"))
    assert excinfo.value.code == CODE_INVALID_FRAME
    assert excinfo.value.details == {"field": "firmwarePath"}

    with pytest.raises(FirmwareFrameError) as excinfo:
        parse_client_frame(_frame(type="firmware.export", firmwarePath="/opt/fw/a.bin"))
    assert excinfo.value.code == CODE_INVALID_FRAME
    assert excinfo.value.details == {"field": "destinationDir"}


def test_job_kind_maps_the_export_frame() -> None:
    request = parse_client_frame(
        _frame(type="firmware.export", firmwarePath="/opt/fw/a.bin", destinationDir="/tmp")
    )

    assert _job_kind(request) == "export"


def test_list_job_returns_inventory_payload(tmp_path: Path):
    entry = _inventory_entry(tmp_path)
    payload = _inventory_payload(tmp_path)

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.resolve_publish_root", return_value=tmp_path
    ), mock.patch(
        f"{_HANDLER_MODULE}.list_firmware_inventory", return_value=[entry]
    ), mock.patch(
        f"{_HANDLER_MODULE}.latest_firmware_ids",
        return_value={("esp32", "general"): str(entry.path)},
    ), mock.patch(
        f"{_HANDLER_MODULE}.build_firmware_inventory_payload", return_value=payload
    ):
        frames = asyncio.run(_run_single_job({"type": "firmware.list"}))

    terminal = frames[-1]
    assert terminal["type"] == "result"
    assert terminal["job"] == "list"
    assert terminal["status"] == "succeeded"
    assert terminal["payload"] == payload
    stages = [frame["stage"] for frame in frames if "stage" in frame]
    assert stages == ["inventory"]


def test_delete_job_returns_refreshed_inventory(tmp_path: Path):
    entry = _inventory_entry(tmp_path)
    payload = _inventory_payload(tmp_path)
    frame = {"type": "firmware.delete", "firmwarePath": str(entry.path)}

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.resolve_publish_root", return_value=tmp_path
    ), mock.patch(
        f"{_HANDLER_MODULE}.delete_firmware_entry",
        return_value={"removed": [str(entry.path)], "absent": []},
    ), mock.patch(
        f"{_HANDLER_MODULE}.list_firmware_inventory", return_value=[entry]
    ), mock.patch(
        f"{_HANDLER_MODULE}.latest_firmware_ids", return_value={}
    ), mock.patch(
        f"{_HANDLER_MODULE}.build_firmware_inventory_payload", return_value=payload
    ):
        frames = asyncio.run(_run_single_job(frame))

    terminal = frames[-1]
    assert terminal["type"] == "result"
    assert terminal["job"] == "delete"
    assert terminal["status"] == "succeeded"
    assert terminal["payload"]["removed"] == [str(entry.path)]
    assert terminal["payload"]["absent"] == []


def test_delete_job_reports_path_invalid_error(tmp_path: Path):
    entry = _inventory_entry(tmp_path)
    frame = {"type": "firmware.delete", "firmwarePath": str(entry.path)}

    def refusing_delete(*, path, publish_root=None):
        raise FirmwareInventoryError(
            "outside the publish root",
            code=CODE_FIRMWARE_PATH_INVALID,
            details={"path": str(path)},
        )

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.resolve_publish_root", return_value=tmp_path
    ), mock.patch(f"{_HANDLER_MODULE}.delete_firmware_entry", side_effect=refusing_delete):
        frames = asyncio.run(_run_single_job(frame))

    terminal = frames[-1]
    assert terminal["type"] == "error"
    assert terminal["code"] == CODE_FIRMWARE_PATH_INVALID
    assert terminal["job"] == "delete"


def test_delete_disabled_when_compile_feature_missing(tmp_path: Path):
    entry = _inventory_entry(tmp_path)

    async def main() -> list[dict]:
        async with _firmware_socket() as websocket:
            await websocket.send(
                json.dumps({"type": "firmware.delete", "firmwarePath": str(entry.path)})
            )
            return await _recv_until_terminal(websocket)

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.build_server_capabilities", return_value={"features": []}
    ):
        frames = asyncio.run(main())

    assert frames[0]["type"] == "error"
    assert frames[0]["code"] == CODE_COMPILE_DISABLED
    assert "firmware-compile" in frames[0]["hint"]


def test_import_job_returns_refreshed_inventory(tmp_path: Path):
    entry = _inventory_entry(tmp_path)
    payload = _inventory_payload(tmp_path)
    imported = {
        "status": "installed",
        "filename": entry.filename,
        "imagePath": str(entry.path),
        "sidecarPath": None,
        "sha256": "0" * 64,
        "boardKnown": True,
    }
    archive = _firmware_archive(tmp_path)
    frame = {"type": "firmware.import", "path": str(archive)}

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.resolve_publish_root", return_value=tmp_path
    ), mock.patch(
        f"{_HANDLER_MODULE}.import_firmware_package", return_value=imported
    ), mock.patch(
        f"{_HANDLER_MODULE}.list_firmware_inventory", return_value=[entry]
    ), mock.patch(
        f"{_HANDLER_MODULE}.latest_firmware_ids", return_value={}
    ), mock.patch(
        f"{_HANDLER_MODULE}.build_firmware_inventory_payload", return_value=payload
    ):
        frames = asyncio.run(_run_single_job(frame))

    terminal = frames[-1]
    assert terminal["type"] == "result"
    assert terminal["job"] == "import"
    assert terminal["status"] == "succeeded"
    assert terminal["payload"]["imported"] == imported
    stages = [f["stage"] for f in frames if "stage" in f]
    assert stages == ["import"]


def test_import_job_reports_package_error(tmp_path: Path):
    from micro_otter.tools.firmware_compile.firmware_package import FirmwarePackageError

    archive = _firmware_archive(tmp_path)
    frame = {"type": "firmware.import", "path": str(archive)}

    def refusing_import(source, *, publish_root=None, force=False, known_board_ids=None):
        raise FirmwarePackageError("bad package", code="firmware-package-invalid")

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.resolve_publish_root", return_value=tmp_path
    ), mock.patch(
        f"{_HANDLER_MODULE}.import_firmware_package", side_effect=refusing_import
    ):
        frames = asyncio.run(_run_single_job(frame))

    terminal = frames[-1]
    assert terminal["type"] == "error"
    assert terminal["code"] == "firmware-package-invalid"
    assert terminal["job"] == "import"


def test_import_disabled_when_compile_feature_missing(tmp_path: Path):
    archive = _firmware_archive(tmp_path)

    async def main() -> list[dict]:
        async with _firmware_socket() as websocket:
            await websocket.send(
                json.dumps({"type": "firmware.import", "path": str(archive)})
            )
            return await _recv_until_terminal(websocket)

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.build_server_capabilities", return_value={"features": []}
    ):
        frames = asyncio.run(main())

    assert frames[0]["type"] == "error"
    assert frames[0]["code"] == CODE_COMPILE_DISABLED
    assert "firmware-compile" in frames[0]["hint"]
    release = threading.Event()

    def blocking_resolve() -> Path:
        """Block until the test releases the inventory job."""

        release.wait(timeout=10)
        return tmp_path

    list_frame = json.dumps({"type": "firmware.list"})

    async def main() -> list[dict]:
        async with _firmware_socket() as websocket:
            await websocket.send(list_frame)
            collected = [await _recv(websocket)]
            await websocket.send(list_frame)
            busy = await _recv(websocket)
            release.set()
            return await _recv_until_terminal(websocket, collected=collected + [busy])

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.resolve_publish_root", side_effect=blocking_resolve
    ), mock.patch(
        f"{_HANDLER_MODULE}.list_firmware_inventory", return_value=[]
    ), mock.patch(
        f"{_HANDLER_MODULE}.latest_firmware_ids", return_value={}
    ), mock.patch(
        f"{_HANDLER_MODULE}.build_firmware_inventory_payload",
        return_value=_inventory_payload(tmp_path),
    ):
        frames = asyncio.run(main())

    busy = [frame for frame in frames if frame.get("code") == CODE_JOB_BUSY]
    assert len(busy) == 1
    assert frames[-1]["type"] == "result"
    assert frames[-1]["status"] == "succeeded"



# --- firmware.import-binary runner ------------------------------------------


def _binary_image(tmp_path: Path, name: str = "esp32.bin") -> Path:
    """Write a tiny ``.bin`` file and return its path."""

    image = tmp_path / name
    image.write_bytes(b"\x00" * 8)
    return image


def _imported_record(status: str, tmp_path: Path) -> dict:
    """Return a fake ``import_firmware_binary`` record."""

    return {
        "status": status,
        "filename": "micro-otter-1.27.0-esp32-imported-0.0.0-000000000000.bin",
        "imagePath": str(tmp_path / "out.bin"),
        "sidecarPath": None,
        "sha256": "0" * 64,
        "boardKnown": True,
        "boardId": "esp32",
        "targetId": "esp32_s3_mini",
        "originalFilename": "esp32.bin",
        "micropythonVersion": "0.0.0",
    }


def test_import_binary_job_returns_imported_record(tmp_path: Path):
    entry = _inventory_entry(tmp_path)
    payload = _inventory_payload(tmp_path)
    image = _binary_image(tmp_path)
    imported = _imported_record("installed", tmp_path)
    frame = {"type": "firmware.import-binary", "path": str(image), "targetId": "esp32_s3_mini"}

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}._resolve_board_name", return_value="esp32"
    ), mock.patch(
        f"{_HANDLER_MODULE}.resolve_publish_root", return_value=tmp_path
    ), mock.patch(
        f"{_HANDLER_MODULE}.import_firmware_binary", return_value=imported
    ), mock.patch(
        f"{_HANDLER_MODULE}.list_firmware_inventory", return_value=[entry]
    ), mock.patch(
        f"{_HANDLER_MODULE}.latest_firmware_ids", return_value={}
    ), mock.patch(
        f"{_HANDLER_MODULE}.build_firmware_inventory_payload", return_value=payload
    ):
        frames = asyncio.run(_run_single_job(frame))

    terminal = frames[-1]
    assert terminal["type"] == "result"
    assert terminal["job"] == "import"
    assert terminal["status"] == "succeeded"
    assert terminal["payload"]["imported"] == imported
    assert terminal["payload"]["entries"] == []
    stages = [f["stage"] for f in frames if "stage" in f]
    assert stages == ["import"]


def test_import_binary_job_answers_already_present_for_an_identical_reimport(tmp_path: Path):
    entry = _inventory_entry(tmp_path)
    payload = _inventory_payload(tmp_path)
    image = _binary_image(tmp_path)
    imported = _imported_record("already-present", tmp_path)
    frame = {"type": "firmware.import-binary", "path": str(image), "targetId": "esp32_s3_mini"}

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}._resolve_board_name", return_value="esp32"
    ), mock.patch(
        f"{_HANDLER_MODULE}.resolve_publish_root", return_value=tmp_path
    ), mock.patch(
        f"{_HANDLER_MODULE}.import_firmware_binary", return_value=imported
    ), mock.patch(
        f"{_HANDLER_MODULE}.list_firmware_inventory", return_value=[entry]
    ), mock.patch(
        f"{_HANDLER_MODULE}.latest_firmware_ids", return_value={}
    ), mock.patch(
        f"{_HANDLER_MODULE}.build_firmware_inventory_payload", return_value=payload
    ):
        frames = asyncio.run(_run_single_job(frame))

    terminal = frames[-1]
    assert terminal["status"] == "succeeded"
    assert terminal["payload"]["imported"]["status"] == "already-present"


def test_import_binary_job_reports_exists_without_force_and_succeeds_with_force(tmp_path: Path):
    from micro_otter.tools.firmware_compile.imported_firmware import ImportedFirmwareError

    entry = _inventory_entry(tmp_path)
    payload = _inventory_payload(tmp_path)
    image = _binary_image(tmp_path)
    imported = _imported_record("installed", tmp_path)

    def conflicting_import(source, *, board_id=None, target_id=None, publish_root=None,
                           force=False, known_board_ids=None):
        if not force:
            raise ImportedFirmwareError("name collision", code="firmware-import-exists")
        return imported

    def run(force: bool) -> list[dict]:
        frame = {
            "type": "firmware.import-binary",
            "path": str(image),
            "targetId": "esp32_s3_mini",
            "force": force,
        }
        with _handler_env(_config(tmp_path)), mock.patch(
            f"{_HANDLER_MODULE}._resolve_board_name", return_value="esp32"
        ), mock.patch(
            f"{_HANDLER_MODULE}.resolve_publish_root", return_value=tmp_path
        ), mock.patch(
            f"{_HANDLER_MODULE}.import_firmware_binary", side_effect=conflicting_import
        ), mock.patch(
            f"{_HANDLER_MODULE}.list_firmware_inventory", return_value=[entry]
        ), mock.patch(
            f"{_HANDLER_MODULE}.latest_firmware_ids", return_value={}
        ), mock.patch(
            f"{_HANDLER_MODULE}.build_firmware_inventory_payload", return_value=payload
        ):
            return asyncio.run(_run_single_job(frame))

    refused = run(force=False)
    assert refused[-1]["type"] == "error"
    assert refused[-1]["code"] == "firmware-import-exists"

    forced = run(force=True)
    assert forced[-1]["type"] == "result"
    assert forced[-1]["payload"]["imported"]["status"] == "installed"


def test_import_binary_job_reports_invalid_for_a_non_bin(tmp_path: Path):
    source = tmp_path / "firmware.uf2"
    source.write_bytes(b"\x55\x46\x32\x0a")
    frame = {"type": "firmware.import-binary", "path": str(source), "targetId": "esp32"}

    @contextlib.contextmanager
    def yield_source(*, path=None, url=None, max_bytes=None, label=None, suffixes=None):
        yield Path(path)

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}._resolve_board_name", return_value="esp32"
    ), mock.patch(
        f"{_HANDLER_MODULE}.resolve_publish_root", return_value=tmp_path
    ), mock.patch(
        f"{_HANDLER_MODULE}.resolve_archive_source", side_effect=yield_source
    ):
        frames = asyncio.run(_run_single_job(frame))

    terminal = frames[-1]
    assert terminal["type"] == "error"
    assert terminal["code"] == "firmware-import-invalid"
    assert terminal["job"] == "import"


def test_import_binary_job_reports_target_unknown_for_a_wildcard(tmp_path: Path):
    image = _binary_image(tmp_path)
    frame = {"type": "firmware.import-binary", "path": str(image), "targetId": "*"}

    def refusing_resolve(*, board=None, target_id=None, workspace_root=None, runtime_id=None):
        raise WebTargetUnknownError(str(target_id))

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}._resolve_board_name", side_effect=refusing_resolve
    ):
        frames = asyncio.run(_run_single_job(frame))

    terminal = frames[-1]
    assert terminal["type"] == "error"
    assert terminal["code"] == CODE_TARGET_UNKNOWN
    assert terminal["job"] == "import"


def test_import_binary_disabled_when_compile_feature_missing(tmp_path: Path):
    image = _binary_image(tmp_path)

    async def main() -> list[dict]:
        async with _firmware_socket() as websocket:
            await websocket.send(
                json.dumps(
                    {"type": "firmware.import-binary", "path": str(image), "targetId": "esp32"}
                )
            )
            return await _recv_until_terminal(websocket)

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.build_server_capabilities", return_value={"features": []}
    ):
        frames = asyncio.run(main())

    assert frames[0]["type"] == "error"
    assert frames[0]["code"] == CODE_COMPILE_DISABLED
    assert "firmware-compile" in frames[0]["hint"]



# --- iteration-21 add-on frames ----------------------------------------------


def test_addon_install_frame_parses_a_path() -> None:
    request = parse_client_frame(_frame(type="addon.install", path="/tmp/a.zip"))

    assert isinstance(request, AddonInstallRequest)
    assert request.path == "/tmp/a.zip"
    assert request.url is None
    assert request.force is False


def test_addon_install_frame_parses_a_url() -> None:
    request = parse_client_frame(_frame(type="addon.install", url="https://x/a.zip"))

    assert isinstance(request, AddonInstallRequest)
    assert request.path is None
    assert request.url == "https://x/a.zip"


def test_addon_install_frame_parses_the_force_flag() -> None:
    request = parse_client_frame(
        _frame(type="addon.install", path="/tmp/a.zip", force=True)
    )

    assert isinstance(request, AddonInstallRequest)
    assert request.force is True


def test_addon_install_frame_requires_exactly_one_of_path_and_url() -> None:
    with pytest.raises(FirmwareFrameError) as excinfo:
        parse_client_frame(_frame(type="addon.install"))
    assert excinfo.value.code == CODE_INVALID_FRAME
    assert excinfo.value.details == {"field": "path"}

    with pytest.raises(FirmwareFrameError) as excinfo:
        parse_client_frame(
            _frame(type="addon.install", path="/tmp/a.zip", url="https://x/a.zip")
        )
    assert excinfo.value.code == CODE_INVALID_FRAME
    assert excinfo.value.details == {"field": "path"}


def test_addon_install_frame_ignores_the_removed_archive_base64_field() -> None:
    """``archiveBase64`` is no longer read, so a frame with only it is ``invalid-frame``."""

    with pytest.raises(FirmwareFrameError) as excinfo:
        parse_client_frame(_frame(type="addon.install", archiveBase64="emlw"))
    assert excinfo.value.code == CODE_INVALID_FRAME
    assert excinfo.value.details == {"field": "path"}


def test_addon_uninstall_frame_parses_one_and_several_ids():
    single = parse_client_frame(_frame(type="addon.uninstall", packageIds=["pulse"]))
    several = parse_client_frame(
        _frame(type="addon.uninstall", packageIds=[" pulse ", "", "   ", "flashy"])
    )

    assert isinstance(single, AddonUninstallRequest)
    assert single.package_ids == ("pulse",)
    assert several.package_ids == ("pulse", "flashy")


@pytest.mark.parametrize("payload", [{}, {"packageIds": []}, {"packageIds": ["  ", ""]}])
def test_addon_uninstall_frame_requires_at_least_one_id(payload: dict[str, object]):
    with pytest.raises(FirmwareFrameError) as excinfo:
        parse_client_frame(_frame(type="addon.uninstall", **payload))

    assert excinfo.value.code == CODE_INVALID_FRAME
    assert excinfo.value.details == {"field": "packageIds"}


def test_addon_uninstall_frame_rejects_a_non_string_element():
    with pytest.raises(FirmwareFrameError) as excinfo:
        parse_client_frame(_frame(type="addon.uninstall", packageIds=["pulse", 3]))

    assert excinfo.value.code == CODE_INVALID_FRAME
    assert excinfo.value.details == {"field": "packageIds"}


def test_addon_frames_ignore_unknown_extra_fields():
    request = parse_client_frame(
        _frame(type="addon.install", path="/tmp/a.zip", futureField=True)
    )

    assert isinstance(request, AddonInstallRequest)


def test_job_kind_maps_the_addon_frames():
    install = parse_client_frame(_frame(type="addon.install", path="/tmp/a.zip"))
    uninstall = parse_client_frame(_frame(type="addon.uninstall", packageIds=["pulse"]))

    assert _job_kind(install) == "addon-install"
    assert _job_kind(uninstall) == "addon-uninstall"


def _addon_install_result(package_id: str = "sample_addon", *, replaced: bool = False) -> object:
    """Return an ``AddonInstallResult`` shaped like a real install or uninstall outcome."""

    return AddonInstallResult(
        id=package_id,
        version="1.0.0",
        package_dir=Path("/tmp/addons") / package_id,
        replaced=replaced,
        archive_sha256="a" * 64,
    )


def _addon_frame(**fields: object) -> dict[str, object]:
    """Return one ``addon.install`` frame, defaulting to a server path unless a ``url`` is given."""

    frame: dict[str, object] = {"type": "addon.install"}
    if "url" not in fields:
        frame["path"] = "/tmp/a.zip"
    frame.update(fields)
    return frame


def _addon_archive(tmp_path: Path) -> Path:
    """Write a tiny real ``.zip`` add-on archive and return its path."""

    import zipfile

    archive = tmp_path / "addon.zip"
    with zipfile.ZipFile(archive, "w") as handle:
        handle.writestr("payload.bin", b"zip-bytes")
    return archive


def _firmware_archive(tmp_path: Path) -> Path:
    """Write a tiny real ``.firmware.zip`` archive and return its path."""

    import zipfile

    archive = tmp_path / "pkg.firmware.zip"
    with zipfile.ZipFile(archive, "w") as handle:
        handle.writestr("payload.bin", b"zip-bytes")
    return archive


def test_addon_install_job_streams_the_stage_and_returns_the_inventory(tmp_path: Path):
    config = _config(tmp_path)
    archive = _addon_archive(tmp_path)
    installed = _addon_install_result()
    inventory = {"addons": [{"id": "sample_addon"}], "conflicts": [], "warnings": []}

    with _handler_env(config), mock.patch(
        f"{_HANDLER_MODULE}.install_addon", return_value=installed
    ) as install, mock.patch(
        f"{_HANDLER_MODULE}.addon_inventory_payload", return_value=dict(inventory)
    ) as addon_inventory, mock.patch(
        f"{_HANDLER_MODULE}.builtin_package_ids", return_value=("core",)
    ):
        frames = asyncio.run(_run_single_job(_addon_frame(path=str(archive))))

    terminal = frames[-1]
    assert terminal["type"] == "result"
    assert terminal["job"] == "addon-install"
    assert terminal["status"] == "succeeded"
    assert terminal["payload"]["installed"] == {
        "id": "sample_addon",
        "version": "1.0.0",
        "replaced": False,
        "archiveSha256": "a" * 64,
        "packageDir": str(Path("/tmp/addons") / "sample_addon"),
    }
    assert terminal["payload"]["addons"] == [{"id": "sample_addon"}]
    assert [frame["stage"] for frame in frames if "stage" in frame] == ["addon-install"]

    kwargs = install.call_args.kwargs
    assert kwargs["addons_root"] == config.addons_dir
    assert kwargs["builtin_ids"] == ("core",)
    assert kwargs["force"] is False
    assert install.call_args.args[0] == archive.resolve()
    addon_inventory.assert_called_once_with(
        _device_root(config.workspace_root), config.addons_dir
    )


def test_addon_install_job_reports_a_replace(tmp_path: Path):
    archive = _addon_archive(tmp_path)
    installed = _addon_install_result(replaced=True)
    inventory = {"addons": [{"id": "sample_addon"}], "conflicts": [], "warnings": []}

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.install_addon", return_value=installed
    ) as install, mock.patch(
        f"{_HANDLER_MODULE}.addon_inventory_payload", return_value=dict(inventory)
    ):
        frames = asyncio.run(_run_single_job(_addon_frame(path=str(archive), force=True)))

    assert frames[-1]["payload"]["installed"]["replaced"] is True
    assert install.call_args.kwargs["force"] is True


def test_addon_install_job_maps_install_errors_to_their_code(tmp_path: Path):
    archive = _addon_archive(tmp_path)

    def refusing_install(*_args: object, **_kwargs: object) -> object:
        """Refuse the install the way ``install_addon`` refuses an existing id."""

        raise AddonInstallError(
            "addon-already-installed",
            "sample_addon is already installed",
            hint="re-run with --force to replace it",
        )

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.install_addon", side_effect=refusing_install
    ):
        frames = asyncio.run(_run_single_job(_addon_frame(path=str(archive))))

    terminal = frames[-1]
    assert terminal["type"] == "error"
    assert terminal["code"] == "addon-already-installed"
    assert terminal["job"] == "addon-install"
    assert terminal["hint"] == "re-run with --force to replace it"



def test_addon_install_job_reports_a_missing_path(tmp_path: Path) -> None:
    """A missing ``path`` answers ``archive-path-invalid`` with the job kind."""

    frames = asyncio.run(
        _run_single_job(_addon_frame(path=str(tmp_path / "missing.zip")))
    )

    terminal = frames[-1]
    assert terminal["type"] == "error"
    assert terminal["code"] == "archive-path-invalid"
    assert terminal["job"] == "addon-install"
    assert terminal["hint"]


def test_addon_install_job_reports_an_oversized_archive(tmp_path: Path) -> None:
    """A local archive above ``MAX_ARCHIVE_BYTES`` answers ``archive-too-large``."""

    from micro_otter.tools.addon_archive import MAX_ARCHIVE_BYTES

    archive = tmp_path / "big.zip"
    archive.write_bytes(b"x" * (MAX_ARCHIVE_BYTES + 1))
    frames = asyncio.run(_run_single_job(_addon_frame(path=str(archive))))

    terminal = frames[-1]
    assert terminal["type"] == "error"
    assert terminal["code"] == "archive-too-large"


def test_addon_install_job_fetches_a_loopback_url(tmp_path: Path) -> None:
    """A loopback ``http://`` URL installs and leaves no ``mo-addon-*`` temp file."""

    import http.server
    import tempfile as _tempfile

    class _Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            self.send_response(200)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def log_message(self, *args: object) -> None:
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        url = f"http://127.0.0.1:{server.server_port}/addon.zip"
        installed = _addon_install_result()
        inventory = {"addons": [], "conflicts": [], "warnings": []}
        with _handler_env(_config(tmp_path)), mock.patch(
            f"{_HANDLER_MODULE}.install_addon", return_value=installed
        ), mock.patch(
            f"{_HANDLER_MODULE}.addon_inventory_payload", return_value=dict(inventory)
        ):
            frames = asyncio.run(_run_single_job(_addon_frame(url=url)))
    finally:
        server.shutdown()
        server.server_close()

    assert frames[-1]["type"] == "result"
    assert frames[-1]["status"] == "succeeded"
    leftovers = list(Path(_tempfile.gettempdir()).glob("mo-addon-*"))
    assert leftovers == []


def test_addon_install_job_rejects_a_public_http_url(tmp_path: Path) -> None:
    """``http://example.com`` answers ``archive-url-blocked``."""

    frames = asyncio.run(
        _run_single_job(_addon_frame(url="http://example.com/x.zip"))
    )

    terminal = frames[-1]
    assert terminal["type"] == "error"
    assert terminal["code"] == "archive-url-blocked"


def test_addon_uninstall_job_removes_each_id_and_reports_them(tmp_path: Path):
    config = _config(tmp_path)
    inventory = {"addons": [], "conflicts": [], "warnings": []}
    calls: list[str] = []

    def fake_uninstall(package_id: str, *, addons_root: Path) -> object:
        """Record the removal and answer with the id's own record."""

        assert addons_root == config.addons_dir
        calls.append(package_id)
        return _addon_install_result(package_id)

    with _handler_env(config), mock.patch(
        f"{_HANDLER_MODULE}.uninstall_addon", side_effect=fake_uninstall
    ), mock.patch(
        f"{_HANDLER_MODULE}.addon_inventory_payload", return_value=dict(inventory)
    ):
        frames = asyncio.run(
            _run_single_job({"type": "addon.uninstall", "packageIds": ["pulse", "flashy"]})
        )

    assert calls == ["pulse", "flashy"]
    announced = [
        frame["message"]
        for frame in frames
        if frame.get("stage") == "addon-uninstall" and "message" in frame
    ]
    assert announced == ["pulse", "flashy"]
    terminal = frames[-1]
    assert terminal["type"] == "result"
    assert terminal["job"] == "addon-uninstall"
    assert terminal["payload"]["removed"] == [
        {"id": "pulse", "version": "1.0.0"},
        {"id": "flashy", "version": "1.0.0"},
    ]


def test_addon_uninstall_job_fails_fast_after_the_ids_already_removed(tmp_path: Path):
    def fake_uninstall(package_id: str, *, addons_root: Path) -> object:
        """Remove the first id, then refuse the second as not installed."""

        del addons_root
        if package_id == "flashy":
            raise AddonInstallError("addon-not-installed", "flashy is not installed")
        return _addon_install_result(package_id)

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.uninstall_addon", side_effect=fake_uninstall
    ):
        frames = asyncio.run(
            _run_single_job({"type": "addon.uninstall", "packageIds": ["pulse", "flashy"]})
        )

    terminal = frames[-1]
    assert terminal["type"] == "error"
    assert terminal["code"] == "addon-not-installed"
    assert terminal["job"] == "addon-uninstall"
    assert any(frame.get("message") == "pulse" for frame in frames), (
        "the id already removed must still be on the wire"
    )


def test_addon_jobs_are_accepted_without_a_capability(tmp_path: Path):
    """The addons root is user state: an empty feature list must not refuse either job."""

    archive = _addon_archive(tmp_path)
    inventory = {"addons": [], "conflicts": [], "warnings": []}

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.build_server_capabilities", return_value={"features": []}
    ), mock.patch(
        f"{_HANDLER_MODULE}.install_addon", return_value=_addon_install_result()
    ), mock.patch(
        f"{_HANDLER_MODULE}.uninstall_addon", return_value=_addon_install_result()
    ), mock.patch(
        f"{_HANDLER_MODULE}.addon_inventory_payload", return_value=dict(inventory)
    ):
        install_frames = asyncio.run(_run_single_job(_addon_frame(path=str(archive))))
        uninstall_frames = asyncio.run(
            _run_single_job({"type": "addon.uninstall", "packageIds": ["pulse"]})
        )

    assert install_frames[-1]["type"] == "result"
    assert install_frames[-1]["status"] == "succeeded"
    assert uninstall_frames[-1]["type"] == "result"
    assert uninstall_frames[-1]["status"] == "succeeded"


def test_second_addon_install_while_busy_gets_job_busy(tmp_path: Path):
    release = threading.Event()

    def blocking_install(*_args: object, **_kwargs: object) -> object:
        """Block until the test releases the running install."""

        release.wait(timeout=10)
        return _addon_install_result()

    archive = _addon_archive(tmp_path)
    frame = json.dumps(_addon_frame(path=str(archive)))
    inventory = {"addons": [], "conflicts": [], "warnings": []}

    async def main() -> list[dict]:
        """Send the same install twice, wait for `job-busy`, then collect the result."""

        async with _firmware_socket() as websocket:
            await websocket.send(frame)
            collected = [await _recv(websocket)]
            await websocket.send(frame)
            while True:
                received = await _recv(websocket)
                collected.append(received)
                if received.get("code") == CODE_JOB_BUSY:
                    break
            release.set()
            return await _recv_until_terminal(websocket, collected=collected)

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.install_addon", side_effect=blocking_install
    ), mock.patch(
        f"{_HANDLER_MODULE}.addon_inventory_payload", return_value=dict(inventory)
    ):
        frames = asyncio.run(main())

    busy_frames = [frame for frame in frames if frame.get("code") == CODE_JOB_BUSY]
    assert len(busy_frames) == 1
    assert frames[-1]["type"] == "result"
    assert frames[-1]["status"] == "succeeded"



# --- fs.list side channel ----------------------------------------------------


def test_fs_list_frame_defaults_path_and_extensions() -> None:
    """``fs.list`` defaults ``path`` to the home directory and ``extensions`` to ``()``."""

    request = parse_client_frame(_frame(type="fs.list", requestId="r1"))
    assert isinstance(request, FsListRequest)
    assert request.path == str(Path.home())
    assert request.extensions == ()


def test_fs_list_frame_rejects_non_list_extensions() -> None:
    """A non-list ``extensions`` raises ``invalid-frame`` naming the field."""

    with pytest.raises(FirmwareFrameError) as exc:
        parse_client_frame(_frame(type="fs.list", requestId="r1", extensions="zip"))
    assert exc.value.code == CODE_INVALID_FRAME
    assert exc.value.details == {"field": "extensions"}


def test_fs_list_job_kind_raises_type_error() -> None:
    """``_job_kind`` refuses an ``fs.list`` request: it is not a job."""

    request = FsListRequest(request_id="r1", path="/tmp", extensions=())
    with pytest.raises(TypeError):
        _job_kind(request)


def test_fs_list_answers_for_a_directory(tmp_path: Path) -> None:
    """``fs.list`` for a temp directory answers a result with roots and sorted entries."""

    (tmp_path / "b.txt").write_text("x")
    (tmp_path / "a.zip").write_text("x")

    async def main() -> list[dict]:
        async with _firmware_socket() as websocket:
            await websocket.send(
                json.dumps(
                    {
                        "type": "fs.list",
                        "requestId": "r1",
                        "path": str(tmp_path),
                        "extensions": [".zip"],
                    }
                )
            )
            return [await _recv(websocket)]

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.build_server_capabilities",
        return_value={"features": ["local-file-access"]},
    ):
        frames = asyncio.run(main())

    assert frames[0]["type"] == "fs.list.result"
    assert frames[0]["requestId"] == "r1"
    assert "roots" in frames[0]
    names = [entry["name"] for entry in frames[0]["entries"]]
    assert names == ["a.zip"]


def test_fs_list_refused_without_local_file_access(tmp_path: Path) -> None:
    """Without ``local-file-access`` the answer is ``fs.list.error`` / ``fs-not-allowed``."""

    async def main() -> list[dict]:
        async with _firmware_socket() as websocket:
            await websocket.send(
                json.dumps({"type": "fs.list", "requestId": "r1", "path": str(tmp_path)})
            )
            return [await _recv(websocket)]

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.build_server_capabilities", return_value={"features": []}
    ):
        frames = asyncio.run(main())

    assert frames[0]["type"] == "fs.list.error"
    assert frames[0]["code"] == "fs-not-allowed"
    assert "job" not in frames[0]


def test_fs_list_missing_directory_answers_not_found(tmp_path: Path) -> None:
    """A missing directory answers ``fs.list.error`` / ``fs-not-found``."""

    async def main() -> list[dict]:
        async with _firmware_socket() as websocket:
            await websocket.send(
                json.dumps(
                    {
                        "type": "fs.list",
                        "requestId": "r1",
                        "path": str(tmp_path / "missing"),
                    }
                )
            )
            return [await _recv(websocket)]

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.build_server_capabilities",
        return_value={"features": ["local-file-access"]},
    ):
        frames = asyncio.run(main())

    assert frames[0]["type"] == "fs.list.error"
    assert frames[0]["code"] == "fs-not-found"


def test_fs_list_answers_while_a_job_is_running(tmp_path: Path) -> None:
    """``fs.list`` answers immediately while a job holds the slot (no ``job-busy``)."""

    release = threading.Event()

    def blocking_resolve() -> Path:
        release.wait(timeout=10)
        return tmp_path

    async def main() -> list[dict]:
        async with _firmware_socket() as websocket:
            await websocket.send(json.dumps({"type": "firmware.list"}))
            first = await _recv(websocket)
            await websocket.send(
                json.dumps({"type": "fs.list", "requestId": "r1", "path": str(tmp_path)})
            )
            listing = await _recv(websocket)
            release.set()
            terminal = await _recv_until_terminal(websocket)
            return [first, listing] + terminal

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.resolve_publish_root", side_effect=blocking_resolve
    ), mock.patch(
        f"{_HANDLER_MODULE}.list_firmware_inventory", return_value=[]
    ), mock.patch(
        f"{_HANDLER_MODULE}.latest_firmware_ids", return_value={}
    ), mock.patch(
        f"{_HANDLER_MODULE}.build_firmware_inventory_payload",
        return_value=_inventory_payload(tmp_path),
    ), mock.patch(
        f"{_HANDLER_MODULE}.build_server_capabilities",
        return_value={"features": ["local-file-access"]},
    ):
        frames = asyncio.run(main())

    listing = next(frame for frame in frames if frame["type"] == "fs.list.result")
    assert listing["requestId"] == "r1"
    assert frames[-1]["type"] == "result"
    assert frames[-1]["status"] == "succeeded"



# --- firmware.export ----------------------------------------------------------


def test_export_job_writes_into_the_destination(tmp_path: Path) -> None:

    written = tmp_path / "a.firmware.zip"
    written.write_bytes(b"package-bytes")
    frame = {
        "type": "firmware.export",
        "firmwarePath": str(tmp_path / "a.bin"),
        "destinationDir": str(tmp_path),
    }

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.resolve_inventory_image", return_value=tmp_path / "a.bin"
    ), mock.patch(
        f"{_HANDLER_MODULE}.validate_destination_directory", return_value=tmp_path
    ), mock.patch(
        f"{_HANDLER_MODULE}.export_firmware_package_to_directory", return_value=written
    ):
        frames = asyncio.run(_run_single_job(frame))

    terminal = frames[-1]
    assert terminal["type"] == "result"
    assert terminal["job"] == "export"
    assert terminal["status"] == "succeeded"
    assert terminal["payload"]["exported"]["path"] == str(written)
    assert terminal["payload"]["exported"]["bytes"] == len(b"package-bytes")
    assert [f["stage"] for f in frames if "stage" in f] == ["export"]


def test_export_job_reports_export_exists(tmp_path: Path) -> None:
    from micro_otter.tools.firmware_compile.firmware_package import FirmwarePackageError

    frame = {
        "type": "firmware.export",
        "firmwarePath": str(tmp_path / "a.bin"),
        "destinationDir": str(tmp_path),
    }

    def refusing_export(image_path, *, destination_dir, force=False):
        raise FirmwarePackageError(
            "already exists", code="firmware-export-exists", hint="pick another folder"
        )

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.resolve_inventory_image", return_value=tmp_path / "a.bin"
    ), mock.patch(
        f"{_HANDLER_MODULE}.validate_destination_directory", return_value=tmp_path
    ), mock.patch(
        f"{_HANDLER_MODULE}.export_firmware_package_to_directory",
        side_effect=refusing_export,
    ):
        frames = asyncio.run(_run_single_job(frame))

    terminal = frames[-1]
    assert terminal["type"] == "error"
    assert terminal["code"] == "firmware-export-exists"
    assert terminal["job"] == "export"


def test_export_job_reports_a_path_outside_the_root(tmp_path: Path) -> None:
    from micro_otter.tools.firmware_compile.firmware_inventory import FirmwareInventoryError

    frame = {
        "type": "firmware.export",
        "firmwarePath": str(tmp_path / "a.bin"),
        "destinationDir": str(tmp_path),
    }

    def refusing_resolve(*, path, publish_root=None):
        raise FirmwareInventoryError("outside root", code="firmware-path-invalid")

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.resolve_inventory_image", side_effect=refusing_resolve
    ):
        frames = asyncio.run(_run_single_job(frame))

    terminal = frames[-1]
    assert terminal["type"] == "error"
    assert terminal["code"] == "firmware-path-invalid"
    assert terminal["job"] == "export"


def test_export_disabled_without_compile(tmp_path: Path) -> None:
    frame = {
        "type": "firmware.export",
        "firmwarePath": str(tmp_path / "a.bin"),
        "destinationDir": str(tmp_path),
    }

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.build_server_capabilities", return_value={"features": []}
    ):
        frames = asyncio.run(_run_single_job(frame))

    assert frames[0]["type"] == "error"
    assert frames[0]["code"] == CODE_COMPILE_DISABLED


def test_export_disabled_without_local_file_access(tmp_path: Path) -> None:
    frame = {
        "type": "firmware.export",
        "firmwarePath": str(tmp_path / "a.bin"),
        "destinationDir": str(tmp_path),
    }

    with _handler_env(_config(tmp_path)), mock.patch(
        f"{_HANDLER_MODULE}.build_server_capabilities",
        return_value={"features": ["firmware-compile"]},
    ):
        frames = asyncio.run(_run_single_job(frame))

    assert frames[0]["type"] == "error"
    assert frames[0]["code"] == "fs-not-allowed"


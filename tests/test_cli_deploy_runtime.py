from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Iterator
from pathlib import Path
from unittest import mock

import pytest
from typer.testing import CliRunner

from micro_otter.cli import app
from micro_otter.config import clear_config_cache, load_config
from micro_otter.tools.firmware_compile import FirmwareDeployReport
from micro_otter.tools.firmware_compile.backends import (
    BackendStatus,
    BuildEvent,
    StreamCallback,
)
from micro_otter.tools.firmware_compile.flash import (
    FlashRequest,
    FlashResult,
    register_flash_backend,
    reset_flash_registry,
)

runner = CliRunner()

REPO_ROOT = Path(__file__).resolve().parents[1]
IDF_LAUNCHER = str(REPO_ROOT / "deploy" / "toolchain" / "esp-idf" / "idf.py")


def _idf_argv(build_dir: Path, port: str, action: str) -> list[str]:
    """Return the argv the CLI must hand to the repository launcher."""

    return [IDF_LAUNCHER, "-B", str(build_dir.resolve()), "-p", port, action]


SEAM = "micro_otter.tools.firmware_compile.flash.esptool.run_streamed_process"
"""Patch target for the shared streamed-process seam used by the flash adapter."""


def _assert_toolchain_env(env: dict[str, str]) -> None:
    """Assert the launcher subprocess received the resolver's toolchain environment."""

    clear_config_cache()
    config = load_config()

    assert env["IDF_PATH"] == str(config.idf_path)
    assert env["IDF_TOOLS_PATH"] == str(config.idf_tools_path)
    assert env["MICROPYTHON_ROOT"] == str(config.micropython_root)
    assert env["MICRO_OTTER_TOOLCHAIN_DIR"] == str(config.toolchain_dir)
    assert env["PATH"].split(os.pathsep)[0] == str(config.idf_py.parent)


def test_deploy_runtime_invokes_idf_flash(tmp_path: Path):
    micropython_root = tmp_path / "micropython"
    ports_root = micropython_root / "ports" / "esp32"
    build_dir = ports_root / "build-ESP32_GENERIC"
    build_dir.mkdir(parents=True, exist_ok=True)
    (build_dir / "flash_args").write_text("--chip esp32", encoding="utf-8")

    with (
        mock.patch(
            "micro_otter.cli.app._resolve_default_micropython_root",
            return_value=micropython_root,
        ),
        mock.patch("micro_otter.cli.app.subprocess.run") as run_mock,
    ):
        result = runner.invoke(app, ["deploy-runtime", "--port", "/dev/ttyUSB0"])

    assert result.exit_code == 0
    run_mock.assert_called_once()
    invocation = run_mock.call_args
    assert invocation.args[0] == _idf_argv(build_dir, "/dev/ttyUSB0", "flash")
    assert invocation.kwargs["cwd"] == ports_root
    assert invocation.kwargs["check"] is True
    _assert_toolchain_env(invocation.kwargs["env"])
    assert "Flashed firmware" in result.stdout


def test_deploy_runtime_supports_monitor(tmp_path: Path):
    micropython_root = tmp_path / "micropython"
    ports_root = micropython_root / "ports" / "esp32"
    build_dir = ports_root / "build-ESP32_GENERIC"
    build_dir.mkdir(parents=True, exist_ok=True)
    (build_dir / "flash_args").write_text("--chip esp32", encoding="utf-8")

    with (
        mock.patch(
            "micro_otter.cli.app._resolve_default_micropython_root",
            return_value=micropython_root,
        ),
        mock.patch("micro_otter.cli.app.subprocess.run") as run_mock,
    ):
        result = runner.invoke(app, ["deploy-runtime", "--port", "/dev/ttyUSB0", "--monitor"])

    assert result.exit_code == 0
    assert run_mock.call_count == 2


def test_deploy_runtime_supports_wipe_filesystem(tmp_path: Path):
    micropython_root = tmp_path / "micropython"
    ports_root = micropython_root / "ports" / "esp32"
    build_dir = ports_root / "build-ESP32_GENERIC"
    build_dir.mkdir(parents=True, exist_ok=True)
    (build_dir / "flash_args").write_text("--chip esp32", encoding="utf-8")

    with (
        mock.patch(
            "micro_otter.cli.app._resolve_default_micropython_root",
            return_value=micropython_root,
        ),
        mock.patch("micro_otter.cli.app.subprocess.run") as run_mock,
    ):
        result = runner.invoke(
            app,
            ["deploy-runtime", "--port", "/dev/ttyUSB0", "--wipe-filesystem"],
        )

    assert result.exit_code == 0
    assert run_mock.call_count == 2
    run_mock.assert_has_calls(
        [
            mock.call(
                _idf_argv(build_dir, "/dev/ttyUSB0", "erase-flash"),
                cwd=ports_root,
                check=True,
                env=mock.ANY,
            ),
            mock.call(
                _idf_argv(build_dir, "/dev/ttyUSB0", "flash"),
                cwd=ports_root,
                check=True,
                env=mock.ANY,
            ),
        ]
    )
    _assert_toolchain_env(run_mock.call_args_list[0].kwargs["env"])
    _assert_toolchain_env(run_mock.call_args_list[1].kwargs["env"])


def test_deploy_runtime_rejects_unsupported_board():
    result = runner.invoke(app, ["deploy-runtime", "--port", "/dev/ttyUSB0", "--board", "rp2"])

    assert result.exit_code == 2
    assert "supports only --board esp32, ESP32_GENERIC_S2 or ESP32_GENERIC_S3" in result.stderr


def test_deploy_runtime_requires_existing_build_output(tmp_path: Path):
    micropython_root = tmp_path / "micropython"
    ports_root = micropython_root / "ports" / "esp32"
    ports_root.mkdir(parents=True, exist_ok=True)

    with mock.patch(
        "micro_otter.cli.app._resolve_default_micropython_root",
        return_value=micropython_root,
    ):
        result = runner.invoke(app, ["deploy-runtime", "--port", "/dev/ttyUSB0"])

    assert result.exit_code == 3
    assert "Run compile-runtime before deploy-runtime" in result.stderr


def test_deploy_runtime_reports_a_missing_launcher_with_a_hint(tmp_path: Path, monkeypatch) -> None:
    """A checkout without the launcher fails fast with the toolchain hint."""

    micropython_root = tmp_path / "micropython"
    ports_root = micropython_root / "ports" / "esp32"
    build_dir = ports_root / "build-ESP32_GENERIC"
    build_dir.mkdir(parents=True, exist_ok=True)
    (build_dir / "flash_args").write_text("--chip esp32", encoding="utf-8")
    monkeypatch.setenv("MICRO_OTTER_TOOLCHAIN_ASSETS", str(tmp_path))

    with (
        mock.patch(
            "micro_otter.cli.app._resolve_default_micropython_root",
            return_value=micropython_root,
        ),
        mock.patch("micro_otter.cli.app.subprocess.run") as run_mock,
    ):
        result = runner.invoke(app, ["deploy-runtime", "--port", "/dev/ttyUSB0"])

    assert result.exit_code == 1
    assert "ESP-IDF launcher not found" in result.stderr
    assert "toolchain asset missing" in result.stderr
    assert "hint: restore esp-idf/idf.py" in result.stderr
    run_mock.assert_not_called()


def test_dr_alias_invokes_deploy_runtime(tmp_path: Path):
    micropython_root = tmp_path / "micropython"
    ports_root = micropython_root / "ports" / "esp32"
    build_dir = ports_root / "build-ESP32_GENERIC"
    build_dir.mkdir(parents=True, exist_ok=True)
    (build_dir / "flash_args").write_text("--chip esp32", encoding="utf-8")

    with (
        mock.patch(
            "micro_otter.cli.app._resolve_default_micropython_root",
            return_value=micropython_root,
        ),
        mock.patch("micro_otter.cli.app.subprocess.run"),
    ):
        result = runner.invoke(app, ["dr", "--port", "/dev/ttyUSB0"])

    assert result.exit_code == 0


def test_deploy_runtime_firmware_invokes_esptool(tmp_path: Path):
    firmware_bin = tmp_path / "micro-otter-1.27.0-esp32-general-0.1.0.bin"
    firmware_bin.write_bytes(b"\x00" * 16)

    with mock.patch(SEAM) as run_mock:
        result = runner.invoke(
            app,
            ["deploy-runtime", "--port", "/dev/ttyUSB0", "--firmware", str(firmware_bin)],
        )

    assert result.exit_code == 0
    run_mock.assert_called_once()
    assert run_mock.call_args.kwargs["argv"] == [
        "esptool",
        "--chip",
        "esp32",
        "--port",
        "/dev/ttyUSB0",
        "write-flash",
        "-z",
        "0x1000",
        str(firmware_bin),
    ]
    assert run_mock.call_args.kwargs["timeout_seconds"] is None
    assert firmware_bin.name in result.stdout


def test_deploy_runtime_firmware_with_wipe_filesystem(tmp_path: Path):
    firmware_bin = tmp_path / "firmware.bin"
    firmware_bin.write_bytes(b"\x00" * 16)

    with mock.patch(SEAM) as run_mock:
        result = runner.invoke(
            app,
            [
                "deploy-runtime",
                "--port",
                "/dev/ttyUSB0",
                "--firmware",
                str(firmware_bin),
                "--wipe-filesystem",
            ],
        )

    assert result.exit_code == 0
    assert [call.kwargs["argv"] for call in run_mock.call_args_list] == [
        ["esptool", "--chip", "esp32", "--port", "/dev/ttyUSB0", "erase-flash"],
        [
            "esptool",
            "--chip",
            "esp32",
            "--port",
            "/dev/ttyUSB0",
            "write-flash",
            "-z",
            "0x1000",
            str(firmware_bin),
        ],
    ]


def test_deploy_runtime_firmware_rejects_missing_file(tmp_path: Path):
    result = runner.invoke(
        app,
        ["deploy-runtime", "--port", "/dev/ttyUSB0", "--firmware", str(tmp_path / "missing.bin")],
    )

    assert result.exit_code == 3
    assert "firmware-image-invalid" in result.stderr


def test_deploy_runtime_firmware_rejects_monitor(tmp_path: Path):
    firmware_bin = tmp_path / "firmware.bin"
    firmware_bin.write_bytes(b"\x00" * 16)

    result = runner.invoke(
        app,
        ["deploy-runtime", "--port", "/dev/ttyUSB0", "--firmware", str(firmware_bin), "--monitor"],
    )

    assert result.exit_code == 2
    assert "--monitor is not supported with --firmware" in result.stderr


def test_deploy_runtime_supports_esp32s3_build_dir(tmp_path: Path):
    micropython_root = tmp_path / "micropython"
    ports_root = micropython_root / "ports" / "esp32"
    build_dir = ports_root / "build-ESP32_GENERIC_S3"
    build_dir.mkdir(parents=True, exist_ok=True)
    (build_dir / "flash_args").write_text("--chip esp32s3", encoding="utf-8")

    with (
        mock.patch(
            "micro_otter.cli.app._resolve_default_micropython_root",
            return_value=micropython_root,
        ),
        mock.patch("micro_otter.cli.app.subprocess.run") as run_mock,
    ):
        result = runner.invoke(
            app,
            ["deploy-runtime", "--port", "/dev/ttyACM0", "--board", "ESP32_GENERIC_S3"],
        )

    assert result.exit_code == 0
    run_mock.assert_called_once()
    invocation = run_mock.call_args
    assert invocation.args[0] == _idf_argv(build_dir, "/dev/ttyACM0", "flash")
    assert invocation.kwargs["cwd"] == ports_root
    _assert_toolchain_env(invocation.kwargs["env"])
    assert "Flashed firmware" in result.stdout


def test_deploy_runtime_accepts_micropython_s3_board_id(tmp_path: Path):
    micropython_root = tmp_path / "micropython"
    ports_root = micropython_root / "ports" / "esp32"
    build_dir = ports_root / "build-ESP32_GENERIC_S3"
    build_dir.mkdir(parents=True, exist_ok=True)
    (build_dir / "flash_args").write_text("--chip esp32s3", encoding="utf-8")

    with (
        mock.patch(
            "micro_otter.cli.app._resolve_default_micropython_root",
            return_value=micropython_root,
        ),
        mock.patch("micro_otter.cli.app.subprocess.run") as run_mock,
    ):
        result = runner.invoke(
            app,
            ["deploy-runtime", "--port", "/dev/ttyACM0", "--board", "ESP32_GENERIC_S3"],
        )

    assert result.exit_code == 0
    run_mock.assert_called_once()
    invocation = run_mock.call_args
    assert invocation.args[0] == _idf_argv(build_dir, "/dev/ttyACM0", "flash")
    assert invocation.kwargs["cwd"] == ports_root
    _assert_toolchain_env(invocation.kwargs["env"])


def test_deploy_runtime_supports_esp32s3_firmware(tmp_path: Path):
    firmware_bin = tmp_path / "ESP32_GENERIC_S3-firmware.bin"
    firmware_bin.write_bytes(b"\x00" * 16)

    with mock.patch(SEAM) as run_mock:
        result = runner.invoke(
            app,
            [
                "deploy-runtime",
                "--port",
                "/dev/ttyACM0",
                "--board",
                "ESP32_GENERIC_S3",
                "--firmware",
                str(firmware_bin),
            ],
        )

    assert result.exit_code == 0
    run_mock.assert_called_once()
    assert run_mock.call_args.kwargs["argv"] == [
        "esptool",
        "--chip",
        "esp32s3",
        "--port",
        "/dev/ttyACM0",
        "write-flash",
        "-z",
        "0",
        str(firmware_bin),
    ]
    assert firmware_bin.name in result.stdout


# --- --json-output / --flash-backend / --timeout-seconds ----------------------


@pytest.fixture(autouse=True)
def _clean_flash_registry() -> Iterator[None]:
    """Keep programmatic flash registrations from leaking between CLI tests."""

    reset_flash_registry()
    yield
    reset_flash_registry()


class _FakeCliFlashBackend:
    """Flash backend that records requests instead of invoking a tool."""

    id = "fake"

    def __init__(self) -> None:
        """Start with an empty request log."""

        self.requests: list[FlashRequest] = []

    def status(self) -> BackendStatus:
        """Report availability without touching a device."""

        return BackendStatus(backend_id=self.id, available=True, detail="fake backend")

    def supported_chips(self) -> tuple[str, ...]:
        """Return the chips this fake can flash."""

        return ("esp32", "esp32s3")

    def flash(
        self,
        request: FlashRequest,
        on_event: StreamCallback | None = None,
    ) -> FlashResult:
        """Record the request and report success."""

        self.requests.append(request)
        if on_event is not None:
            on_event(BuildEvent(kind="status", message="done"))
        return FlashResult(
            exit_code=0,
            backend_id=self.id,
            port=request.port,
            firmware_path=request.firmware_path,
            message=f"Flashed {request.firmware_path.name} to {request.port}.",
        )


def test_deploy_runtime_json_output_uses_helper(tmp_path: Path):
    backend = _FakeCliFlashBackend()
    register_flash_backend(backend)
    firmware_bin = tmp_path / "firmware.bin"
    firmware_bin.write_bytes(b"\x00" * 16)

    with mock.patch("micro_otter.cli.app.subprocess.run") as run_mock:
        result = runner.invoke(
            app,
            [
                "dr",
                "--port",
                "/dev/ttyUSB0",
                "--firmware",
                str(firmware_bin),
                "--flash-backend",
                "fake",
                "--json-output",
            ],
        )

    assert result.exit_code == 0
    # The helper path replaces the inline esptool invocation entirely.
    run_mock.assert_not_called()

    payload = json.loads(result.stdout)
    assert payload["schemaVersion"] == 1
    assert payload["status"] == "succeeded"
    assert payload["board"] == {"id": "esp32", "chip": "esp32"}
    assert payload["port"] == "/dev/ttyUSB0"
    assert payload["backend"] == "fake"
    assert payload["firmware"]["path"] == str(firmware_bin.resolve())
    assert payload["firmware"]["sizeBytes"] == 16
    assert payload["firmware"]["sha256"] == (
        "sha256:" + hashlib.sha256(firmware_bin.read_bytes()).hexdigest()
    )
    assert payload["exitCode"] == 0
    assert payload["errors"] == []
    assert len(backend.requests) == 1


def test_deploy_runtime_json_output_failure_payload(tmp_path: Path):
    result = runner.invoke(
        app,
        [
            "dr",
            "--port",
            "/dev/ttyUSB0",
            "--firmware",
            str(tmp_path / "missing.bin"),
            "--json-output",
        ],
    )

    assert result.exit_code == 3
    payload = json.loads(result.stdout)
    assert payload["status"] == "failed"
    assert payload["exitCode"] == 3
    assert [entry["code"] for entry in payload["errors"]] == ["firmware-image-invalid"]
    assert payload["errors"][0]["details"] == {"path": str((tmp_path / "missing.bin").resolve())}
    assert "hint" not in payload["errors"][0]


def test_deploy_runtime_without_json_keeps_human_output(tmp_path: Path):
    firmware_bin = tmp_path / "firmware.bin"
    firmware_bin.write_bytes(b"\x00" * 16)
    report = FirmwareDeployReport(
        exit_code=0,
        board_id="esp32",
        port="/dev/ttyUSB0",
        backend_id="esptool",
        firmware_path=firmware_bin,
        size_bytes=16,
        sha256="",
        message=f"Flashed {firmware_bin.name} to /dev/ttyUSB0.",
    )

    with mock.patch("micro_otter.cli.app.flash_firmware", return_value=report) as helper_mock:
        result = runner.invoke(
            app,
            ["deploy-runtime", "--port", "/dev/ttyUSB0", "--firmware", str(firmware_bin)],
        )

    assert result.exit_code == 0
    helper_mock.assert_called_once()
    assert firmware_bin.name in result.stdout
    assert "{" not in result.stdout


def test_deploy_runtime_rejects_unknown_flash_backend(tmp_path: Path):
    firmware_bin = tmp_path / "firmware.bin"
    firmware_bin.write_bytes(b"\x00" * 16)

    result = runner.invoke(
        app,
        [
            "deploy-runtime",
            "--port",
            "/dev/ttyUSB0",
            "--firmware",
            str(firmware_bin),
            "--flash-backend",
            "nope",
        ],
    )

    assert result.exit_code == 1
    assert "flash-unknown-backend" in result.stderr
    assert "known backends" in result.stderr

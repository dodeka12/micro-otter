"""Tests for the firmware flash backend seam.

Covers the protocol contract, registry selection precedence, entry-point
discovery, and the esptool adapter's command shape. The adapter must keep the
existing ``mo dr --firmware`` behavior byte-for-byte, so several assertions here
mirror ``tests/test_cli_deploy_runtime.py``.
"""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path

import pytest

from micro_otter.tools.firmware_compile.backends import (
    BackendStatus,
    BuildEvent,
    BuildEventKind,
    StreamCallback,
)
from micro_otter.tools.firmware_compile.board_registry import (
    BOARD_CATALOG_DEFAULT_PATH,
    BoardSpec,
    load_board_catalog,
)
from micro_otter.tools.firmware_compile.flash import (
    FLASH_BACKEND_ENV_VAR,
    FirmwareImageNotFoundError,
    FlashBackend,
    FlashBackendError,
    FlashBackendUnavailableError,
    FlashCommandError,
    FlashRequest,
    FlashResult,
    FlashToolMissingError,
    MonitorNotSupportedError,
    NoAvailableFlashBackendError,
    UnknownFlashBackendError,
    UnsupportedFlashChipError,
    get_flash_backend,
    register_flash_backend,
    reset_flash_registry,
    select_flash_backend,
    select_flash_backend_for_board,
)
from micro_otter.tools.firmware_compile.flash.esptool import SUPPORTED_CHIPS, EsptoolFlashBackend
from micro_otter.tools.firmware_compile.process_stream import ProcessTimeout

FLASH_REGISTRY_MODULE = "micro_otter.tools.firmware_compile.flash.registry"
ESPTOOL_MODULE = "micro_otter.tools.firmware_compile.flash.esptool"


def _board_spec(
    *,
    board_id: str = "esp32",
    chip: str = "esp32",
    flash_offset: str = "0x1000",
    flash_backend: str = "esptool",
) -> BoardSpec:
    """Return a minimal board catalog entry for flash adapter tests."""

    return BoardSpec(
        name=board_id,
        slug=board_id.lower(),
        display_name=board_id.upper(),
        chip=chip,
        build_backend="esp-idf",
        flash_backend=flash_backend,
        build_params={
            "port": "esp32",
            "board": board_id,
            "buildDirName": f"build-{board_id.upper()}",
        },
        flash_params={"offset": flash_offset},
    )


class _FakeFlashBackend:
    """Configurable in-memory flash backend used by the contract tests."""

    def __init__(
        self,
        backend_id: str = "fake",
        *,
        available: bool = True,
        chips: tuple[str, ...] = ("esp32",),
    ) -> None:
        """Record the behavior this fake should report."""

        self.id = backend_id
        self.available = available
        self.chips = chips
        self.requests: list[FlashRequest] = []
        self.events: list[BuildEvent] = []

    def status(self) -> BackendStatus:
        """Report the configured availability without touching a device."""

        return BackendStatus(backend_id=self.id, available=self.available, detail="fake backend")

    def supported_chips(self) -> tuple[str, ...]:
        """Return the configured chip tuple."""

        return self.chips

    def flash(
        self,
        request: FlashRequest,
        on_event: StreamCallback | None = None,
    ) -> FlashResult:
        """Record the request and emit one fake status event."""

        self.requests.append(request)
        event = BuildEvent(kind="status", message="fake flash")
        self.events.append(event)
        if on_event is not None:
            on_event(event)
        return FlashResult(
            exit_code=0,
            backend_id=self.id,
            port=request.port,
            firmware_path=request.firmware_path,
        )


# --- 3.1 contract types -------------------------------------------------------


def test_fake_flash_backend_satisfies_runtime_checkable_protocol():
    assert isinstance(_FakeFlashBackend(), FlashBackend)


def test_flash_request_defaults(tmp_path: Path):
    request = FlashRequest(
        board_spec=_board_spec(),
        port="/dev/ttyUSB0",
        firmware_path=tmp_path / "firmware.bin",
    )

    assert request.wipe_filesystem is False
    assert request.timeout_seconds is None
    assert request.monitor is False
    assert request.firmware_path == tmp_path / "firmware.bin"


def test_flash_result_defaults(tmp_path: Path):
    result = FlashResult(
        exit_code=0,
        backend_id="esptool",
        port="/dev/ttyUSB0",
        firmware_path=tmp_path / "firmware.bin",
    )

    assert result.message is None
    assert result.exit_code == 0


def test_flash_backend_forwards_events_to_callback(tmp_path: Path):
    backend = _FakeFlashBackend()
    received: list[BuildEvent] = []

    result = backend.flash(
        FlashRequest(
            board_spec=_board_spec(),
            port="/dev/ttyUSB0",
            firmware_path=tmp_path / "firmware.bin",
        ),
        on_event=received.append,
    )

    assert [event.message for event in received] == ["fake flash"]
    assert received == backend.events
    assert result.port == "/dev/ttyUSB0"


def test_flash_seam_reuses_the_build_event_contract():
    assert BuildEventKind is not None
    assert FlashBackendError.__mro__[1] is RuntimeError


def test_flash_failures_expose_the_cli_exit_codes(tmp_path: Path):
    missing_image = FirmwareImageNotFoundError(tmp_path / "missing.bin")
    missing_tool = FlashToolMissingError("esptool", detail="no such file")
    monitor = MonitorNotSupportedError()
    negative = FlashCommandError("esptool", -1, argv=("esptool", "write-flash"))
    failed = FlashCommandError("esptool", 7, argv=("esptool", "write-flash"))

    assert (missing_image.exit_code, missing_tool.exit_code, monitor.exit_code) == (3, 1, 2)
    assert negative.exit_code == 1
    assert failed.exit_code == 7
    assert "missing.bin" in str(missing_image)
    assert "--monitor is not supported with --firmware." in str(monitor)


def test_missing_firmware_error_is_a_flash_backend_error():
    assert issubclass(FirmwareImageNotFoundError, FlashBackendError)


# --- 3.2 registry selection ---------------------------------------------------


class _FakeEntryPoint:
    """Stand-in for ``importlib.metadata.EntryPoint`` in discovery tests."""

    def __init__(self, name: str, loaded: object, *, broken: bool = False) -> None:
        """Record the entry-point name, payload, and whether it must fail."""

        self.name = name
        self.value = f"tests.fake:{name}"
        self._loaded = loaded
        self._broken = broken

    def load(self) -> object:
        """Return the payload or fail like a broken distribution would."""

        if self._broken:
            raise ImportError(f"broken flash backend entry point: {self.name}")
        return self._loaded


@pytest.fixture(autouse=True)
def _isolated_flash_registry():
    """Keep programmatic flash backend registrations local to each test."""

    reset_flash_registry()
    yield
    reset_flash_registry()


def _patch_entry_points(
    monkeypatch: pytest.MonkeyPatch,
    entry_points: list[_FakeEntryPoint],
) -> None:
    """Replace entry-point discovery with a fixed in-memory list."""

    def fake_entry_points(*, group: str):
        assert group == "micro_otter.flash_backends"
        return list(entry_points)

    monkeypatch.setattr("importlib.metadata.entry_points", fake_entry_points)


def _patch_builtin(monkeypatch: pytest.MonkeyPatch, backend: FlashBackend) -> None:
    """Stand in for the esptool adapter while only the contract is under test."""

    def fake_load_spec(spec):
        assert spec.backend_id == "esptool"
        return backend

    monkeypatch.setattr(f"{FLASH_REGISTRY_MODULE}._load_spec", fake_load_spec)


def test_get_flash_backend_returns_the_builtin_adapter(monkeypatch: pytest.MonkeyPatch):
    backend = _FakeFlashBackend("esptool")
    _patch_entry_points(monkeypatch, [])
    _patch_builtin(monkeypatch, backend)

    assert get_flash_backend("esptool") is backend


def test_get_flash_backend_unknown_id_lists_known_backends(monkeypatch: pytest.MonkeyPatch):
    _patch_entry_points(monkeypatch, [])

    with pytest.raises(UnknownFlashBackendError) as excinfo:
        get_flash_backend("skyflasher")

    assert "skyflasher" in str(excinfo.value)
    assert "esptool" in str(excinfo.value)


def test_auto_selects_the_first_available_backend_for_the_chip(
    monkeypatch: pytest.MonkeyPatch,
):
    _patch_entry_points(monkeypatch, [_FakeEntryPoint("lab", _FakeFlashBackend("lab"))])
    _patch_builtin(monkeypatch, _FakeFlashBackend("esptool", available=False))

    backend = select_flash_backend(chip="esp32")

    assert backend.id == "lab"


def test_auto_normalizes_the_requested_chip(monkeypatch: pytest.MonkeyPatch):
    _patch_entry_points(monkeypatch, [])
    _patch_builtin(monkeypatch, _FakeFlashBackend("esptool", chips=("esp32s3",)))

    backend = select_flash_backend(chip="  ESP32S3 ")

    assert backend.id == "esptool"


def test_auto_without_a_capable_backend_names_the_chip(monkeypatch: pytest.MonkeyPatch):
    _patch_entry_points(monkeypatch, [])
    _patch_builtin(monkeypatch, _FakeFlashBackend("esptool", available=False))

    with pytest.raises(NoAvailableFlashBackendError) as excinfo:
        select_flash_backend(chip="esp32")

    assert "esp32" in str(excinfo.value)
    assert "esptool" in str(excinfo.value)


def test_unavailable_hard_selected_backend_raises(monkeypatch: pytest.MonkeyPatch):
    _patch_entry_points(monkeypatch, [])
    _patch_builtin(monkeypatch, _FakeFlashBackend("esptool", available=False))

    with pytest.raises(FlashBackendUnavailableError) as excinfo:
        select_flash_backend(chip="esp32", requested="esptool")

    assert excinfo.value.backend_id == "esptool"


def test_hard_selected_backend_rejects_an_unsupported_chip(monkeypatch: pytest.MonkeyPatch):
    _patch_entry_points(monkeypatch, [])
    _patch_builtin(monkeypatch, _FakeFlashBackend("esptool", chips=("esp32",)))

    with pytest.raises(UnsupportedFlashChipError) as excinfo:
        select_flash_backend(chip="esp32c3", requested="esptool")

    assert "esp32c3" in str(excinfo.value)


def test_concrete_environment_selection_beats_board_default(
    monkeypatch: pytest.MonkeyPatch,
):
    _patch_entry_points(monkeypatch, [_FakeEntryPoint("lab", _FakeFlashBackend("lab"))])
    _patch_builtin(monkeypatch, _FakeFlashBackend("esptool"))
    monkeypatch.setenv(FLASH_BACKEND_ENV_VAR, "esptool")

    backend = select_flash_backend(chip="esp32", board_default="lab")

    assert backend.id == "esptool"


def test_explicit_request_beats_environment_and_board_default(
    monkeypatch: pytest.MonkeyPatch,
):
    _patch_entry_points(monkeypatch, [_FakeEntryPoint("lab", _FakeFlashBackend("lab"))])
    _patch_builtin(monkeypatch, _FakeFlashBackend("esptool"))
    monkeypatch.setenv(FLASH_BACKEND_ENV_VAR, "lab")

    backend = select_flash_backend(chip="esp32", requested="esptool", board_default="lab")

    assert backend.id == "esptool"


def test_auto_environment_value_still_uses_the_board_default(
    monkeypatch: pytest.MonkeyPatch,
):
    _patch_entry_points(monkeypatch, [_FakeEntryPoint("lab", _FakeFlashBackend("lab"))])
    _patch_builtin(monkeypatch, _FakeFlashBackend("esptool"))
    monkeypatch.setenv(FLASH_BACKEND_ENV_VAR, "auto")

    backend = select_flash_backend(chip="esp32", board_default="lab")

    assert backend.id == "lab"


def test_unavailable_board_default_falls_through_to_auto(monkeypatch: pytest.MonkeyPatch):
    _patch_entry_points(
        monkeypatch,
        [_FakeEntryPoint("lab", _FakeFlashBackend("lab", available=False))],
    )
    _patch_builtin(monkeypatch, _FakeFlashBackend("esptool"))

    backend = select_flash_backend(chip="esp32", board_default="lab")

    assert backend.id == "esptool"


def test_unknown_board_default_falls_through_to_auto(monkeypatch: pytest.MonkeyPatch):
    _patch_entry_points(monkeypatch, [])
    _patch_builtin(monkeypatch, _FakeFlashBackend("esptool"))

    backend = select_flash_backend(chip="esp32", board_default="does-not-exist")

    assert backend.id == "esptool"


def test_broken_entry_point_is_skipped_with_diagnostic(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
):
    _patch_entry_points(
        monkeypatch,
        [
            _FakeEntryPoint("broken", None, broken=True),
            _FakeEntryPoint("lab", _FakeFlashBackend("lab")),
        ],
    )
    _patch_builtin(monkeypatch, _FakeFlashBackend("esptool", available=False))

    with caplog.at_level(logging.WARNING):
        backend = select_flash_backend(chip="esp32")

    assert backend.id == "lab"
    assert "broken" in caplog.text


def test_registered_backend_overrides_lookup(monkeypatch: pytest.MonkeyPatch):
    _patch_entry_points(monkeypatch, [])
    backend = _FakeFlashBackend("lab")

    register_flash_backend(backend)

    assert get_flash_backend("lab") is backend


def test_importing_the_seam_does_not_load_the_esptool_adapter():
    script = (
        "import sys\n"
        "import micro_otter.tools.firmware_compile.flash as flash\n"
        "adapter = 'micro_otter.tools.firmware_compile.flash.esptool'\n"
        "assert adapter not in sys.modules\n"
        "assert flash.known_flash_backend_ids() == ('esptool',)\n"
        "assert adapter not in sys.modules, 'listing ids must stay lazy'\n"
    )

    completed = subprocess.run(
        ["python", "-c", script],
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr


# --- 3.3 esptool adapter ------------------------------------------------------


def _firmware_image(tmp_path: Path, name: str = "firmware.bin") -> Path:
    """Create a tiny firmware image and return its resolved path."""

    firmware = tmp_path / name
    firmware.write_bytes(b"\x00" * 16)
    return firmware.resolve()


def _patch_run(monkeypatch: pytest.MonkeyPatch) -> list[tuple[list[str], float | None]]:
    """Replace the shared process seam with a recorder returning success."""

    calls: list[tuple[list[str], float | None]] = []

    def fake_run(*, argv, timeout_seconds=None, log_callback=None, **_kwargs):
        calls.append((argv, timeout_seconds))
        return 0

    monkeypatch.setattr(f"{ESPTOOL_MODULE}.run_streamed_process", fake_run)
    return calls


def _catalog_board(board_id: str) -> BoardSpec:
    """Return one board entry from the real board catalog."""

    repo_root = Path(__file__).resolve().parents[1]
    catalog = load_board_catalog(repo_root / BOARD_CATALOG_DEFAULT_PATH)
    return next(spec for spec in catalog if spec.name == board_id)


def test_esptool_backend_satisfies_the_flash_protocol():
    assert isinstance(EsptoolFlashBackend(), FlashBackend)


def test_esptool_status_and_chips_do_not_require_a_device(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(f"{ESPTOOL_MODULE}.shutil.which", lambda tool: "/usr/bin/esptool")

    backend = EsptoolFlashBackend()

    assert backend.status().available is True
    assert backend.status().backend_id == "esptool"
    assert backend.supported_chips() == SUPPORTED_CHIPS == ("esp32", "esp32s2", "esp32s3")


def test_esptool_status_reports_a_missing_tool(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(f"{ESPTOOL_MODULE}.shutil.which", lambda tool: None)

    status = EsptoolFlashBackend().status()

    assert status.available is False
    assert status.missing_requirements == ("esptool",)


def test_esptool_write_flash_matches_the_cli_command_shape(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    firmware = _firmware_image(tmp_path)
    calls = _patch_run(monkeypatch)

    result = EsptoolFlashBackend().flash(
        FlashRequest(
            board_spec=_board_spec(),
            port="/dev/ttyUSB0",
            firmware_path=firmware,
        )
    )

    # Kept byte-for-byte in sync with tests/test_cli_deploy_runtime.py.
    assert calls == [
        (
            [
                "esptool",
                "--chip",
                "esp32",
                "--port",
                "/dev/ttyUSB0",
                "write-flash",
                "-z",
                "0x1000",
                str(firmware),
            ],
            None,
        )
    ]
    assert result.exit_code == 0
    assert result.backend_id == "esptool"
    assert result.port == "/dev/ttyUSB0"
    assert result.firmware_path == firmware
    assert result.message == f"Flashed {firmware.name} to /dev/ttyUSB0."


def test_esptool_wipe_filesystem_prepends_erase_flash(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    firmware = _firmware_image(tmp_path)
    calls = _patch_run(monkeypatch)

    EsptoolFlashBackend().flash(
        FlashRequest(
            board_spec=_board_spec(),
            port="/dev/ttyUSB0",
            firmware_path=firmware,
            wipe_filesystem=True,
        )
    )

    assert calls == [
        (["esptool", "--chip", "esp32", "--port", "/dev/ttyUSB0", "erase-flash"], None),
        (
            [
                "esptool",
                "--chip",
                "esp32",
                "--port",
                "/dev/ttyUSB0",
                "write-flash",
                "-z",
                "0x1000",
                str(firmware),
            ],
            None,
        ),
    ]


@pytest.mark.parametrize(
    ("board_id", "chip", "offset"),
    (
        ("esp32", "esp32", "0x1000"),
        ("ESP32_GENERIC_S2", "esp32s2", "0x1000"),
        ("ESP32_GENERIC_S3", "esp32s3", "0"),
    ),
)
def test_esptool_offsets_come_from_the_board_catalog(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    board_id: str,
    chip: str,
    offset: str,
):
    firmware = _firmware_image(tmp_path)
    calls = _patch_run(monkeypatch)
    board_spec = _catalog_board(board_id)

    EsptoolFlashBackend().flash(
        FlashRequest(board_spec=board_spec, port="/dev/ttyUSB0", firmware_path=firmware)
    )

    assert board_spec.chip == chip
    assert calls[0][0] == [
        "esptool",
        "--chip",
        chip,
        "--port",
        "/dev/ttyUSB0",
        "write-flash",
        "-z",
        offset,
        str(firmware),
    ]


def test_esptool_missing_firmware_raises_before_running_the_tool(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    calls = _patch_run(monkeypatch)
    events: list[BuildEvent] = []

    with pytest.raises(FirmwareImageNotFoundError) as excinfo:
        EsptoolFlashBackend().flash(
            FlashRequest(
                board_spec=_board_spec(),
                port="/dev/ttyUSB0",
                firmware_path=tmp_path / "missing.bin",
            ),
            on_event=events.append,
        )

    assert calls == []
    assert excinfo.value.exit_code == 3
    assert events[-1].kind == "error"
    assert events[-1].payload == {"exception": "FirmwareImageNotFoundError", "exit_code": 3}


def test_esptool_rejects_monitor_requests(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    firmware = _firmware_image(tmp_path)
    calls = _patch_run(monkeypatch)

    with pytest.raises(MonitorNotSupportedError) as excinfo:
        EsptoolFlashBackend().flash(
            FlashRequest(
                board_spec=_board_spec(),
                port="/dev/ttyUSB0",
                firmware_path=firmware,
                monitor=True,
            )
        )

    assert calls == []
    assert excinfo.value.exit_code == 2


def test_esptool_missing_tool_maps_to_exit_code_one(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    firmware = _firmware_image(tmp_path)

    def fake_run(**_kwargs):
        raise FileNotFoundError(2, "No such file or directory", "esptool")

    monkeypatch.setattr(f"{ESPTOOL_MODULE}.run_streamed_process", fake_run)

    with pytest.raises(FlashToolMissingError) as excinfo:
        EsptoolFlashBackend().flash(
            FlashRequest(board_spec=_board_spec(), port="/dev/ttyUSB0", firmware_path=firmware)
        )

    assert excinfo.value.exit_code == 1


def test_esptool_failed_subprocess_keeps_the_positive_exit_code(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    firmware = _firmware_image(tmp_path)

    def fake_run(*, argv, **_kwargs):
        raise subprocess.CalledProcessError(returncode=7, cmd=argv)

    monkeypatch.setattr(f"{ESPTOOL_MODULE}.run_streamed_process", fake_run)

    with pytest.raises(FlashCommandError) as excinfo:
        EsptoolFlashBackend().flash(
            FlashRequest(board_spec=_board_spec(), port="/dev/ttyUSB0", firmware_path=firmware)
        )

    assert excinfo.value.exit_code == 7
    assert excinfo.value.returncode == 7


def test_esptool_negative_subprocess_code_maps_to_exit_code_one(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    firmware = _firmware_image(tmp_path)

    def fake_run(*, argv, **_kwargs):
        raise subprocess.CalledProcessError(returncode=-11, cmd=argv)

    monkeypatch.setattr(f"{ESPTOOL_MODULE}.run_streamed_process", fake_run)

    with pytest.raises(FlashCommandError) as excinfo:
        EsptoolFlashBackend().flash(
            FlashRequest(board_spec=_board_spec(), port="/dev/ttyUSB0", firmware_path=firmware)
        )

    assert excinfo.value.exit_code == 1


def test_esptool_timeout_maps_to_exit_code_one(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    firmware = _firmware_image(tmp_path)
    recorded: list[float] = []

    def fake_run(*, timeout_seconds=None, **_kwargs):
        recorded.append(timeout_seconds)
        raise ProcessTimeout(timeout_seconds or 0.0)

    monkeypatch.setattr(f"{ESPTOOL_MODULE}.run_streamed_process", fake_run)

    with pytest.raises(FlashCommandError) as excinfo:
        EsptoolFlashBackend().flash(
            FlashRequest(
                board_spec=_board_spec(),
                port="/dev/ttyUSB0",
                firmware_path=firmware,
                timeout_seconds=30.0,
            )
        )

    assert recorded == [30.0]
    assert excinfo.value.exit_code == 1


def test_esptool_forwards_streamed_output_to_the_request_sink(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    firmware = _firmware_image(tmp_path)
    lines: list[tuple[str, str]] = []

    def fake_run(*, log_callback=None, **_kwargs):
        assert log_callback is not None, "the adapter passes the request sink through"
        log_callback("stdout", "Writing at 0x00010000...\n")
        log_callback("stderr", "esptool warning\n")
        return 0

    monkeypatch.setattr(f"{ESPTOOL_MODULE}.run_streamed_process", fake_run)

    EsptoolFlashBackend().flash(
        FlashRequest(
            board_spec=_board_spec(),
            port="/dev/ttyUSB0",
            firmware_path=firmware,
            log_callback=lambda stream, text: lines.append((stream, text)),
        )
    )

    assert lines == [
        ("stdout", "Writing at 0x00010000...\n"),
        ("stderr", "esptool warning\n"),
    ]


def test_esptool_emits_stage_events_in_order(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    firmware = _firmware_image(tmp_path)
    _patch_run(monkeypatch)
    events: list[BuildEvent] = []

    EsptoolFlashBackend().flash(
        FlashRequest(
            board_spec=_board_spec(),
            port="/dev/ttyUSB0",
            firmware_path=firmware,
            wipe_filesystem=True,
        ),
        on_event=events.append,
    )

    assert [event.message for event in events] == [
        "erase-start",
        "erase-finish",
        "write-start",
        "write-finish",
        "done",
    ]
    assert [event.kind for event in events] == ["stage", "stage", "stage", "stage", "status"]
    assert events[2].payload["offset"] == "0x1000"


def test_esptool_flash_is_inert_without_an_event_callback(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
):
    firmware = _firmware_image(tmp_path)
    _patch_run(monkeypatch)

    result = EsptoolFlashBackend().flash(
        FlashRequest(board_spec=_board_spec(), port="/dev/ttyUSB0", firmware_path=firmware)
    )

    captured = capsys.readouterr()
    assert result.exit_code == 0
    assert captured.out == ""
    assert captured.err == ""


def test_esptool_logs_every_tool_line_verbatim(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """The adapter relays the tool's own output, bar redraws and all, in order.

    The Deploy log is a console transcript: a line the tool wrote must reach the
    request sink unchanged, and no line may be swallowed to synthesise a
    percentage the protocol does not carry.
    """

    firmware = _firmware_image(tmp_path)
    lines: list[tuple[str, str]] = []
    events: list[BuildEvent] = []
    replayed = [
        ("stdout", "esptool v5.1.0\n"),
        ("stdout", "Writing at 0x00001000 [==>     ]  33.3% 4096/12000 bytes... \n"),
        ("stdout", "Writing at 0x00001000 [=====>  ]  66.7% 8192/12000 bytes... \n"),
        ("stdout", "Wrote 12000 bytes at 0x00010000 in 2.1 seconds\n"),
        ("stderr", "esptool warning: stub is old\n"),
    ]

    def fake_run(*, log_callback=None, **_kwargs):
        """Replay the recorded tool output through the sink the adapter passed."""

        assert log_callback is not None, "the adapter hands the request sink to the seam"
        for stream, text in replayed:
            log_callback(stream, text)
        return 0

    monkeypatch.setattr(f"{ESPTOOL_MODULE}.run_streamed_process", fake_run)

    EsptoolFlashBackend().flash(
        FlashRequest(
            board_spec=_board_spec(),
            port="/dev/ttyUSB0",
            firmware_path=firmware,
            log_callback=lambda stream, text: lines.append((stream, text)),
        ),
        on_event=events.append,
    )

    assert lines == replayed
    assert [event.kind for event in events] == ["stage", "stage", "status"]



# --- 4.3 board-aware flash selection ------------------------------------------


def _patch_esptool_available(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make the built-in adapter report itself as installed."""

    monkeypatch.setattr(f"{ESPTOOL_MODULE}.shutil.which", lambda tool: "/usr/bin/esptool")


def test_select_flash_backend_for_board_uses_the_catalog_default(
    monkeypatch: pytest.MonkeyPatch,
):
    _patch_entry_points(monkeypatch, [_FakeEntryPoint("lab", _FakeFlashBackend("lab"))])
    _patch_esptool_available(monkeypatch)

    backend = select_flash_backend_for_board(
        _board_spec(flash_backend="lab"),
    )

    assert backend.id == "lab"


def test_select_flash_backend_for_board_honors_the_environment(
    monkeypatch: pytest.MonkeyPatch,
):
    _patch_entry_points(monkeypatch, [_FakeEntryPoint("lab", _FakeFlashBackend("lab"))])
    _patch_esptool_available(monkeypatch)
    monkeypatch.setenv(FLASH_BACKEND_ENV_VAR, "esptool")

    backend = select_flash_backend_for_board(_board_spec(flash_backend="lab"))

    assert backend.id == "esptool"


def test_select_flash_backend_for_board_honors_a_request(monkeypatch: pytest.MonkeyPatch):
    _patch_entry_points(monkeypatch, [_FakeEntryPoint("lab", _FakeFlashBackend("lab"))])
    _patch_esptool_available(monkeypatch)

    backend = select_flash_backend_for_board(
        _board_spec(flash_backend="esptool"),
        requested="lab",
    )

    assert backend.id == "lab"


def test_select_flash_backend_for_board_falls_back_for_unknown_defaults(
    monkeypatch: pytest.MonkeyPatch,
):
    _patch_entry_points(monkeypatch, [])
    _patch_esptool_available(monkeypatch)

    backend = select_flash_backend_for_board(_board_spec(flash_backend="does-not-exist"))

    assert backend.id == "esptool"


@pytest.mark.parametrize("board_id", ("esp32", "ESP32_GENERIC_S2", "ESP32_GENERIC_S3"))
def test_auto_selects_esptool_for_every_catalog_board(
    monkeypatch: pytest.MonkeyPatch, board_id: str
):
    _patch_entry_points(monkeypatch, [])
    _patch_esptool_available(monkeypatch)

    backend = select_flash_backend(chip=_catalog_board(board_id).chip)

    assert backend.id == "esptool"


def test_unsupported_chip_raises_the_documented_error(monkeypatch: pytest.MonkeyPatch):
    _patch_entry_points(monkeypatch, [])
    _patch_esptool_available(monkeypatch)

    with pytest.raises(UnsupportedFlashChipError) as excinfo:
        select_flash_backend(chip="esp32c6", requested="esptool")

    assert excinfo.value.chip == "esp32c6"
    assert "esp32s3" in str(excinfo.value)

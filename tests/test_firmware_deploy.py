"""Tests for the headless firmware deploy helper.

The helper is the single server-side entry point for "flash this board with this
image". These tests pin its image-resolution rules, its error family, and its
payload shape, using a registered fake flash backend so no device, tool, or
subprocess is touched.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterator
from pathlib import Path

import pytest

from micro_otter.tools.firmware_compile.backends import (
    BackendStatus,
    BuildEvent,
    StreamCallback,
)
from micro_otter.tools.firmware_compile.board_registry import BoardSpec
from micro_otter.tools.firmware_compile.firmware_deploy import (
    FirmwareBoardUnsupportedError,
    FirmwareDeployError,
    FirmwareDeployReport,
    FirmwareDeployRequest,
    FirmwareImageInvalidError,
    FirmwareImageUnavailableError,
    build_deploy_payload,
    flash_firmware,
    resolve_firmware_image,
    resolve_latest_firmware_for_board,
)
from micro_otter.tools.firmware_compile.flash import (
    FLASH_BACKEND_ENV_VAR,
    FlashCommandError,
    FlashRequest,
    FlashResult,
    register_flash_backend,
    reset_flash_registry,
)


@pytest.fixture(autouse=True)
def _clean_flash_registry() -> Iterator[None]:
    """Keep programmatic flash registrations from leaking between tests."""

    reset_flash_registry()
    yield
    reset_flash_registry()


def _board_spec(
    *,
    board_id: str = "esp32",
    chip: str = "esp32",
    flash_backend: str = "esptool",
) -> BoardSpec:
    """Return a minimal board catalog entry for deploy tests."""

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
        flash_params={"offset": "0x1000"},
    )


class _FakeFlashBackend:
    """In-memory flash backend that records requests and replays one result."""

    def __init__(
        self,
        backend_id: str = "fake",
        *,
        chips: tuple[str, ...] = ("esp32", "esp32s3"),
        exit_code: int = 0,
        error: Exception | None = None,
        available: bool = True,
    ) -> None:
        """Record the behavior this fake should report."""

        self.id = backend_id
        self.chips = chips
        self.exit_code = exit_code
        self.error = error
        self.available = available
        self.requests: list[FlashRequest] = []

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
        """Record the request, stream one event, and replay the configured outcome."""

        self.requests.append(request)
        if on_event is not None:
            on_event(
                BuildEvent(kind="stage", message="write-start", payload={"port": request.port})
            )
        if self.error is not None:
            raise self.error
        return FlashResult(
            exit_code=self.exit_code,
            backend_id=self.id,
            port=request.port,
            firmware_path=request.firmware_path,
            message="fake flash complete",
        )


def _write_image(path: Path, payload: bytes = b"\x00" * 32) -> Path:
    """Write *payload* to *path* and return the path."""

    path.write_bytes(payload)
    return path


def _published(root: Path, name: str) -> Path:
    """Create one published firmware file under *root* and return it."""

    root.mkdir(parents=True, exist_ok=True)
    return _write_image(root / name)


# --- 3.2 image resolution ----------------------------------------------------


def test_resolve_latest_firmware_for_board_filters_channel(tmp_path: Path):
    root = tmp_path / "published"
    _published(root, "micro-otter-1.27.0-esp32-general-1.0.0.bin")
    dev = _published(root, "micro-otter-1.27.0-esp32-general-1.0.1-dev.7.gabc1234.bin")

    assert resolve_latest_firmware_for_board(board_id="esp32", publish_root=root) == dev
    release = resolve_latest_firmware_for_board(
        board_id="esp32", publish_root=root, channel="release"
    )
    assert release is not None and release.name.endswith("1.0.0.bin")
    assert (
        resolve_latest_firmware_for_board(
            board_id="esp32", publish_root=root, channel="unknown"
        )
        is None
    )


def test_resolve_firmware_image_reports_channel_in_error(tmp_path: Path):
    root = tmp_path / "published"
    _published(root, "micro-otter-1.27.0-esp32-general-1.0.1-dev.7.gabc1234.bin")

    with pytest.raises(FirmwareImageUnavailableError) as excinfo:
        resolve_firmware_image(board_spec=_board_spec(), publish_root=root, channel="release")

    assert excinfo.value.details["channel"] == "release"


def test_resolve_latest_firmware_for_board_picks_newest_version(tmp_path: Path):
    root = tmp_path / "published"
    _published(root, "micro-otter-1.27.0-esp32-general-0.1.0.bin")
    _published(root, "micro-otter-1.27.0-esp32-general-0.9.0.bin")
    newest = _published(root, "micro-otter-1.27.0-esp32-general-0.10.0.bin")

    resolved = resolve_latest_firmware_for_board(board_id="esp32", publish_root=root)

    assert resolved == newest
    assert resolved == resolve_latest_firmware_for_board(board_id="ESP32", publish_root=root)


def test_resolve_latest_firmware_for_board_filters_runtime_id(tmp_path: Path):
    root = tmp_path / "published"
    _published(root, "micro-otter-1.27.0-esp32-general-0.9.0.bin")
    hass = _published(root, "micro-otter-1.27.0-esp32-hass-0.2.0.bin")

    resolved = resolve_latest_firmware_for_board(
        board_id="esp32",
        runtime_id="hass",
        publish_root=root,
    )

    assert resolved == hass


def test_resolve_latest_firmware_for_board_filters_content_hash(tmp_path: Path):
    root = tmp_path / "published"
    _published(root, "micro-otter-1.27.0-esp32-general-0.9.0-111111111111.bin")
    wanted = _published(root, "micro-otter-1.27.0-esp32-general-0.9.0-222222222222.bin")

    resolved = resolve_latest_firmware_for_board(
        board_id="esp32",
        content_hash="222222222222",
        publish_root=root,
    )

    assert resolved == wanted

    assert (
        resolve_latest_firmware_for_board(
            board_id="esp32",
            content_hash="333333333333",
            publish_root=root,
        )
        is None
    )


def test_resolve_latest_firmware_for_board_returns_none_for_unknown_board(tmp_path: Path):
    root = tmp_path / "published"
    _published(root, "micro-otter-1.27.0-esp32-general-0.1.0.bin")

    assert resolve_latest_firmware_for_board(board_id="rp2", publish_root=root) is None
    missing_root = tmp_path / "nope"
    assert resolve_latest_firmware_for_board(board_id="esp32", publish_root=missing_root) is None


def test_resolve_latest_firmware_for_board_tolerates_odd_versions(tmp_path: Path):
    root = tmp_path / "published"
    _published(root, "micro-otter-1.27.0-esp32-general-dev.bin")
    semver = _published(root, "micro-otter-1.27.0-esp32-general-0.0.1.bin")

    resolved = resolve_latest_firmware_for_board(board_id="esp32", publish_root=root)

    assert resolved == semver


def test_resolve_explicit_path_wins_over_inventory(tmp_path: Path):
    root = tmp_path / "published"
    _published(root, "micro-otter-1.27.0-esp32-general-9.9.9.bin")
    explicit = _write_image(tmp_path / "local-image.bin")

    resolved = resolve_firmware_image(
        board_spec=_board_spec(),
        firmware_path=explicit,
        publish_root=root,
    )

    assert resolved == explicit.resolve()


def test_resolve_firmware_image_looks_up_by_canonical_slug(tmp_path: Path):
    root = tmp_path / "published"
    _published(root, "micro-otter-1.29.0-esp32_generic_s3-general-0.36.0.bin")

    resolved = resolve_firmware_image(
        board_spec=_board_spec(board_id="ESP32_GENERIC_S3", chip="esp32s3"),
        runtime_id="general",
        publish_root=root,
    )

    assert resolved.name == "micro-otter-1.29.0-esp32_generic_s3-general-0.36.0.bin"


def test_resolve_missing_image_raises_with_hint(tmp_path: Path):
    root = tmp_path / "published"
    root.mkdir()

    with pytest.raises(FirmwareImageUnavailableError) as excinfo:
        resolve_firmware_image(board_spec=_board_spec(), runtime_id="general", publish_root=root)

    error = excinfo.value
    assert error.code == "firmware-image-unavailable"
    assert error.exit_code == 3
    assert error.hint is not None
    assert "mo cr" in error.hint
    assert "MICRO_OTTER_FIRMWARE_DIR" in error.hint
    assert error.details == {
        "boardId": "esp32",
        "runtimeId": "general",
        "publishRoot": str(root),
    }


def test_invalid_image_raises_code(tmp_path: Path):
    request = FirmwareDeployRequest(
        board_spec=_board_spec(),
        port="/dev/ttyUSB0",
        firmware_path=tmp_path / "missing.bin",
    )

    with pytest.raises(FirmwareImageInvalidError) as excinfo:
        flash_firmware(request)

    assert excinfo.value.code == "firmware-image-invalid"
    assert excinfo.value.exit_code == 3
    assert excinfo.value.hint is None
    assert excinfo.value.details == {"path": str((tmp_path / "missing.bin").resolve())}


def test_empty_image_raises_invalid_code(tmp_path: Path):
    request = FirmwareDeployRequest(
        board_spec=_board_spec(),
        port="/dev/ttyUSB0",
        firmware_path=_write_image(tmp_path / "empty.bin", b""),
    )

    with pytest.raises(FirmwareImageInvalidError) as excinfo:
        flash_firmware(request)

    assert excinfo.value.code == "firmware-image-invalid"


def test_board_without_chip_is_rejected(tmp_path: Path):
    request = FirmwareDeployRequest(
        board_spec=_board_spec(chip=" "),
        port="/dev/ttyUSB0",
        firmware_path=_write_image(tmp_path / "image.bin"),
    )

    with pytest.raises(FirmwareBoardUnsupportedError) as excinfo:
        flash_firmware(request)

    assert excinfo.value.code == "board-not-flashable"
    assert excinfo.value.exit_code == 2


# --- 3.3 flash_firmware ------------------------------------------------------


def _deploy_request(tmp_path: Path, **overrides) -> FirmwareDeployRequest:
    """Return a deploy request pointing at a freshly written fake image."""

    image = _write_image(tmp_path / "image.bin")
    defaults = {
        "board_spec": _board_spec(flash_backend="fake"),
        "port": "/dev/ttyUSB0",
        "firmware_path": image,
    }
    defaults.update(overrides)
    return FirmwareDeployRequest(**defaults)


def test_deploy_forwards_events_to_callback(tmp_path: Path):
    backend = _FakeFlashBackend()
    register_flash_backend(backend)
    events: list[BuildEvent] = []

    flash_firmware(_deploy_request(tmp_path), on_event=events.append)

    assert [event.message for event in events] == ["write-start"]
    assert events[0].kind == "stage"


def test_deploy_reports_backend_result_fields(tmp_path: Path):
    backend = _FakeFlashBackend()
    register_flash_backend(backend)
    request = _deploy_request(tmp_path)

    report = flash_firmware(request)

    assert isinstance(report, FirmwareDeployReport)
    assert report.exit_code == 0
    assert report.board_id == "esp32"
    assert report.port == "/dev/ttyUSB0"
    assert report.backend_id == "fake"
    assert report.firmware_path == request.firmware_path.resolve()
    assert report.size_bytes == 32
    assert report.sha256 == "sha256:" + hashlib.sha256(b"\x00" * 32).hexdigest()
    assert report.message == "fake flash complete"


def test_deploy_propagates_nonzero_exit_code_without_raising(tmp_path: Path):
    register_flash_backend(_FakeFlashBackend(exit_code=2))

    report = flash_firmware(_deploy_request(tmp_path))

    assert report.exit_code == 2


def test_deploy_wraps_backend_error_with_code_and_cause(tmp_path: Path):
    backend_error = FlashCommandError("esptool", 3, argv=("esptool", "write-flash"))
    register_flash_backend(_FakeFlashBackend(error=backend_error))

    with pytest.raises(FirmwareDeployError) as excinfo:
        flash_firmware(_deploy_request(tmp_path))

    error = excinfo.value
    assert error.code == "flash-command"
    assert error.category == "deploy"
    assert error.exit_code == 3
    assert error.details == {"tool": "esptool", "returncode": 3}
    assert error.__cause__ is backend_error


def test_deploy_uses_requested_backend_id(tmp_path: Path):
    requested = _FakeFlashBackend("requested")
    other = _FakeFlashBackend("other")
    register_flash_backend(requested)
    register_flash_backend(other)

    report = flash_firmware(_deploy_request(tmp_path, backend_id="requested"))

    assert report.backend_id == "requested"
    assert len(requested.requests) == 1
    assert other.requests == []


def test_deploy_prefers_requested_backend_over_environment(tmp_path: Path):
    requested = _FakeFlashBackend("requested")
    from_environment = _FakeFlashBackend("from-env")
    register_flash_backend(requested)
    register_flash_backend(from_environment)

    report = flash_firmware(
        _deploy_request(tmp_path, backend_id="requested"),
        environ={FLASH_BACKEND_ENV_VAR: "from-env"},
    )

    assert report.backend_id == "requested"


def test_deploy_uses_environment_backend_when_none_requested(tmp_path: Path):
    from_environment = _FakeFlashBackend("from-env")
    register_flash_backend(from_environment)

    report = flash_firmware(
        _deploy_request(tmp_path),
        environ={FLASH_BACKEND_ENV_VAR: "from-env"},
    )

    assert report.backend_id == "from-env"


def test_deploy_rejects_unknown_backend_with_known_ids(tmp_path: Path):
    register_flash_backend(_FakeFlashBackend("fake"))

    with pytest.raises(FirmwareDeployError) as excinfo:
        flash_firmware(_deploy_request(tmp_path, backend_id="nope"))

    assert excinfo.value.code == "flash-unknown-backend"
    assert excinfo.value.details is not None
    assert "fake" in excinfo.value.details["known_backend_ids"]


def test_deploy_passes_monitor_false_and_timeout(tmp_path: Path):
    backend = _FakeFlashBackend()
    register_flash_backend(backend)

    flash_firmware(_deploy_request(tmp_path, timeout_seconds=12.5, wipe_filesystem=True))

    flash_request = backend.requests[0]
    assert flash_request.monitor is False
    assert flash_request.timeout_seconds == 12.5
    assert flash_request.wipe_filesystem is True


# --- 3.4 payload builder -----------------------------------------------------


def test_build_deploy_payload_reports_success_shape(tmp_path: Path):
    register_flash_backend(_FakeFlashBackend())
    request = _deploy_request(tmp_path)

    payload = build_deploy_payload(flash_firmware(request), request=request)

    assert payload["schemaVersion"] == 1
    assert payload["status"] == "succeeded"
    assert payload["board"] == {"id": "esp32", "chip": "esp32"}
    assert payload["port"] == "/dev/ttyUSB0"
    assert payload["backend"] == "fake"
    assert payload["firmware"]["path"] == str(request.firmware_path.resolve())
    assert payload["firmware"]["sizeBytes"] == 32
    assert payload["firmware"]["sha256"].startswith("sha256:")
    assert payload["exitCode"] == 0
    assert payload["errors"] == []
    assert payload["warnings"] == []


def test_build_deploy_payload_reports_error_shape(tmp_path: Path):
    request = _deploy_request(tmp_path, firmware_path=tmp_path / "missing.bin")
    try:
        flash_firmware(request)
    except FirmwareDeployError as error:
        payload = build_deploy_payload(error, request=request)
    else:  # pragma: no cover - the deploy must fail for this test to mean anything
        raise AssertionError("expected the deploy to fail")

    assert payload["status"] == "failed"
    assert payload["exitCode"] == 3
    assert payload["board"] == {"id": "esp32", "chip": "esp32"}
    assert payload["port"] == "/dev/ttyUSB0"
    assert payload["firmware"]["sizeBytes"] is None
    assert payload["firmware"]["sha256"] is None
    assert [entry["code"] for entry in payload["errors"]] == ["firmware-image-invalid"]
    assert payload["errors"][0]["category"] == "deploy"
    assert "hint" not in payload["errors"][0]


def test_build_deploy_payload_keeps_hint_for_unavailable_image(tmp_path: Path):
    try:
        resolve_firmware_image(board_spec=_board_spec(), publish_root=tmp_path)
    except FirmwareImageUnavailableError as error:
        payload = build_deploy_payload(error)
    else:  # pragma: no cover - resolution must fail in an empty inventory
        raise AssertionError("expected image resolution to fail")

    assert payload["status"] == "failed"
    assert payload["errors"][0]["code"] == "firmware-image-unavailable"
    assert "mo cr" in payload["errors"][0]["hint"]
    assert payload["errors"][0]["details"]["boardId"] == "esp32"

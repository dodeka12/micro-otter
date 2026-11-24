from pathlib import Path

from micro_otter.cli import state as state_module
from micro_otter.cli.state import CliState, detect_serial_ports, load_state, save_state


def _pyserial_unavailable():
    """Simulate a host without pyserial so the glob fallback runs."""

    raise ImportError("pyserial unavailable")


def test_detect_serial_ports_sorts_and_deduplicates(monkeypatch):
    def fake_glob(pattern):
        if pattern == "/dev/ttyUSB*":
            return ["/dev/ttyUSB1", "/dev/ttyUSB0"]
        if pattern == "/dev/ttyACM*":
            return ["/dev/ttyACM0", "/dev/ttyUSB0"]
        return []

    monkeypatch.setattr("micro_otter.cli.state._list_ports_via_pyserial", _pyserial_unavailable)
    monkeypatch.setattr("micro_otter.cli.state.glob.glob", fake_glob)
    monkeypatch.setattr("micro_otter.cli.state._serial_by_id_labels", lambda: {})

    ports = detect_serial_ports()
    assert [port.device for port in ports] == ["/dev/ttyACM0", "/dev/ttyUSB0", "/dev/ttyUSB1"]
    assert all(port.label is None for port in ports)


def test_detect_serial_ports_no_matches(monkeypatch):
    monkeypatch.setattr("micro_otter.cli.state._list_ports_via_pyserial", _pyserial_unavailable)
    monkeypatch.setattr("micro_otter.cli.state.glob.glob", lambda pattern: [])
    monkeypatch.setattr("micro_otter.cli.state._serial_by_id_labels", lambda: {})

    assert detect_serial_ports() == []


def test_detect_serial_ports_attaches_friendly_labels(monkeypatch):
    def fake_glob(pattern):
        if pattern == "/dev/ttyACM*":
            return ["/dev/ttyACM0"]
        return []

    monkeypatch.setattr("micro_otter.cli.state._list_ports_via_pyserial", _pyserial_unavailable)
    monkeypatch.setattr("micro_otter.cli.state.glob.glob", fake_glob)
    monkeypatch.setattr(
        "micro_otter.cli.state._serial_by_id_labels",
        lambda: {"/dev/ttyACM0": "usb-Espressif_USB_JTAG_SERIAL_ABC-if00"},
    )

    ports = detect_serial_ports()
    assert ports[0].device == "/dev/ttyACM0"
    assert ports[0].label == "usb-Espressif_USB_JTAG_SERIAL_ABC-if00"


def test_load_state_round_trip(tmp_path: Path):
    path = tmp_path / "state.json"
    save_state(
        CliState(
            last_port="/dev/ttyACM0",
            last_wipe_filesystem=True,
            last_monitor=False,
            last_board="esp32s3",
            last_action="deploy",
        ),
        path,
    )

    loaded = load_state(path)
    assert loaded.last_port == "/dev/ttyACM0"
    assert loaded.last_wipe_filesystem is True
    assert loaded.last_monitor is False
    assert loaded.last_board == "esp32s3"
    assert loaded.last_action == "deploy"


def test_load_state_round_trip_build_deploy_action(tmp_path: Path):
    path = tmp_path / "state.json"
    save_state(CliState(last_action="build-deploy"), path)

    loaded = load_state(path)

    assert loaded.last_action == "build-deploy"


def test_load_state_missing_file_returns_defaults(tmp_path: Path):
    state = load_state(tmp_path / "missing.json")

    assert state.last_port is None
    assert state.last_wipe_filesystem is False
    assert state.last_monitor is False


def test_load_state_corrupt_json_returns_defaults(tmp_path: Path):
    path = tmp_path / "state.json"
    path.write_text("{not valid json", encoding="utf-8")

    state = load_state(path)

    assert state.last_port is None
    assert state.last_wipe_filesystem is False
    assert state.last_monitor is False


def test_load_state_ignores_non_bool_flags(tmp_path: Path):
    path = tmp_path / "state.json"
    path.write_text(
        '{"lastPort": "/dev/ttyACM0", "lastWipeFilesystem": "yes", "lastMonitor": 1}',
        encoding="utf-8",
    )

    state = load_state(path)

    assert state.last_port == "/dev/ttyACM0"
    assert state.last_wipe_filesystem is False
    assert state.last_monitor is False


def test_load_state_ignores_invalid_board_and_action(tmp_path: Path):
    path = tmp_path / "state.json"
    path.write_text(
        '{"lastBoard": "", "lastAction": "watch"}',
        encoding="utf-8",
    )

    state = load_state(path)

    assert state.last_board is None
    assert state.last_action is None


def test_default_state_path_honours_micro_otter_state_dir(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("MICRO_OTTER_STATE_DIR", str(tmp_path / "state"))

    assert state_module._default_state_path() == tmp_path / "state" / "state.json"


def test_load_state_reads_legacy_file_when_new_path_missing(tmp_path: Path, monkeypatch):
    legacy = tmp_path / "config" / "micro-otter" / "state.json"
    legacy.parent.mkdir(parents=True)
    legacy.write_text('{"lastPort": "/dev/ttyUSB1"}', encoding="utf-8")
    resolved = tmp_path / "state" / "state.json"
    monkeypatch.setattr("micro_otter.cli.state._default_state_path", lambda: resolved)
    monkeypatch.setattr("micro_otter.cli.state._legacy_state_path", lambda: legacy)

    assert load_state().last_port == "/dev/ttyUSB1"


def test_save_state_writes_to_resolved_state_dir(tmp_path: Path, monkeypatch):
    resolved = tmp_path / "state" / "state.json"
    monkeypatch.setattr("micro_otter.cli.state._default_state_path", lambda: resolved)

    save_state(CliState(last_board="esp32"), None)

    assert resolved.is_file()
    assert load_state(resolved).last_board == "esp32"


def test_save_state_keeps_legacy_file(tmp_path: Path, monkeypatch):
    legacy = tmp_path / "config" / "micro-otter" / "state.json"
    legacy.parent.mkdir(parents=True)
    legacy.write_text('{"lastPort": "/dev/ttyUSB1"}', encoding="utf-8")
    resolved = tmp_path / "state" / "state.json"
    monkeypatch.setattr("micro_otter.cli.state._default_state_path", lambda: resolved)
    monkeypatch.setattr("micro_otter.cli.state._legacy_state_path", lambda: legacy)

    save_state(CliState(last_port="/dev/ttyACM0"), None)

    assert resolved.is_file()
    assert legacy.is_file()
    assert load_state().last_port == "/dev/ttyACM0"

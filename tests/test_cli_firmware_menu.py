import json
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from typer.testing import CliRunner

from micro_otter.cli import app
from micro_otter.cli.state import CliState, SerialPort
from micro_otter.config import load_config
from micro_otter.tools.firmware_compile.staleness import FirmwareBuildStatus

runner = CliRunner()


def _config_with(tmp_path, **overrides):
    """Return a resolved configuration with ``enable_*`` overrides applied.

    The workspace comes from the current directory (the repository), so the real
    board catalog is available exactly like in the non-gated menu tests.
    """

    del tmp_path  # kept in the signature so callers read like the other tests
    return load_config(
        overrides=overrides,
        env={"MICRO_OTTER_HOME": str(Path.cwd() / ".test-home")},
    )


def _install_two_variant_addon(addons_root: Path, package_id: str = "pulse") -> None:
    """Write an installed add-on with a default and a ``viper`` variant."""

    (addons_root / package_id).mkdir(parents=True, exist_ok=True)
    (addons_root / package_id / "manifest.json").write_text(
        json.dumps(
            {
                "id": package_id,
                "name": package_id,
                "version": "1.0.0",
                "manifestVersion": 2,
                "variants": {
                    "py": {
                        "precedence": 0,
                        "mpAssets": {"*": [f"moa_{package_id}/__init__.py"]},
                    },
                    "viper": {
                        "precedence": 10,
                        "requiredCapabilities": ["viper"],
                        "mpAssets": {"*": [f"moa_{package_id}_viper/__init__.py"]},
                    },
                },
            }
        ),
        encoding="utf-8",
    )


def test_firmware_menu_forwards_the_addons_root_to_staleness(tmp_path):
    """The status column compares against the add-ons a build would stage."""

    addons_root = tmp_path / "addons"
    captured = {}

    def fake_staleness(**kwargs):
        captured.update(kwargs)
        return {}

    with (
        mock.patch("micro_otter.cli.app.load_config", lambda **_kwargs: _config_with(tmp_path)),
        mock.patch("micro_otter.cli.app.scan_publish_root", lambda: {}),
        mock.patch("micro_otter.cli.app.latest_version_by_board", lambda ws: {}),
        mock.patch("micro_otter.cli.app._resolve_addons_root", lambda: addons_root),
        mock.patch("micro_otter.cli.app.check_firmware_staleness", fake_staleness),
        mock.patch("micro_otter.cli.app.load_state", lambda: CliState()),
        mock.patch("micro_otter.cli.app.save_state"),
        mock.patch(
            "micro_otter.cli.app.execute_compile_runtime_request",
            lambda request: SimpleNamespace(exit_code=0, payload={"status": "success"}),
        ),
    ):
        result = runner.invoke(app, ["firmware"], input="1\n1\n")

    assert result.exit_code == 0
    assert captured["addons_root"] == addons_root
    assert captured["board_ids"]


def test_firmware_menu_survives_an_installed_two_variant_add_on(tmp_path):
    """A multi-variant add-on on disk no longer breaks the status column."""

    addons_root = tmp_path / "addons"
    _install_two_variant_addon(addons_root)

    with (
        mock.patch("micro_otter.cli.app.load_config", lambda **_kwargs: _config_with(tmp_path)),
        mock.patch("micro_otter.cli.app._resolve_addons_root", lambda: addons_root),
        mock.patch("micro_otter.cli.app.scan_publish_root", lambda: {}),
        mock.patch("micro_otter.cli.app.latest_version_by_board", lambda ws: {}),
        mock.patch("micro_otter.cli.app.load_state", lambda: CliState()),
        mock.patch("micro_otter.cli.app.save_state"),
        mock.patch(
            "micro_otter.cli.app.execute_compile_runtime_request",
            lambda request: SimpleNamespace(exit_code=0, payload={"status": "success"}),
        ),
    ):
        result = runner.invoke(app, ["firmware"], input="1\n1\n")

    assert result.exit_code == 0
    assert "Firmware boards" in result.stdout


def test_firmware_menu_hides_deploy_when_disabled(tmp_path):
    config = _config_with(tmp_path, enable_deploy=False)
    captured = {}

    def fake_compile(request):
        captured["request"] = request
        return SimpleNamespace(
            exit_code=0,
            payload={"status": "success", "runtime": {"id": "general"}},
        )

    with (
        mock.patch("micro_otter.cli.app.load_config", lambda **_kwargs: config),
        mock.patch("micro_otter.cli.app.scan_publish_root", lambda: {}),
        mock.patch("micro_otter.cli.app.latest_version_by_board", lambda ws: {}),
        mock.patch("micro_otter.cli.app.execute_compile_runtime_request", fake_compile),
        mock.patch("micro_otter.cli.app.load_state", lambda: CliState()),
        mock.patch("micro_otter.cli.app.save_state"),
    ):
        result = runner.invoke(app, ["firmware"], input="1\n1\n")

    assert result.exit_code == 0
    assert "Build firmware" in result.stdout
    assert "Deploy firmware" not in result.stdout
    assert "Disabled by configuration: deploy (enable_deploy = false)" in result.stdout
    assert captured["request"].board == "esp32"


def test_firmware_menu_exits_when_all_disabled(tmp_path):
    config = _config_with(tmp_path, enable_compile=False, enable_deploy=False)

    with mock.patch("micro_otter.cli.app.load_config", lambda **_kwargs: config):
        result = runner.invoke(app, ["firmware"], input="")

    assert result.exit_code == 0
    assert "compile and deploy are disabled by configuration" in result.stdout


def test_firmware_build_if_stale_requires_both_flags(tmp_path):
    config = _config_with(tmp_path, enable_deploy=False)

    with mock.patch("micro_otter.cli.app.load_config", lambda **_kwargs: config):
        result = runner.invoke(app, ["firmware", "--build-if-stale"], input="")

    assert result.exit_code == 2
    assert "requires both enable_compile and enable_deploy" in result.stderr


def test_firmware_explicit_commands_ignore_flags(tmp_path):
    config = _config_with(tmp_path, enable_compile=False, enable_deploy=False)
    captured = {}

    def fake_execute(request):
        captured["request"] = request
        return SimpleNamespace(exit_code=0, payload={"status": "success"})

    with (
        mock.patch("micro_otter.cli.app.load_config", lambda **_kwargs: config),
        mock.patch("micro_otter.cli.app.execute_compile_runtime_request", fake_execute),
    ):
        result = runner.invoke(
            app, ["compile-runtime", "--runtime-id", "general", "--board", "esp32"]
        )

    assert result.exit_code == 0
    assert captured["request"].board == "esp32"


def test_firmware_build_uses_fixed_defaults():
    captured = {}

    def fake_compile(request):
        captured["request"] = request
        return SimpleNamespace(
            exit_code=0,
            payload={"status": "success", "runtime": {"id": "general"}},
        )

    with (
        mock.patch("micro_otter.cli.app.scan_publish_root", lambda: {}),
        mock.patch("micro_otter.cli.app.latest_version_by_board", lambda ws: {}),
        mock.patch("micro_otter.cli.app.execute_compile_runtime_request", fake_compile),
        mock.patch("micro_otter.cli.app.load_state", lambda: CliState()),
        mock.patch("micro_otter.cli.app.save_state") as save_mock,
    ):
        result = runner.invoke(app, ["firmware"], input="1\n1\n")

    assert result.exit_code == 0
    request = captured["request"]
    assert request.runtime_id == "general"
    assert request.board == "esp32"
    assert request.clean_staging is True
    assert request.clean_build is True
    assert "—" in result.stdout

    saved = save_mock.call_args.args[0]
    assert saved.last_board == "esp32"
    assert saved.last_action == "build"


def test_firmware_deploy_uses_remembered_port_and_defaults(tmp_path):
    state_path = tmp_path / "state.json"
    state_path.write_text(
        '{"lastPort": "/dev/ttyUSB0", "lastWipeFilesystem": false, "lastMonitor": false}',
        encoding="utf-8",
    )

    deploy_calls = {}

    with (
        mock.patch("micro_otter.cli.state._default_state_path", lambda: state_path),
        mock.patch("micro_otter.cli.app.scan_publish_root", lambda: {"esp32": ["0.13.0"]}),
        mock.patch(
            "micro_otter.cli.app.latest_version_by_board",
            lambda ws: {"esp32": "1.27.0-esp32-general-0.13.0"},
        ),
        mock.patch(
            "micro_otter.cli.app.detect_serial_ports",
            lambda: [
                SerialPort(device="/dev/ttyACM0", label="usb-Espressif_USB_JTAG-if00"),
                SerialPort(device="/dev/ttyUSB0", label=None),
            ],
        ),
        mock.patch("micro_otter.cli.app._run_deploy", lambda **kwargs: deploy_calls.update(kwargs)),
    ):
        result = runner.invoke(app, ["firmware"], input="1\n\n\n\n\n")

    assert result.exit_code == 0
    assert deploy_calls["port"] == "/dev/ttyUSB0"
    assert deploy_calls["wipe_filesystem"] is False
    assert deploy_calls["monitor"] is False

    saved = json.loads(state_path.read_text(encoding="utf-8"))
    assert saved["lastPort"] == "/dev/ttyUSB0"
    assert saved["lastWipeFilesystem"] is False
    assert saved["lastMonitor"] is False
    assert saved["lastBoard"] == "esp32"
    assert saved["lastAction"] == "deploy"


def test_firmware_deploy_persists_chosen_options(tmp_path):
    state_path = tmp_path / "state.json"
    state_path.write_text(
        '{"lastPort": "/dev/ttyUSB0", "lastWipeFilesystem": false, "lastMonitor": false}',
        encoding="utf-8",
    )

    deploy_calls = {}

    with (
        mock.patch("micro_otter.cli.state._default_state_path", lambda: state_path),
        mock.patch("micro_otter.cli.app.scan_publish_root", lambda: {"esp32": ["0.13.0"]}),
        mock.patch("micro_otter.cli.app.latest_version_by_board", lambda ws: {}),
        mock.patch("micro_otter.cli.app.detect_serial_ports", lambda: []),
        mock.patch("micro_otter.cli.app._run_deploy", lambda **kwargs: deploy_calls.update(kwargs)),
    ):
        result = runner.invoke(app, ["firmware"], input="1\n\n/dev/ttyACM0\ny\ny\n")

    assert result.exit_code == 0
    assert deploy_calls["port"] == "/dev/ttyACM0"
    assert deploy_calls["wipe_filesystem"] is True
    assert deploy_calls["monitor"] is True

    saved = json.loads(state_path.read_text(encoding="utf-8"))
    assert saved["lastPort"] == "/dev/ttyACM0"
    assert saved["lastWipeFilesystem"] is True
    assert saved["lastMonitor"] is True
    assert saved["lastBoard"] == "esp32"
    assert saved["lastAction"] == "deploy"


def test_firmware_invalid_board_number_rejected():
    with (
        mock.patch("micro_otter.cli.app.scan_publish_root", lambda: {}),
        mock.patch("micro_otter.cli.app.latest_version_by_board", lambda ws: {}),
        mock.patch("micro_otter.cli.app.load_state", lambda: CliState()),
    ):
        result = runner.invoke(app, ["firmware"], input="9\n")

    assert result.exit_code == 2
    assert "Invalid board number" in result.stderr


def test_firmware_remembers_board_choice(tmp_path):
    state_path = tmp_path / "state.json"
    state_path.write_text(
        '{"lastBoard": "ESP32_GENERIC_S3", "lastAction": "build"}',
        encoding="utf-8",
    )

    captured = {}

    def fake_compile(request):
        captured["request"] = request
        return SimpleNamespace(
            exit_code=0,
            payload={"status": "success", "runtime": {"id": "general"}},
        )

    with (
        mock.patch("micro_otter.cli.state._default_state_path", lambda: state_path),
        mock.patch("micro_otter.cli.app.scan_publish_root", lambda: {}),
        mock.patch("micro_otter.cli.app.latest_version_by_board", lambda ws: {}),
        mock.patch("micro_otter.cli.app.execute_compile_runtime_request", fake_compile),
    ):
        result = runner.invoke(app, ["firmware"], input="\n\n")

    assert result.exit_code == 0
    assert captured["request"].board == "ESP32_GENERIC_S3"


def test_firmware_remembers_action_choice(tmp_path):
    state_path = tmp_path / "state.json"
    state_path.write_text('{"lastBoard": "esp32", "lastAction": "build"}', encoding="utf-8")

    captured = {}

    def fake_compile(request):
        captured["request"] = request
        return SimpleNamespace(
            exit_code=0,
            payload={"status": "success", "runtime": {"id": "general"}},
        )

    with (
        mock.patch("micro_otter.cli.state._default_state_path", lambda: state_path),
        mock.patch("micro_otter.cli.app.scan_publish_root", lambda: {"esp32": ["0.13.0"]}),
        mock.patch("micro_otter.cli.app.latest_version_by_board", lambda ws: {}),
        mock.patch("micro_otter.cli.app.execute_compile_runtime_request", fake_compile),
    ):
        result = runner.invoke(app, ["firmware"], input="1\n\n")

    assert result.exit_code == 0
    assert captured["request"].board == "esp32"


def test_firmware_selects_port_by_index(tmp_path):
    state_path = tmp_path / "state.json"
    state_path.write_text("{}", encoding="utf-8")

    deploy_calls = {}

    with (
        mock.patch("micro_otter.cli.state._default_state_path", lambda: state_path),
        mock.patch("micro_otter.cli.app.scan_publish_root", lambda: {"esp32": ["0.13.0"]}),
        mock.patch("micro_otter.cli.app.latest_version_by_board", lambda ws: {}),
        mock.patch(
            "micro_otter.cli.app.detect_serial_ports",
            lambda: [
                SerialPort(device="/dev/ttyACM0", label=None),
                SerialPort(device="/dev/ttyUSB0", label=None),
            ],
        ),
        mock.patch("micro_otter.cli.app._run_deploy", lambda **kwargs: deploy_calls.update(kwargs)),
    ):
        result = runner.invoke(app, ["firmware"], input="1\n2\n2\n\n\n")

    assert result.exit_code == 0
    assert deploy_calls["port"] == "/dev/ttyUSB0"


def test_firmware_invalid_action_number_rejected():
    with (
        mock.patch("micro_otter.cli.app.scan_publish_root", lambda: {}),
        mock.patch("micro_otter.cli.app.latest_version_by_board", lambda ws: {}),
        mock.patch("micro_otter.cli.app.load_state", lambda: CliState()),
    ):
        result = runner.invoke(app, ["firmware"], input="1\n5\n")

    assert result.exit_code == 2
    assert "Invalid action number" in result.stderr


def test_firmware_menu_marks_stale_firmware_in_table():
    stale = {
        "esp32": FirmwareBuildStatus(
            board_id="esp32",
            target_key="esp32-general",
            latest_firmware_version="0.13.0",
            is_stale=True,
            reason="source-changed",
        ),
        "esp32_generic_s3": FirmwareBuildStatus(
            board_id="esp32_generic_s3",
            target_key="esp32_generic_s3-general",
            latest_firmware_version="0.4.2",
            is_stale=False,
            reason="up-to-date",
        ),
    }

    with (
        mock.patch("micro_otter.cli.app.scan_publish_root", lambda: {}),
        mock.patch("micro_otter.cli.app.latest_version_by_board", lambda ws: {}),
        mock.patch("micro_otter.cli.app.check_firmware_staleness", lambda **kwargs: stale),
        mock.patch("micro_otter.cli.app.load_state", lambda: CliState()),
    ):
        result = runner.invoke(app, ["firmware"], input="9\n")

    assert result.exit_code == 2
    assert "needs rebuild" in result.stdout
    assert "up to date" in result.stdout


def test_firmware_menu_renders_new_staleness_reasons() -> None:
    statuses = {
        "esp32": FirmwareBuildStatus(
            board_id="esp32",
            target_key="esp32-general",
            latest_firmware_version="1.0.0",
            is_stale=True,
            reason="content-changed",
        ),
        "esp32_generic_s3": FirmwareBuildStatus(
            board_id="esp32_generic_s3",
            target_key="esp32_generic_s3-general",
            latest_firmware_version=None,
            is_stale=True,
            reason="no-image",
        ),
    }

    with (
        mock.patch("micro_otter.cli.app.scan_publish_root", lambda: {}),
        mock.patch("micro_otter.cli.app.latest_version_by_board", lambda ws: {}),
        mock.patch("micro_otter.cli.app.check_firmware_staleness", lambda **kwargs: statuses),
        mock.patch("micro_otter.cli.app.load_state", lambda: CliState()),
    ):
        result = runner.invoke(app, ["firmware"], input="9\n")

    assert "contents" in result.stdout
    assert "changed" in result.stdout
    assert "no image in" in result.stdout
    assert "channel" in result.stdout


def test_firmware_rebuilds_all_stale_firmware():
    requests = []

    def fake_compile(request):
        requests.append(request)
        return SimpleNamespace(
            exit_code=0,
            payload={"status": "success", "runtime": {"id": "general"}},
        )

    stale = {
        "esp32": FirmwareBuildStatus(
            board_id="esp32",
            target_key="esp32-general",
            latest_firmware_version="0.13.0",
            is_stale=True,
            reason="source-changed",
        ),
        "esp32_generic_s3": FirmwareBuildStatus(
            board_id="esp32_generic_s3",
            target_key="esp32_generic_s3-general",
            latest_firmware_version="0.4.2",
            is_stale=True,
            reason="source-changed",
        ),
    }

    with (
        mock.patch("micro_otter.cli.app.scan_publish_root", lambda: {}),
        mock.patch("micro_otter.cli.app.latest_version_by_board", lambda ws: {}),
        mock.patch("micro_otter.cli.app.check_firmware_staleness", lambda **kwargs: stale),
        mock.patch("micro_otter.cli.app.execute_compile_runtime_request", fake_compile),
        mock.patch("micro_otter.cli.app.load_state", lambda: CliState()),
    ):
        result = runner.invoke(app, ["firmware"], input="1\n3\n")

    assert result.exit_code == 0
    assert [request.board for request in requests] == ["esp32", "ESP32_GENERIC_S3"]
    assert all(request.runtime_id == "general" for request in requests)
    assert all(request.clean_staging and request.clean_build for request in requests)


def test_firmware_rebuild_all_stale_none_to_rebuild():
    with (
        mock.patch("micro_otter.cli.app.scan_publish_root", lambda: {}),
        mock.patch("micro_otter.cli.app.latest_version_by_board", lambda ws: {}),
        mock.patch("micro_otter.cli.app.check_firmware_staleness", lambda **kwargs: {}),
        mock.patch("micro_otter.cli.app.load_state", lambda: CliState()),
    ):
        result = runner.invoke(app, ["firmware"], input="1\n3\n")

    assert result.exit_code == 0
    assert "No stale firmware to rebuild." in result.stdout


def test_fw_alias_invokes_firmware():
    with (
        mock.patch("micro_otter.cli.app.scan_publish_root", lambda: {}),
        mock.patch("micro_otter.cli.app.latest_version_by_board", lambda ws: {}),
        mock.patch(
            "micro_otter.cli.app.execute_compile_runtime_request",
            lambda request: SimpleNamespace(
                exit_code=0,
                payload={"status": "success", "runtime": {"id": "general"}},
            ),
        ),
        mock.patch("micro_otter.cli.app.load_state", lambda: CliState()),
        mock.patch("micro_otter.cli.app.save_state"),
    ):
        result = runner.invoke(app, ["fw"], input="1\n1\n")

    assert result.exit_code == 0


FULL_VERSION = "1.29.0-esp32_generic_s3-general-0.19.0"


def _already_published_payload() -> dict:
    return {
        "status": "failed",
        "errors": [
            {
                "code": "FIRMWARE_ALREADY_PUBLISHED",
                "category": "firmware-already-published",
                "message": (
                    f"micro-otter-{FULL_VERSION}.bin already exists; "
                    "re-run with --force-overwrite to rebuild."
                ),
                "details": {
                    "existingPath": f"/opt/micro_otter/firmware/micro-otter-{FULL_VERSION}.bin",
                    "fullVersion": FULL_VERSION,
                },
            }
        ],
    }


def _stale_statuses() -> dict:
    return {
        "esp32_generic_s3": FirmwareBuildStatus(
            board_id="esp32_generic_s3",
            target_key="esp32_generic_s3-general",
            latest_firmware_version="0.18.0",
            is_stale=True,
            reason="source-changed",
        ),
    }


def test_firmware_build_rebuilds_with_overwrite_when_confirmed():
    requests = []

    def fake_compile(request):
        requests.append(request)
        if len(requests) == 1:
            return SimpleNamespace(exit_code=9, payload=_already_published_payload())
        return SimpleNamespace(
            exit_code=0,
            payload={"status": "success", "runtime": {"id": "general"}},
        )

    with (
        mock.patch("micro_otter.cli.app.scan_publish_root", lambda: {}),
        mock.patch("micro_otter.cli.app.latest_version_by_board", lambda ws: {}),
        mock.patch("micro_otter.cli.app.execute_compile_runtime_request", fake_compile),
        mock.patch("micro_otter.cli.app.load_state", lambda: CliState()),
        mock.patch("micro_otter.cli.app.save_state"),
    ):
        result = runner.invoke(app, ["firmware"], input="1\n1\ny\n")

    assert result.exit_code == 0
    assert [request.force_overwrite for request in requests] == [False, True]
    expected_path = f"/opt/micro_otter/firmware/micro-otter-{FULL_VERSION}.bin"
    assert f"Firmware already published: {expected_path}" in result.stdout
    assert FULL_VERSION in result.stdout


def test_firmware_build_keeps_existing_firmware_when_overwrite_declined():
    requests = []

    def fake_compile(request):
        requests.append(request)
        return SimpleNamespace(exit_code=9, payload=_already_published_payload())

    with (
        mock.patch("micro_otter.cli.app.scan_publish_root", lambda: {}),
        mock.patch("micro_otter.cli.app.latest_version_by_board", lambda ws: {}),
        mock.patch("micro_otter.cli.app.execute_compile_runtime_request", fake_compile),
        mock.patch("micro_otter.cli.app.load_state", lambda: CliState()),
        mock.patch("micro_otter.cli.app.save_state"),
    ):
        result = runner.invoke(app, ["firmware"], input="1\n1\nn\n")

    assert result.exit_code == 9
    assert [request.force_overwrite for request in requests] == [False]
    assert "Existing firmware kept; build skipped." in result.stdout


def test_firmware_rebuild_stale_rebuilds_with_overwrite_when_confirmed():
    requests = []

    def fake_compile(request):
        requests.append(request)
        if len(requests) == 1:
            return SimpleNamespace(exit_code=9, payload=_already_published_payload())
        return SimpleNamespace(
            exit_code=0,
            payload={"status": "success", "runtime": {"id": "general"}},
        )

    with (
        mock.patch("micro_otter.cli.app.scan_publish_root", lambda: {}),
        mock.patch("micro_otter.cli.app.latest_version_by_board", lambda ws: {}),
        mock.patch(
            "micro_otter.cli.app.check_firmware_staleness",
            lambda **kwargs: _stale_statuses(),
        ),
        mock.patch("micro_otter.cli.app.execute_compile_runtime_request", fake_compile),
        mock.patch("micro_otter.cli.app.load_state", lambda: CliState()),
        mock.patch("micro_otter.cli.app.save_state"),
    ):
        result = runner.invoke(app, ["firmware"], input="1\n3\ny\n")

    assert result.exit_code == 0
    assert [request.board for request in requests] == ["ESP32_GENERIC_S3", "ESP32_GENERIC_S3"]
    assert [request.force_overwrite for request in requests] == [False, True]


def test_firmware_build_does_not_offer_overwrite_for_internal_errors():
    requests = []

    def fake_compile(request):
        requests.append(request)
        return SimpleNamespace(
            exit_code=9,
            payload={
                "status": "failed",
                "errors": [
                    {
                        "code": "INTERNAL_ERROR",
                        "category": "unexpected-internal",
                        "message": "boom",
                    }
                ],
            },
        )

    with (
        mock.patch("micro_otter.cli.app.scan_publish_root", lambda: {}),
        mock.patch("micro_otter.cli.app.latest_version_by_board", lambda ws: {}),
        mock.patch("micro_otter.cli.app.execute_compile_runtime_request", fake_compile),
        mock.patch("micro_otter.cli.app.load_state", lambda: CliState()),
        mock.patch("micro_otter.cli.app.save_state"),
    ):
        result = runner.invoke(app, ["firmware"], input="1\n1\n")

    assert result.exit_code == 9
    assert [request.force_overwrite for request in requests] == [False]
    assert "Remove existing firmware" not in result.stdout


def test_firmware_rebuild_stale_reports_existing_failure_when_declined():
    requests = []

    def fake_compile(request):
        requests.append(request)
        return SimpleNamespace(exit_code=9, payload=_already_published_payload())

    with (
        mock.patch("micro_otter.cli.app.scan_publish_root", lambda: {}),
        mock.patch("micro_otter.cli.app.latest_version_by_board", lambda ws: {}),
        mock.patch(
            "micro_otter.cli.app.check_firmware_staleness",
            lambda **kwargs: _stale_statuses(),
        ),
        mock.patch("micro_otter.cli.app.execute_compile_runtime_request", fake_compile),
        mock.patch("micro_otter.cli.app.load_state", lambda: CliState()),
        mock.patch("micro_otter.cli.app.save_state"),
    ):
        result = runner.invoke(app, ["firmware"], input="1\n3\nn\n")

    assert result.exit_code == 9
    assert [request.force_overwrite for request in requests] == [False]
    assert "Existing firmware kept; build skipped." in result.stdout


def _status(
    board_id: str,
    *,
    is_stale: bool,
    reason: str,
    latest_firmware_version: str | None = "0.18.0",
) -> FirmwareBuildStatus:
    return FirmwareBuildStatus(
        board_id=board_id,
        target_key=f"{board_id}-general",
        latest_firmware_version=latest_firmware_version,
        is_stale=is_stale,
        reason=reason,
    )


def _esp32_stale_statuses() -> dict:
    return {"esp32": _status("esp32", is_stale=True, reason="source-changed")}


def _esp32_up_to_date_statuses() -> dict:
    return {"esp32": _status("esp32", is_stale=False, reason="up-to-date")}


def _esp32_unavailable_statuses() -> dict:
    return {"esp32": _status("esp32", is_stale=False, reason="unavailable")}


def test_firmware_build_if_stale_builds_then_deploys():
    events = []
    deploy_calls = {}

    def fake_compile(request):
        events.append("compile")
        return SimpleNamespace(
            exit_code=0,
            payload={"status": "success", "runtime": {"id": "general"}},
        )

    def fake_deploy(**kwargs):
        events.append("deploy")
        deploy_calls.update(kwargs)

    with (
        mock.patch("micro_otter.cli.app.scan_publish_root", lambda: {}),
        mock.patch("micro_otter.cli.app.latest_version_by_board", lambda ws: {}),
        mock.patch(
            "micro_otter.cli.app.check_firmware_staleness",
            lambda **kwargs: _esp32_stale_statuses(),
        ),
        mock.patch("micro_otter.cli.app.execute_compile_runtime_request", fake_compile),
        mock.patch("micro_otter.cli.app.load_state", lambda: CliState()),
        mock.patch("micro_otter.cli.app.save_state") as save_mock,
        mock.patch("micro_otter.cli.app.detect_serial_ports", lambda: []),
        mock.patch("micro_otter.cli.app._run_deploy", fake_deploy),
    ):
        result = runner.invoke(
            app, ["firmware", "--build-if-stale"], input="1\n/dev/ttyUSB0\nn\nn\n"
        )

    assert result.exit_code == 0
    assert events == ["compile", "deploy"]
    assert deploy_calls["port"] == "/dev/ttyUSB0"
    assert deploy_calls["firmware"] is None

    saved = save_mock.call_args.args[0]
    assert saved.last_board == "esp32"
    assert saved.last_action == "build-deploy"


def test_firmware_build_if_stale_skips_build_when_up_to_date():
    events = []
    deploy_calls = {}

    def fake_compile(request):
        events.append("compile")
        return SimpleNamespace(exit_code=0, payload={"status": "success"})

    def fake_deploy(**kwargs):
        events.append("deploy")
        deploy_calls.update(kwargs)

    with (
        mock.patch("micro_otter.cli.app.scan_publish_root", lambda: {}),
        mock.patch("micro_otter.cli.app.latest_version_by_board", lambda ws: {}),
        mock.patch(
            "micro_otter.cli.app.check_firmware_staleness",
            lambda **kwargs: _esp32_up_to_date_statuses(),
        ),
        mock.patch("micro_otter.cli.app.execute_compile_runtime_request", fake_compile),
        mock.patch("micro_otter.cli.app.load_state", lambda: CliState()),
        mock.patch("micro_otter.cli.app.save_state"),
        mock.patch("micro_otter.cli.app.detect_serial_ports", lambda: []),
        mock.patch("micro_otter.cli.app._run_deploy", fake_deploy),
    ):
        result = runner.invoke(
            app, ["firmware", "--build-if-stale"], input="1\n/dev/ttyUSB0\nn\nn\n"
        )

    assert result.exit_code == 0
    assert events == ["deploy"]
    assert "up to date" in result.stdout



def test_firmware_build_if_stale_aborts_deploy_on_build_failure():
    events = []

    def fake_compile(request):
        events.append("compile")
        return SimpleNamespace(
            exit_code=7,
            payload={
                "status": "failed",
                "errors": [{"code": "BUILD_COMMAND_FAILED", "message": "boom"}],
            },
        )

    def fake_deploy(**kwargs):
        events.append("deploy")

    with (
        mock.patch("micro_otter.cli.app.scan_publish_root", lambda: {}),
        mock.patch("micro_otter.cli.app.latest_version_by_board", lambda ws: {}),
        mock.patch(
            "micro_otter.cli.app.check_firmware_staleness",
            lambda **kwargs: _esp32_stale_statuses(),
        ),
        mock.patch("micro_otter.cli.app.execute_compile_runtime_request", fake_compile),
        mock.patch("micro_otter.cli.app.load_state", lambda: CliState()),
        mock.patch("micro_otter.cli.app.save_state"),
        mock.patch("micro_otter.cli.app.detect_serial_ports", lambda: []),
        mock.patch("micro_otter.cli.app._run_deploy", fake_deploy),
    ):
        result = runner.invoke(app, ["firmware", "--build-if-stale"], input="1\n")

    assert result.exit_code == 7
    assert events == ["compile"]


def test_firmware_build_if_stale_overwrite_confirm_rebuilds_then_deploys():
    events = []
    requests = []

    def fake_compile(request):
        events.append("compile")
        requests.append(request)
        if len(requests) == 1:
            return SimpleNamespace(exit_code=9, payload=_already_published_payload())
        return SimpleNamespace(
            exit_code=0,
            payload={"status": "success", "runtime": {"id": "general"}},
        )

    def fake_deploy(**kwargs):
        events.append("deploy")

    with (
        mock.patch("micro_otter.cli.app.scan_publish_root", lambda: {}),
        mock.patch("micro_otter.cli.app.latest_version_by_board", lambda ws: {}),
        mock.patch(
            "micro_otter.cli.app.check_firmware_staleness",
            lambda **kwargs: _esp32_stale_statuses(),
        ),
        mock.patch("micro_otter.cli.app.execute_compile_runtime_request", fake_compile),
        mock.patch("micro_otter.cli.app.load_state", lambda: CliState()),
        mock.patch("micro_otter.cli.app.save_state"),
        mock.patch("micro_otter.cli.app.detect_serial_ports", lambda: []),
        mock.patch("micro_otter.cli.app._run_deploy", fake_deploy),
    ):
        result = runner.invoke(
            app,
            ["firmware", "--build-if-stale"],
            input="1\ny\n/dev/ttyUSB0\nn\nn\n",
        )

    assert result.exit_code == 0
    assert events == ["compile", "compile", "deploy"]
    assert [request.force_overwrite for request in requests] == [False, True]




def test_firmware_build_if_stale_unavailable_warns_and_deploys():
    events = []

    def fake_compile(request):
        events.append("compile")

    def fake_deploy(**kwargs):
        events.append("deploy")

    with (
        mock.patch("micro_otter.cli.app.scan_publish_root", lambda: {}),
        mock.patch("micro_otter.cli.app.latest_version_by_board", lambda ws: {}),
        mock.patch(
            "micro_otter.cli.app.check_firmware_staleness",
            lambda **kwargs: _esp32_unavailable_statuses(),
        ),
        mock.patch("micro_otter.cli.app.execute_compile_runtime_request", fake_compile),
        mock.patch("micro_otter.cli.app.load_state", lambda: CliState()),
        mock.patch("micro_otter.cli.app.save_state"),
        mock.patch("micro_otter.cli.app.detect_serial_ports", lambda: []),
        mock.patch("micro_otter.cli.app._run_deploy", fake_deploy),
    ):
        result = runner.invoke(
            app, ["firmware", "--build-if-stale"], input="1\n/dev/ttyUSB0\nn\nn\n"
        )

    assert result.exit_code == 0
    assert events == ["deploy"]
    assert "Cannot determine firmware staleness" in result.stdout


def test_firmware_menu_action_build_deploy_builds_then_deploys():
    events = []
    deploy_calls = {}

    def fake_compile(request):
        events.append("compile")
        return SimpleNamespace(
            exit_code=0,
            payload={"status": "success", "runtime": {"id": "general"}},
        )

    def fake_deploy(**kwargs):
        events.append("deploy")
        deploy_calls.update(kwargs)

    with (
        mock.patch("micro_otter.cli.app.scan_publish_root", lambda: {}),
        mock.patch("micro_otter.cli.app.latest_version_by_board", lambda ws: {}),
        mock.patch(
            "micro_otter.cli.app.check_firmware_staleness",
            lambda **kwargs: _esp32_stale_statuses(),
        ),
        mock.patch("micro_otter.cli.app.execute_compile_runtime_request", fake_compile),
        mock.patch("micro_otter.cli.app.load_state", lambda: CliState()),
        mock.patch("micro_otter.cli.app.save_state") as save_mock,
        mock.patch("micro_otter.cli.app.detect_serial_ports", lambda: []),
        mock.patch("micro_otter.cli.app._run_deploy", fake_deploy),
    ):
        result = runner.invoke(
            app, ["firmware"], input="1\n4\n/dev/ttyUSB0\nn\nn\n"
        )

    assert result.exit_code == 0
    assert events == ["compile", "deploy"]
    assert deploy_calls["port"] == "/dev/ttyUSB0"

    saved = save_mock.call_args.args[0]
    assert saved.last_action == "build-deploy"

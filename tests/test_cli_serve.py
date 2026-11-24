from unittest import mock

from typer.testing import CliRunner

from micro_otter.cli import app

runner = CliRunner()


def _assert_run_bridge(mock_run_bridge, host, port, disable_protection=False):
    """Assert ``serve`` forwarded the bind address and the resolved configuration."""

    mock_run_bridge.assert_called_once()
    args, kwargs = mock_run_bridge.call_args
    assert args == (host, port)
    assert kwargs["disable_protection"] is disable_protection
    settings = kwargs["config"]
    assert (settings.host, settings.port) == (host, port)


def test_serve_invokes_run_bridge_defaults():
    with mock.patch("micro_otter.tools.serial_bridge.run_bridge") as run_bridge:
        result = runner.invoke(app, ["serve"])

    assert result.exit_code == 0
    _assert_run_bridge(run_bridge, "127.0.0.1", 8000)


def test_serve_accepts_host_and_port():
    with mock.patch("micro_otter.tools.serial_bridge.run_bridge") as run_bridge:
        result = runner.invoke(app, ["serve", "--host", "127.0.0.1", "--port", "9000"])

    assert result.exit_code == 0
    _assert_run_bridge(run_bridge, "127.0.0.1", 9000)


def test_serve_reports_bind_error():
    with mock.patch(
        "micro_otter.tools.serial_bridge.run_bridge", side_effect=OSError("bind failed")
    ):
        result = runner.invoke(app, ["serve", "--port", "9001"])

    assert result.exit_code == 1
    assert "bind failed" in (result.stdout + result.stderr)


def _write_toml(tmp_path, text: str):
    """Write *text* to a ``micro-otter.toml`` under *tmp_path* and return the path."""

    path = tmp_path / "micro-otter.toml"
    path.write_text(text, encoding="utf-8")
    return path


def test_serve_reads_host_and_port_from_toml(tmp_path):
    config = _write_toml(
        tmp_path,
        '[server]\nhost = "192.0.2.10"\nport = 8123\n',
    )

    with mock.patch("micro_otter.tools.serial_bridge.run_bridge") as run_bridge:
        result = runner.invoke(app, ["serve", "--config", str(config)])

    assert result.exit_code == 0
    _assert_run_bridge(run_bridge, "192.0.2.10", 8123)


def test_serve_cli_flag_beats_toml(tmp_path):
    config = _write_toml(tmp_path, '[server]\nhost = "192.0.2.10"\nport = 8123\n')

    with mock.patch("micro_otter.tools.serial_bridge.run_bridge") as run_bridge:
        result = runner.invoke(
            app, ["serve", "--config", str(config), "--port", "8300", "--host", "127.0.0.1"]
        )

    assert result.exit_code == 0
    _assert_run_bridge(run_bridge, "127.0.0.1", 8300)


def test_serve_warns_when_exposed_with_capabilities_enabled(tmp_path):
    with mock.patch("micro_otter.tools.serial_bridge.run_bridge"):
        result = runner.invoke(app, ["serve", "--host", "0.0.0.0"])

    assert result.exit_code == 0
    assert "exposes the compile/deploy endpoints" in result.stderr


def test_serve_does_not_warn_when_capabilities_disabled(tmp_path):
    config = _write_toml(
        tmp_path,
        "[build]\nenable_compile = false\nenable_deploy = false\n",
    )

    with mock.patch("micro_otter.tools.serial_bridge.run_bridge"):
        result = runner.invoke(app, ["serve", "--host", "0.0.0.0", "--config", str(config)])

    assert result.exit_code == 0
    assert "exposes the compile/deploy endpoints" not in result.stderr


def test_serve_open_browser_schedules_launch():
    with (
        mock.patch("micro_otter.tools.serial_bridge.run_bridge"),
        mock.patch("micro_otter.cli.app._open_browser_when_ready") as launch,
    ):
        result = runner.invoke(app, ["serve", "--open-browser", "--port", "8200"])

    assert result.exit_code == 0
    launch.assert_called_once_with("http://127.0.0.1:8200/")


def test_serve_no_open_browser_does_not_launch():
    with (
        mock.patch("micro_otter.tools.serial_bridge.run_bridge"),
        mock.patch("micro_otter.cli.app._open_browser_when_ready") as launch,
    ):
        result = runner.invoke(app, ["serve"])

    assert result.exit_code == 0
    launch.assert_not_called()

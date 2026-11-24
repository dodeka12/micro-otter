from unittest import mock

from typer.testing import CliRunner

from micro_otter.cli import app

runner = CliRunner()


def test_serve_runs_unified_server_on_configured_port():
    calls = {}

    def fake_run_bridge(host, port, disable_protection=False, *, config=None):
        calls["host"] = host
        calls["port"] = port
        calls["disable_protection"] = disable_protection
        calls["config"] = config

    with mock.patch("micro_otter.tools.serial_bridge.run_bridge", fake_run_bridge):
        result = runner.invoke(app, ["serve", "--port", "8123"])

    assert result.exit_code == 0
    assert calls["host"] == "127.0.0.1"
    assert calls["port"] == 8123
    assert calls["disable_protection"] is False
    assert calls["config"] is not None
    assert (calls["config"].host, calls["config"].port) == ("127.0.0.1", 8123)

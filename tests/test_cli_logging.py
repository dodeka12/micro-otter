import logging
from unittest import mock

from typer.testing import CliRunner

from micro_otter.cli import app

runner = CliRunner()


def test_logging_configured_before_command():
    with mock.patch("micro_otter.cli.app.logging.basicConfig") as basic_config, mock.patch(
        "micro_otter.cli.app.load_devices", return_value=[]
    ), mock.patch(
        "micro_otter.cli.app.load_targets", return_value=[]
    ):
        result = runner.invoke(app, ["--log-level", "DEBUG", "--log-format", "simple", "info"])

    assert result.exit_code == 0
    basic_config.assert_called_once_with(level=logging.DEBUG, format="simple")


def test_invalid_log_level_exits_with_error():
    result = runner.invoke(app, ["--log-level", "INVALID", "info"])
    assert result.exit_code == 2
    assert "Invalid log level" in (result.stdout + result.stderr)

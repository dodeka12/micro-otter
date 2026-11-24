from typer.testing import CliRunner

from micro_otter.cli import app

runner = CliRunner()


def test_help_lists_commands():
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    output = result.stdout.lower()
    assert "serve" in output
    assert "info" in output
    assert "compile-runtime" in output

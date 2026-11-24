from pathlib import Path
from unittest import mock

from typer.testing import CliRunner

from micro_otter.cli import app

runner = CliRunner()


def test_info_lists_devices(tmp_path: Path):
    manifest = tmp_path / "devices.json"
    manifest.write_text(
        """
        {
          "defaultDevice": "general",
          "devices": {
            "general": {
              "deviceFile": "general/device.json",
              "name": "General",
              "description": "Default"
            }
          }
        }
        """,
        encoding="utf-8",
    )

    targets = tmp_path / "targets.json"
    targets.write_text(
        """
        {
            "version": 1,
            "targets": [
                {
                  "id": "generic",
                  "file": "generic.json",
                  "displayName": "Generic",
                  "description": "Base"
                }
            ],
            "defaultTargetId": "generic"
        }
        """,
        encoding="utf-8",
    )

    with mock.patch("micro_otter.cli.info.DEVICES_INDEX", manifest), mock.patch(
        "micro_otter.cli.info.TARGETS_INDEX", targets
    ):
        result = runner.invoke(app, ["info"])

    assert result.exit_code == 0
    assert "Available devices" in result.stdout
    assert "general" in result.stdout
    assert "general/device.json" in result.stdout
    assert "Available targets" in result.stdout
    assert "Generic" in result.stdout
    assert "Base" in result.stdout


def test_info_missing_manifest_exits_nonzero(tmp_path: Path):
    missing = tmp_path / "missing.json"
    with mock.patch("micro_otter.cli.info.DEVICES_INDEX", missing):
        result = runner.invoke(app, ["info"])

    assert result.exit_code != 0
    assert "Device manifest not found" in result.stdout

"""Tests for ``micro-otter toolchain status`` / ``toolchain install``."""

from __future__ import annotations

import json
from pathlib import Path
from unittest import mock

import pytest
from tests.helpers.ansi import strip_ansi
from typer.testing import CliRunner

from micro_otter.cli import app
from micro_otter.config import load_config
from micro_otter.tools.toolchain_install import ToolchainInstallError, install_toolchain
from micro_otter.tools.toolchain_status import ComponentStatus, ToolchainReport

runner = CliRunner()


def _report(*, ok: bool = True) -> ToolchainReport:
    """Return a one-component toolchain report with a deterministic summary."""

    status = "ok" if ok else "missing"
    return ToolchainReport(
        components=(
            ComponentStatus(
                component_id="mpy-cross",
                label="mpy-cross",
                status=status,
                path="/opt/micropython/mpy-cross/build/mpy-cross",
                hint=None if ok else "run: micro-otter toolchain install",
            ),
        ),
        config_summary={"toolchain_dir": "/tmp/toolchain", "toolchain_dir_source": "env"},
        ok=ok,
    )


def test_toolchain_status_help_lists_json_flag() -> None:
    result = runner.invoke(app, ["toolchain", "status", "--help"])

    assert result.exit_code == 0
    output = strip_ansi(result.stdout)
    assert "--json" in output
    assert "--json-output" in output
    assert "micro-otter.toml" in output


def test_toolchain_status_json_has_schema_version() -> None:
    with mock.patch(
        "micro_otter.cli.toolchain.collect_toolchain_report", return_value=_report()
    ):
        result = runner.invoke(app, ["toolchain", "status", "--json"])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["schemaVersion"] == 1
    assert payload["ok"] is True
    assert payload["components"][0]["id"] == "mpy-cross"


def test_toolchain_status_json_output_alias() -> None:
    with mock.patch(
        "micro_otter.cli.toolchain.collect_toolchain_report", return_value=_report()
    ):
        alias = runner.invoke(app, ["toolchain", "status", "--json-output"])
        primary = runner.invoke(app, ["toolchain", "status", "--json"])

    assert alias.exit_code == primary.exit_code == 0
    alias_payload = json.loads(alias.stdout)
    primary_payload = json.loads(primary.stdout)
    alias_payload.pop("generatedAt")
    primary_payload.pop("generatedAt")
    assert alias_payload == primary_payload


def test_toolchain_status_exit_code_one_when_missing() -> None:
    with mock.patch(
        "micro_otter.cli.toolchain.collect_toolchain_report", return_value=_report(ok=False)
    ):
        result = runner.invoke(app, ["toolchain", "status"])

    assert result.exit_code == 1
    assert "missing" in result.stdout


def test_toolchain_status_bad_config_exits_two(tmp_path: Path) -> None:
    broken = tmp_path / "micro-otter.toml"
    broken.write_text("[paths\nbroken = = =\n", encoding="utf-8")

    result = runner.invoke(app, ["toolchain", "status", "--config", str(broken)])

    assert result.exit_code == 2
    assert "configuration error" in result.stdout.lower() or result.exception is not None


def test_install_dry_run_reports_command(tmp_path: Path) -> None:
    result = runner.invoke(
        app,
        ["toolchain", "install", "--dry-run", "--dir", str(tmp_path / "tc")],
    )

    assert result.exit_code == 0
    assert "deploy/toolchain/bootstrap.sh" in result.stdout
    assert f"MICRO_OTTER_TOOLCHAIN_DIR={tmp_path / 'tc'}" in result.stdout
    assert "dry run" in result.stdout


def _fake_workspace(tmp_path: Path) -> Path:
    """Create a minimal workspace with a recording ``bootstrap.sh``."""

    workspace = tmp_path / "workspace"
    (workspace / "src" / "micro_otter").mkdir(parents=True)
    (workspace / "pyproject.toml").write_text("", encoding="utf-8")
    script_dir = workspace / "deploy" / "toolchain"
    script_dir.mkdir(parents=True)
    recorder = tmp_path / "recorded.txt"
    (script_dir / "bootstrap.sh").write_text(
        "#!/usr/bin/env bash\n"
        f'printf "%s" "${{MICRO_OTTER_BUILD_BACKEND:-unset}}" > "{recorder}"\n',
        encoding="utf-8",
    )
    return workspace


def test_install_forwards_backend_env(tmp_path: Path) -> None:
    workspace = _fake_workspace(tmp_path)
    config = load_config(
        env={
            "MICRO_OTTER_HOME": str(tmp_path / "home"),
            "MICRO_OTTER_WORKSPACE": str(workspace),
        },
        cwd=tmp_path,
    )

    result = install_toolchain(backend="esp-idf", config=config)

    assert result.returncode == 0
    assert (tmp_path / "recorded.txt").read_text(encoding="utf-8") == "esp-idf"
    assert result.command[0] == "bash"


def test_install_missing_script_raises(tmp_path: Path) -> None:
    config = load_config(
        env={"MICRO_OTTER_HOME": str(tmp_path / "home")}, cwd=tmp_path
    )

    with pytest.raises(ToolchainInstallError):
        install_toolchain(dry_run=True, config=config)

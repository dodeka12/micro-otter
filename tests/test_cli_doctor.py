"""Tests for ``micro-otter doctor``."""

from __future__ import annotations

import json
from unittest import mock

from typer.testing import CliRunner

from micro_otter.cli import app
from micro_otter.tools.doctor import (
    SEVERITY_WARNING,
    DoctorCheck,
    DoctorReport,
)
from micro_otter.tools.toolchain_status import ComponentStatus, ToolchainReport

runner = CliRunner()


def _report(*checks: DoctorCheck) -> DoctorReport:
    """Return a doctor report with *checks* and a healthy toolchain snapshot."""

    toolchain = ToolchainReport(
        components=(ComponentStatus(component_id="python", label="Python", status="ok"),),
        config_summary={"toolchain_dir": "/tmp/toolchain"},
        ok=True,
    )
    return DoctorReport(checks=tuple(checks), toolchain=toolchain)


_HEALTHY = _report(
    DoctorCheck(check_id="python-version", label="Python version", ok=True, detail="3.12.16"),
    DoctorCheck(check_id="workspace", label="Workspace layout", ok=True, detail="/repo"),
)


def test_doctor_table_renders() -> None:
    with mock.patch("micro_otter.cli.doctor.run_doctor", return_value=_HEALTHY):
        result = runner.invoke(app, ["doctor"])

    assert result.exit_code == 0
    assert "Environment checks" in result.stdout
    assert "Python version" in result.stdout
    assert "healthy" in result.stdout


def test_doctor_json_output() -> None:
    with mock.patch("micro_otter.cli.doctor.run_doctor", return_value=_HEALTHY):
        result = runner.invoke(app, ["doctor", "--json"])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["schemaVersion"] == 1
    assert payload["ok"] is True
    assert payload["toolchain"]["schemaVersion"] == 1
    assert payload["checks"][0]["id"] == "python-version"


def test_doctor_strict_promotes_warnings() -> None:
    report = _report(
        DoctorCheck(check_id="python-version", label="Python version", ok=True, detail="3.12.16"),
        DoctorCheck(
            check_id="firmware-dir",
            label="Firmware publish directory",
            ok=False,
            detail="/read-only",
            hint="pick a writable path",
            severity=SEVERITY_WARNING,
        ),
    )

    with mock.patch("micro_otter.cli.doctor.run_doctor", return_value=report):
        lenient = runner.invoke(app, ["doctor"])
        strict = runner.invoke(app, ["doctor", "--strict"])

    assert lenient.exit_code == 0
    assert strict.exit_code == 1
    assert "warning" in lenient.stdout


def test_doctor_exit_code_zero_on_healthy_env() -> None:
    with mock.patch("micro_otter.cli.doctor.run_doctor", return_value=_HEALTHY):
        result = runner.invoke(app, ["doctor", "--json-output"])

    assert result.exit_code == 0
    assert json.loads(result.stdout)["ok"] is True

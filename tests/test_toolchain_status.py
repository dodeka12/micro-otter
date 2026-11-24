"""Tests for the toolchain snapshot and doctor checks (``micro_otter.tools``)."""

from __future__ import annotations

from pathlib import Path

import pytest

from micro_otter import config as config_module
from micro_otter.config import Config, load_config
from micro_otter.tools import doctor as doctor_module
from micro_otter.tools import toolchain_status as status_module
from micro_otter.tools.doctor import (
    SEVERITY_WARNING,
    DoctorCheck,
    DoctorReport,
    exit_code,
    run_doctor,
)
from micro_otter.tools.doctor import (
    report_to_payload as doctor_payload,
)
from micro_otter.tools.toolchain_status import (
    STATUS_MISSING,
    STATUS_OK,
    ComponentStatus,
    ToolchainReport,
    collect_toolchain_report,
    payload_schema_version,
    report_to_payload,
)


@pytest.fixture(autouse=True)
def _no_system_prefix(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep the devcontainer ``/opt`` layout from leaking into these tests."""

    monkeypatch.setattr(config_module, "SYSTEM_PREFIX", Path("/nonexistent/opt"))


def _config(tmp_path: Path, **environment: str) -> Config:
    """Return a resolved configuration rooted in *tmp_path* with extra env values."""

    values = {"MICRO_OTTER_HOME": str(tmp_path / "home")}
    values.update(environment)
    return load_config(env=values, cwd=tmp_path)


def _report(*components: ComponentStatus, ok: bool = True) -> ToolchainReport:
    """Return a toolchain report built from *components*."""

    return ToolchainReport(components=tuple(components), config_summary={}, ok=ok)


def test_payload_has_schema_version_one(tmp_path: Path) -> None:
    report = collect_toolchain_report(_config(tmp_path))

    payload = report_to_payload(report, generated_at="2026-01-01T00:00:00+00:00")

    assert payload_schema_version() == 1
    assert payload["schemaVersion"] == 1
    assert payload["generatedAt"] == "2026-01-01T00:00:00+00:00"
    assert isinstance(payload["ok"], bool)
    assert {"id", "label", "status", "version", "path", "hint"} <= set(payload["components"][0])


def test_missing_mpy_cross_reports_hint(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(status_module.shutil, "which", lambda _name: None)
    config = _config(tmp_path, MICRO_OTTER_MICROPYTHON_ROOT=str(tmp_path / "micropython"))

    component = collect_toolchain_report(config).component("mpy-cross")

    assert component is not None
    assert component.status == STATUS_MISSING
    assert component.hint is not None
    assert "micro-otter toolchain install" in component.hint


def test_backend_status_exception_degrades_to_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def _boom(_backend_id: str) -> object:
        raise RuntimeError("adapter exploded")

    monkeypatch.setattr(status_module, "get_backend", _boom)

    report = collect_toolchain_report(_config(tmp_path))
    component = report.component("build-backend:esp-idf")

    assert component is not None
    assert component.status == STATUS_MISSING
    assert component.hint is not None
    assert "adapter exploded" in component.hint
    assert report.ok is False


def test_config_summary_reports_winning_sources(tmp_path: Path) -> None:
    toolchain_dir = tmp_path / "toolchain"
    config = _config(tmp_path, MICRO_OTTER_TOOLCHAIN_DIR=str(toolchain_dir))

    summary = collect_toolchain_report(config).config_summary

    assert summary["toolchain_dir"] == str(toolchain_dir.resolve())
    assert summary["toolchain_dir_source"] == "env"
    assert summary["micropython_root_source"] == "default"
    assert summary["idf_py"].endswith("idf.py")


def _doctor_report(*checks: DoctorCheck) -> DoctorReport:
    """Return a doctor report with *checks* and an empty toolchain snapshot."""

    return DoctorReport(checks=tuple(checks), toolchain=_report())


def test_doctor_flags_missing_components(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    missing = ComponentStatus(
        component_id="mpy-cross",
        label="mpy-cross",
        status=STATUS_MISSING,
        hint="run: micro-otter toolchain install",
    )
    monkeypatch.setattr(
        doctor_module, "collect_toolchain_report", lambda _config: _report(missing, ok=False)
    )

    report = run_doctor(_config(tmp_path))

    assert report.ok is False
    assert exit_code(report) == 1
    failed_ids = {check.check_id for check in report.failed}
    assert "toolchain:mpy-cross" in failed_ids
    assert any("micro-otter toolchain install" in (check.hint or "") for check in report.failed)


def test_doctor_warning_does_not_fail() -> None:
    warning = DoctorCheck(
        check_id="firmware-dir",
        label="Firmware publish directory",
        ok=False,
        detail="/read-only",
        hint="pick a writable path",
        severity=SEVERITY_WARNING,
    )
    healthy = DoctorCheck(check_id="python-version", label="Python version", ok=True, detail="3.12")

    report = _doctor_report(healthy, warning)

    assert report.warnings == (warning,)
    assert exit_code(report) == 0
    assert exit_code(report, strict=True) == 1


def test_doctor_payload_matches_schema() -> None:
    report = _doctor_report(
        DoctorCheck(check_id="workspace", label="Workspace layout", ok=True, detail="/tmp")
    )

    payload = doctor_payload(report, generated_at="2026-01-01T00:00:00+00:00")

    assert payload["schemaVersion"] == 1
    assert payload["generatedAt"] == "2026-01-01T00:00:00+00:00"
    assert payload["ok"] is True
    assert payload["toolchain"]["schemaVersion"] == 1
    assert payload["checks"][0] == {
        "id": "workspace",
        "label": "Workspace layout",
        "ok": True,
        "severity": "error",
        "detail": "/tmp",
        "hint": None,
    }


def test_collected_report_is_ok_when_components_are_available(tmp_path: Path) -> None:
    component = ComponentStatus(component_id="python", label="Python", status=STATUS_OK)

    report = collect_toolchain_report(_config(tmp_path))

    assert component.status == STATUS_OK
    assert report.component("python") is not None


def test_missing_esp_idf_checkout_is_reported(tmp_path: Path) -> None:
    """The repository launcher exists everywhere, so the checkout is what counts."""

    config = _config(tmp_path, MICRO_OTTER_TOOLCHAIN_DIR=str(tmp_path / "toolchain"))

    component = collect_toolchain_report(config).component("esp-idf")

    assert component is not None
    assert component.status == STATUS_MISSING
    assert component.hint is not None
    assert "micro-otter toolchain install" in component.hint

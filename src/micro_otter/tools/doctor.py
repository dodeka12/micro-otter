"""Host and workspace health checks behind ``micro-otter doctor``.

The report combines the toolchain snapshot from
:mod:`micro_otter.tools.toolchain_status` with checks that snapshot does not cover:
interpreter version, workspace layout, writable publish/state directories, which
configuration file won, and whether the container-wide ``/opt`` layout is in use.
Nothing here starts a build, flashes a device, or repairs anything.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from micro_otter.config import SYSTEM_PREFIX, Config, load_config, state_path
from micro_otter.tools.toolchain_status import (
    PAYLOAD_SCHEMA_VERSION,
    STATUS_MISSING,
    ToolchainReport,
    collect_toolchain_report,
)
from micro_otter.tools.toolchain_status import (
    report_to_payload as toolchain_report_to_payload,
)

SEVERITY_ERROR = "error"
"""A failing check with this severity makes ``doctor`` exit ``1``."""

SEVERITY_WARNING = "warning"
"""A failing check with this severity is informational unless ``--strict``."""


@dataclass(frozen=True)
class DoctorCheck:
    """One health check result."""

    check_id: str
    """Stable identifier used by scripts."""

    label: str
    """Human-readable name shown in the Rich table."""

    ok: bool
    """Whether the check passed."""

    detail: str
    """What was found (path, version, or failure detail)."""

    hint: str | None = None
    """Actionable remedy printed when the check is not ``ok``."""

    severity: str = SEVERITY_ERROR
    """``error`` (fails the run) or ``warning`` (reported, never fails)."""


@dataclass(frozen=True)
class DoctorReport:
    """Complete doctor result: the individual checks plus the toolchain snapshot."""

    checks: tuple[DoctorCheck, ...]
    """Every health check, in display order."""

    toolchain: ToolchainReport
    """Toolchain snapshot the checks were derived from."""

    @property
    def failed(self) -> tuple[DoctorCheck, ...]:
        """Return the error-severity checks that did not pass."""

        return tuple(
            check
            for check in self.checks
            if not check.ok and check.severity == SEVERITY_ERROR
        )

    @property
    def warnings(self) -> tuple[DoctorCheck, ...]:
        """Return the warning-severity checks that did not pass."""

        return tuple(
            check
            for check in self.checks
            if not check.ok and check.severity == SEVERITY_WARNING
        )

    @property
    def ok(self) -> bool:
        """Return ``True`` when no error-severity check failed."""

        return not self.failed


def _nearest_existing_ancestor(path: Path) -> Path | None:
    """Return the closest existing directory at or above *path*, or ``None``."""

    for candidate in (path, *path.parents):
        if candidate.is_dir():
            return candidate
    return None


def _is_writable(directory: Path) -> bool:
    """Return ``True`` when *directory* (or its nearest existing ancestor) is writable."""

    existing = _nearest_existing_ancestor(directory)
    return existing is not None and os.access(existing, os.W_OK)


def _python_check() -> DoctorCheck:
    """Check the interpreter version against the supported minimum."""

    running = ".".join(str(part) for part in sys.version_info[:3])
    ok = tuple(sys.version_info[:2]) >= (3, 12)
    return DoctorCheck(
        check_id="python-version",
        label="Python version",
        ok=ok,
        detail=running,
        hint=None if ok else "install Python 3.12 or newer",
    )


def _workspace_check(config: Config) -> DoctorCheck:
    """Check that the resolved workspace is a Micro-Otter checkout."""

    root = config.workspace_root
    has_project = (root / "pyproject.toml").is_file()
    has_package = (root / "src" / "micro_otter").is_dir()
    ok = has_project and has_package
    return DoctorCheck(
        check_id="workspace",
        label="Workspace layout",
        ok=ok,
        detail=str(root),
        hint=None if ok else "run from a Micro-Otter checkout or set MICRO_OTTER_WORKSPACE",
    )


def _toolchain_checks(report: ToolchainReport) -> list[DoctorCheck]:
    """Turn every missing toolchain component into a failed check."""

    missing = [component for component in report.components if component.status == STATUS_MISSING]
    if not missing:
        return [
            DoctorCheck(
                check_id="toolchain",
                label="Toolchain components",
                ok=True,
                detail=f"{len(report.components)} component(s) available",
            )
        ]
    return [
        DoctorCheck(
            check_id=f"toolchain:{component.component_id}",
            label=component.label,
            ok=False,
            detail=component.path or "not found",
            hint=component.hint or "run: micro-otter toolchain install",
        )
        for component in missing
    ]


def _writable_check(check_id: str, label: str, directory: Path, hint: str) -> DoctorCheck:
    """Check that *directory* can be created or written to."""

    ok = _is_writable(directory)
    return DoctorCheck(
        check_id=check_id,
        label=label,
        ok=ok,
        detail=str(directory),
        hint=None if ok else hint,
    )


def _config_file_check(config: Config) -> DoctorCheck:
    """Report which configuration file won (the resolver already parsed it)."""

    if config.config_path is None:
        return DoctorCheck(
            check_id="config-file",
            label="Configuration file",
            ok=True,
            detail="platform defaults (no micro-otter.toml discovered)",
        )
    return DoctorCheck(
        check_id="config-file",
        label="Configuration file",
        ok=True,
        detail=str(config.config_path),
    )


def _layout_check(config: Config) -> DoctorCheck:
    """Report whether the container-wide ``/opt`` layout supplies the toolchain."""

    inside = [
        str(path)
        for path in (config.toolchain_dir, config.micropython_root)
        if path.is_relative_to(SYSTEM_PREFIX)
    ]
    if inside:
        return DoctorCheck(
            check_id="toolchain-layout",
            label="Toolchain layout",
            ok=True,
            detail=f"container layout detected: {', '.join(inside)}",
        )
    return DoctorCheck(
        check_id="toolchain-layout",
        label="Toolchain layout",
        ok=True,
        detail=f"user layout: {config.toolchain_dir}",
    )


def run_doctor(config: Config | None = None) -> DoctorReport:
    """Run every health check and return the report.

    ``config`` lets callers (and tests) inject a resolved configuration; when
    omitted :func:`micro_otter.config.load_config` is used. Configuration errors
    are raised before this function runs, so the CLI owns that exit path.
    """

    effective = load_config() if config is None else config
    toolchain = collect_toolchain_report(effective)

    checks: list[DoctorCheck] = [
        _python_check(),
        _workspace_check(effective),
        *_toolchain_checks(toolchain),
        _writable_check(
            "firmware-dir",
            "Firmware publish directory",
            effective.firmware_dir,
            "create the directory or point MICRO_OTTER_FIRMWARE_DIR at a writable path",
        ),
        _writable_check(
            "state-dir",
            "State directory",
            state_path(effective).parent,
            "set MICRO_OTTER_STATE_DIR to a writable path",
        ),
        _config_file_check(effective),
        _layout_check(effective),
    ]

    return DoctorReport(checks=tuple(checks), toolchain=toolchain)


def exit_code(report: DoctorReport, *, strict: bool = False) -> int:
    """Return the process exit code: ``0`` healthy, ``1`` when a check failed.

    Failures are error-severity checks; with *strict* a failing warning also
    produces ``1``. Configuration errors never reach this function — the CLI
    exits ``2`` for those.
    """

    if report.failed:
        return 1
    if strict and report.warnings:
        return 1
    return 0


def _check_payload(check: DoctorCheck) -> dict[str, Any]:
    """Render one check as the JSON object used in the doctor payload."""

    return {
        "id": check.check_id,
        "label": check.label,
        "ok": check.ok,
        "severity": check.severity,
        "detail": check.detail,
        "hint": check.hint,
    }


def report_to_payload(
    report: DoctorReport,
    *,
    strict: bool = False,
    generated_at: str | None = None,
) -> dict[str, Any]:
    """Render *report* as the ``doctor --json`` payload (schema version ``1``).

    *strict* is echoed into ``ok`` so a scripted caller sees the same verdict the
    exit code reports; *generated_at* defaults to the current UTC time.
    """

    timestamp = generated_at or datetime.now(UTC).isoformat()
    return {
        "schemaVersion": PAYLOAD_SCHEMA_VERSION,
        "generatedAt": timestamp,
        "ok": exit_code(report, strict=strict) == 0,
        "checks": [_check_payload(check) for check in report.checks],
        "toolchain": toolchain_report_to_payload(report.toolchain, generated_at=timestamp),
    }


__all__ = [
    "SEVERITY_ERROR",
    "SEVERITY_WARNING",
    "DoctorCheck",
    "DoctorReport",
    "exit_code",
    "report_to_payload",
    "run_doctor",
]

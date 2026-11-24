"""Toolchain snapshot used by ``micro-otter toolchain status`` and ``micro-otter doctor``.

The snapshot reads the resolved configuration and asks the existing backend
registries for their reported availability. It never starts a build, never
downloads anything, and never mutates state, so it is safe to run as a
diagnostic. Rendering (Rich tables, JSON envelopes) lives in ``micro_otter.cli``.
"""

from __future__ import annotations

import importlib
import importlib.metadata
import shutil
import sys
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from types import MappingProxyType
from typing import Any

from micro_otter.config import Config, load_config
from micro_otter.tools.firmware_compile.backends import (
    BackendStatus,
    get_backend,
    known_backend_ids,
)
from micro_otter.tools.firmware_compile.flash.registry import (
    get_flash_backend,
    known_flash_backend_ids,
)

PAYLOAD_SCHEMA_VERSION = 1
"""Schema version of the ``toolchain status`` / ``doctor`` JSON payloads."""

MINIMUM_PYTHON = (3, 12)
"""Minimum supported Python version, matching ``requires-python``."""

INSTALL_HINT = "run: micro-otter toolchain install"
"""Remedy printed for every component the toolchain bootstrap can provide."""

STATUS_OK = "ok"
"""Component is installed and usable."""

STATUS_MISSING = "missing"
"""Component is required but absent; it makes the report fail."""

STATUS_WARNING = "warning"
"""Component is present but not fully usable; it never fails the report."""

_ESP_IDF_BACKEND_ID = "esp-idf"
"""Backend id whose status doubles as the ESP-IDF component probe."""

_SUMMARY_SOURCES = (
    "workspace_root",
    "toolchain_dir",
    "micropython_root",
    "firmware_dir",
)
"""Config accessors echoed into ``config_summary`` together with their source."""


@dataclass(frozen=True)
class ComponentStatus:
    """Availability snapshot for one toolchain component."""

    component_id: str
    """Stable identifier used by scripts (``mpy-cross``, ``build-backend:esp-idf``)."""

    label: str
    """Human-readable name shown in the Rich table."""

    status: str
    """One of :data:`STATUS_OK`, :data:`STATUS_MISSING`, :data:`STATUS_WARNING`."""

    version: str | None = None
    """Detected version, when the probe can report one cheaply."""

    path: str | None = None
    """Resolved location of the component, when it has one."""

    hint: str | None = None
    """Actionable remedy printed next to a non-``ok`` component."""


@dataclass(frozen=True)
class ToolchainReport:
    """Complete toolchain snapshot plus the configuration it was resolved from."""

    components: tuple[ComponentStatus, ...]
    """Every probed component, in display order."""

    config_summary: Mapping[str, str] = field(default_factory=dict)
    """Resolved paths plus the winning layer per accessor (``<name>_source``)."""

    ok: bool = True
    """``True`` when no component is :data:`STATUS_MISSING`."""

    def component(self, component_id: str) -> ComponentStatus | None:
        """Return the component with *component_id*, or ``None`` when it is absent."""

        for component in self.components:
            if component.component_id == component_id:
                return component
        return None


def _python_component() -> ComponentStatus:
    """Report the interpreter version against :data:`MINIMUM_PYTHON`."""

    running = ".".join(str(part) for part in sys.version_info[:3])
    if tuple(sys.version_info[:2]) < MINIMUM_PYTHON:
        required = ".".join(str(part) for part in MINIMUM_PYTHON)
        return ComponentStatus(
            component_id="python",
            label="Python",
            status=STATUS_MISSING,
            version=running,
            path=sys.executable,
            hint=f"install Python {required} or newer",
        )
    return ComponentStatus(
        component_id="python",
        label="Python",
        status=STATUS_OK,
        version=running,
        path=sys.executable,
    )


def _node_component() -> ComponentStatus:
    """Report whether ``node`` is on ``PATH`` (the editor asset tooling needs it)."""

    node = shutil.which("node")
    if node is None:
        return ComponentStatus(
            component_id="node",
            label="Node.js",
            status=STATUS_MISSING,
            hint="install Node.js 20+ for the editor asset tooling",
        )
    return ComponentStatus(component_id="node", label="Node.js", status=STATUS_OK, path=node)


def _mpy_cross_candidates(config: Config) -> tuple[Path, ...]:
    """Return the mpy-cross locations the device syntax gate would try."""

    return (
        config.micropython_root / "mpy-cross" / "build" / "mpy-cross",
        config.micropython_root / "mpy-cross" / "mpy-cross",
    )


def _mpy_cross_component(config: Config) -> ComponentStatus:
    """Report the ``mpy-cross`` compiler used by the device syntax gate."""

    for candidate in _mpy_cross_candidates(config):
        if candidate.is_file():
            return ComponentStatus(
                component_id="mpy-cross",
                label="mpy-cross",
                status=STATUS_OK,
                path=str(candidate),
            )

    from_path = shutil.which("mpy-cross")
    if from_path is not None:
        return ComponentStatus(
            component_id="mpy-cross", label="mpy-cross", status=STATUS_OK, path=from_path
        )

    return ComponentStatus(
        component_id="mpy-cross",
        label="mpy-cross",
        status=STATUS_MISSING,
        path=str(_mpy_cross_candidates(config)[0]),
        hint=INSTALL_HINT,
    )


def _esptool_component() -> ComponentStatus:
    """Report the flashing tool: package metadata first, then ``PATH``."""

    try:
        version = importlib.metadata.version("esptool")
    except importlib.metadata.PackageNotFoundError:
        version = None

    on_path = shutil.which("esptool")
    if version is None and on_path is None:
        return ComponentStatus(
            component_id="esptool",
            label="esptool",
            status=STATUS_MISSING,
            hint=INSTALL_HINT,
        )
    return ComponentStatus(
        component_id="esptool",
        label="esptool",
        status=STATUS_OK,
        version=version,
        path=on_path,
    )


def _serial_component() -> ComponentStatus:
    """Report whether ``serial.tools.list_ports`` (pyserial) is importable."""

    try:
        importlib.import_module("serial.tools.list_ports")
    except ImportError as error:  # pragma: no cover - pyserial is a hard dependency
        return ComponentStatus(
            component_id="serial",
            label="pyserial",
            status=STATUS_MISSING,
            hint=f"install pyserial ({error})",
        )
    return ComponentStatus(component_id="serial", label="pyserial", status=STATUS_OK)


def _backend_status(backend_id: str, *, flash: bool) -> BackendStatus:
    """Return one backend's ``status()`` snapshot, degrading to ``missing``.

    A broken adapter must never crash a diagnostic, so any exception becomes an
    unavailable status whose ``detail`` names the failure.
    """

    try:
        backend = get_flash_backend(backend_id) if flash else get_backend(backend_id)
        return backend.status()
    except Exception as error:  # noqa: BLE001 - diagnostics must not propagate
        return BackendStatus(
            backend_id=backend_id,
            available=False,
            detail=f"{type(error).__name__}: {error}",
        )


def _backend_components(
    *, flash: bool
) -> tuple[dict[str, BackendStatus], list[ComponentStatus]]:
    """Probe every registered backend and return both the raw and display views."""

    backend_ids = known_flash_backend_ids() if flash else known_backend_ids()
    statuses: dict[str, BackendStatus] = {}
    components: list[ComponentStatus] = []
    kind = "flash" if flash else "build"
    kind_label = "Flash" if flash else "Build"
    for backend_id in backend_ids:
        status = _backend_status(backend_id, flash=flash)
        statuses[backend_id] = status
        components.append(
            ComponentStatus(
                component_id=f"{kind}-backend:{backend_id}",
                label=f"{kind_label} backend {backend_id}",
                status=STATUS_OK if status.available else STATUS_MISSING,
                version=status.version,
                path=status.detail if status.available else None,
                hint=None if status.available else (status.detail or INSTALL_HINT),
            )
        )
    return statuses, components


def _esp_idf_component(
    config: Config, build_statuses: Mapping[str, BackendStatus]
) -> ComponentStatus:
    """Report the ESP-IDF checkout from the launcher path plus the backend probe.

    The backend probe alone is not enough: it reports the repository launcher as
    available, so a missing checkout (``idf_path`` is not a directory) must still
    be reported as missing - otherwise ``doctor`` would bless a host that cannot
    build.
    """

    launcher = config.idf_py
    checkout = config.idf_path
    status = build_statuses.get(_ESP_IDF_BACKEND_ID)
    version = None if status is None else status.version

    if not launcher.is_file():
        return ComponentStatus(
            component_id="esp-idf",
            label="ESP-IDF",
            status=STATUS_MISSING,
            version=version,
            path=str(launcher),
            hint=INSTALL_HINT,
        )
    if not checkout.is_dir():
        return ComponentStatus(
            component_id="esp-idf",
            label="ESP-IDF",
            status=STATUS_MISSING,
            version=version,
            path=str(checkout),
            hint=INSTALL_HINT,
        )
    if status is not None and not status.available:
        return ComponentStatus(
            component_id="esp-idf",
            label="ESP-IDF",
            status=STATUS_MISSING,
            version=version,
            path=str(checkout),
            hint=f"{status.detail or 'ESP-IDF unavailable'} — {INSTALL_HINT}",
        )
    return ComponentStatus(
        component_id="esp-idf",
        label="ESP-IDF",
        status=STATUS_OK,
        version=version,
        path=str(launcher),
    )


def _config_summary(config: Config) -> Mapping[str, str]:
    """Return resolved paths plus the winning layer recorded for each accessor."""

    summary: dict[str, str] = {
        "workspace_root": str(config.workspace_root),
        "toolchain_dir": str(config.toolchain_dir),
        "micropython_root": str(config.micropython_root),
        "firmware_dir": str(config.firmware_dir),
        "idf_py": str(config.idf_py),
        "config_path": str(config.config_path) if config.config_path else "",
    }
    for accessor in _SUMMARY_SOURCES:
        summary[f"{accessor}_source"] = config.source_of(accessor)
    return MappingProxyType(summary)


def collect_toolchain_report(config: Config | None = None) -> ToolchainReport:
    """Probe every toolchain component and return the snapshot.

    Components are reported in a stable order: interpreter, Node.js, mpy-cross,
    ESP-IDF, esptool, pyserial, then one entry per registered build backend and
    per registered flash backend. ``config`` lets callers (and tests) inject a
    resolved configuration; when omitted
    :func:`micro_otter.config.load_config` is used so a cached CLI configuration
    never leaks into a library call.
    """

    effective = load_config() if config is None else config

    build_statuses, build_components = _backend_components(flash=False)
    _, flash_components = _backend_components(flash=True)

    components: list[ComponentStatus] = [
        _python_component(),
        _node_component(),
        _mpy_cross_component(effective),
        _esp_idf_component(effective, build_statuses),
        _esptool_component(),
        _serial_component(),
        *build_components,
        *flash_components,
    ]

    return ToolchainReport(
        components=tuple(components),
        config_summary=_config_summary(effective),
        ok=all(component.status != STATUS_MISSING for component in components),
    )


def payload_schema_version() -> int:
    """Return the JSON payload schema version (currently ``1``)."""

    return PAYLOAD_SCHEMA_VERSION


def _component_payload(component: ComponentStatus) -> dict[str, Any]:
    """Render one component as the JSON object used by both payloads."""

    return {
        "id": component.component_id,
        "label": component.label,
        "status": component.status,
        "version": component.version,
        "path": component.path,
        "hint": component.hint,
    }


def report_to_payload(
    report: ToolchainReport, *, generated_at: str | None = None
) -> dict[str, Any]:
    """Render *report* as the ``toolchain status`` JSON payload.

    *generated_at* defaults to the current UTC time in ISO-8601; tests pass a
    fixed value so the payload stays deterministic.
    """

    timestamp = generated_at or datetime.now(UTC).isoformat()
    return {
        "schemaVersion": PAYLOAD_SCHEMA_VERSION,
        "generatedAt": timestamp,
        "ok": report.ok,
        "config": dict(report.config_summary),
        "components": [_component_payload(component) for component in report.components],
    }


__all__ = [
    "INSTALL_HINT",
    "MINIMUM_PYTHON",
    "PAYLOAD_SCHEMA_VERSION",
    "STATUS_MISSING",
    "STATUS_OK",
    "STATUS_WARNING",
    "ComponentStatus",
    "ToolchainReport",
    "collect_toolchain_report",
    "payload_schema_version",
    "report_to_payload",
]

"""``micro-otter doctor`` command.

Rendering only: the checks live in :mod:`micro_otter.tools.doctor`, which combines
the toolchain snapshot with workspace, interpreter, and writability checks. The
command resolves configuration through ``micro-otter.toml`` / ``--config`` /
``MICRO_OTTER_*`` and exits ``2`` on a configuration error.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import typer
from rich import box
from rich.console import Console
from rich.table import Table

from micro_otter.cli.toolchain import fail_config
from micro_otter.config import ConfigError, load_config
from micro_otter.tools.doctor import (
    DoctorReport,
    exit_code,
    report_to_payload,
    run_doctor,
)


def _checks_table(payload: dict[str, Any]) -> Table:
    """Build the ``Check | Result | Detail | Hint`` table."""

    table = Table(title="Environment checks", box=box.SIMPLE_HEAD, header_style="bold")
    table.add_column("Check")
    table.add_column("Result")
    table.add_column("Detail", overflow="fold")
    table.add_column("Hint", overflow="fold")

    for check in payload.get("checks", []):
        ok = bool(check.get("ok"))
        severity = str(check.get("severity", "error"))
        if ok:
            result = "[green]ok[/]"
        elif severity == "warning":
            result = "[yellow]warning[/]"
        else:
            result = "[red]failed[/]"
        table.add_row(
            str(check.get("label", check.get("id", "?"))),
            result,
            str(check.get("detail") or ""),
            str(check.get("hint") or ""),
        )
    return table


def render_report(report: DoctorReport, *, strict: bool = False) -> None:
    """Print the human-readable doctor view: checks table plus component snapshot."""

    console = Console()
    payload = report_to_payload(report, strict=strict)
    console.print(_checks_table(payload))
    toolchain_ok = bool(payload.get("toolchain", {}).get("ok"))
    verdict = "healthy" if exit_code(report, strict=strict) == 0 else "problems found"
    style = "green" if verdict == "healthy" else "red"
    console.print(
        f"[{style}]{verdict}[/] "
        f"(toolchain: {'ok' if toolchain_ok else 'incomplete'}, "
        f"failing checks: {len(report.failed)}, warnings: {len(report.warnings)})"
    )


def doctor_command(
    config_path: Path | None = typer.Option(
        None,
        "--config",
        help="micro-otter.toml to read instead of discovering one",
    ),
    json_output: bool = typer.Option(
        False,
        "--json",
        "--json-output",
        help="Emit the machine-readable payload (schema version 1) instead of a table",
    ),
    strict: bool = typer.Option(
        False,
        "--strict",
        help="Treat warnings as failures (exit 1) as well",
    ),
) -> None:
    """Check the host, workspace, toolchain, and configuration.

    Checks the interpreter version, the workspace layout, every toolchain
    component, the writable firmware and state directories, the configuration file
    that won, and whether the container-wide toolchain layout is in use. Paths come
    from ``micro-otter.toml``, ``--config``, or the ``MICRO_OTTER_*`` environment
    variables. Exits ``0`` when healthy, ``1`` when a check fails (``--strict``
    promotes warnings), and ``2`` on a configuration error.
    """

    try:
        config = load_config(config_path=config_path)
    except ConfigError as error:
        fail_config(error)
        return

    report = run_doctor(config)
    if json_output:
        typer.echo(json.dumps(report_to_payload(report, strict=strict), indent=2))
    else:
        render_report(report, strict=strict)
    raise typer.Exit(code=exit_code(report, strict=strict))


__all__ = ["doctor_command", "render_report"]

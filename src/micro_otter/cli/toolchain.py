"""``micro-otter toolchain`` commands: ``status`` and ``install``.

Rendering only: probing lives in :mod:`micro_otter.tools.toolchain_status` and
provisioning in :mod:`micro_otter.tools.toolchain_install`, so both stay reusable
without Typer or Rich. Every command resolves configuration through
``micro-otter.toml`` / ``--config`` / ``MICRO_OTTER_*`` and exits ``2`` on a
configuration error.
"""

from __future__ import annotations

import json
import shlex
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import typer
from rich import box
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from micro_otter.config import ConfigError, load_config
from micro_otter.tools.toolchain_install import (
    InstallResult,
    ToolchainInstallError,
    install_env_overrides,
    install_toolchain,
)
from micro_otter.tools.toolchain_status import (
    STATUS_MISSING,
    ToolchainReport,
    collect_toolchain_report,
    report_to_payload,
)

toolchain_app = typer.Typer(
    add_completion=False,
    help="Inspect and provision the build toolchain",
)

_STATUS_STYLES = {
    "ok": "green",
    STATUS_MISSING: "red",
    "warning": "yellow",
}
"""Rich style per component status."""


def fail_config(error: ConfigError) -> None:
    """Print a configuration error with its hint and exit ``2``."""

    typer.echo(f"configuration error: {error}", err=True)
    if error.hint:
        typer.echo(f"hint: {error.hint}", err=True)
    raise typer.Exit(code=2)


def _status_table(payload: Mapping[str, Any]) -> Table:
    """Build the ``Component | Status | Version | Path`` table."""

    table = Table(title="Toolchain", box=box.SIMPLE_HEAD, header_style="bold")
    table.add_column("Component")
    table.add_column("Status")
    table.add_column("Version")
    table.add_column("Path", overflow="fold")
    table.add_column("Hint", overflow="fold")

    for component in payload.get("components", []):
        status = str(component.get("status", ""))
        table.add_row(
            str(component.get("label", component.get("id", "?"))),
            f"[{_STATUS_STYLES.get(status, 'white')}]{status}[/]",
            str(component.get("version") or "-"),
            str(component.get("path") or "-"),
            str(component.get("hint") or ""),
        )
    return table


def _config_panel(payload: Mapping[str, Any]) -> Panel:
    """Build the resolved-configuration panel, naming the winning layer per path."""

    config = payload.get("config", {})
    lines: list[str] = []
    for key in ("workspace_root", "toolchain_dir", "micropython_root", "firmware_dir", "idf_py"):
        source = config.get(f"{key}_source")
        suffix = f" [dim]({source})[/]" if source else ""
        lines.append(f"{key}: {config.get(key, '-')}{suffix}")
    config_path = config.get("config_path") or "platform defaults (no micro-otter.toml)"
    lines.append(f"config file: {config_path}")
    return Panel("\n".join(lines), title="Resolved configuration", border_style="blue")


def render_status(report: ToolchainReport) -> None:
    """Print the human-readable status view: configuration panel plus component table."""

    console = Console()
    payload = report_to_payload(report)
    console.print(_config_panel(payload))
    console.print(_status_table(payload))
    if not report.ok:
        console.print(
            "[red]One or more components are missing[/] — "
            "run [bold]micro-otter toolchain install[/] and re-run this command."
        )


def _install_payload(
    result: InstallResult, overrides: Mapping[str, str]
) -> dict[str, Any]:
    """Render an install result as the ``--json`` payload (schema version ``1``)."""

    return {
        "schemaVersion": 1,
        "command": list(result.command),
        "env": dict(overrides),
        "dryRun": result.dry_run,
        "returnCode": result.returncode,
        "stdoutTail": result.stdout_tail,
        "stderrTail": result.stderr_tail,
    }


def render_install(result: InstallResult, overrides: Mapping[str, str]) -> None:
    """Print the install command (with its exported overrides) and the child output."""

    prefix = " ".join(f"{key}={shlex.quote(value)}" for key, value in overrides.items())
    command = " ".join(shlex.quote(part) for part in result.command)
    typer.echo(f"{prefix} {command}".strip())
    if result.dry_run:
        typer.echo("(dry run: nothing was executed)")
        return
    if result.stdout_tail:
        typer.echo(result.stdout_tail)
    if result.stderr_tail:
        typer.echo(result.stderr_tail, err=True)
    summary = "toolchain install finished" if result.returncode == 0 else "toolchain install failed"
    typer.echo(summary)


@toolchain_app.command("status")
def toolchain_status(
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
) -> None:
    """Show resolved toolchain paths and component availability.

    Paths come from ``micro-otter.toml``, ``--config``, or the ``MICRO_OTTER_*``
    environment variables (``MICRO_OTTER_TOOLCHAIN_DIR``, ``MICRO_OTTER_FIRMWARE_DIR``,
    ``MICRO_OTTER_MICROPYTHON_ROOT``, ``IDF_PATH``, ...). Exits ``0`` when every
    component is available, ``1`` when one is missing, and ``2`` on a configuration
    error.
    """

    try:
        config = load_config(config_path=config_path)
    except ConfigError as error:
        fail_config(error)
        return

    report = collect_toolchain_report(config)
    if json_output:
        typer.echo(json.dumps(report_to_payload(report), indent=2))
    else:
        render_status(report)
    raise typer.Exit(code=0 if report.ok else 1)


@toolchain_app.command("install")
def toolchain_install_command(
    backend: str | None = typer.Option(
        None,
        "--backend",
        help="Build backend to install (default: MICRO_OTTER_BUILD_BACKEND, then esp-idf)",
    ),
    directory: Path | None = typer.Option(
        None,
        "--dir",
        help="Install into this toolchain directory instead of the resolved toolchain_dir",
    ),
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help="Print the bootstrap command and its environment without running it",
    ),
    force: bool = typer.Option(
        False,
        "--force",
        help="Forward --force to the bootstrap script (re-clone and repair)",
    ),
    json_output: bool = typer.Option(
        False,
        "--json",
        "--json-output",
        help="Emit the machine-readable payload (schema version 1) instead of text",
    ),
    config_path: Path | None = typer.Option(
        None,
        "--config",
        help="micro-otter.toml to read instead of discovering one",
    ),
) -> None:
    """Provision or repair the ESP-IDF/MicroPython toolchain.

    Provisioning is delegated to ``deploy/toolchain/bootstrap.sh``; this command
    only resolves the workspace, the toolchain directory, and the child
    environment (``MICRO_OTTER_TOOLCHAIN_DIR`` / ``IDF_PATH`` / ``IDF_TOOLS_PATH``,
    from ``micro-otter.toml``, ``--config``, or ``MICRO_OTTER_*``). It exits with
    the bootstrap script's return code, or ``2`` on a configuration error.
    """

    try:
        config = load_config(config_path=config_path)
        result = install_toolchain(
            backend=backend,
            toolchain_dir=directory,
            dry_run=dry_run,
            force=force,
            config=config,
        )
    except ConfigError as error:
        fail_config(error)
        return
    except ToolchainInstallError as error:
        typer.echo(str(error), err=True)
        raise typer.Exit(code=1) from error

    overrides = install_env_overrides(backend=backend, toolchain_dir=directory)
    if json_output:
        typer.echo(json.dumps(_install_payload(result, overrides), indent=2))
    else:
        render_install(result, overrides)
    raise typer.Exit(code=0 if result.dry_run else result.returncode)


__all__ = ["toolchain_app"]

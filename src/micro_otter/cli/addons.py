"""``micro-otter addons`` commands: ``list``, ``install``, ``uninstall``, ``validate``.

Rendering and argument handling only: validation, atomic install, and uninstall live in
:mod:`micro_otter.tools.addon_archive`, and the read-only inventory in
:mod:`micro_otter.tools.addon_store`, so both stay reusable without Typer or Rich.

Every command resolves configuration through ``micro-otter.toml`` / ``--config`` /
``MICRO_OTTER_*`` and exits ``2`` on a configuration error, ``1`` on a failed add-on
operation (with its stable error code), and ``0`` on success.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import typer
from rich import box
from rich.console import Console
from rich.table import Table

from micro_otter.cli.toolchain import fail_config
from micro_otter.config import Config, ConfigError, load_config
from micro_otter.tools.addon_archive import (
    MAX_ARCHIVE_BYTES,
    AddonInstallError,
    install_addon,
    uninstall_addon,
    validate_addon_source,
    validate_addon_tree,
)
from micro_otter.tools.addon_store import (
    addon_inventory_payload,
    builtin_package_ids,
)
from micro_otter.tools.archive_source import (
    ArchiveSourceError,
    package_addon_source,
    resolve_archive_source,
)

addons_app = typer.Typer(
    add_completion=False,
    help="Install, list, and remove add-on node packages",
)

DEVICE_SUBDIR = (Path("src") / "micro_otter" / "nodes" / "device")
"""Device root inside a workspace checkout, used to read the built-in package ids."""


def _device_root(config: Config) -> Path:
    """Return the built-in device root for the resolved workspace."""

    return (config.workspace_root / DEVICE_SUBDIR).resolve()


def _load(config_path: Path | None) -> Config:
    """Resolve the configuration, printing a configuration error and exiting ``2``."""

    try:
        return load_config(config_path=config_path)
    except ConfigError as error:
        fail_config(error)
        raise AssertionError("fail_config always raises") from error


def _fail_addon(error: AddonInstallError) -> None:
    """Print an add-on failure with its stable code and hint, then exit ``1``."""

    typer.echo(f"{error.code}: {error}", err=True)
    if error.hint:
        typer.echo(f"hint: {error.hint}", err=True)
    raise typer.Exit(code=1)


def _fail_archive_source(error: ArchiveSourceError) -> None:
    """Print an archive-source failure with its stable code and hint, then exit ``1``."""

    typer.echo(f"{error.code}: {error}", err=True)
    if error.hint:
        typer.echo(f"hint: {error.hint}", err=True)
    raise typer.Exit(code=1)


def _sha256(path: Path) -> str:
    """Return the hex SHA-256 of the archive at *path*."""

    return hashlib.sha256(path.read_bytes()).hexdigest()


def _addons_table(rows: list[dict[str, Any]]) -> Table:
    """Build the ``Id | Version | Name | Variants | Module roots | Path | Provenance`` table."""

    table = Table(title="Add-on node packages", box=box.SIMPLE_HEAD, header_style="bold")
    table.add_column("Id")
    table.add_column("Version")
    table.add_column("Name")
    table.add_column("Variants")
    table.add_column("Module roots")
    table.add_column("Path", overflow="fold")
    table.add_column("Provenance")
    for row in rows:
        table.add_row(
            str(row["id"]),
            str(row["version"] or "-"),
            str(row["name"] or "-"),
            ", ".join(row["variants"]) or "-",
            ", ".join(row["moduleRoots"]) or "-",
            str(row["packageDir"]),
            str(row["provenance"]),
        )
    return table


@addons_app.command("list")
def list_command(
    json_output: bool = typer.Option(
        False,
        "--json-output",
        help="Emit the machine-readable payload instead of a table",
    ),
    config_path: Path | None = typer.Option(
        None,
        "--config",
        help="micro-otter.toml to read instead of discovering one",
    ),
) -> None:
    """List the installed add-on node packages and their provenance.

    Reads ``addons_dir`` from the resolved configuration and reports every package as
    ``addon`` (``builtin`` only for a hand-copied folder that shadows a shipped package,
    which is also reported as a conflict). Nothing is written.
    """

    config = _load(config_path)
    addons_root = config.addons_dir
    device_root = _device_root(config)
    payload = addon_inventory_payload(device_root, addons_root)
    rows: list[dict[str, Any]] = payload["addons"]
    warnings: list[str] = payload["warnings"]

    if json_output:
        typer.echo(json.dumps(payload, indent=2))
        raise typer.Exit(code=0)

    if not rows:
        typer.echo(f"No add-ons installed in {addons_root}")
    else:
        Console().print(_addons_table(rows))
    for warning in warnings:
        typer.echo(f"warning: {warning}", err=True)
    raise typer.Exit(code=0)


@addons_app.command("install")
def install_command(
    source: Path | None = typer.Argument(
        None, help="Add-on archive (.zip) or package directory to install"
    ),
    force: bool = typer.Option(
        False,
        "--force",
        help="Replace an already installed add-on with the same id",
    ),
    package_as: str | None = typer.Option(
        None,
        "--as",
        help="Package id to use when the archive stores manifest.json at its root",
    ),
    url: str | None = typer.Option(
        None, "--url", help="https:// URL of the add-on archive"
    ),
    json_output: bool = typer.Option(
        False,
        "--json-output",
        help="Emit the machine-readable payload instead of text",
    ),
    config_path: Path | None = typer.Option(
        None,
        "--config",
        help="micro-otter.toml to read instead of discovering one",
    ),
) -> None:
    """Install one add-on package into ``<addons_dir>/<id>``.

    The archive is validated (layout, ids, paths, sizes) and published with a single
    rename, so a failed install leaves no package behind. An archive that reuses a
    built-in package id is rejected. A directory installs a copy directly; an
    archive or a ``--url`` is resolved by the server-side archive source (the CLI
    fetches the URL itself under the same policy the server applies). Exits ``1``
    with the stable error code on failure.
    """

    config = _load(config_path)
    if (source is None) == (url is None):
        typer.echo("Pass either a source path or --url, not both.", err=True)
        raise typer.Exit(code=2)

    builtin_ids = builtin_package_ids(_device_root(config))
    if source is not None and source.is_dir():
        try:
            result = install_addon(
                source,
                addons_root=config.addons_dir,
                builtin_ids=builtin_ids,
                force=force,
                package_id=package_as,
            )
        except AddonInstallError as error:
            _fail_addon(error)
            return
    else:
        try:
            with resolve_archive_source(
                path=str(source) if source is not None else None,
                url=url,
                max_bytes=MAX_ARCHIVE_BYTES,
                label="addon",
            ) as archive:
                result = install_addon(
                    archive,
                    addons_root=config.addons_dir,
                    builtin_ids=builtin_ids,
                    force=force,
                    package_id=package_as,
                )
        except AddonInstallError as error:
            _fail_addon(error)
            return
        except ArchiveSourceError as error:
            _fail_archive_source(error)
            return

    payload = {
        "id": result.id,
        "version": result.version,
        "packageDir": str(result.package_dir),
        "replaced": result.replaced,
        "archiveSha256": result.archive_sha256,
    }
    if json_output:
        typer.echo(json.dumps(payload, indent=2))
    else:
        verb = "Replaced" if result.replaced else "Installed"
        typer.echo(f"{verb} {result.id} {result.version or ''} -> {result.package_dir}".strip())
    raise typer.Exit(code=0)


@addons_app.command("uninstall")
def uninstall_command(
    package_id: str = typer.Argument(..., help="Id of the add-on package to remove"),
    json_output: bool = typer.Option(
        False,
        "--json-output",
        help="Emit the machine-readable payload instead of text",
    ),
    config_path: Path | None = typer.Option(
        None,
        "--config",
        help="micro-otter.toml to read instead of discovering one",
    ),
) -> None:
    """Remove an installed add-on package.

    Removing an add-on changes local inventory only: firmware images, device
    filesystems, and the collection deploy decision are untouched. An unknown id exits
    ``1`` with the installed ids in the hint.
    """

    config = _load(config_path)
    try:
        result = uninstall_addon(package_id, addons_root=config.addons_dir)
    except AddonInstallError as error:
        _fail_addon(error)
        return

    payload = {"id": result.id, "version": result.version, "removed": True}
    if json_output:
        typer.echo(json.dumps(payload, indent=2))
    else:
        typer.echo(f"Removed {result.id} from {config.addons_dir}")
    raise typer.Exit(code=0)


@addons_app.command("validate")
def validate_command(
    source: Path = typer.Argument(
        ...,
        help="Add-on archive (.zip) or package directory to check",
    ),
    package_as: str | None = typer.Option(
        None,
        "--as",
        help="Package id to expect when the archive stores manifest.json at its root",
    ),
    json_output: bool = typer.Option(
        False,
        "--json-output",
        help="Emit the machine-readable payload instead of text",
    ),
    config_path: Path | None = typer.Option(
        None,
        "--config",
        help="micro-otter.toml to read instead of discovering one",
    ),
) -> None:
    """Validate an add-on archive or package folder without installing it.

    Nothing is copied into the addons folder and no package directory is created, so
    this is the command a package author runs against a release artifact.
    """

    config = _load(config_path)
    try:
        manifest = validate_addon_source(
            source,
            builtin_ids=builtin_package_ids(_device_root(config)),
            package_id=package_as,
        )
    except AddonInstallError as error:
        _fail_addon(error)
        return

    payload = {
        "id": manifest.id,
        "version": manifest.version,
        "name": manifest.name,
        "assets": list(manifest.assets),
        "variants": [variant.id for variant in manifest.variants],
        "moduleRoots": list(manifest.module_roots),
        "valid": True,
    }
    if json_output:
        typer.echo(json.dumps(payload, indent=2))
    else:
        variant_note = (
            f" ({len(manifest.variants)} variant(s))" if manifest.variants else ""
        )
        typer.echo(
            f"{manifest.id} {manifest.version} is a valid add-on package"
            f"{variant_note} ({len(manifest.assets)} declared asset(s))"
        )
    raise typer.Exit(code=0)


@addons_app.command("package")
def package_command(
    source: Path = typer.Argument(..., help="Add-on package directory to package"),
    output: Path | None = typer.Option(None, "--output", "-o", help="Output .zip path"),
    force: bool = typer.Option(False, "--force", help="Overwrite an existing archive"),
    config_path: Path | None = typer.Option(
        None, "--config", help="micro-otter.toml to read instead of discovering one"
    ),
) -> None:
    """Package a validated add-on directory into a reproducible .zip archive.

    Packaging is deterministic (fixed timestamps, sorted members, fixed mode), and
    the archive is exactly what ``addons install`` and ``addon.install`` expect.
    """

    config = _load(config_path)
    try:
        validate_addon_tree(source, builtin_ids=builtin_package_ids(_device_root(config)))
    except AddonInstallError as error:
        _fail_addon(error)
        return
    try:
        archive = package_addon_source(source, output, force=force)
    except FileExistsError:
        typer.echo("archive already exists; pass --force", err=True)
        raise typer.Exit(code=1) from None
    except ArchiveSourceError as error:
        _fail_archive_source(error)
        return
    typer.echo(f"Wrote {archive} ({archive.stat().st_size} bytes)")
    typer.echo(f"sha256: {_sha256(archive)}")


__all__ = ["addons_app"]

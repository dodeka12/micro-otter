"""Typer-based CLI for Micro-Otter.

This module defines the top-level ``micro-otter`` Typer application. It exposes
``serve``, ``info``, ``compile-runtime``/``cr``, ``deploy-runtime``/``dr``,
``firmware``/``fw``, ``compile-mpy``/``cmpy``, the ``toolchain`` group
(``status``/``install``), the ``webapp`` group (``build``/``upload``), and ``doctor``;
every command resolves configuration through :mod:`micro_otter.config`.
"""

from __future__ import annotations

import json
import logging
import subprocess
import threading
import webbrowser
from pathlib import Path
from typing import Any

import click
import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from micro_otter.cli.addons import _fail_archive_source, addons_app
from micro_otter.cli.doctor import doctor_command
from micro_otter.cli.info import (
    load_devices,
    load_targets,
    render_devices_table,
    render_targets_table,
)
from micro_otter.cli.state import (
    CliState,
    SerialPort,
    detect_serial_ports,
    load_state,
    save_state,
)
from micro_otter.cli.toolchain import fail_config, toolchain_app
from micro_otter.cli.webapp import webapp_app
from micro_otter.config import (
    SYSTEM_PREFIX,
    Config,
    ConfigError,
    clear_config_cache,
    get_config,
    load_config,
    resolve_micropython_root,
)
from micro_otter.toolchain import ToolchainAssetsNotFound
from micro_otter.tools.archive_source import ArchiveSourceError, resolve_archive_source
from micro_otter.tools.firmware_compile import (
    CompileRuntimeRequest,
    DeviceMpyPrecompileRequest,
    MpyManifestPrecompileRequest,
    execute_compile_runtime_request,
    render_result_json,
    run_device_mpy_precompile,
    run_manifest_mpy_precompile,
)
from micro_otter.tools.firmware_compile.board_registry import (
    BOARD_CATALOG_DEFAULT_PATH,
    BoardSpec,
    find_board,
    load_board_catalog,
)
from micro_otter.tools.firmware_compile.firmware_deploy import (
    FirmwareDeployError,
    FirmwareDeployRequest,
    build_deploy_payload,
    flash_firmware,
)
from micro_otter.tools.firmware_compile.firmware_inventory import (
    build_firmware_inventory_payload,
    latest_firmware_ids,
    latest_firmware_ids_by_channel,
    list_firmware_inventory,
)
from micro_otter.tools.firmware_compile.firmware_package import (
    MAX_PACKAGE_BYTES,
    FirmwarePackageError,
    export_firmware_package,
    export_firmware_package_to_directory,
    import_firmware_package,
    package_firmware_image,
)
from micro_otter.tools.firmware_compile.local_firmware import (
    latest_version_by_board,
    resolve_publish_root,
    scan_publish_root,
)
from micro_otter.tools.firmware_compile.local_package_scan import (
    LocalPackageScan,
    LocalPackageScanError,
    LocalPackageSyncResult,
    build_package_scan_payload,
    scan_local_packages,
    update_runtime_local_packages,
)
from micro_otter.tools.firmware_compile.staleness import (
    FirmwareBuildStatus,
    check_firmware_staleness,
)
from micro_otter.tools.host_policy import is_loopback_host

DEFAULT_LOG_LEVEL = "INFO"
DEFAULT_LOG_FORMAT = "%(levelname)s %(name)s %(message)s"

app = typer.Typer(add_completion=False, help="Micro-Otter command line interface")


def _resolve_workspace_root(start: Path | None = None) -> Path:
    """Resolve the repository workspace root through the configuration resolver.

    ``MICRO_OTTER_WORKSPACE`` and ``micro-otter.toml`` win; otherwise the nearest
    ancestor of *start* (or the current directory) holding ``pyproject.toml`` and
    ``src/micro_otter`` is used, matching the previous directory walk.
    """

    return load_config(cwd=start or Path.cwd()).workspace_root


def _resolve_default_micropython_root(workspace_root: Path) -> Path:
    """Resolve the default MicroPython clone through the configuration resolver.

    The system-wide MicroPython fallback (``SYSTEM_PREFIX / "micropython"``) is
    passed as the documented discovery fallback, so a toolchain installed under
    ``MICRO_OTTER_TOOLCHAIN_DIR`` or an explicit ``MICRO_OTTER_MICROPYTHON_ROOT`` is
    preferred over it.
    """

    return resolve_micropython_root(workspace_root, fallback=SYSTEM_PREFIX / "micropython")


def _payload_text(payload: dict[str, Any], *keys: str, default: str = "n/a") -> str:
    value: Any = payload
    for key in keys:
        if not isinstance(value, dict):
            return default
        value = value.get(key)

    if value is None:
        return default
    text = str(value).strip()
    return text if text else default


def _render_compile_runtime_result(result: Any) -> None:
    payload = result.payload if isinstance(result.payload, dict) else {}
    status = str(payload.get("status", "failed")).lower()
    success = status == "success"

    status_text = "Compile runtime succeeded" if success else "Compile runtime failed"
    status_style = "bold green" if success else "bold red"

    out_console = Console()
    err_console = Console(stderr=True)

    out_console.print(
        Panel.fit(
            f"[{status_style}]{status_text}[/{status_style}]",
            title="Micro-Otter Compile Runtime",
            border_style="green" if success else "red",
        )
    )

    summary = Table(title="Summary", show_header=True, header_style="bold cyan")
    summary.add_column("Field", style="cyan", no_wrap=True)
    summary.add_column("Value", style="white")
    summary.add_row("Runtime", _payload_text(payload, "runtime", "id"))
    summary.add_row("Runtime Version", _payload_text(payload, "runtime", "version"))
    summary.add_row("Board", _payload_text(payload, "target", "board"))
    summary.add_row(
        "Firmware Version", _payload_text(payload, "metadata", "runtimeFirmwareVersion")
    )
    summary.add_row("Full Version", _payload_text(payload, "metadata", "fullVersion"))
    summary.add_row("Packaging Mode", _payload_text(payload, "metadata", "modulePackagingMode"))
    summary.add_row("Publish Status", _payload_text(payload, "metadata", "firmwarePublishStatus"))
    summary.add_row("Exit Code", str(result.exit_code))
    summary.add_row("Build Exit Code", _payload_text(payload, "build", "exitCode"))
    summary.add_row("Duration (ms)", _payload_text(payload, "build", "durationMs"))
    summary.add_row("Build Command", _payload_text(payload, "build", "command"))
    out_console.print(summary)

    paths = Table(title="Paths", show_header=True, header_style="bold cyan")
    paths.add_column("Path", style="cyan", no_wrap=True)
    paths.add_column("Value", style="white")
    paths.add_row("MicroPython Root", _payload_text(payload, "paths", "micropythonRoot"))
    paths.add_row("Modules Path", _payload_text(payload, "paths", "modulesPath"))
    paths.add_row("Firmware Artifact", _payload_text(payload, "paths", "firmwareArtifact"))
    paths.add_row(
        "Published Firmware",
        _payload_text(payload, "paths", "firmwarePublishedArtifact"),
    )
    paths.add_row(
        "Embedded Inventory",
        _payload_text(payload, "staging", "embeddedInventoryPath"),
    )
    out_console.print(paths)

    warnings = payload.get("warnings", [])
    if isinstance(warnings, list) and warnings:
        warning_table = Table(title="Warnings", show_header=True, header_style="bold yellow")
        warning_table.add_column("Message", style="yellow")
        for warning in warnings:
            warning_table.add_row(str(warning))
        out_console.print(warning_table)

    errors = payload.get("errors", [])
    if isinstance(errors, list) and errors:
        error_table = Table(title="Errors", show_header=True, header_style="bold red")
        error_table.add_column("Category", style="red", no_wrap=True)
        error_table.add_column("Code", style="magenta", no_wrap=True)
        error_table.add_column("Message", style="white")
        for error in errors:
            if isinstance(error, dict):
                error_table.add_row(
                    str(error.get("category", "unknown")),
                    str(error.get("code", "unknown")),
                    str(error.get("message", "unknown error")),
                )
            else:
                error_table.add_row("unknown", "unknown", str(error))
        err_console.print(error_table)


def _already_published_details(result: Any) -> tuple[str, str] | None:
    """Return ``(existing_path, full_version)`` when *result* reports an already-published build."""

    if getattr(result, "exit_code", None) != 9:
        return None

    payload = getattr(result, "payload", None)
    errors = payload.get("errors") if isinstance(payload, dict) else None
    first_error = errors[0] if isinstance(errors, list) and errors else None
    if not isinstance(first_error, dict) or first_error.get("code") != "FIRMWARE_ALREADY_PUBLISHED":
        return None

    details = first_error.get("details")
    details = details if isinstance(details, dict) else {}

    existing_path = details.get("existingPath") or "unknown path"
    full_version = details.get("fullVersion") or "unknown version"
    return str(existing_path), str(full_version)


def _load_compile_mpy_spec(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)

    if not isinstance(payload, dict):
        raise ValueError("Spec file must contain a JSON object")

    def _pick_text(*keys: str) -> str | None:
        for key in keys:
            value = payload.get(key)
            if value is None:
                continue
            if not isinstance(value, str):
                raise ValueError(f"Spec key '{key}' must be a string")
            text = value.strip()
            return text or None
        return None

    def _pick_int(*keys: str) -> int | None:
        for key in keys:
            value = payload.get(key)
            if value is None:
                continue
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValueError(f"Spec key '{key}' must be an integer")
            return value
        return None

    return {
        "emit": _pick_text("emit"),
        "small_int_bits": _pick_int("small_int_bits", "smallIntBits"),
        "march": _pick_text("march"),
        "march_flags": _pick_text("march_flags", "marchFlags"),
    }


def _parse_log_level(value: str) -> int:
    numeric = getattr(logging, value.upper(), None)
    if isinstance(numeric, int):
        return numeric
    raise ValueError(f"Invalid log level: {value}")


def _configure_logging(level: str, fmt: str) -> None:
    numeric_level = _parse_log_level(level)
    logging.basicConfig(level=numeric_level, format=fmt)


@app.callback(invoke_without_command=True)
def _root(
    ctx: typer.Context,
    log_level: str = typer.Option(
        DEFAULT_LOG_LEVEL,
        "--log-level",
        help="Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)",
    ),
    log_format: str = typer.Option(
        DEFAULT_LOG_FORMAT,
        "--log-format",
        help="Logging format string",
    ),
) -> None:
    """Common options applied before subcommands run."""

    try:
        _configure_logging(log_level, log_format)
    except ValueError as exc:
        typer.echo(str(exc))
        raise typer.Exit(code=2) from exc

    if ctx.invoked_subcommand is None:
        typer.echo(ctx.get_help())
        raise typer.Exit()


def _display_host(host: str) -> str:
    """Return *host* as it should appear in a URL (``::1`` becomes ``[::1]``)."""

    candidate = host.strip()
    if not candidate:
        return "127.0.0.1"
    return f"[{candidate}]" if ":" in candidate and not candidate.startswith("[") else candidate


def _open_browser_when_ready(url: str, delay: float = 1.0) -> None:
    """Open *url* in the default browser shortly after the server starts.

    The launch runs on a daemon timer so ``serve`` never blocks on it, and a
    headless host only logs a warning. Tests patch this function, so nothing is
    launched during a test run.
    """

    def _open() -> None:
        try:
            webbrowser.open(url)
        except Exception as error:  # noqa: BLE001 - a browser is never required
            typer.echo(f"warning: could not open a browser for {url}: {error}", err=True)

    timer = threading.Timer(delay, _open)
    timer.daemon = True
    timer.start()


@app.command()
def serve(
    host: str | None = typer.Option(
        None,
        "--host",
        help="Host/IP to bind (default: 127.0.0.1)",
    ),
    port: int | None = typer.Option(
        None,
        "--port",
        help="Port to serve the node editor (default: 8000)",
        min=1,
        max=65535,
    ),
    open_browser: bool | None = typer.Option(
        None,
        "--open-browser/--no-open-browser",
        help="Open the editor in the default browser once the server is listening",
    ),
    no_protection: bool = typer.Option(
        False,
        "--no-protection",
        help="Disable direct access protection (allows direct navigation to all paths)",
    ),
    config: Path | None = typer.Option(
        None,
        "--config",
        help="Path to micro-otter.toml",
    ),
) -> None:
    """Serve the Micro-Otter app and its WebSocket serial bridge on a single port.

    The bind address, port, and browser behaviour come from ``micro-otter.toml``,
    the ``MICRO_OTTER_HOST`` / ``MICRO_OTTER_PORT`` / ``MICRO_OTTER_OPEN_BROWSER``
    environment variables, or the platform defaults (``127.0.0.1:8000``), in that
    order of precedence; ``--host`` / ``--port`` / ``--open-browser`` override all
    of them.
    """
    # Imported lazily to avoid a circular import via micro_otter.cli.state.
    from micro_otter.tools.serial_bridge import run_bridge

    try:
        settings = load_config(
            config_path=config,
            overrides={"host": host, "port": port, "open_browser": open_browser},
        )
    except ConfigError as error:
        fail_config(error)
        return

    if not is_loopback_host(settings.host) and (
        settings.enable_compile or settings.enable_deploy
    ):
        typer.echo(
            f"warning: serving on {settings.host}:{settings.port} exposes the compile/deploy "
            "endpoints to the network; pass --host 127.0.0.1 or set "
            "enable_compile/enable_deploy = false",
            err=True,
        )

    if settings.open_browser:
        _open_browser_when_ready(f"http://{_display_host(settings.host)}:{settings.port}/")

    try:
        run_bridge(
            settings.host,
            settings.port,
            disable_protection=no_protection,
            config=settings,
        )
    except OSError as exc:
        typer.echo(f"Failed to start server on {settings.host}:{settings.port}: {exc}")
        raise typer.Exit(code=1) from exc
    except Exception as exc:  # pragma: no cover - unexpected
        typer.echo(f"Server error: {exc}")
        raise typer.Exit(code=1) from exc


@app.command()
def info() -> None:
    """Show available device profiles and package manifest path."""

    try:
        devices = load_devices()
        targets = load_targets()
    except FileNotFoundError as exc:
        typer.echo(str(exc))
        raise typer.Exit(code=1) from exc
    except Exception as exc:  # pragma: no cover - safety net
        typer.echo(f"Failed to read device manifest: {exc}")
        raise typer.Exit(code=1) from exc

    typer.echo(render_devices_table(devices))
    typer.echo()
    typer.echo(render_targets_table(targets))


def _resolve_addons_root() -> Path:
    """Resolve the add-ons folder through the configuration resolver.

    The compile commands always use the configured folder (``addons_dir``); the
    library-level ``addons_root=None`` default exists for callers and tests that want
    built-in-only resolution.
    """

    return load_config().addons_dir


def _parse_package_ids_option(value: str | None) -> tuple[str, ...] | None:
    """Split the ``--package-ids`` CSV option into a selection tuple.

    An omitted or blank option becomes ``None`` (freeze every compatible package)
    rather than a tuple of empty strings.
    """

    if value is None:
        return None
    parts = tuple(part.strip() for part in value.split(","))
    return parts if any(parts) else None


def _parse_package_variants_option(value: str | None) -> dict[str, str] | None:
    """Split the ``--package-variants`` CSV option into a ``{package_id: variant_id}`` map.

    An omitted or blank option becomes ``None``. Each comma-separated pair is
    ``package_id=variant_id``; the last occurrence of a package id wins.
    """

    if value is None:
        return None
    result: dict[str, str] = {}
    for part in value.split(","):
        item = part.strip()
        if not item:
            continue
        if "=" not in item:
            raise typer.BadParameter(
                f"{item!r} is not a package=variant pair", param_hint="--package-variants"
            )
        package_id, variant_id = (segment.strip() for segment in item.split("=", 1))
        if not package_id or not variant_id:
            raise typer.BadParameter(
                f"{item!r} is not a package=variant pair", param_hint="--package-variants"
            )
        result[package_id] = variant_id
    return result or None


@app.command("compile-runtime")
def compile_runtime(
    runtime_id: str = typer.Option(..., "--runtime-id", help="Runtime identifier from manifest."),
    board: str = typer.Option(..., "--board", help="MicroPython board/target identifier."),
    micropython_root: Path | None = typer.Option(
        None,
        "--micropython-root",
        help="Override MicroPython clone root.",
    ),
    modules_path: Path | None = typer.Option(
        None,
        "--modules-path",
        help="Override modules destination path.",
    ),
    device_root: Path | None = typer.Option(
        None,
        "--device-root",
        help="Override device source root.",
    ),
    build_dir: Path | None = typer.Option(
        None,
        "--build-dir",
        help="Optional explicit build output working directory.",
    ),
    clean_staging: bool = typer.Option(
        False,
        "--clean-staging",
        help="Clean managed staged module subtree before copy.",
    ),
    clean_build: bool = typer.Option(
        False,
        "--clean-build",
        help="Clean build artifacts before compile.",
    ),
    module_packaging_mode: str | None = typer.Option(
        None,
        "--module-packaging-mode",
        help="Module packaging mode: source-py (default) or compiled-mpy.",
    ),
    package_ids: str | None = typer.Option(
        None,
        "--package-ids",
        help=(
            "Comma-separated node-package ids to freeze into the image; "
            "omit for all compatible packages."
        ),
    ),
    package_variants: str | None = typer.Option(
        None,
        "--package-variants",
        help="Comma-separated package=variant pairs, e.g. \"pulse=viper,audio=viper\".",
    ),
    json_output: bool = typer.Option(
        False,
        "--json-output",
        help="Emit final result payload as compact JSON to stdout.",
    ),
    embedded_inventory_output: Path | None = typer.Option(
        None,
        "--embedded-inventory-output",
        help="Override output path for generated embedded inventory metadata.",
    ),
    verbose: bool = typer.Option(False, "--verbose", help="Enable detailed step logs."),
    request_id: str | None = typer.Option(
        None,
        "--request-id",
        help="Optional correlation ID pass-through.",
    ),
    timeout_seconds: int | None = typer.Option(
        None,
        "--timeout-seconds",
        help="Optional timeout bound for orchestrated execution.",
    ),
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help="Resolve and validate without file copy/compile.",
    ),
    force_overwrite: bool = typer.Option(
        False,
        "--force-overwrite",
        help="Delete any existing published firmware and rebuild from scratch.",
    ),
) -> None:
    """Compile runtime firmware assets using package-owned orchestration."""

    workspace_root = _resolve_workspace_root()
    addons_root = _resolve_addons_root()

    request = CompileRuntimeRequest(
        runtime_id=runtime_id,
        board=board,
        workspace_root=workspace_root,
        micropython_root=micropython_root,
        modules_path=modules_path,
        device_root=device_root,
        addons_root=addons_root,
        build_dir=build_dir,
        clean_staging=clean_staging,
        clean_build=clean_build,
        module_packaging_mode=module_packaging_mode,
        package_ids=_parse_package_ids_option(package_ids),
        package_variants=_parse_package_variants_option(package_variants),
        json_output=json_output,
        embedded_inventory_output=embedded_inventory_output,
        verbose=verbose,
        request_id=request_id,
        timeout_seconds=timeout_seconds,
        dry_run=dry_run,
        force_overwrite=force_overwrite,
    )

    result = execute_compile_runtime_request(request)

    already_published = None if json_output else _already_published_details(result)
    if already_published is not None:
        existing_path, full_version = already_published
        typer.echo(f"Firmware already published: {existing_path} (version {full_version})")
        rebuild = typer.confirm("Remove existing firmware and rebuild?", default=False)
        if rebuild:
            request = CompileRuntimeRequest(
                runtime_id=runtime_id,
                board=board,
                workspace_root=workspace_root,
                micropython_root=micropython_root,
                modules_path=modules_path,
                device_root=device_root,
                addons_root=addons_root,
                build_dir=build_dir,
                clean_staging=clean_staging,
                clean_build=clean_build,
                module_packaging_mode=module_packaging_mode,
                package_ids=_parse_package_ids_option(package_ids),
        package_variants=_parse_package_variants_option(package_variants),
                json_output=json_output,
                embedded_inventory_output=embedded_inventory_output,
                verbose=verbose,
                request_id=request_id,
                timeout_seconds=timeout_seconds,
                dry_run=dry_run,
                force_overwrite=True,
            )
            result = execute_compile_runtime_request(request)
        else:
            typer.echo(
                "Build cancelled. Re-run with --force-overwrite to rebuild without prompting."
            )
            raise typer.Exit(code=result.exit_code)

    if json_output:
        typer.echo(render_result_json(result))
    else:
        _render_compile_runtime_result(result)

    raise typer.Exit(code=result.exit_code)


# Alias: short form for compile-runtime.
app.command("cr")(compile_runtime)


def _render_json_payload(payload: dict[str, Any]) -> str:
    """Return the compact JSON rendering of a command payload.

    The separators match :func:`micro_otter.tools.firmware_compile.render_result_json`,
    so every command emits machine-readable output the same way.
    """

    return json.dumps(payload, separators=(",", ":"), ensure_ascii=True)


def _deploy_image_via_helper(
    *,
    board_spec: BoardSpec,
    port: str,
    firmware: Path,
    flash_backend: str | None,
    timeout_seconds: int | None,
    wipe_filesystem: bool,
    json_output: bool,
) -> None:
    """Flash one firmware image through the shared deploy helper.

    The helper path serves every invocation that wants the machine-readable
    payload or needs to influence backend selection or the tool timeout, so the
    server and the CLI share one deployment implementation. The plain
    ``mo dr --firmware`` invocation without those options keeps its historical
    inline ``esptool`` call, which is why its output and exit codes are
    unchanged.

    Exits with the report's exit code, or with the error's exit code when the
    helper raised a structured failure.
    """

    request = FirmwareDeployRequest(
        board_spec=board_spec,
        port=port,
        firmware_path=firmware,
        backend_id=flash_backend,
        wipe_filesystem=wipe_filesystem,
        timeout_seconds=float(timeout_seconds) if timeout_seconds is not None else None,
    )

    try:
        report = flash_firmware(request)
    except FirmwareDeployError as error:
        if json_output:
            typer.echo(_render_json_payload(build_deploy_payload(error, request=request)))
        else:
            typer.echo(f"{error.code}: {error.message}", err=True)
            if error.hint:
                typer.echo(f"hint: {error.hint}", err=True)
        raise typer.Exit(code=error.exit_code) from error

    if json_output:
        typer.echo(_render_json_payload(build_deploy_payload(report, request=request)))
    elif report.message:
        typer.echo(report.message)

    raise typer.Exit(code=report.exit_code)


def _run_deploy(
    *,
    board_spec: BoardSpec,
    port: str,
    firmware: Path | None,
    micropython_root: Path | None,
    build_dir: Path | None,
    monitor: bool,
    wipe_filesystem: bool,
    flash_backend: str | None = None,
    timeout_seconds: int | None = None,
    json_output: bool = False,
) -> None:
    """Flash compiled firmware to a connected device for a resolved board."""
    if firmware is not None:
        firmware_path = firmware.resolve()
        if monitor:
            typer.echo("--monitor is not supported with --firmware.", err=True)
            raise typer.Exit(code=2)
        _deploy_image_via_helper(
            board_spec=board_spec,
            port=port,
            firmware=firmware_path,
            flash_backend=flash_backend,
            timeout_seconds=timeout_seconds,
            wipe_filesystem=wipe_filesystem,
            json_output=json_output,
        )
        return

    workspace_root = _resolve_workspace_root()
    selected_micropython_root = (
        micropython_root.resolve()
        if micropython_root is not None
        else _resolve_default_micropython_root(workspace_root)
    )
    ports_root = selected_micropython_root / "ports" / "esp32"
    selected_build_dir = (
        build_dir.resolve()
        if build_dir is not None
        else (ports_root / board_spec.build_params.get("buildDirName", "")).resolve()
    )

    if not ports_root.is_dir():
        typer.echo(f"ESP32 port directory not found: {ports_root}", err=True)
        raise typer.Exit(code=3)

    config = get_config()
    try:
        idf_py = config.idf_py
    except ToolchainAssetsNotFound as exc:
        typer.echo(f"ESP-IDF launcher not found: {exc}", err=True)
        typer.echo(f"hint: {exc.hint}", err=True)
        raise typer.Exit(code=1) from exc
    if not idf_py.is_file():
        typer.echo(f"ESP-IDF launcher not found: {idf_py}", err=True)
        typer.echo(
            "hint: run 'micro-otter toolchain install' or set MICRO_OTTER_TOOLCHAIN_DIR",
            err=True,
        )
        raise typer.Exit(code=1)
    launcher = str(idf_py)
    toolchain_env = config.toolchain_env()

    flash_args = selected_build_dir / "flash_args"
    if not flash_args.is_file():
        typer.echo(
            f"Build output not found: {flash_args}. Run compile-runtime before deploy-runtime.",
            err=True,
        )
        raise typer.Exit(code=3)

    flash_command = [launcher, "-B", str(selected_build_dir), "-p", port, "flash"]
    try:
        if wipe_filesystem:
            erase_command = [launcher, "-B", str(selected_build_dir), "-p", port, "erase-flash"]
            subprocess.run(erase_command, cwd=ports_root, check=True, env=toolchain_env)
        subprocess.run(flash_command, cwd=ports_root, check=True, env=toolchain_env)
        if monitor:
            typer.echo("Starting serial monitor. Exit with Ctrl+] (German layout: Strg+AltGr+9).")
            monitor_command = [launcher, "-B", str(selected_build_dir), "-p", port, "monitor"]
            subprocess.run(monitor_command, cwd=ports_root, check=True, env=toolchain_env)
    except FileNotFoundError as exc:
        typer.echo(f"Required tool not found: {exc}", err=True)
        raise typer.Exit(code=1) from exc
    except subprocess.CalledProcessError as exc:
        exit_code = exc.returncode if exc.returncode > 0 else 1
        raise typer.Exit(code=exit_code) from exc

    typer.echo(f"Flashed firmware to {port} using build directory: {selected_build_dir}")


@app.command("deploy-runtime")
def deploy_runtime(
    port: str = typer.Option(
        ...,
        "--port",
        help="Serial port for flashing, for example /dev/ttyUSB0.",
    ),
    board: str = typer.Option(
        "esp32",
        "--board",
        help="Board target to deploy (esp32, ESP32_GENERIC_S2 or ESP32_GENERIC_S3).",
    ),
    firmware: Path | None = typer.Option(
        None,
        "--firmware",
        help=(
            "Path to a prebuilt firmware .bin to flash directly via esptool, "
            "bypassing the build directory."
        ),
    ),
    micropython_root: Path | None = typer.Option(
        None,
        "--micropython-root",
        help="Override MicroPython clone root.",
    ),
    build_dir: Path | None = typer.Option(
        None,
        "--build-dir",
        help="Override build output directory.",
    ),
    monitor: bool = typer.Option(
        False,
        "--monitor",
        help="Open serial monitor after flashing.",
    ),
    wipe_filesystem: bool = typer.Option(
        False,
        "--wipe-filesystem",
        help="Erase flash before deploy to wipe all files from the device filesystem.",
    ),
    flash_backend: str | None = typer.Option(
        None,
        "--flash-backend",
        help="Flash backend id; omit for auto selection.",
    ),
    timeout_seconds: int | None = typer.Option(
        None,
        "--timeout-seconds",
        help="Optional timeout in seconds for the flash tool invocation.",
    ),
    json_output: bool = typer.Option(
        False,
        "--json-output",
        help="Emit final result payload as compact JSON to stdout.",
    ),
) -> None:
    """Flash compiled firmware to a connected device."""

    # The resolver caches per process; refresh it so environment and TOML edits
    # made since the last command in this process take effect.
    clear_config_cache()

    workspace_root = _resolve_workspace_root()
    catalog = load_board_catalog((workspace_root / BOARD_CATALOG_DEFAULT_PATH).resolve())

    board_spec = find_board(board, catalog)
    if board_spec is None:
        typer.echo(
            "deploy-runtime supports only --board esp32, ESP32_GENERIC_S2 or ESP32_GENERIC_S3.",
            err=True,
        )
        raise typer.Exit(code=2)

    _run_deploy(
        board_spec=board_spec,
        port=port,
        firmware=firmware,
        micropython_root=micropython_root,
        build_dir=build_dir,
        monitor=monitor,
        wipe_filesystem=wipe_filesystem,
        flash_backend=flash_backend,
        timeout_seconds=timeout_seconds,
        json_output=json_output,
    )


# Alias: short form for deploy-runtime.
app.command("dr")(deploy_runtime)


def _render_package_scan_table(scan: LocalPackageScan) -> Table:
    """Return the human table for one package inventory scan.

    Every cell carries text: unknown names, versions, and manifests render as an
    em dash so a reader never sees a raw ``None``.
    """

    table = Table(title=f"Node packages ({scan.runtime_id})", header_style="bold cyan")
    table.add_column("#", style="bold yellow", no_wrap=True)
    table.add_column("Package", style="bold green")
    table.add_column("Version")
    table.add_column("Source")
    table.add_column("Staged")
    table.add_column("Notes")

    for index, record in enumerate(scan.packages, start=1):
        label = (
            f"{record.id} ({record.name})"
            if record.name and record.name != record.id
            else record.id
        )
        notes: list[str] = []
        if record.gated_out:
            reasons = ", ".join(record.missing_capabilities) or "required capabilities"
            notes.append(f"gated out: {reasons}")
        table.add_row(
            str(index),
            label,
            record.version or "—",
            record.source,
            Text("yes", style="green") if record.staged else Text("no", style="dim"),
            "; ".join(notes) or "—",
        )
    return table


def _render_package_sync_result(result: LocalPackageSyncResult) -> str:
    """Return one human summary line for a ``nodePackages.local`` reconciliation."""

    state = "updated" if result.written else "already in sync"
    skipped = f", {len(result.skipped)} skipped" if result.skipped else ""
    return f"nodePackages.local: {state} ({len(result.current)} package(s){skipped})"


@app.command("node-packages")
def node_packages(
    runtime_id: str = typer.Option(
        "general",
        "--runtime-id",
        help="Runtime identifier from manifest.",
    ),
    sync_local: bool = typer.Option(
        False,
        "--sync-local",
        help=(
            "Rewrite nodePackages.local in the runtime manifest to match the folders on disk."
        ),
    ),
    json_output: bool = typer.Option(
        False,
        "--json-output",
        help="Emit final result payload as compact JSON to stdout.",
    ),
) -> None:
    """List node packages discoverable locally and whether this runtime stages them.

    The listing is advisory: ``staged: false`` means "not in this firmware image",
    never "skip the source upload". ``--sync-local`` only reorders the runtime
    manifest's ``nodePackages.local`` array; it never touches
    ``nodePackages.global``, ``filesystem``, or any package folder.
    """

    clear_config_cache()

    workspace_root = _resolve_workspace_root()
    device_root = (workspace_root / "src" / "micro_otter" / "nodes" / "device").resolve()

    try:
        sync_result = (
            update_runtime_local_packages(
                device_root=device_root,
                runtime_id=runtime_id,
                apply=True,
            )
            if sync_local
            else None
        )
        scan = scan_local_packages(
            device_root=device_root,
            runtime_id=runtime_id,
            addons_root=_resolve_addons_root(),
        )
    except LocalPackageScanError as error:
        typer.echo(f"{error.code}: {error.message}", err=True)
        if error.hint:
            typer.echo(f"hint: {error.hint}", err=True)
        raise typer.Exit(code=error.exit_code) from error

    payload = build_package_scan_payload(scan)
    if sync_result is not None:
        payload["sync"] = {
            "written": sync_result.written,
            "previous": list(sync_result.previous),
            "current": list(sync_result.current),
            "skipped": list(sync_result.skipped),
        }

    if json_output:
        typer.echo(_render_json_payload(payload))
        raise typer.Exit(code=0)

    if sync_result is not None:
        typer.echo(_render_package_sync_result(sync_result))
    Console().print(_render_package_scan_table(scan))
    for warning in scan.warnings:
        typer.echo(f"warning: {warning}", err=True)


# Alias: short form for node-packages.
app.command("np")(node_packages)


def _firmware_status_text(status: FirmwareBuildStatus | None) -> Text:
    """Return a styled renderable for a firmware staleness status."""
    if status is None:
        return Text("—", style="dim")
    if status.reason == "up-to-date":
        return Text("up to date", style="green")
    if status.reason == "source-changed":
        return Text("needs rebuild", style="bold red")
    if status.reason == "content-changed":
        return Text("contents changed", style="bold red")
    if status.reason == "never-built":
        return Text("never built", style="yellow")
    if status.reason == "no-image":
        return Text("no image in channel", style="yellow")
    if status.reason == "artifact-missing":
        return Text("missing firmware", style="bold red")
    return Text("unknown", style="dim")


def _render_board_menu(
    catalog: list[BoardSpec],
    available: dict[str, list[str]],
    latest: dict[str, str],
    statuses: dict[str, FirmwareBuildStatus] | None = None,
) -> None:
    """Render the board selection table."""
    table = Table(title="Firmware boards", show_header=True, header_style="bold cyan")
    table.add_column("#", style="bold yellow", no_wrap=True)
    table.add_column("Board", style="bold green")
    table.add_column("Compile board", style="cyan")
    table.add_column("Local firmware", style="white")
    table.add_column("Latest", style="magenta")
    table.add_column("Status")

    for index, spec in enumerate(catalog, start=1):
        inventory_key = spec.slug
        versions = available.get(inventory_key, [])
        local_text = ", ".join(versions) if versions else "—"
        latest_text = latest.get(inventory_key, "—")
        status = (statuses or {}).get(inventory_key)
        table.add_row(
            str(index),
            spec.display_name,
            spec.name,
            local_text,
            latest_text,
            _firmware_status_text(status),
        )

    Console().print(table)


def _build_firmware(
    workspace_root: Path, compile_board: str, *, force_overwrite: bool = False
) -> Any:
    """Build firmware for a single compile board using the firmware menu defaults."""
    request = CompileRuntimeRequest(
        runtime_id="general",
        board=compile_board,
        workspace_root=workspace_root,
        clean_staging=True,
        clean_build=True,
        force_overwrite=force_overwrite,
    )
    return execute_compile_runtime_request(request)


def _build_firmware_with_overwrite_prompt(workspace_root: Path, compile_board: str) -> Any:
    """Build firmware, offering to replace an already-published version when blocked."""

    result = _build_firmware(workspace_root, compile_board)

    already_published = _already_published_details(result)
    if already_published is None:
        return result

    existing_path, full_version = already_published
    typer.echo(f"Firmware already published: {existing_path} (version {full_version})")
    if not typer.confirm("Remove existing firmware and rebuild?", default=False):
        typer.echo("Existing firmware kept; build skipped.")
        return result
    return _build_firmware(workspace_root, compile_board, force_overwrite=True)


def _build_firmware_if_stale(
    workspace_root: Path, board_spec: BoardSpec, status: FirmwareBuildStatus | None
) -> int | None:
    """Build firmware when *status* says it is stale; return an exit code to stop before deploy."""

    if status is None or status.reason == "unavailable":
        typer.echo(
            f"Cannot determine firmware staleness for {board_spec.display_name}; "
            "deploying the existing build."
        )
        return None

    if not status.is_stale:
        typer.echo(f"Firmware for {board_spec.display_name} is up to date; skipping build.")
        return None

    typer.echo(
        f"Firmware for {board_spec.display_name} needs a rebuild ({status.reason}); building..."
    )
    result = _build_firmware_with_overwrite_prompt(workspace_root, board_spec.name)
    _render_compile_runtime_result(result)
    return result.exit_code or None


def _deploy_firmware(*, board_spec: BoardSpec, state: CliState, last_action: str) -> None:
    """Prompt for port/wipe/monitor, persist state, and flash the build-directory firmware."""

    port = _prompt_port(detect_serial_ports(), state.last_port)

    wipe_filesystem = typer.confirm(
        "Wipe filesystem before flash?",
        default=state.last_wipe_filesystem,
    )
    monitor = typer.confirm(
        "Open serial monitor after flash?",
        default=state.last_monitor,
    )

    save_state(
        CliState(
            last_board=board_spec.name,
            last_action=last_action,
            last_port=port,
            last_wipe_filesystem=wipe_filesystem,
            last_monitor=monitor,
        )
    )

    _run_deploy(
        board_spec=board_spec,
        port=port,
        firmware=None,
        micropython_root=None,
        build_dir=None,
        monitor=monitor,
        wipe_filesystem=wipe_filesystem,
    )


firmware_app = typer.Typer(
    add_completion=False,
    help="Build, deploy, and manage firmware packages",
)


@firmware_app.callback(invoke_without_command=True)
def firmware(
    build_if_stale: bool = typer.Option(
        False,
        "--build-if-stale",
        help=(
            "Build the firmware first when the current source is newer than the "
            "latest build, then deploy it."
        ),
    ),
) -> None:
    """Interactively build or deploy firmware for a board.

    ``enable_compile`` / ``enable_deploy`` shape this menu only: they hide
    interactive actions, never the explicit ``compile-runtime`` /
    ``deploy-runtime`` commands, and never the collection-deploy source-upload path.
    """
    if click.get_current_context().invoked_subcommand is not None:
        return
    settings = load_config()
    if build_if_stale and not (settings.enable_compile and settings.enable_deploy):
        typer.echo(
            "--build-if-stale requires both enable_compile and enable_deploy to be enabled",
            err=True,
        )
        raise typer.Exit(code=2)

    allowed_actions = _allowed_actions(settings)
    if not allowed_actions:
        typer.echo(
            "compile and deploy are disabled by configuration (enable_compile / enable_deploy)"
        )
        raise typer.Exit(code=0)

    workspace_root = _resolve_workspace_root()

    catalog = load_board_catalog((workspace_root / BOARD_CATALOG_DEFAULT_PATH).resolve())
    available = scan_publish_root()
    latest = latest_version_by_board(workspace_root)
    state = load_state()

    statuses = check_firmware_staleness(
        workspace_root=workspace_root,
        micropython_root=_resolve_default_micropython_root(workspace_root),
        board_ids=[spec.slug for spec in catalog],
        addons_root=_resolve_addons_root(),
    )

    _render_board_menu(catalog, available, latest, statuses)
    _render_disabled_notice(settings)

    board_index = typer.prompt(
        "Select board",
        type=int,
        default=_default_board_index(catalog, state.last_board),
    )
    if board_index < 1 or board_index > len(catalog):
        typer.echo(f"Invalid board number: {board_index}. Expected 1..{len(catalog)}.", err=True)
        raise typer.Exit(code=2)

    board_spec = catalog[board_index - 1]
    inventory_key = board_spec.slug
    has_local_firmware = bool(available.get(inventory_key))

    action = (
        "build-deploy"
        if build_if_stale
        else _prompt_action(
            default=state.last_action,
            has_local_firmware=has_local_firmware,
            allowed=allowed_actions,
        )
    )

    if action == "rebuild-stale":
        stale_statuses = [status for status in statuses.values() if status.is_stale]
        if not stale_statuses:
            typer.echo("No stale firmware to rebuild.")
            raise typer.Exit(code=0)

        failed_codes: list[int] = []
        for status in stale_statuses:
            spec = next(spec for spec in catalog if spec.slug == status.board_id)
            typer.echo(f"Rebuilding firmware for {spec.display_name} ({spec.name})...")
            result = _build_firmware_with_overwrite_prompt(workspace_root, spec.name)
            _render_compile_runtime_result(result)
            if result.exit_code != 0:
                failed_codes.append(result.exit_code)
        raise typer.Exit(code=failed_codes[0] if failed_codes else 0)

    if action == "build":
        save_state(
            CliState(
                last_board=board_spec.name,
                last_action="build",
                last_port=state.last_port,
                last_wipe_filesystem=state.last_wipe_filesystem,
                last_monitor=state.last_monitor,
            )
        )
        result = _build_firmware_with_overwrite_prompt(workspace_root, board_spec.name)
        _render_compile_runtime_result(result)
        raise typer.Exit(code=result.exit_code)

    if action == "build-deploy":
        exit_code = _build_firmware_if_stale(
            workspace_root, board_spec, statuses.get(inventory_key)
        )
        if exit_code is not None:
            raise typer.Exit(code=exit_code)
        _deploy_firmware(board_spec=board_spec, state=state, last_action="build-deploy")
        return

    _deploy_firmware(board_spec=board_spec, state=state, last_action="deploy")


def _fail_firmware_package(error: FirmwarePackageError) -> None:
    """Print a firmware-package failure with its stable code and hint, then exit."""

    typer.echo(f"{error.code}: {error.message}", err=True)
    if error.hint:
        typer.echo(f"hint: {error.hint}", err=True)
    raise typer.Exit(code=error.exit_code)


@firmware_app.command("package")
def firmware_package_command(
    image: Path = typer.Argument(..., help="Published .bin image to package"),
    output: Path | None = typer.Option(
        None, "--output", "-o", help="Output .firmware.zip path (default: next to the image)"
    ),
) -> None:
    """Package a published firmware image into a self-contained .firmware.zip."""

    try:
        path = package_firmware_image(image, destination=output)
    except FirmwarePackageError as error:
        _fail_firmware_package(error)
    typer.echo(f"Wrote {path}")


@firmware_app.command("export")
def firmware_export_command(
    version: str = typer.Argument(..., help="Runtime firmware version to export"),
    board: str | None = typer.Option(None, "--board", help="Board slug to narrow the match"),
    output: Path | None = typer.Option(None, "--output", "-o", help="Output .firmware.zip path"),
    output_dir: Path | None = typer.Option(
        None,
        "--output-dir",
        help="Directory to write the .firmware.zip into (name derived from the image)",
    ),
    force: bool = typer.Option(
        False, "--force", help="Overwrite an existing package in --output-dir"
    ),
    firmware_dir: Path | None = typer.Option(
        None, "--firmware-dir", help="Override the firmware publish root"
    ),
) -> None:
    """Export a published image (matched by version/board) as a .firmware.zip."""

    if output is not None and output_dir is not None:
        typer.echo("Pass either --output or --output-dir, not both.", err=True)
        raise typer.Exit(code=2)

    entries = list_firmware_inventory(publish_root=firmware_dir)
    matches = [entry for entry in entries if entry.runtime_firmware_version == version]
    if board:
        matches = [entry for entry in matches if entry.board_id == board.strip().lower()]
    if not matches:
        typer.echo(f"No published image matches version {version!r}.", err=True)
        raise typer.Exit(code=2)
    if len(matches) > 1:
        names = ", ".join(f"{entry.board_id}:{entry.filename}" for entry in matches)
        typer.echo(f"Multiple images match {version!r}: {names}", err=True)
        typer.echo("Pass --board to disambiguate.", err=True)
        raise typer.Exit(code=2)
    try:
        if output_dir is not None:
            path = export_firmware_package_to_directory(
                matches[0].path, destination_dir=output_dir.resolve(), force=force
            )
        else:
            path = export_firmware_package(matches[0].path, destination=output)
    except FirmwarePackageError as error:
        _fail_firmware_package(error)
    typer.echo(f"Wrote {path}")


@firmware_app.command("import")
def firmware_import_command(
    package: Path | None = typer.Argument(None, help="The .firmware.zip to import"),
    force: bool = typer.Option(
        False, "--force", help="Overwrite an existing image with the same name"
    ),
    url: str | None = typer.Option(None, "--url", help="https:// URL of the package"),
    firmware_dir: Path | None = typer.Option(
        None, "--firmware-dir", help="Override the firmware publish root"
    ),
) -> None:
    """Import a firmware package into the publish root (never builds or flashes)."""

    if (package is None) == (url is None):
        typer.echo("Pass either a package path or --url, not both.", err=True)
        raise typer.Exit(code=2)
    try:
        with resolve_archive_source(
            path=str(package) if package is not None else None,
            url=url,
            max_bytes=MAX_PACKAGE_BYTES,
            label="firmware",
        ) as archive_path:
            result = import_firmware_package(
                archive_path, publish_root=firmware_dir, force=force
            )
    except FirmwarePackageError as error:
        _fail_firmware_package(error)
        return
    except ArchiveSourceError as error:
        _fail_archive_source(error)
        return
    if result["status"] == "already-present":
        typer.echo(f"already-present {result['imagePath']}")
    else:
        typer.echo(f"installed {result['imagePath']}")


@firmware_app.command("list")
def firmware_list_command(
    json_output: bool = typer.Option(False, "--json", help="Emit the inventory payload as JSON"),
    firmware_dir: Path | None = typer.Option(
        None, "--firmware-dir", help="Override the firmware publish root"
    ),
) -> None:
    """List the published firmware images in the publish root."""

    root = resolve_publish_root(firmware_dir)
    entries = list_firmware_inventory(publish_root=root)
    latest = latest_firmware_ids(entries)
    if json_output:
        payload = build_firmware_inventory_payload(
            publish_root=root,
            entries=entries,
            latest=latest,
            latest_by_channel=latest_firmware_ids_by_channel(entries),
        )
        typer.echo(json.dumps(payload))
        return

    table = Table(title="Published firmware", header_style="bold")
    table.add_column("Filename", overflow="fold")
    table.add_column("Board")
    table.add_column("Runtime")
    table.add_column("Version")
    table.add_column("Hash")
    table.add_column("Size")
    table.add_column("Channel")
    for entry in entries:
        table.add_row(
            entry.filename,
            entry.board_id,
            entry.runtime_id,
            entry.runtime_firmware_version,
            entry.content_hash or "-",
            str(entry.size_bytes),
            entry.channel or "-",
        )
    Console().print(table)


_ACTION_LABELS = ("build", "deploy", "rebuild-stale", "build-deploy")

_ACTION_TITLES = {
    "build": "Build firmware",
    "deploy": "Deploy firmware",
    "rebuild-stale": "Rebuild all stale firmware",
    "build-deploy": "Build (if needed) and deploy firmware",
}
"""Menu text per action key, in the order :data:`_ACTION_LABELS` declares."""


def _allowed_actions(settings: Config) -> tuple[str, ...]:
    """Return the interactive actions enabled by ``enable_compile``/``enable_deploy``.

    ``build`` and ``rebuild-stale`` need ``enable_compile``, ``deploy`` needs
    ``enable_deploy``, and ``build-deploy`` needs both. The result keeps the
    canonical :data:`_ACTION_LABELS` order so numbering stays predictable.
    """

    allowed: set[str] = set()
    if settings.enable_compile:
        allowed.update({"build", "rebuild-stale"})
    if settings.enable_deploy:
        allowed.add("deploy")
    if settings.enable_compile and settings.enable_deploy:
        allowed.add("build-deploy")
    return tuple(action for action in _ACTION_LABELS if action in allowed)


def _render_disabled_notice(settings: Config) -> None:
    """Print which interactive actions the configuration disables, if any."""

    disabled: list[str] = []
    if not settings.enable_compile:
        disabled.append("build (enable_compile = false)")
    if not settings.enable_deploy:
        disabled.append("deploy (enable_deploy = false)")
    if disabled:
        typer.echo("Disabled by configuration: " + ", ".join(disabled))


def _default_board_index(catalog: list[BoardSpec], last_board: str | None) -> int:
    """Return the 1-based board index matching *last_board*, or 1 when unset/unknown."""

    if last_board:
        for index, spec in enumerate(catalog, start=1):
            if spec.name == last_board:
                return index
    return 1


def _prompt_action(
    *,
    default: str | None,
    has_local_firmware: bool,
    allowed: tuple[str, ...] | None = None,
) -> str:
    """Prompt for the firmware action as a numbered choice and return the action key.

    *allowed* filters both the listed actions and their numbering; ``None`` keeps
    all four actions, which is the behaviour existing callers and tests expect. The
    remembered *default* and the ``build``/``deploy`` fallback are clamped to
    *allowed*, so a disabled action can never be selected by pressing Enter.
    """

    choices = _ACTION_LABELS if allowed is None else allowed
    if not choices:
        typer.echo("No firmware action is enabled by configuration.", err=True)
        raise typer.Exit(code=0)

    fallback = "deploy" if has_local_firmware else "build"
    if fallback not in choices:
        fallback = choices[0]
    selected = default if default in choices else fallback

    typer.echo("Action:")
    for index, action in enumerate(choices, start=1):
        typer.echo(f"  {index}. {_ACTION_TITLES[action]}")

    default_index = choices.index(selected) + 1
    action_index = typer.prompt("Select action", type=int, default=default_index)
    if action_index < 1 or action_index > len(choices):
        typer.echo(
            f"Invalid action number: {action_index}. Expected 1..{len(choices)}.",
            err=True,
        )
        raise typer.Exit(code=2)
    return choices[action_index - 1]


def _prompt_port(ports: list[SerialPort], last_port: str | None) -> str:
    """Prompt for a serial port, using a numbered list when ports are detected."""

    if not ports:
        return typer.prompt("Serial port", default=last_port)

    typer.echo("Detected serial ports:")
    default_index = 1
    for index, candidate in enumerate(ports, start=1):
        label_suffix = f"  ({candidate.label})" if candidate.label else ""
        typer.echo(f"  {index}. {candidate.device}{label_suffix}")
        if last_port is not None and candidate.device == last_port:
            default_index = index

    port_index = typer.prompt("Select port", type=int, default=default_index)
    if port_index < 1 or port_index > len(ports):
        typer.echo(f"Invalid port number: {port_index}. Expected 1..{len(ports)}.", err=True)
        raise typer.Exit(code=2)
    return ports[port_index - 1].device


@app.command("compile-mpy")
def compile_mpy(
    port: str = typer.Option("u0", "--port", help="mpremote port selector."),
    mpremote: str = typer.Option(
        "mpremote",
        "--mpremote",
        help="Path to mpremote executable for probing the connected device.",
    ),
    mpy_cross: Path | None = typer.Option(
        None,
        "--mpy-cross",
        help="Path to mpy-cross executable. Falls back to PATH or local MicroPython build.",
    ),
    device_root: Path | None = typer.Option(
        None,
        "--device-root",
        help="Override nodes/device root.",
    ),
    micropython_root: Path | None = typer.Option(
        None,
        "--micropython-root",
        help="Override MicroPython root used for local mpy-cross fallback lookup.",
    ),
    clean: bool = typer.Option(
        False,
        "--clean",
        help="Delete existing __mpycache__ folders under runtime/node_pkgs/tools before compile.",
    ),
    spec_file: Path | None = typer.Option(
        None,
        "--spec-file",
        help="JSON file with compile spec (emit, smallIntBits, march, marchFlags).",
    ),
    from_device: bool = typer.Option(
        False,
        "--from-device",
        help="Probe a connected device to derive compile parameters automatically.",
    ),
    emit: str | None = typer.Option(
        None,
        "--emit",
        help="Compile emit mode (bytecode/native/viper).",
    ),
    small_int_bits: int | None = typer.Option(
        None,
        "--small-int-bits",
        help="Compile small-int bit width.",
    ),
    march: str | None = typer.Option(
        None,
        "--march",
        help="Compile march value.",
    ),
    march_flags: str | None = typer.Option(
        None,
        "--march-flags",
        help="Compile march-flags pass-through.",
    ),
    json_output: bool = typer.Option(
        False,
        "--json-output",
        help="Emit compact JSON output instead of human-readable tables.",
    ),
    skip_addons: bool = typer.Option(
        False,
        "--skip-addons",
        help="Compile the shipped device tree only, leaving installed add-ons untouched.",
    ),
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help="Report the sources that would be compiled without writing anything.",
    ),
) -> None:
    """Compile runtime/node package .mpy caches from CLI args, JSON spec, or device probe.

    The add-ons folder (``addons_dir``) is covered as well, so an installed add-on gets
    its ``__mpycache__`` and ``mpyCompileProfiles`` record; ``--skip-addons`` opts out and
    leaves that tree byte-identical, and ``--dry-run`` reports the source set without
    compiling, cleaning, or rewriting a manifest.
    """

    workspace_root = _resolve_workspace_root()

    selected_device_root = (
        device_root.resolve()
        if device_root is not None
        else (workspace_root / "src" / "micro_otter" / "nodes" / "device").resolve()
    )
    selected_micropython_root = (
        micropython_root.resolve()
        if micropython_root is not None
        else _resolve_default_micropython_root(workspace_root)
    )

    has_cli_spec = any(value is not None for value in (emit, small_int_bits, march, march_flags))
    source_count = sum(
        (
            1 if from_device else 0,
            1 if spec_file is not None else 0,
            1 if has_cli_spec else 0,
        )
    )
    if source_count != 1:
        typer.echo(
            "compile-mpy requires exactly one parameter source: --from-device, "
            "--spec-file, or explicit compile args "
            "(--emit/--small-int-bits/--march/--march-flags).",
            err=True,
        )
        raise typer.Exit(code=2)

    resolved_mpy_cross = mpy_cross.resolve() if mpy_cross is not None else None
    selected_addons_root = None if skip_addons else _resolve_addons_root()
    compile_result = None
    probe_values: dict[str, Any] | None = None
    selected_emit: str | None = None
    selected_small_int_bits: int | None = None
    selected_march: str | None = None
    selection_source = ""

    try:
        if from_device:
            selection_source = "device"
            device_result = run_device_mpy_precompile(
                DeviceMpyPrecompileRequest(
                    device_root=selected_device_root,
                    micropython_root=selected_micropython_root,
                    port=port,
                    mpremote=mpremote,
                    mpy_cross=resolved_mpy_cross,
                    clean=clean,
                    addons_root=selected_addons_root,
                )
            )
            probe_values = device_result.probe_values
            selected_emit = device_result.selected_emit
            selected_small_int_bits = device_result.selected_small_int_bits
            selected_march = device_result.selected_march
            compile_result = device_result.compile
        else:
            compile_spec: dict[str, Any] = {}
            if spec_file is not None:
                selection_source = "spec-file"
                compile_spec = _load_compile_mpy_spec(spec_file.resolve())
            else:
                selection_source = "cli-args"

            selected_emit = emit if emit is not None else compile_spec.get("emit") or "bytecode"
            selected_small_int_bits = (
                small_int_bits
                if small_int_bits is not None
                else compile_spec.get("small_int_bits")
            )
            selected_march = march if march is not None else compile_spec.get("march")
            selected_march_flags = (
                march_flags
                if march_flags is not None
                else compile_spec.get("march_flags")
            )

            compile_result = run_manifest_mpy_precompile(
                MpyManifestPrecompileRequest(
                    device_root=selected_device_root,
                    micropython_root=selected_micropython_root,
                    mpy_cross=resolved_mpy_cross,
                    clean=clean,
                    emit=selected_emit,
                    small_int_bits=selected_small_int_bits,
                    march=selected_march,
                    march_flags=selected_march_flags,
                    addons_root=selected_addons_root,
                    dry_run=dry_run,
                )
            )
    except Exception as exc:
        typer.echo(f"compile-mpy failed: {exc}", err=True)
        raise typer.Exit(code=1) from exc

    if json_output:
        payload = {
            "status": "success",
            "source": selection_source,
            "probe": probe_values,
            "selected": {
                "emit": selected_emit,
                "smallIntBits": selected_small_int_bits,
                "march": selected_march,
            },
            "compile": {
                "compiledCount": compile_result.compiled_count,
                "profileHash": compile_result.profile_hash,
                "compilerPath": str(compile_result.compiler_path),
                "compilerArgs": list(compile_result.compiler_args),
                "runtimeManifestsUpdated": compile_result.runtime_manifests_updated,
                "nodePackageManifestsUpdated": compile_result.node_package_manifests_updated,
                "toolsManifestsUpdated": compile_result.tools_manifests_updated,
                "addonManifestsUpdated": compile_result.addon_manifests_updated,
                "addonsSkipped": compile_result.addons_skipped,
                "dryRun": dry_run,
                "warnings": list(compile_result.warnings),
            },
        }
        typer.echo(json.dumps(payload, separators=(",", ":"), ensure_ascii=True))
        raise typer.Exit(code=0)

    console = Console()
    console.print(
        Panel.fit(
            "[bold green]MPY precompile completed[/bold green]",
            title="Micro-Otter MPY Precompile",
            border_style="green",
        )
    )

    selected_table = Table(
        title="Selected Compile Settings",
        show_header=True,
        header_style="bold cyan",
    )
    selected_table.add_column("Field", style="cyan", no_wrap=True)
    selected_table.add_column("Value", style="white")
    selected_table.add_row("Source", selection_source)
    selected_table.add_row("Emit", str(selected_emit))
    selected_table.add_row("Small Int Bits", str(selected_small_int_bits))
    selected_table.add_row("March", str(selected_march or "n/a"))
    selected_table.add_row("Compiler", str(compile_result.compiler_path))
    selected_table.add_row("Profile Hash", compile_result.profile_hash)
    console.print(selected_table)

    summary = Table(title="Compilation Summary", show_header=True, header_style="bold cyan")
    summary.add_column("Field", style="cyan", no_wrap=True)
    summary.add_column("Value", style="white")
    summary.add_row("Compiled Files", str(compile_result.compiled_count))
    summary.add_row("Runtime Manifests Updated", str(compile_result.runtime_manifests_updated))
    summary.add_row(
        "Node Package Manifests Updated",
        str(compile_result.node_package_manifests_updated),
    )
    summary.add_row("Tools Manifests Updated", str(compile_result.tools_manifests_updated))
    summary.add_row("Add-on Manifests Updated", str(compile_result.addon_manifests_updated))
    summary.add_row("Add-ons Skipped", "yes" if compile_result.addons_skipped else "no")
    if dry_run:
        summary.add_row("Dry Run", "yes (nothing was written)")
    console.print(summary)

    if compile_result.warnings:
        warning_table = Table(title="Warnings", show_header=True, header_style="bold yellow")
        warning_table.add_column("Message", style="yellow")
        for warning in compile_result.warnings:
            warning_table.add_row(warning)
        console.print(warning_table)


# Alias: short form for compile-mpy.
app.command("cmpy")(compile_mpy)

# Toolchain diagnostics and provisioning (see micro_otter.cli.toolchain).
app.add_typer(toolchain_app, name="toolchain")

# Add-on node package inventory and installation (see micro_otter.cli.addons).
app.add_typer(addons_app, name="addons")

# Hosted web app build and upload (see micro_otter.cli.webapp).
app.add_typer(webapp_app, name="webapp")

# Firmware build/deploy menu plus package import/export (see micro_otter.cli.app).
app.add_typer(firmware_app, name="firmware")
app.add_typer(firmware_app, name="fw")

app.command("doctor")(doctor_command)


def main() -> None:
    """Entry point used by the console script."""

    app(prog_name="micro-otter")


if __name__ == "__main__":  # pragma: no cover - manual execution convenience
    main()

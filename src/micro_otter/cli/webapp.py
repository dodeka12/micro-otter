"""``micro-otter webapp`` commands: ``build`` and ``upload``.

Rendering and argument handling only: the build orchestration lives in
:mod:`micro_otter.tools.webapp_build` (with the manifest in
:mod:`micro_otter.tools.webapp_manifest` and the ``/firmware`` page in
:mod:`micro_otter.tools.webapp_firmware_page`) and the publication in
:mod:`micro_otter.tools.webapp_upload`, so the work stays usable without Typer or Rich.

Every command resolves configuration through ``micro-otter.toml`` / ``--config`` /
``MICRO_OTTER_*`` and exits ``2`` on a configuration error, ``1`` on a failed operation (with its
stable ``webapp-build-*`` / ``webapp-upload-*`` code), ``130`` on an interrupted upload and ``0`` on
success. The SFTP password is read from ``MICRO_OTTER_UPLOAD_PASSWORD`` or one hidden prompt, never
from a flag, and it is redacted from everything this module prints.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from urllib.parse import SplitResult, urlsplit

import typer
from rich import box
from rich.console import Console
from rich.table import Table

from micro_otter.cli.toolchain import fail_config
from micro_otter.config import Config, ConfigError, load_config
from micro_otter.tools.webapp_build import WebappBuildResult, run_webapp_build
from micro_otter.tools.webapp_errors import WebappError
from micro_otter.tools.webapp_upload import (
    UPLOAD_PASSWORD_ENV,
    UploadPlan,
    UploadResult,
    redact,
    resolve_target,
    run_webapp_upload,
)

webapp_app = typer.Typer(
    add_completion=False,
    help="Build and publish the hosted web app",
)

DEFAULT_OUT_DIR = Path("_dist") / "webapp-hosted"
"""Default `--out`: never `_dist/webapp`, which is the wheel payload."""

ROOT_HOSTING_HINT = (
    "host the app at the root of a vhost or on its own subdomain: the bundle fetches "
    "/html/version.json, /html/locales/*.json, /html/icons/*, /html/styles/*, /html/vendor/*, "
    "/device/* and /firmware/* with root-absolute paths"
)
"""Why a public URL may not carry a path; also the follow-up (base-URL support) it names."""


def _load(config_path: Path | None) -> Config:
    """Resolve the configuration, printing a configuration error and exiting ``2``."""

    try:
        return load_config(config_path=config_path)
    except ConfigError as error:
        fail_config(error)
        raise AssertionError("fail_config always raises") from error


def _fail_webapp(error: WebappError, *, secret: str | None = None) -> None:
    """Print a web-app failure with its stable code and hint, then exit with its exit code.

    *secret* is the SFTP password when one was used: every occurrence is replaced by ``***``
    before anything is written, so no error path can echo a credential.
    """

    typer.echo(redact(f"{error.code}: {error}", secret), err=True)
    if error.hint:
        typer.echo(redact(f"hint: {error.hint}", secret), err=True)
    raise typer.Exit(code=error.exit_code)


def _parse_absolute_url(value: str, *, option: str, code: str) -> SplitResult:
    """Return *value* parsed as an absolute ``http``/``https`` URL.

    Raises:
        WebappError: *code* when the scheme is not ``http(s)`` or the URL has no host.
    """

    try:
        parsed = urlsplit(value.strip())
    except ValueError as error:
        raise WebappError(
            code,
            f"{option} {value!r} is not a valid URL",
            hint="pass an absolute URL such as https://docs.example.invalid/install",
        ) from error
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise WebappError(
            code,
            f"{option} {value!r} is not an absolute http(s) URL",
            hint="pass an absolute URL such as https://docs.example.invalid/install",
        )
    return parsed


def _validate_docs_url(value: str | None) -> str | None:
    """Return the ``--docs-url`` value when it is an absolute http(s) URL."""

    if value is None:
        return None
    _parse_absolute_url(
        value, option="--docs-url", code="webapp-build-docs-url-invalid"
    )
    return value.strip()


def _validate_public_url(value: str | None) -> str | None:
    """Return the ``--public-url`` value when it names the root of a host.

    A path would need base-URL support the bundle does not have: every runtime fetch is
    root-absolute, so the app would 404 under ``/otter/``.
    """

    if value is None:
        return None
    parsed = _parse_absolute_url(
        value, option="--public-url", code="webapp-build-public-url-invalid"
    )
    if parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise WebappError(
            "webapp-build-public-url-invalid",
            f"--public-url {value!r} must not carry a path, query or fragment",
            hint=ROOT_HOSTING_HINT,
        )
    return value.strip()


def _result_payload(result: WebappBuildResult) -> dict[str, object]:
    """Return the camelCase ``--json-output`` payload of one build."""

    return {
        "outDir": str(result.out_dir),
        "appVersion": result.app_version,
        "fileCount": result.file_count,
        "firmwarePage": str(result.firmware_page) if result.firmware_page else None,
        "manifestPath": str(result.manifest_path),
    }


def _build_table(result: WebappBuildResult) -> Table:
    """Build the ``Field | Value`` summary table of one build."""

    table = Table(title="Hosted web app", box=box.SIMPLE_HEAD, header_style="bold")
    table.add_column("Field")
    table.add_column("Value", overflow="fold")
    table.add_row("Out dir", str(result.out_dir))
    table.add_row("App version", result.app_version)
    table.add_row("Files", str(result.file_count))
    table.add_row(
        "Firmware page",
        str(result.firmware_page) if result.firmware_page is not None else "-",
    )
    table.add_row("Manifest", str(result.manifest_path))
    return table


@webapp_app.command("build")
def build_command(
    out: Path = typer.Option(
        DEFAULT_OUT_DIR,
        "--out",
        help="Output directory; `_dist/webapp` (the wheel payload) is refused",
    ),
    firmware_index: Path | None = typer.Option(
        None,
        "--firmware-index",
        help="Release index.json to render firmware/index.html from",
    ),
    docs_url: str | None = typer.Option(
        None,
        "--docs-url",
        help="Absolute documentation URL the hosted notice links to",
    ),
    public_url: str | None = typer.Option(
        None,
        "--public-url",
        help="Absolute root URL the bundle will be served from; recorded in the manifest",
    ),
    no_build: bool = typer.Option(
        False,
        "--no-build",
        help="Skip npm and re-render the page and manifest of an existing --out",
    ),
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
    """Build the hosted web app into a publication directory.

    Sets MICRO_OTTER_HOSTED=1 for the Vite build that `npm run build` runs, so the bundle never
    probes /api/server-capabilities, carries the CSP meta tag and shows the hosted notice in the
    Firmware tab.
    `_dist/webapp` (the wheel payload) is refused; the default is `_dist/webapp-hosted`.

    With --firmware-index the command also renders firmware/index.html from that release index.
    In every case it writes webapp-build.json last: the file list, sizes and hashes
    `mo webapp upload` verifies against.
    Nothing about a destination host is stored.
    """

    config = _load(config_path)

    try:
        resolved_docs_url = _validate_docs_url(docs_url)
        resolved_public_url = _validate_public_url(public_url)
        result = run_webapp_build(
            workspace=config.workspace_root,
            out_dir=out,
            docs_url=resolved_docs_url,
            firmware_index=firmware_index,
            public_url=resolved_public_url,
            skip_build=no_build,
        )
    except WebappError as error:
        _fail_webapp(error)
        return

    if result.npm_output:
        typer.echo(result.npm_output)
    if json_output:
        typer.echo(json.dumps(_result_payload(result), indent=2))
        raise typer.Exit(code=0)
    Console().print(_build_table(result))
    raise typer.Exit(code=0)
def _resolve_password(*, identity_file: Path | None, interactive: bool) -> str | None:
    """Return the SFTP password from ``MICRO_OTTER_UPLOAD_PASSWORD`` or one hidden prompt.

    The password is never a CLI flag: a flag would land in the shell history and in ``ps``. Key
    auth is the supported path, so the prompt says an empty answer uses the key, and a
    non-interactive caller (``--dry-run``, ``--json-output``, CI) is never blocked on a prompt.
    """

    from_env = os.environ.get(UPLOAD_PASSWORD_ENV, "").strip()
    if from_env:
        return from_env
    if identity_file is not None or not interactive:
        return None
    answer = typer.prompt(
        "SFTP password (empty uses your SSH key)",
        hide_input=True,
        default="",
        show_default=False,
    )
    secret = str(answer).strip()
    return secret or None


def _upload_payload(result: UploadResult) -> dict[str, object]:
    """Return the camelCase ``--json-output`` payload of one upload."""

    return {
        "fileCount": result.file_count,
        "byteCount": result.byte_count,
        "directories": result.directories,
        "pruned": list(result.pruned),
        "verified": result.verified,
        "dryRun": result.dry_run,
        "manifestPath": str(result.manifest_path),
    }


def _plan_table(plan: UploadPlan) -> Table:
    """Build the ``--dry-run`` table: one row per file, in publication order."""

    target = plan.target
    table = Table(
        title=f"Upload plan for {target.destination}:{target.remote_path}",
        box=box.SIMPLE_HEAD,
        header_style="bold",
    )
    table.add_column("Remote path", overflow="fold")
    table.add_column("Bytes", justify="right")
    for item in plan.files:
        table.add_row(item.remote, str(item.size))
    return table


def _upload_table(result: UploadResult) -> Table:
    """Build the ``Field | Value`` summary table of one upload."""

    target = result.plan.target
    table = Table(title="Hosted web app upload", box=box.SIMPLE_HEAD, header_style="bold")
    table.add_column("Field")
    table.add_column("Value", overflow="fold")
    table.add_row("Host", target.destination)
    table.add_row("Remote path", target.remote_path)
    table.add_row("Files", str(result.file_count))
    table.add_row("Bytes", str(result.byte_count))
    table.add_row("Directories", str(result.directories))
    table.add_row("Pruned", str(len(result.pruned)))
    table.add_row("Verified", "yes" if result.verified else "no")
    return table


@webapp_app.command("upload")
def upload_command(
    source: Path = typer.Option(
        DEFAULT_OUT_DIR,
        "--source",
        help="Build directory holding webapp-build.json",
    ),
    host: str | None = typer.Option(
        None,
        "--host",
        help="SFTP host; defaults to MICRO_OTTER_UPLOAD_HOST",
    ),
    user: str | None = typer.Option(
        None,
        "--user",
        help="SFTP user; defaults to MICRO_OTTER_UPLOAD_USER",
    ),
    remote_path: str | None = typer.Option(
        None,
        "--remote-path",
        help="Absolute remote directory; defaults to MICRO_OTTER_UPLOAD_PATH",
    ),
    port: int | None = typer.Option(
        None,
        "--port",
        help="SSH port; defaults to MICRO_OTTER_UPLOAD_PORT or 22",
    ),
    identity_file: Path | None = typer.Option(
        None,
        "--identity-file",
        help="Private key for publickey auth",
    ),
    known_hosts: Path | None = typer.Option(
        None,
        "--known-hosts",
        help="known_hosts file to pin the host key against",
    ),
    accept_new_host_key: bool = typer.Option(
        False,
        "--accept-new-host-key",
        help="Accept an unknown host key; off by default",
    ),
    prune: bool = typer.Option(
        False,
        "--prune",
        help="Delete remote files the manifest does not list, after confirmation",
    ),
    verify: bool = typer.Option(
        False,
        "--verify",
        help="Compare the host and the public version with the manifest",
    ),
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help="Print the plan and exit 0 without connecting",
    ),
    assume_yes: bool = typer.Option(
        False,
        "--yes",
        help="Skip the prune confirmation; the plan is still printed",
    ),
    json_output: bool = typer.Option(
        False,
        "--json-output",
        help="Emit the machine-readable payload instead of tables",
    ),
    config_path: Path | None = typer.Option(
        None,
        "--config",
        help="micro-otter.toml to read instead of discovering one",
    ),
) -> None:
    """Publish a built hosted bundle to any SFTP host.

    The files, sizes and hashes come from webapp-build.json, never from a directory walk.
    Hashed assets go first, html/version.json next-to-last and index.html last, so an
    interrupted upload leaves the previous site working.

    Host, user, path, port, key and known-hosts come from flags or MICRO_OTTER_UPLOAD_*;
    the password comes from MICRO_OTTER_UPLOAD_PASSWORD or one hidden prompt. Nothing about
    the destination is stored in the tree, and no credential reaches a log line.

    --prune removes remote files the manifest does not list, but only after a fully
    successful upload, and index.html and html/version.json are never candidates.
    """

    _load(config_path)  # the --config contract: a configuration error exits 2

    password: str | None = None
    try:
        target = resolve_target(
            host=host,
            user=user,
            remote_path=remote_path,
            port=port,
            identity_file=identity_file,
            known_hosts=known_hosts,
            accept_new_host_key=accept_new_host_key,
        )
        # A dry run reaches no transport, so it never reads a credential at all.
        password = (
            None
            if dry_run
            else _resolve_password(
                identity_file=target.identity_file,
                interactive=not json_output and sys.stdin.isatty(),
            )
        )
        result = run_webapp_upload(
            source_dir=source,
            target=target,
            password=password,
            prune=prune,
            verify=verify,
            dry_run=dry_run,
            assume_yes=assume_yes,
            confirm=None if (assume_yes or json_output) else typer.confirm,
        )
    except WebappError as error:
        _fail_webapp(error, secret=password)
        return

    if json_output:
        typer.echo(redact(json.dumps(_upload_payload(result), indent=2), password))
        raise typer.Exit(code=0)
    Console().print(_plan_table(result.plan) if result.dry_run else _upload_table(result))
    for line in result.checks:
        typer.echo(redact(line, password))
    raise typer.Exit(code=0)


__all__ = ["webapp_app"]

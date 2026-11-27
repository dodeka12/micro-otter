"""Orchestration of ``mo webapp build``: the hosted bundle, the ``/firmware`` page, the manifest.

Everything here is stdlib plus the sibling :mod:`webapp_*` modules, so a test can drive the command
with an injected runner and no npm, Node.js or network. The guards run in a fixed order and each
carries a stable ``webapp-build-*`` code:

============================  ==============================================
Guard                         Code
============================  ==============================================
no ``package.json``/vite cfg  ``webapp-build-source-missing``
no ``npm`` on ``PATH``        ``webapp-build-tool-missing``
no ``node_modules``           ``webapp-build-dependencies-missing``
out dir is ``_dist/webapp``   ``webapp-build-out-dir-unsafe``
``--no-build`` without files  ``webapp-build-output-missing``
npm exits non-zero            ``webapp-build-failed``
============================  ==============================================

The build sets ``MICRO_OTTER_HOSTED=1``, ``MICRO_OTTER_WEBAPP_OUT`` and optionally
``MICRO_OTTER_WEBAPP_DOCS_URL`` for the `vite build` that ``npm run build`` runs; those three names
are the contract with :file:`vite.config.js` and live here as constants so neither side can drift.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from micro_otter.tools import webapp_manifest
from micro_otter.tools.webapp_errors import WebappError
from micro_otter.tools.webapp_firmware_page import (
    load_firmware_index,
    write_firmware_page,
)

WEBAPP_HOSTED_ENV = "MICRO_OTTER_HOSTED"
"""Environment variable `vite.config.js` reads to switch the bundle into hosted mode."""

WEBAPP_OUT_ENV = "MICRO_OTTER_WEBAPP_OUT"
"""Environment variable `vite.config.js` reads for `build.outDir`."""

WEBAPP_DOCS_URL_ENV = "MICRO_OTTER_WEBAPP_DOCS_URL"
"""Environment variable `vite.config.js` reads for the hosted notice's documentation link."""

WHEEL_PAYLOAD_DIR = Path("_dist") / "webapp"
"""The wheel payload inside a checkout; a hosted build must never write here."""

NPM_BUILD_COMMAND: tuple[str, ...] = ("npm", "run", "build")
"""The build command; an argv, never a shell string."""


@dataclass(frozen=True)
class WebappBuildResult:
    """What one ``mo webapp build`` produced."""

    out_dir: Path
    """Absolute output directory holding the bundle, page and manifest."""

    manifest_path: Path
    """Absolute path of the written ``webapp-build.json``."""

    app_version: str
    """Version read from ``html/version.json`` in the built bundle."""

    file_count: int
    """Number of files the manifest lists (the manifest itself excluded)."""

    firmware_page: Path | None
    """Absolute path of ``firmware/index.html``, or ``None`` when no index was given."""

    npm_output: str
    """Captured stdout and stderr of ``npm run build``; empty for ``--no-build``."""


def _fail(code: str, message: str, hint: str) -> WebappError:
    """Return a build failure carrying *code*, *message* and *hint*."""

    return WebappError(code, message, hint=hint)


def _require_source(workspace: Path) -> None:
    """Require a Micro-Otter source checkout at *workspace*."""

    for name in ("package.json", "vite.config.js"):
        if not (workspace / name).is_file():
            raise _fail(
                "webapp-build-source-missing",
                f"{workspace} does not look like a Micro-Otter checkout ({name} is missing)",
                "run this from a Micro-Otter source checkout",
            )


def _require_available_npm() -> None:
    """Require the system ``npm`` the build shells out to."""

    if shutil.which("npm") is None:
        raise _fail(
            "webapp-build-tool-missing",
            "npm was not found on PATH",
            "install Node.js (npm) to build the web app",
        )


def _require_dependencies(workspace: Path) -> None:
    """Require the installed Node.js dependencies of *workspace*."""

    if not (workspace / "node_modules").is_dir():
        raise _fail(
            "webapp-build-dependencies-missing",
            f"{workspace / 'node_modules'} does not exist",
            "run `npm ci` in the checkout first",
        )


def _require_safe_out_dir(workspace: Path, out_dir: Path) -> None:
    """Refuse ``_dist/webapp`` and anything inside it — the wheel payload."""

    wheel_payload = (workspace / WHEEL_PAYLOAD_DIR).resolve()
    if out_dir == wheel_payload or out_dir.is_relative_to(wheel_payload):
        raise _fail(
            "webapp-build-out-dir-unsafe",
            f"{out_dir} is the wheel payload directory ({WHEEL_PAYLOAD_DIR.as_posix()})",
            "`_dist/webapp` is the install artifact; pick another directory",
        )


def _require_output(out_dir: Path) -> None:
    """Require an already-built bundle for ``--no-build``."""

    if not (out_dir / "index.html").is_file():
        raise _fail(
            "webapp-build-output-missing",
            f"{out_dir} holds no index.html",
            "run the build first or drop `--no-build`",
        )


def _read_app_version(out_dir: Path) -> str:
    """Return ``version`` from ``html/version.json`` in the built bundle.

    The file is what the host serves and what ``js/core/app-meta.ts`` reads, so the manifest reports
    the same version a visitor sees. ``tools/project-version.mjs`` is not importable from the
    packaged wheel and stays a Vite-time concern.
    """

    path = out_dir / "html" / "version.json"
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise _fail(
            "webapp-build-failed",
            f"{path} is missing after the build",
            "check that the build wrote html/version.json, then re-run",
        ) from error
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise _fail(
            "webapp-build-failed",
            f"{path} cannot be read as JSON: {error}",
            "check that the build wrote html/version.json, then re-run",
        ) from error

    version = document.get("version") if isinstance(document, dict) else None
    if not isinstance(version, str) or not version.strip():
        raise _fail(
            "webapp-build-failed",
            f"{path} does not state a version",
            "check that the build wrote html/version.json, then re-run",
        )
    return version.strip()


def _build_env(out_dir: Path, docs_url: str | None) -> dict[str, str]:
    """Return the environment for ``npm run build``: the process environment plus the seam.

    ``MICRO_OTTER_WEBAPP_DOCS_URL`` is *removed* when no ``--docs-url`` was passed, so a leftover
    value in the caller's shell can never leak a stale documentation link into the bundle.
    """

    env = dict(os.environ)
    env[WEBAPP_HOSTED_ENV] = "1"
    env[WEBAPP_OUT_ENV] = str(out_dir)
    if docs_url:
        env[WEBAPP_DOCS_URL_ENV] = docs_url
    else:
        env.pop(WEBAPP_DOCS_URL_ENV, None)
    return env


def _combine_output(completed: subprocess.CompletedProcess[str]) -> str:
    """Return the captured stdout and stderr of *completed* as one trimmed block."""

    parts = [
        part.strip()
        for part in (completed.stdout, completed.stderr)
        if isinstance(part, str) and part.strip()
    ]
    return "\n".join(parts)


def run_webapp_build(
    *,
    workspace: Path,
    out_dir: Path,
    docs_url: str | None = None,
    firmware_index: Path | None = None,
    public_url: str | None = None,
    skip_build: bool = False,
    run: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> WebappBuildResult:
    """Build the hosted bundle into *out_dir* and describe it in ``webapp-build.json``.

    Args:
        workspace: Micro-Otter source checkout holding ``package.json`` and ``vite.config.js``.
        out_dir: Publication directory; relative paths are resolved against the process directory.
        docs_url: Absolute documentation URL for the hosted notice, or ``None``.
        firmware_index: Release ``index.json`` to render ``firmware/index.html`` from, or ``None``.
        public_url: Root URL the bundle will be served from; recorded, never guessed.
        skip_build: Reuse an existing ``out_dir`` and only re-render the page and the manifest.
        run: ``subprocess.run``-compatible callable, injected by tests.

    Returns:
        A :class:`WebappBuildResult` describing the finished tree.

    Raises:
        WebappError: Any ``webapp-build-*`` failure from the guard table, plus
            ``webapp-firmware-index-invalid`` for an unusable release index.
    """

    workspace = workspace.resolve()
    target = out_dir.resolve()

    _require_source(workspace)
    if not skip_build:
        _require_available_npm()
        _require_dependencies(workspace)
    _require_safe_out_dir(workspace, target)
    # Validated before the build, so an index typo does not cost a full rebuild; rendered after it,
    # because `vite build` empties the output directory.
    index = load_firmware_index(firmware_index) if firmware_index is not None else None

    npm_output = ""
    if not skip_build:
        completed = run(
            list(NPM_BUILD_COMMAND),
            cwd=workspace,
            env=_build_env(target, docs_url),
            capture_output=True,
            text=True,
            check=False,
        )
        npm_output = _combine_output(completed)
        if completed.returncode != 0:
            raise _fail(
                "webapp-build-failed",
                f"npm run build exited with code {completed.returncode}",
                "fix the reported error and re-run `mo webapp build`",
            )
    else:
        _require_output(target)

    app_version = _read_app_version(target)

    firmware_page: dict[str, Any] | None = None
    page_path: Path | None = None
    if index is not None and firmware_index is not None:
        page_path = write_firmware_page(target, index, public_url=public_url)
        firmware_page = {
            "path": page_path.relative_to(target).as_posix(),
            "entryCount": len(index["firmware"]),
            "indexSha256": webapp_manifest.sha256_file(firmware_index),
        }

    files = webapp_manifest.collect_files(target)
    document = webapp_manifest.payload(
        app_version,
        hosted=True,
        public_url=public_url,
        firmware_page=firmware_page,
        files=files,
    )
    webapp_manifest.validate_manifest(document, code="webapp-build-manifest-invalid")
    manifest_path = webapp_manifest.write_manifest(target, document)

    return WebappBuildResult(
        out_dir=target,
        manifest_path=manifest_path,
        app_version=app_version,
        file_count=len(files),
        firmware_page=page_path,
        npm_output=npm_output,
    )


__all__ = [
    "NPM_BUILD_COMMAND",
    "WEBAPP_DOCS_URL_ENV",
    "WEBAPP_HOSTED_ENV",
    "WEBAPP_OUT_ENV",
    "WHEEL_PAYLOAD_DIR",
    "WebappBuildResult",
    "run_webapp_build",
]

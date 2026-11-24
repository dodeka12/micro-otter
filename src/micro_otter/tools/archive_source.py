# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
"""The one place that answers "where is the archive?" for the install/import paths.

Two inputs, mutually exclusive: a **path** the server can already see, or a **URL**
the server may fetch. The server never receives archive bytes from the client; it
resolves either form into one local file with a caller-chosen suffix (``.zip`` for
add-on and firmware packages, ``.bin`` for a raw MicroPython image) and applies both
policies here:

- the path policy (absolute, existing regular file, suffix in the accepted list,
  byte cap), and
- the URL policy (https always, ``http`` only towards loopback, at most three
  re-validated redirects, a streamed byte cap, connect/read timeouts).

The module is shared by ``addon.install``, ``firmware.import``, and the
``mo addons`` / ``mo firmware`` verbs, so the CLI and the WebSocket frames can never
disagree about what a URL is allowed to fetch.
"""

from __future__ import annotations

import tempfile
import urllib.error
import urllib.request
import zipfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit

from .host_policy import is_loopback_host

__all__ = (
    "ARCHIVE_SOURCE_ERROR_CODES",
    "ARCHIVE_URL_MAX_REDIRECTS",
    "DEFAULT_ARCHIVE_SUFFIXES",
    "PACKAGE_IGNORED_NAMES",
    "ArchiveSourceError",
    "download_archive",
    "package_addon_source",
    "resolve_archive_source",
)

CODE_ARCHIVE_PATH_INVALID = "archive-path-invalid"
CODE_ARCHIVE_TOO_LARGE = "archive-too-large"
CODE_ARCHIVE_URL_INVALID = "archive-url-invalid"
CODE_ARCHIVE_URL_BLOCKED = "archive-url-blocked"
CODE_ARCHIVE_URL_REDIRECT = "archive-url-redirect"
CODE_ARCHIVE_URL_UNREACHABLE = "archive-url-unreachable"
CODE_ARCHIVE_URL_TOO_LARGE = "archive-url-too-large"

ARCHIVE_SOURCE_ERROR_CODES: tuple[str, ...] = (
    CODE_ARCHIVE_PATH_INVALID,
    CODE_ARCHIVE_TOO_LARGE,
    CODE_ARCHIVE_URL_INVALID,
    CODE_ARCHIVE_URL_BLOCKED,
    CODE_ARCHIVE_URL_REDIRECT,
    CODE_ARCHIVE_URL_UNREACHABLE,
    CODE_ARCHIVE_URL_TOO_LARGE,
)
"""Every stable code :class:`ArchiveSourceError` can raise.

The WebSocket handler splats this tuple into ``ERROR_CODES`` so the contract table
and the client's error-code list stay in lock-step with this module.
"""

ARCHIVE_URL_MAX_REDIRECTS = 3
"""Largest number of redirect hops a download follows before refusing."""

ARCHIVE_URL_TIMEOUT_SECONDS = 30.0
"""One socket timeout for the connect and for each read.

The byte counter is what actually bounds a slow or endless body; this value only
stops a host that accepts the connection and then stalls forever.
"""

ARCHIVE_URL_CHUNK_BYTES = 64 * 1024
"""Bytes read per chunk while streaming a download to its destination."""

PACKAGE_IGNORED_NAMES = (".DS_Store", "Thumbs.db", "__pycache__")
"""Editor/OS cache names ``package_addon_source`` skips; never package content."""

DEFAULT_ARCHIVE_SUFFIXES: tuple[str, ...] = (".zip",)
"""Default accepted archive suffixes (``.zip`` for add-on and firmware packages).

The firmware binary import passes ``(".bin",)`` instead; every other caller keeps
this default. Entries must each start with a leading dot, and the tuple must not be
empty, or :func:`resolve_archive_source` raises ``ValueError``.
"""




class ArchiveSourceError(RuntimeError):
    """One archive source (path or URL) failed, with a stable code and a hint.

    Mirrors :class:`micro_otter.tools.addon_archive.AddonInstallError` so both job
    ladders map it identically: ``code`` is machine-readable, ``hint`` names the
    next action, and there is deliberately no ``details``.
    """

    def __init__(self, code: str, message: str, *, hint: str | None = None) -> None:
        """Store the stable *code*, the human-readable *message*, and the optional *hint*."""

        super().__init__(message)
        self.code = code
        self.hint = hint


def _resolve_local_archive(
    raw_path: str, *, max_bytes: int, label: str, suffixes: tuple[str, ...]
) -> Path:
    """Resolve *raw_path* to one existing, capped file whose suffix is in *suffixes*.

    *label* only shapes the error message ("add-on archive", "firmware package").
    A missing path, a directory, or a suffix outside *suffixes* raise
    ``archive-path-invalid`` and the message names the accepted suffixes; a file
    above *max_bytes* raises ``archive-too-large`` with the actual size and the cap
    in the message.
    """

    path = Path(raw_path).expanduser().resolve()
    accepted = "/".join(suffixes)
    if not path.is_file() or path.suffix.lower() not in suffixes:
        raise ArchiveSourceError(
            CODE_ARCHIVE_PATH_INVALID,
            f"{label} path {path} is not an existing {accepted} file",
            hint="point at the archive file on the server's machine",
        )
    size = path.stat().st_size
    if size > max_bytes:
        raise ArchiveSourceError(
            CODE_ARCHIVE_TOO_LARGE,
            f"{label} {path} is {size} bytes, above the {max_bytes}-byte cap",
            hint="Package fewer or smaller sources, or raise the documented cap.",
        )
    return path


def _validate_archive_url(url: str) -> str:
    """Return *url* unchanged, or raise ``ArchiveSourceError`` for a policy breach.

    ``https`` is accepted for any host; ``http`` is accepted only towards loopback,
    so a local mirror or test server still works. Any other scheme (``file:``,
    ``ftp:``, ``data:``) and any URL without a hostname are refused with
    ``archive-url-invalid``. Every redirect hop is re-validated by the opener, so a
    hop can never downgrade to plain ``http`` on a public host.
    """

    parts = urlsplit(url)
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https"):
        raise ArchiveSourceError(
            CODE_ARCHIVE_URL_INVALID,
            f"archive URL scheme {scheme!r} is not supported",
            hint="Use an https:// URL, or a path instead.",
        )
    if not parts.hostname:
        raise ArchiveSourceError(
            CODE_ARCHIVE_URL_INVALID,
            "archive URL is missing a hostname",
            hint="Use an https:// URL, or a path instead.",
        )
    if scheme == "http" and not is_loopback_host(parts.hostname):
        raise ArchiveSourceError(
            CODE_ARCHIVE_URL_BLOCKED,
            f"archive URL {url!r} uses http towards a non-loopback host",
            hint="Use an https:// URL for anything that is not this machine.",
        )
    return url


class _RedirectPolicy(urllib.request.HTTPRedirectHandler):
    """Redirect handler that re-validates every hop and caps the hop count.

    Each ``Location`` target is passed through :func:`_validate_archive_url` before
    it is followed, so a chain that starts at a loopback ``http`` mirror can never
    hop to a public ``http`` host. The hop budget is :data:`ARCHIVE_URL_MAX_REDIRECTS`,
    and the refusal names that budget instead of an HTTP status.
    """

    def __init__(self) -> None:
        """Initialise the parent and reset the per-download hop counter."""

        super().__init__()
        self._hops = 0

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        """Validate *newurl*, then refuse once the redirect budget is exhausted.

        The hop count lives on the handler instance because ``urllib`` only records
        ``redirect_dict`` on the *next* request after this method returns, so it is
        not readable here on the first hop.
        """

        _validate_archive_url(newurl)
        self._hops += 1
        if self._hops > ARCHIVE_URL_MAX_REDIRECTS:
            raise ArchiveSourceError(
                CODE_ARCHIVE_URL_REDIRECT,
                f"archive URL redirects more than {ARCHIVE_URL_MAX_REDIRECTS} times",
                hint="shorten the redirect chain, or point at the final URL directly.",
            )
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download_archive(url: str, destination: Path, *, max_bytes: int) -> int:
    """Download *url* into *destination* and return the byte count.

    The body is streamed in :data:`ARCHIVE_URL_CHUNK_BYTES` chunks with a running
    byte counter that aborts at *max_bytes* (the cap costs at most one chunk over
    budget). The partial file is unlinked on any failure, and ``HTTPError`` /
    ``URLError`` / ``TimeoutError`` are mapped to ``archive-url-unreachable`` with
    the underlying message.
    """

    url = _validate_archive_url(url)
    opener = urllib.request.build_opener(_RedirectPolicy())
    request = urllib.request.Request(url)
    total = 0
    try:
        with opener.open(request, timeout=ARCHIVE_URL_TIMEOUT_SECONDS) as response:
            with destination.open("wb") as handle:
                while True:
                    chunk = response.read(ARCHIVE_URL_CHUNK_BYTES)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > max_bytes:
                        raise ArchiveSourceError(
                            CODE_ARCHIVE_URL_TOO_LARGE,
                            f"archive URL {url!r} exceeds the {max_bytes}-byte cap",
                            hint="Package fewer or smaller sources, or raise the documented cap.",
                        )
                    handle.write(chunk)
    except ArchiveSourceError:
        _unlink_quietly(destination)
        raise
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as error:
        _unlink_quietly(destination)
        raise ArchiveSourceError(
            CODE_ARCHIVE_URL_UNREACHABLE,
            f"archive URL {url!r} could not be fetched: {error}",
            hint="check the URL, and that the server can reach it.",
        ) from error
    return total


def _unlink_quietly(path: Path) -> None:
    """Remove *path* if it exists, swallowing any ``OSError``."""

    try:
        path.unlink()
    except OSError:
        pass



@contextmanager
def resolve_archive_source(
    *,
    path: str | None,
    url: str | None,
    max_bytes: int,
    label: str,
    suffixes: tuple[str, ...] = DEFAULT_ARCHIVE_SUFFIXES,
) -> Iterator[Path]:
    """Yield one local archive file for exactly one of *path* / *url*.

    Exactly one of *path* / *url* must be set; both or neither is a programming
    error and raises ``ValueError`` (the WebSocket frames validate the wire with
    ``invalid-frame`` and the CLI validates its own flags, so this module needs no
    wire-specific code for it). *suffixes* names the accepted file suffixes for the
    path branch and, for the URL branch, the first entry is used as the temporary
    file suffix; an empty tuple or any entry without a leading dot raises
    ``ValueError``.

    Ownership rule: for *path* the caller owns the file and nothing is deleted; for
    *url* a temp file is created, yielded, and unlinked in a ``finally`` block, so
    the yielded path is only valid inside the ``with`` block.
    """

    if (path is None) == (url is None):
        raise ValueError("exactly one of 'path' or 'url' is required")
    if not suffixes or any(not entry.startswith(".") for entry in suffixes):
        raise ValueError("'suffixes' must be a non-empty tuple of dot-prefixed strings")
    if path is not None:
        yield _resolve_local_archive(
            path, max_bytes=max_bytes, label=label, suffixes=suffixes
        )
        return

    handle = tempfile.NamedTemporaryFile(
        prefix=f"mo-{label}-", suffix=suffixes[0], delete=False
    )
    handle.close()
    archive_path = Path(handle.name)
    try:
        download_archive(url, archive_path, max_bytes=max_bytes)  # type: ignore[arg-type]
        yield archive_path
    finally:
        _unlink_quietly(archive_path)


def package_addon_source(
    package_dir: Path,
    destination: Path | None = None,
    *,
    force: bool = False,
) -> Path:
    """Package a validated add-on directory into a reproducible ``.zip``.

    *package_dir* must be a directory containing ``manifest.json``. Tree validation
    stays in :func:`micro_otter.tools.addon_archive.validate_addon_tree`, which the
    CLI runs first; this function never re-implements a manifest rule. *destination*
    defaults to ``<package_dir>.zip`` next to the directory. An existing destination
    raises ``FileExistsError`` unless *force* is set.

    Every member is stored under ``<package_dir.name>/``, so the archive unpacks to a
    single package folder with ``<folder>/manifest.json`` at its top. That is the only
    layout the installer accepts without ``--as``, and the layout ``addon.install``
    needs because its frame carries no ``as`` field — it also matches what a plain
    ``zip -r <folder>.zip <folder>`` produces, so the two are interchangeable.

    The archive is reproducible: members are written in sorted relative-POSIX order,
    every member gets a fixed ``1980-01-01`` timestamp and ``0o644`` mode, so two
    runs over the same tree produce byte-identical archives. Editor/OS cache names
    (:data:`PACKAGE_IGNORED_NAMES`) are skipped here only; the installer still takes
    an archive exactly as it is.
    """

    package_dir = Path(package_dir).resolve()
    if not package_dir.is_dir() or not (package_dir / "manifest.json").is_file():
        raise ArchiveSourceError(
            CODE_ARCHIVE_PATH_INVALID,
            f"{package_dir} is not a package directory holding manifest.json",
            hint="Point at a package directory that holds manifest.json.",
        )
    destination = (destination or package_dir.parent / f"{package_dir.name}.zip").resolve()
    if destination.exists() and not force:
        raise FileExistsError(f"{destination} already exists")

    prefix = package_dir.name
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
        for member in sorted(package_dir.rglob("*")):
            if not member.is_file():
                continue
            relative = member.relative_to(package_dir)
            if any(part in PACKAGE_IGNORED_NAMES for part in relative.parts):
                continue
            arcname = f"{prefix}/{relative.as_posix()}"
            info = zipfile.ZipInfo(arcname, date_time=(1980, 1, 1, 0, 0, 0))
            info.external_attr = 0o644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, member.read_bytes())
    return destination


"""The ``webapp-build.json`` manifest: one description of exactly what a hosted build wrote.

``mo webapp build`` writes it **last**, so its ``files`` list describes the finished tree, and it
never lists itself. ``mo webapp upload`` reads it back to decide what to transfer and to verify the
result, so the schema, the reader and the validator live here and neither command re-implements
them.

The document is serialised with ``indent=2, sort_keys=True`` and a trailing newline, and its
``builtAt`` honours ``SOURCE_DATE_EPOCH`` (the same rule ``tools/make_release_index.py`` uses), so
two builds of the same bytes can be byte-identical.
"""

from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from micro_otter.tools.webapp_errors import WebappError

MANIFEST_NAME = "webapp-build.json"
"""File name of the manifest inside the build output directory."""

MANIFEST_SCHEMA = "webapp-build/v1"
"""Schema token of the document shape this module writes and validates."""

_HEX_DIGITS = set("0123456789abcdef")
"""Alphabet of a lowercase SHA-256 hex digest."""

_READ_CHUNK_BYTES = 1024 * 1024
"""Bytes read per step while hashing a file, so a large image never lands in memory at once."""


def sha256_file(path: Path) -> str:
    """Return the hex SHA-256 of the bytes at *path*."""

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(_READ_CHUNK_BYTES), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_built_at(*, now: datetime | None = None) -> datetime:
    """Return the instant the build is stamped with, in UTC.

    ``SOURCE_DATE_EPOCH`` wins when it is set and parses as an integer (the reproducibility rule of
    :mod:`tools.make_release_index`); anything else falls back to *now*, or to the current time.
    """

    epoch = os.environ.get("SOURCE_DATE_EPOCH", "").strip()
    if epoch:
        try:
            return datetime.fromtimestamp(int(epoch), tz=UTC)
        except (OverflowError, OSError, ValueError):
            pass
    return (now or datetime.now(tz=UTC)).astimezone(UTC)


def _format_built_at(moment: datetime) -> str:
    """Render *moment* as ISO-8601 UTC with seconds precision and a ``Z`` suffix."""

    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def payload(
    app_version: str,
    *,
    hosted: bool,
    public_url: str | None,
    firmware_page: dict[str, Any] | None,
    files: list[dict[str, Any]],
    built_at: datetime | None = None,
) -> dict[str, Any]:
    """Build the manifest document.

    Args:
        app_version: Version from ``html/version.json``; the value the host serves.
        hosted: Whether the bundle carries the hosted build mode.
        public_url: Root URL the bundle will be served from, or ``None`` when not stated.
        firmware_page: ``{"path", "entryCount", "indexSha256"}`` when a page was rendered.
        files: Entries from :func:`collect_files`.
        built_at: Stamp to record; defaults to :func:`resolve_built_at`.

    Returns:
        The document :func:`write_manifest` serialises.
    """

    return {
        "schemaVersion": MANIFEST_SCHEMA,
        "appVersion": app_version,
        "hosted": bool(hosted),
        "builtAt": _format_built_at(built_at or resolve_built_at()),
        "publicUrl": public_url,
        "firmwarePage": firmware_page,
        "files": files,
    }


def collect_files(
    out_dir: Path, *, exclude: Iterable[str] = (MANIFEST_NAME,)
) -> list[dict[str, Any]]:
    """Describe every file under *out_dir* with its POSIX path, size and SHA-256.

    Entries are sorted by path so two runs over the same tree serialise identically. *exclude* holds
    POSIX-relative names to skip — the manifest itself by default, which is why the document never
    lists its own path.

    Raises:
        WebappError: ``webapp-build-failed`` for a broken symlink, which has no bytes to hash.
    """

    excluded = {str(name).replace(os.sep, "/") for name in exclude}
    collected: list[tuple[str, Path]] = []
    for path in out_dir.rglob("*"):
        relative = path.relative_to(out_dir).as_posix()
        if path.is_symlink() and not path.exists():
            raise WebappError(
                "webapp-build-failed",
                f"broken symlink in the build output: {relative}",
                hint="remove the link and re-run the build",
            )
        if not path.is_file() or relative in excluded:
            continue
        collected.append((relative, path))
    # Sorted by the POSIX path string, not by `Path`: `Path` orders parts, so `a.b` and `a/b`
    # would come out in a different order than the manifest claims to use.
    return [
        {"path": relative, "size": path.stat().st_size, "sha256": sha256_file(path)}
        for relative, path in sorted(collected)
    ]


def write_manifest(out_dir: Path, payload: dict[str, Any]) -> Path:
    """Write *payload* as ``webapp-build.json`` in *out_dir* and return its path."""

    path = out_dir / MANIFEST_NAME
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return path


def read_manifest(path: Path) -> dict[str, Any]:
    """Read a manifest without validating it.

    Raises:
        WebappError: ``webapp-upload-manifest-invalid`` when the file is missing, unreadable or not
            a JSON object.
    """

    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise WebappError(
            "webapp-upload-manifest-invalid",
            f"{path} does not exist",
            hint="run `mo webapp build` in this directory first",
        ) from error
    except (OSError, UnicodeDecodeError) as error:
        raise WebappError(
            "webapp-upload-manifest-invalid",
            f"{path} cannot be read: {error}",
            hint="run `mo webapp build` again to rewrite the manifest",
        ) from error
    except json.JSONDecodeError as error:
        raise WebappError(
            "webapp-upload-manifest-invalid",
            f"{path} is not valid JSON: {error.msg} at line {error.lineno}",
            hint="run `mo webapp build` again to rewrite the manifest",
        ) from error

    if not isinstance(document, dict):
        raise WebappError(
            "webapp-upload-manifest-invalid",
            f"{path} does not contain a JSON object",
            hint="run `mo webapp build` again to rewrite the manifest",
        )
    return document


def _manifest_error(code: str, message: str) -> WebappError:
    """Return a manifest-validation failure carrying the caller's *code*."""

    return WebappError(
        code,
        message,
        hint="run `mo webapp build` again to rewrite the manifest",
    )


def _validate_file_entry(entry: Any, code: str) -> str:
    """Validate one ``files`` entry and return its path."""

    if not isinstance(entry, dict):
        raise _manifest_error(code, "every files entry must be an object")
    path = entry.get("path")
    if not isinstance(path, str) or not path.strip():
        raise _manifest_error(code, "every files entry needs a non-empty path")
    if path.startswith("/") or "\\" in path or ".." in path.split("/"):
        raise _manifest_error(code, f"files path {path!r} must be a relative POSIX path")
    size = entry.get("size")
    if isinstance(size, bool) or not isinstance(size, int) or size < 0:
        raise _manifest_error(code, f"files path {path!r} needs a non-negative integer size")
    digest = entry.get("sha256")
    if not isinstance(digest, str) or len(digest) != 64 or not set(digest) <= _HEX_DIGITS:
        raise _manifest_error(
            code, f"files path {path!r} needs a lowercase 64-character sha256"
        )
    return path


def validate_manifest(payload: Any, *, code: str = "webapp-upload-manifest-invalid") -> None:
    """Validate a manifest document, raising ``WebappError(code, …)`` on the first problem.

    The schema token, ``appVersion``, a non-empty ``files`` list, unique relative POSIX paths,
    lowercase 64-hex hashes and non-negative sizes are enforced; ``publicUrl`` and
    ``firmwarePage`` may be ``None`` and are only type-checked when present.

    Args:
        payload: The document to check, typically from :func:`read_manifest`.
        code: Error code to raise with; ``mo webapp build`` passes a ``webapp-build-*`` token and
            ``mo webapp upload`` keeps the default.
    """

    if not isinstance(payload, dict):
        raise _manifest_error(code, "the manifest must be a JSON object")

    schema = payload.get("schemaVersion")
    if schema != MANIFEST_SCHEMA:
        raise _manifest_error(
            code, f"schemaVersion is {schema!r}; expected {MANIFEST_SCHEMA!r}"
        )

    app_version = payload.get("appVersion")
    if not isinstance(app_version, str) or not app_version.strip():
        raise _manifest_error(code, "appVersion must be a non-empty string")

    if not isinstance(payload.get("hosted"), bool):
        raise _manifest_error(code, "hosted must be true or false")

    public_url = payload.get("publicUrl")
    if public_url is not None and not isinstance(public_url, str):
        raise _manifest_error(code, "publicUrl must be a string or null")

    firmware_page = payload.get("firmwarePage")
    if firmware_page is not None and not (
        isinstance(firmware_page, dict)
        and isinstance(firmware_page.get("path"), str)
        and isinstance(firmware_page.get("entryCount"), int)
        and not isinstance(firmware_page.get("entryCount"), bool)
        and isinstance(firmware_page.get("indexSha256"), str)
    ):
        raise _manifest_error(
            code, "firmwarePage must be null or carry path, entryCount and indexSha256"
        )

    files = payload.get("files")
    if not isinstance(files, list) or not files:
        raise _manifest_error(code, "files must be a non-empty list")

    seen: set[str] = set()
    for entry in files:
        path = _validate_file_entry(entry, code)
        if path in seen:
            raise _manifest_error(code, f"files lists {path!r} twice")
        seen.add(path)


__all__ = [
    "MANIFEST_NAME",
    "MANIFEST_SCHEMA",
    "collect_files",
    "sha256_file",
    "payload",
    "read_manifest",
    "resolve_built_at",
    "validate_manifest",
    "write_manifest",
]

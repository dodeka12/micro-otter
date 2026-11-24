# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
"""Filesystem **reads** for the server-side file picker and one write-target *validation*.

Nothing here writes, creates, or deletes. :func:`list_directory` answers the
``fs.list`` side channel so a browser can browse the machine the server runs on,
and :func:`validate_destination_directory` is the only write-target rule the
``firmware.export`` job applies. Every refusal is a stable ``fs-*`` code.
"""

from __future__ import annotations

import os
from collections.abc import Sequence
from pathlib import Path

__all__ = (
    "CODE_FS_NOT_ALLOWED",
    "FS_MAX_ENTRIES",
    "LOCAL_FILE_ERROR_CODES",
    "LocalFileError",
    "default_start_directory",
    "known_roots",
    "list_directory",
    "validate_destination_directory",
)

FS_MAX_ENTRIES = 2000
"""The cap that turns an enormous directory into one honest error instead of a frame."""

CODE_FS_NOT_ALLOWED = "fs-not-allowed"
CODE_FS_PATH_INVALID = "fs-path-invalid"
CODE_FS_NOT_FOUND = "fs-not-found"
CODE_FS_NOT_A_DIRECTORY = "fs-not-a-directory"
CODE_FS_PERMISSION_DENIED = "fs-permission-denied"
CODE_FS_TOO_MANY_ENTRIES = "fs-too-many-entries"
CODE_FS_NOT_WRITABLE = "fs-not-writable"
CODE_FS_DESTINATION_NOT_ABSOLUTE = "fs-destination-not-absolute"

LOCAL_FILE_ERROR_CODES: tuple[str, ...] = (
    CODE_FS_NOT_ALLOWED,
    CODE_FS_PATH_INVALID,
    CODE_FS_NOT_FOUND,
    CODE_FS_NOT_A_DIRECTORY,
    CODE_FS_PERMISSION_DENIED,
    CODE_FS_TOO_MANY_ENTRIES,
    CODE_FS_NOT_WRITABLE,
    CODE_FS_DESTINATION_NOT_ABSOLUTE,
)
"""Every stable code :class:`LocalFileError` can raise.

``fs-not-allowed`` is raised by the WebSocket handler (not by this module) but is
listed here so the contract table has one source for the whole family.
"""


class LocalFileError(RuntimeError):
    """One filesystem listing or destination validation failed, with a stable code.

    Mirrors :class:`micro_otter.tools.addon_archive.AddonInstallError` so the server
    serialises this family identically: ``code`` is stable and ``hint`` names the
    next action.
    """

    def __init__(self, code: str, message: str, *, hint: str | None = None) -> None:
        """Store the stable *code*, the human-readable *message*, and the optional *hint*."""

        super().__init__(message)
        self.code = code
        self.hint = hint


def default_start_directory() -> Path:
    """Return the picker's first location: the user's home directory."""

    return Path.home()


def known_roots() -> tuple[dict[str, str], ...]:
    """Return the picker's shortcut roots, de-duplicated by resolved path.

    ``("home", Path.home())``, ``("workspace", Path.cwd())``, and
    ``("root", Path.home().anchor)`` are emitted as ``{"id": ..., "path": str}`` so
    the dialog can offer shortcuts without guessing a label — the view translates
    the ``id``.
    """

    seen: list[Path] = []
    roots: list[dict[str, str]] = []
    for root_id, path in (
        ("home", Path.home()),
        ("workspace", Path.cwd()),
        ("root", Path(Path.home().anchor)),
    ):
        resolved = path.resolve()
        if any(resolved == prior for prior in seen):
            continue
        seen.append(resolved)
        roots.append({"id": root_id, "path": str(resolved)})
    return tuple(roots)


def _is_hidden(name: str) -> bool:
    """Return whether *name* is a dot-file (``.git``, ``.dotfiles``, ...)."""

    return name.startswith(".")


def list_directory(
    *,
    path: str,
    extensions: Sequence[str] = (),
    show_hidden: bool = False,
) -> dict[str, object]:
    """Return one directory listing as ``{path, parent, entries}``.

    *path* must be absolute (``fs-path-invalid``). A missing path, a non-directory,
    and an unreadable directory raise ``fs-not-found`` / ``fs-not-a-directory`` /
    ``fs-permission-denied`` respectively. Entries are ``{"name", "path", "kind",
    "sizeBytes", "modifiedAt"}`` where **any** symlink is ``kind: "symlink"`` (never
    enterable and never selectable, so no listing can walk outside what it shows),
    directories come first and each group is ordered case-insensitively by name.
    Hidden names are dropped unless *show_hidden*. Files are filtered by
    *extensions* (case-insensitive suffix; an empty sequence means every file).
    More than :data:`FS_MAX_ENTRIES` matches raises ``fs-too-many-entries``.
    """

    raw = Path(path)
    if not raw.is_absolute():
        raise LocalFileError(
            CODE_FS_PATH_INVALID,
            f"listing path {raw!s} must be absolute",
            hint="pass an absolute path returned by a previous listing or a root.",
        )
    resolved = raw.resolve()
    if not resolved.exists():
        raise LocalFileError(
            CODE_FS_NOT_FOUND, f"{resolved} does not exist", hint="pick another directory."
        )
    if not resolved.is_dir():
        raise LocalFileError(
            CODE_FS_NOT_A_DIRECTORY,
            f"{resolved} is not a directory",
            hint="pick a directory, not a file.",
        )

    extension_set = {ext.lower() for ext in extensions}
    entries: list[dict[str, object]] = []
    try:
        candidates = list(resolved.iterdir())
    except PermissionError as error:
        raise LocalFileError(
            CODE_FS_PERMISSION_DENIED,
            f"cannot read {resolved}",
            hint="pick a directory the server process may read.",
        ) from error

    def _matches(name: str, is_dir: bool) -> bool:
        if not show_hidden and _is_hidden(name):
            return False
        if is_dir:
            return True
        if not extension_set:
            return True
        return Path(name).suffix.lower() in extension_set

    for member in candidates:
        is_symlink = member.is_symlink()
        is_dir = member.is_dir() and not is_symlink
        if not _matches(member.name, is_dir):
            continue
        if is_symlink:
            kind = "symlink"
            size_bytes: int | None = None
        elif is_dir:
            kind = "directory"
            size_bytes = None
        else:
            kind = "file"
            try:
                size_bytes = member.stat().st_size
            except OSError:
                size_bytes = None
        try:
            modified_at = member.stat().st_mtime
        except OSError:
            modified_at = None
        entries.append(
            {
                "name": member.name,
                "path": str(member),
                "kind": kind,
                "sizeBytes": size_bytes,
                "modifiedAt": f"{modified_at:.6f}" if modified_at is not None else None,
            }
        )

    if len(entries) > FS_MAX_ENTRIES:
        raise LocalFileError(
            CODE_FS_TOO_MANY_ENTRIES,
            f"{resolved} has more than {FS_MAX_ENTRIES} matching entries",
            hint="narrow the listing, or open a subfolder.",
        )

    entries.sort(key=lambda entry: (entry["kind"] != "directory", str(entry["name"]).lower()))
    parent = None if resolved.parent == resolved else resolved.parent
    return {
        "path": str(resolved),
        "parent": str(parent) if parent is not None else None,
        "entries": entries,
    }


def validate_destination_directory(path: str) -> Path:
    """Validate and return *path* as a writable destination directory.

    The directory must be absolute (``fs-destination-not-absolute``), exist
    (``fs-not-found``), be a real directory — not a symlink — (``fs-not-a-directory``),
    and be writable (``fs-not-writable``). This is export's only write-target rule.
    """

    raw = Path(path)
    if not raw.is_absolute():
        raise LocalFileError(
            CODE_FS_DESTINATION_NOT_ABSOLUTE,
            f"destination {raw!s} must be an absolute directory",
            hint="pick an absolute folder through the file picker.",
        )
    if raw.is_symlink():
        raise LocalFileError(
            CODE_FS_NOT_A_DIRECTORY,
            f"{raw} is not a real directory",
            hint="pick a real folder, not a symlink or a file.",
        )
    resolved = raw.resolve()
    if not resolved.exists():
        raise LocalFileError(
            CODE_FS_NOT_FOUND, f"{resolved} does not exist", hint="pick another folder."
        )
    if not resolved.is_dir():
        raise LocalFileError(
            CODE_FS_NOT_A_DIRECTORY,
            f"{resolved} is not a real directory",
            hint="pick a real folder, not a symlink or a file.",
        )
    if not os.access(resolved, os.W_OK):
        raise LocalFileError(
            CODE_FS_NOT_WRITABLE,
            f"{resolved} is not writable",
            hint="pick a folder the server process may write.",
        )
    return resolved


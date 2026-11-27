#!/usr/bin/env python3
# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
"""Generate the release-asset index and the GitHub Release body for one firmware release.

A firmware release ships one paired artifact set per board — the exported
``<stem>.firmware.zip`` (recommended: it keeps the firmware identity and the package
inventory) and the raw ``<stem>.bin`` (fallback) — plus the ``<stem>.manifest.json``
sidecar each image was built with. This script turns a directory of those files into
the two descriptions the release page needs:

* ``index.json`` — absolute asset URLs, SHA-256 and size measured from the bytes on
  disk, board slug, chip, flash offset, MicroPython version and the embedded package
  list, ordered deterministically.
* ``release-notes.md`` — the Markdown body of the GitHub Release, built from the same
  in-memory document, so the table, the checksums and the URLs can never disagree.

Nothing in ``src/micro_otter/`` reads either file: they are build output of the
maintainer's machine. Importing an image keeps using the paths that already exist —
the Firmware tab's **Import** / **Import from URL…** dialogs, or ``mo fw import``.

Exit codes: ``0`` success (and a clean ``--check``), ``1`` ``--check`` drift, ``2``
invalid input. Every failure carries a stable ``release-index-*`` code.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from micro_otter import __version__
from micro_otter.tools.firmware_compile.board_registry import (
    BOARD_CATALOG_DEFAULT_PATH,
    BoardSpec,
    find_board_by_slug,
    load_board_catalog,
)
from micro_otter.tools.firmware_compile.firmware_inventory import (
    FirmwareInventoryEntry,
    list_firmware_inventory,
)
from micro_otter.tools.firmware_compile.firmware_package import PACKAGE_SUFFIX
from micro_otter.tools.firmware_compile.version_identity import firmware_version_sort_key
from micro_otter.tools.firmware_compile.version_registry import (
    RELEASE_MANIFEST_DEFAULT_PATH,
    ReleaseManifest,
    load_release_manifest,
)

INDEX_SCHEMA_VERSION = 1
"""Version of the ``index.json`` document shape this script writes."""

INDEX_FILENAME = "index.json"
"""Default name of the generated document inside the release directory."""

NOTES_FILENAME = "release-notes.md"
"""Default name of the generated release body inside the release directory."""

_DOCUMENT_KEYS = frozenset({"schemaVersion", "generatedAt", "generatedBy", "release", "firmware"})
"""Exactly the root keys an ``index.json`` document may carry."""

_ENTRY_KEYS = frozenset(
    {
        "board",
        "boardName",
        "chip",
        "flashOffset",
        "runtime",
        "version",
        "channel",
        "micropythonVersion",
        "sha256",
        "size",
        "url",
        "package",
        "includedPackages",
    }
)
"""Exactly the keys one ``firmware`` entry may carry."""

_PACKAGE_KEYS = frozenset({"sha256", "size", "url"})
"""Exactly the keys a ``package`` object may carry."""

CODE_EMPTY = "release-index-empty"
"""Code for a missing or image-less release directory."""

CODE_BASE_URL_INVALID = "release-index-base-url-invalid"
"""Code for a ``--base-url`` that is not an absolute ``https://`` URL."""

CODE_ARTIFACT_INVALID = "release-index-artifact-invalid"
"""Code for an image without a complete identity or a published-firmware name."""

CODE_CHANNEL_MISMATCH = "release-index-channel-mismatch"
"""Code for an image whose channel is not the requested one (e.g. a dev build)."""

CODE_VERSION_MISMATCH = "release-index-version-mismatch"
"""Code for an image whose runtime firmware version is not ``release.json``'s."""

CODE_ORPHAN = "release-index-orphan"
"""Code for a ``.bin`` without its ``.firmware.zip``, or the reverse."""

CODE_BOARD_UNKNOWN = "release-index-board-unknown"
"""Code for an image whose board slug is not in the board catalog."""

CODE_DRIFT = "release-index-drift"
"""Code for a ``--check`` run whose files differ from a fresh regeneration."""


class ReleaseIndexError(RuntimeError):
    """Structured release-index failure.

    Mirrors :class:`...firmware_package.FirmwarePackageError` so a caller can print
    the same ``code`` / ``hint`` / ``details`` shape: ``code`` is stable, ``exit_code``
    maps to the process code, and ``hint`` carries the remediation.
    """

    def __init__(
        self,
        message: str,
        *,
        code: str,
        hint: str | None = None,
        details: dict[str, Any] | None = None,
        exit_code: int = 2,
    ) -> None:
        """Record the message plus the code, hint, details, and exit category."""

        super().__init__(message)
        self.code = code
        self.message = message
        self.hint = hint
        self.details = details
        self.exit_code = exit_code


def _asset_url(base_url: str, filename: str) -> str:
    """Return the absolute URL of *filename* under *base_url*."""

    return f"{base_url}/{filename}"


def _release_zip_paths(release_dir: Path) -> dict[str, Path]:
    """Return ``image stem -> package path`` for every ``.firmware.zip`` in *release_dir*.

    The exporter names a package after its image stem, so stripping
    :data:`...firmware_package.PACKAGE_SUFFIX` from the archive name recovers the image
    it belongs to.
    """

    packages: dict[str, Path] = {}
    for path in sorted(release_dir.iterdir()):
        if not path.is_file() or not path.name.endswith(PACKAGE_SUFFIX):
            continue
        packages[path.name[: -len(PACKAGE_SUFFIX)]] = path
    return packages


def _require_paired_artifacts(
    entries: Sequence[FirmwareInventoryEntry],
    packages: dict[str, Path],
    release_dir: Path,
) -> dict[str, Path]:
    """Return ``image stem -> package path`` and refuse an unpaired artifact set.

    A release ships both the ``.firmware.zip`` and the ``.bin`` for every board; a set
    missing one of them is worse than no index at all, because the reader cannot tell
    whether the package or the image is the authoritative artifact.
    """

    entry_stems = {entry.path.stem for entry in entries}
    for stem, package in packages.items():
        if stem not in entry_stems:
            raise ReleaseIndexError(
                f"{package.name} has no matching published .bin image",
                code=CODE_ORPHAN,
                hint=(
                    "the package name must equal <stem>.firmware.zip for a <stem>.bin in the "
                    "same directory; re-export with `mo fw export --output-dir <dir>`"
                ),
                details={"file": package.name, "directory": str(release_dir)},
            )

    paired: dict[str, Path] = {}
    for entry in entries:
        package = packages.get(entry.path.stem)
        if package is None:
            raise ReleaseIndexError(
                f"{entry.filename} has no sibling {entry.path.stem}{PACKAGE_SUFFIX}",
                code=CODE_ORPHAN,
                hint=(
                    "export the package with `mo fw export <version> --board <slug> "
                    "--output-dir <dir>` and keep both artifacts in the release directory"
                ),
                details={"file": entry.filename, "directory": str(release_dir)},
            )
        paired[entry.path.stem] = package
    return paired


def _entry_document(
    entry: FirmwareInventoryEntry,
    *,
    board: BoardSpec,
    package: Path,
    base_url: str,
) -> dict[str, Any]:
    """Return the ``firmware`` entry for one image, hashing both artifacts on disk.

    The hashes and sizes come from the files themselves, never from the sidecar: the
    sidecar describes what was built, while the release must describe what is uploaded.
    """

    return {
        "board": entry.board_id,
        "boardName": board.display_name,
        "chip": board.chip or "",
        "flashOffset": board.flash_params.get("offset", ""),
        "runtime": entry.runtime_id,
        "version": entry.runtime_firmware_version,
        "channel": entry.channel,
        "micropythonVersion": entry.micropython_version,
        "sha256": _sha256(entry.path),
        "size": entry.path.stat().st_size,
        "url": _asset_url(base_url, entry.filename),
        "package": {
            "sha256": _sha256(package),
            "size": package.stat().st_size,
            "url": _asset_url(base_url, package.name),
        },
        "includedPackages": _included_packages(entry),
    }


def _validate_document(document: dict[str, Any]) -> None:
    """Refuse a document whose key set drifted from the developer page.

    The shape is stated as data (:data:`_DOCUMENT_KEYS`, :data:`_ENTRY_KEYS`,
    :data:`_PACKAGE_KEYS`) so the generator and
    ``docs/dev/firmware-compile/firmware-index.md`` cannot disagree: adding a field is a
    deliberate edit to both.
    """

    if set(document) != _DOCUMENT_KEYS:
        raise ReleaseIndexError(
            f"index document keys drifted: {sorted(set(document) ^ _DOCUMENT_KEYS)!r}",
            code=CODE_ARTIFACT_INVALID,
            hint="update _DOCUMENT_KEYS and docs/dev/firmware-compile/firmware-index.md together",
        )
    for entry in document["firmware"]:
        if set(entry) != _ENTRY_KEYS:
            raise ReleaseIndexError(
                f"firmware entry keys drifted: {sorted(set(entry) ^ _ENTRY_KEYS)!r}",
                code=CODE_ARTIFACT_INVALID,
                hint="update _ENTRY_KEYS and docs/dev/firmware-compile/firmware-index.md together",
            )
        if set(entry["package"]) != _PACKAGE_KEYS:
            raise ReleaseIndexError(
                f"package keys drifted: {sorted(set(entry['package']) ^ _PACKAGE_KEYS)!r}",
                code=CODE_ARTIFACT_INVALID,
                hint="update _PACKAGE_KEYS and docs/dev/firmware-compile/firmware-index.md",
            )


def _sha256(path: Path) -> str:
    """Return the SHA-256 hex digest of the file at *path*.

    Args:
        path: File to hash.

    Returns:
        The lowercase hexadecimal digest of the file's bytes.
    """

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _generated_at() -> str:
    """Return the ``generatedAt`` instant as an ISO-8601 UTC string with a ``Z``.

    ``SOURCE_DATE_EPOCH`` wins when it is set and parses as an integer, which is what
    makes two runs over the same bytes produce a byte-identical document (the value
    the plan's determinism test pins). Otherwise the current UTC time is used.
    """

    raw = os.environ.get("SOURCE_DATE_EPOCH", "").strip()
    if raw:
        try:
            moment = datetime.fromtimestamp(int(raw), tz=UTC)
        except (ValueError, OverflowError, OSError):
            moment = datetime.now(UTC)
    else:
        moment = datetime.now(UTC)
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def _human_size(size: int) -> str:
    """Return *size* in bytes as a short human-readable string (``1.4 MB``).

    Args:
        size: Byte count of an artifact.

    Returns:
        A decimal string with one fractional digit above 1 KiB, bytes below that.
    """

    value = float(size)
    for unit in ("B", "KiB", "MiB"):
        if value < 1024 or unit == "MiB":
            return f"{value:.0f} {unit}" if unit == "B" else f"{value:.1f} {unit}"
        value /= 1024
    return f"{value:.1f} MiB"


def _normalize_base_url(base_url: str) -> str:
    """Return *base_url* without trailing slashes, or raise ``base-url-invalid``.

    Only an absolute ``https://`` prefix is accepted: the release page serves assets
    over TLS, and a relative base is exactly the "bare file names that resolve to
    nothing" case the required flag exists to prevent.
    """

    normalized = (base_url or "").strip().rstrip("/")
    if not normalized.startswith("https://") or len(normalized) <= len("https://"):
        raise ReleaseIndexError(
            f"--base-url must be an absolute https:// URL; got {base_url!r}",
            code=CODE_BASE_URL_INVALID,
            hint=(
                "pass the folder the assets will be published under, e.g. "
                "https://github.com/<owner>/micro-otter/releases/download/firmware-v1.0.0"
            ),
        )
    return normalized


def _included_packages(entry: FirmwareInventoryEntry) -> dict[str, str]:
    """Return the entry's embedded and add-on packages keyed by package id.

    Add-on packages win a key collision: an add-on package frozen into the image
    describes the version actually present, while ``embeddedPackages`` records the
    platform package it was layered on.
    """

    combined = dict(entry.embedded_packages)
    combined.update(entry.addon_packages)
    return dict(sorted(combined.items()))


def _require_entry_identity(entry: FirmwareInventoryEntry) -> None:
    """Raise when *entry* is not a published image with a complete identity.

    A missing sidecar (or a v1 one) leaves ``identity_complete`` false and the content
    hash absent; such a file cannot be described in a release, because the index would
    advertise an image whose board, runtime and package list are unknown.
    """

    if not entry.identity_complete or not entry.content_hash:
        raise ReleaseIndexError(
            f"{entry.filename} has no complete firmware identity",
            code=CODE_ARTIFACT_INVALID,
            hint=(
                "publish a v2/v3 <stem>.manifest.json sidecar next to the image "
                "(mo compile-runtime writes one); a bare imported .bin cannot be released"
            ),
            details={"file": entry.filename, "hasManifest": entry.has_manifest},
        )


def _require_requested_channel(entry: FirmwareInventoryEntry, channel: str) -> None:
    """Raise when *entry* does not belong to *channel* (a dev build in a release run)."""

    if entry.channel != channel:
        raise ReleaseIndexError(
            f"{entry.filename} is on channel {entry.channel!r}, not {channel!r}",
            code=CODE_CHANNEL_MISMATCH,
            hint=(
                "a -dev.<n>.g<sha> version means the image was built from a development "
                "checkout; rebuild it from the release commit"
            ),
            details={"file": entry.filename, "channel": entry.channel, "expected": channel},
        )


def _require_release_version(entry: FirmwareInventoryEntry, release: ReleaseManifest) -> None:
    """Raise when *entry*'s runtime firmware version is not ``release.json``'s version."""

    if entry.runtime_firmware_version != release.release_version:
        raise ReleaseIndexError(
            f"{entry.filename} is version {entry.runtime_firmware_version!r}, "
            f"not {release.release_version!r} from release.json",
            code=CODE_VERSION_MISMATCH,
            hint="bump release.json and rebuild, or export images of the released version",
            details={
                "file": entry.filename,
                "version": entry.runtime_firmware_version,
                "expected": release.release_version,
            },
        )


def _load_release_manifest(path: Path) -> ReleaseManifest:
    """Return the validated ``release.json`` at *path*.

    A broken manifest is reported as ``release-index-artifact-invalid``: the release
    version, kind and tag the index quotes all come from that one file, so an invalid
    one makes every entry undescribable.
    """

    try:
        return load_release_manifest(path)
    except Exception as error:  # noqa: BLE001 - the validator raises a ValueError family
        raise ReleaseIndexError(
            f"{path} is not a valid release manifest: {error}",
            code=CODE_ARTIFACT_INVALID,
            hint="run `npm run check:firmware-release` and fix release.json first",
            details={"file": str(path)},
        ) from error


def _load_catalog(path: Path) -> list[BoardSpec]:
    """Return the board catalog at *path*.

    An unreadable catalog is reported as ``release-index-board-unknown``: without it no
    board slug can be verified, which is the same outcome as a slug the catalog lacks.
    """

    try:
        return load_board_catalog(path)
    except Exception as error:  # noqa: BLE001 - the loader raises a ValueError family
        raise ReleaseIndexError(
            f"{path} is not a valid board catalog: {error}",
            code=CODE_BOARD_UNKNOWN,
            hint="run `npm run check:firmware-release` and fix boards.json first",
            details={"catalog": str(path)},
        ) from error


def build_release_index(
    *,
    release_dir: Path,
    base_url: str,
    release_manifest_path: Path | None = None,
    catalog_path: Path | None = None,
    channel: str = "release",
    generated_at: str | None = None,
) -> dict[str, Any]:
    """Return the ``index.json`` document for the assets in *release_dir*.

    Every image is validated (identity, channel, version, known board), paired with its
    ``.firmware.zip`` sibling, and hashed from the bytes on disk. Entries are ordered by
    ``(board, version sort key, sha256)``, so any directory listing order and any file
    creation order produce the same document.

    Args:
        release_dir: Directory holding the exported ``.bin``, ``.manifest.json`` and
            ``.firmware.zip`` files.
        base_url: Absolute ``https://`` prefix every asset URL is built from.
        release_manifest_path: ``release.json`` to quote; defaults to the in-tree file.
        catalog_path: ``boards.json`` to resolve display names and chips from.
        channel: Channel every entry must report (``release`` by default).
        generated_at: Override for ``generatedAt``; ``None`` derives it from
            ``SOURCE_DATE_EPOCH`` or the current time.

    Returns:
        The validated index document.

    Raises:
        ReleaseIndexError: With one of the ``release-index-*`` codes.
    """

    normalized_base = _normalize_base_url(base_url)
    if not release_dir.is_dir():
        raise ReleaseIndexError(
            f"{release_dir} is not a directory",
            code=CODE_EMPTY,
            hint="export the images first (`mo fw export ... --output-dir <dir>`)",
            details={"releaseDir": str(release_dir)},
        )

    manifest = _load_release_manifest(release_manifest_path or RELEASE_MANIFEST_DEFAULT_PATH)
    catalog = _load_catalog(catalog_path or BOARD_CATALOG_DEFAULT_PATH)

    packages = _release_zip_paths(release_dir)
    entries = list_firmware_inventory(publish_root=release_dir)
    paired = _require_paired_artifacts(entries, packages, release_dir)
    if not entries:
        raise ReleaseIndexError(
            f"{release_dir} holds no published firmware images",
            code=CODE_EMPTY,
            hint=(
                "export the images with `mo fw export <version> --board <slug> "
                "--output-dir <dir>` and copy their .bin and .manifest.json siblings in"
            ),
            details={"releaseDir": str(release_dir)},
        )

    firmware: list[dict[str, Any]] = []
    for entry in entries:
        _require_entry_identity(entry)
        _require_requested_channel(entry, channel)
        _require_release_version(entry, manifest)
        board = find_board_by_slug(catalog, entry.board_id)
        if board is None:
            raise ReleaseIndexError(
                f"{entry.filename} names the board {entry.board_id!r}, which boards.json lacks",
                code=CODE_BOARD_UNKNOWN,
                hint="add the board to src/micro_otter/nodes/device/firmware/boards.json",
                details={"file": entry.filename, "board": entry.board_id},
            )
        firmware.append(
            _entry_document(
                entry,
                board=board,
                package=paired[entry.path.stem],
                base_url=normalized_base,
            )
        )

    firmware.sort(
        key=lambda item: (
            item["board"],
            firmware_version_sort_key(item["version"]),
            item["sha256"],
        )
    )

    document: dict[str, Any] = {
        "schemaVersion": INDEX_SCHEMA_VERSION,
        "generatedAt": generated_at or _generated_at(),
        "generatedBy": {"name": "micro-otter", "version": __version__},
        "release": {
            "version": manifest.release_version,
            "tag": manifest.tag or f"firmware-v{manifest.release_version}",
            "kind": manifest.kind,
        },
        "firmware": firmware,
    }
    _validate_document(document)
    return document


def serialize_index(document: dict[str, Any]) -> str:
    """Return *document* serialized as the canonical ``index.json`` text.

    The serialization is fixed (``indent=2``, sorted keys, a trailing newline) so the
    ``--check`` comparison is a byte comparison and a re-run over the same directory
    never produces a diff.

    Args:
        document: A document returned by :func:`build_release_index`.

    Returns:
        The JSON text of the document.
    """

    return json.dumps(document, indent=2, sort_keys=True) + "\n"


def render_release_notes(document: dict[str, Any]) -> str:
    """Return the Markdown release body for *document*.

    One table row per board (display name, slug, MicroPython version, chip and flash
    offset, image size, the full SHA-256 and both asset links), followed by the install
    steps. The body is derived from the same in-memory document as ``index.json``, so a
    hand-edited table cannot disagree with the checksum list.

    Args:
        document: A document returned by :func:`build_release_index`.

    Returns:
        The Markdown body, with ``\\n`` line endings and no timestamp of its own.
    """

    release = document["release"]
    lines: list[str] = [
        f"# Firmware {release['version']}",
        "",
        f"Tag `{release['tag']}` · kind `{release['kind']}` · "
        f"generated `{document['generatedAt']}`.",
        "",
        "| Board | Slug | MicroPython | Chip | Image size | SHA-256 | Package | Raw image |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for entry in document["firmware"]:
        package = entry["package"]
        lines.append(
            f"| {entry['boardName']} | `{entry['board']}` | {entry['micropythonVersion']} | "
            f"{entry['chip']} ({entry['flashOffset']}) | {_human_size(entry['size'])} | "
            f"`{entry['sha256']}` | "
            f"[.firmware.zip]({package['url']}) ({_human_size(package['size'])}) | "
            f"[.bin]({entry['url']}) |"
        )

    lines.extend(
        [
            "",
            "## Install",
            "",
            "1. Copy the `.firmware.zip` URL for your board and paste it into the "
            "**Firmware** tab's **Import from URL…** dialog, pick the board, then "
            "**Deploy**. From a terminal the same import is `mo fw import --url <url>`.",
            "2. Prefer the `.firmware.zip`: it carries the firmware version, the embedded "
            "package list and the verified SHA-256. A bare `.bin` is imported as the "
            "`imported` image with incomplete identity, so its details are unavailable.",
            "",
        ]
    )
    return "\n".join(lines)


def _build_parser() -> argparse.ArgumentParser:
    """Return the command-line parser for ``make_release_index.py``."""

    parser = argparse.ArgumentParser(
        prog="make_release_index.py",
        description=(
            "Write index.json and the GitHub Release body for a directory of exported "
            "firmware artifacts. Nothing in src/micro_otter/ reads either file: they are "
            "build output for the release page."
        ),
    )
    parser.add_argument(
        "--release-dir",
        required=True,
        type=Path,
        help="directory holding the exported .bin, .manifest.json and .firmware.zip files",
    )
    parser.add_argument(
        "--base-url",
        required=True,
        help=(
            "absolute https:// prefix every asset URL is built from, e.g. "
            "https://github.com/<owner>/micro-otter/releases/download/firmware-v1.0.0"
        ),
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help=f"written document (default: <release-dir>/{INDEX_FILENAME})",
    )
    parser.add_argument(
        "--notes-out",
        type=Path,
        default=None,
        help=f"written release body (default: <release-dir>/{NOTES_FILENAME})",
    )
    parser.add_argument(
        "--release-json",
        type=Path,
        default=RELEASE_MANIFEST_DEFAULT_PATH,
        help="release manifest supplying version, tag and kind",
    )
    parser.add_argument(
        "--channel",
        default="release",
        help="channel every image must report (default: release)",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="regenerate in memory and compare both files; exit 1 on drift, never write",
    )
    return parser


def _report(error: ReleaseIndexError) -> int:
    """Print *error* as one ``<code>: <message>`` line plus hint/details, return its code."""

    print(f"{error.code}: {error.message}", file=sys.stderr)
    if error.hint:
        print(f"hint: {error.hint}", file=sys.stderr)
    if error.details:
        print(json.dumps(error.details, sort_keys=True), file=sys.stderr)
    return error.exit_code


def _check(targets: Sequence[tuple[Path, str]]) -> int:
    """Compare every ``(path, expected text)`` pair and return the ``--check`` status.

    A missing file is drift too: ``--check`` proves the release directory already
    carries what a fresh run would write, so an absent ``index.json`` cannot pass.
    """

    drifted = [
        str(path)
        for path, expected in targets
        if not path.is_file() or path.read_text(encoding="utf-8") != expected
    ]
    if not drifted:
        print("make_release_index: index and release notes match the release directory")
        return 0
    for path in drifted:
        print(
            f"{CODE_DRIFT}: {path} differs from a fresh generation; re-run without --check",
            file=sys.stderr,
        )
    return 1


def main(argv: list[str]) -> int:
    """Write (or verify) the release index and body and return the process exit code.

    Args:
        argv: Command-line arguments after the program name.

    Returns:
        ``0`` after writing both files (or after a clean ``--check``), ``1`` on
        ``--check`` drift, ``2`` for an invalid release directory or artifact.
    """

    args = _build_parser().parse_args(argv)
    out = args.out or args.release_dir / INDEX_FILENAME
    notes_out = args.notes_out or args.release_dir / NOTES_FILENAME

    try:
        document = build_release_index(
            release_dir=args.release_dir,
            base_url=args.base_url,
            release_manifest_path=args.release_json,
            channel=args.channel,
        )
    except ReleaseIndexError as error:
        return _report(error)

    index_text = serialize_index(document)
    notes_text = render_release_notes(document)

    if args.check:
        return _check(((out, index_text), (notes_out, notes_text)))

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(index_text, encoding="utf-8")
    notes_out.parent.mkdir(parents=True, exist_ok=True)
    notes_out.write_text(notes_text, encoding="utf-8")
    print(
        f"make_release_index: wrote {out} and {notes_out} "
        f"({len(document['firmware'])} board(s), release {document['release']['version']})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

"""Validated, atomic install and uninstall of add-on node-package archives.

This is the only module that writes into the addons root, so it is also where the
"never trust an archive" rules live:

* **One rename per install.** A package is extracted into ``<addons_root>/.staging/``,
  validated there, and moved onto ``<addons_root>/<id>`` with a single
  :func:`os.replace`, so a crash never leaves a half-installed package. Both
  ``.staging`` and ``.trash`` live *inside* the addons root on purpose: ``os.replace``
  is only atomic within one filesystem, so a system temp directory must never be used.
* **Built-in ids are immutable.** An archive that reuses a shipped package id is
  rejected during validation, before anything is moved into place, so an add-on can
  never shadow a built-in package.
* **The manifest ``id`` is authoritative.** The installed folder is always named after
  the manifest ``id``; the folder name inside the archive is irrelevant.

Every failure raises :class:`AddonInstallError` with a stable ``code`` (used verbatim by
the CLI, the JSON payload, and the developer docs) and an actionable ``hint``. No
:class:`ValueError` escapes this module.

Layout contract (shared with :mod:`micro_otter.tools.addon_store`): an installed
package is ``<addons_root>/<id>/manifest.json`` plus the ``mpAssets`` it declares, i.e.
exactly the ``node_pkgs``-relative subtree.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import stat
import tempfile
import zipfile
from collections.abc import Collection, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

from micro_otter.tools.addon_store import (
    ADDON_MANIFEST_NAME,
    ADDON_MODULE_PREFIX,
    ADDONS_BOOKKEEPING_DIRS,
    INSTALL_RECORD_NAME,
    addon_module_root,
    is_package_id,
    legacy_variant_manifest_paths,
    package_variants,
    read_addon_manifest,
)
from micro_otter.tools.addon_store import (
    installed_addons as list_installed_addons,
)

MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
"""Largest archive file accepted, checked before the zip is opened.

Only the bytes streamed from a ``url`` source are bounded by this; an unpacked
archive is really bounded by :data:`MAX_UNPACKED_BYTES`, which is why this value
is nothing more than an early refusal for a path, or a download cap.
"""

MAX_ENTRIES = 2000
"""Largest number of archive members accepted."""

MAX_UNPACKED_BYTES = 128 * 1024 * 1024
"""Largest total unpacked size accepted; also the post-install tree bound.

This is the bound a user actually experiences: it is checked from each member's
metadata before anything is written, so a zip bomb is refused before it lands.
"""

FORBIDDEN_PACKAGE_ID_PREFIXES = ("__", ".")
"""Rejected id prefixes: tool namespaces and dot-directories never become packages."""

FORBIDDEN_ASSET_NAMES = ("__mpycache__", INSTALL_RECORD_NAME)
"""Names an add-on may not declare as its own assets; the tool owns both."""

IGNORED_ARCHIVE_ROOTS = ("__MACOSX",)
"""Top-level directory a macOS ``zip -r`` adds for AppleDouble metadata; skipped."""

STAGING_DIR_NAME = ".staging"
"""Directory holding in-progress installs; never a package."""

TRASH_DIR_NAME = ".trash"
"""Directory holding replaced or removed packages until pruning."""

INSTALL_RECORD_SCHEMA_VERSION = 1
"""Schema version written into ``.installed.json``."""


class AddonInstallError(RuntimeError):
    """One add-on operation failed, with a stable code and an actionable hint.

    ``code`` is a machine-readable string (``addon-already-installed`` and friends)
    that the CLI prints, the ``--json-output`` payload carries, and the developer
    docs list; ``hint`` names the next command a user should run.
    """

    def __init__(self, code: str, message: str, *, hint: str | None = None) -> None:
        """Store the stable *code*, the human-readable *message*, and the optional *hint*."""

        super().__init__(message)
        self.code = code
        self.hint = hint


@dataclass(frozen=True)
class AddonInstallResult:
    """Outcome of one install or uninstall."""

    id: str
    """Package id that was installed or removed."""

    version: str | None
    """Manifest version, when the package declares one."""

    package_dir: Path
    """Directory the package lives in (unchanged by an uninstall)."""

    replaced: bool
    """Whether an existing installation was replaced by this install."""

    archive_sha256: str | None
    """SHA-256 of the installed archive; ``None`` for a directory install or an uninstall."""


@dataclass(frozen=True)
class AddonVariant:
    """One variant implementation declared by an add-on package."""

    id: str
    """Variant id: the manifest ``variant`` value or the ``manifest.<variant>.json`` suffix."""

    module_root: str
    """Device module root this variant stages under (``moa_<id>_<variant>``)."""

    precedence: int
    """Selection precedence; higher wins when capabilities tie (``0`` when undeclared)."""

    required_capabilities: tuple[object, ...]
    """The declared ``requiredCapabilities`` list, kept verbatim for the resolver."""

    hardware: Mapping[str, str] | None
    """Localised hardware description (``en``/``de``), when declared."""


@dataclass(frozen=True)
class AddonManifest:
    """The validated parts of an add-on package manifest."""

    id: str
    """Package id, which also names the installed folder."""

    version: str
    """Non-empty manifest version."""

    name: str | None
    """Human-readable name, when the manifest declares one."""

    assets: tuple[str, ...]
    """Every declared ``mpAssets`` entry, in declaration order, without duplicates."""

    module_roots: tuple[str, ...]
    """Device module roots: the base root followed by one root per variant."""

    variants: tuple[AddonVariant, ...]
    """The validated variant implementations, in manifest order."""


def _sha256(path: Path) -> str:
    """Return the SHA-256 hex digest of the file at *path*."""

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _timestamp(now: datetime | None = None) -> str:
    """Return a sortable UTC timestamp for staging, trash, and install-record names."""

    moment = datetime.now(UTC) if now is None else now.astimezone(UTC)
    return moment.strftime("%Y%m%dT%H%M%S%fZ")


def _require_manifest_at(directory: Path, manifest_path: Path) -> dict[str, object]:
    """Return the parsed manifest object at *manifest_path*.

    Raises
    ------
    AddonInstallError
        ``addon-archive-no-manifest`` when the file is missing,
        ``addon-manifest-invalid`` when it does not parse as a JSON object.
    """

    if not manifest_path.is_file():
        raise AddonInstallError(
            "addon-archive-no-manifest",
            f"no {manifest_path.name} found in {directory.name or directory}",
            hint=(
                "archive the package folder itself, so it contains "
                f"{ADDON_MANIFEST_NAME} and the declared mpAssets"
            ),
        )
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise AddonInstallError(
            "addon-manifest-invalid",
            f"{manifest_path} is not readable JSON: {exc}",
            hint=f"fix the JSON syntax in {manifest_path.name}",
        ) from exc
    if not isinstance(payload, dict):
        raise AddonInstallError(
            "addon-manifest-invalid",
            f"{manifest_path} must contain a JSON object",
            hint="wrap the manifest payload in a single object and declare an id",
        )
    return payload


def _require_manifest_object(package_dir: Path) -> dict[str, object]:
    """Return the parsed base manifest object of *package_dir*."""

    return _require_manifest_at(package_dir, package_dir / ADDON_MANIFEST_NAME)


def _validated_package_id(
    manifest: dict[str, object],
    *,
    package_id: str | None,
    builtin_ids: Collection[str],
) -> str:
    """Return the authoritative package id, validating it against every install rule.

    Raises
    ------
    AddonInstallError
        ``addon-id-invalid`` for a malformed id, ``addon-id-mismatch`` when an
        expected id was supplied, ``addon-id-conflicts-builtin`` for a shipped id.
    """

    raw_id = manifest.get("id")
    if (
        not isinstance(raw_id, str)
        or not raw_id
        or not is_package_id(raw_id)
        or raw_id.startswith(FORBIDDEN_PACKAGE_ID_PREFIXES)
    ):
        raise AddonInstallError(
            "addon-id-invalid",
            f"manifest id {raw_id!r} is not a valid package id",
            hint=(
                "use lowercase letters, digits, and underscores, starting with a letter "
                "(for example sample_addon)"
            ),
        )
    if package_id is not None and package_id != raw_id:
        raise AddonInstallError(
            "addon-id-mismatch",
            f"archive was named {package_id!r} but its manifest declares {raw_id!r}",
            hint=(
                "the manifest id is authoritative: drop --as, or pass --as "
                f"{raw_id} to confirm"
            ),
        )
    if raw_id in builtin_ids:
        raise AddonInstallError(
            "addon-id-conflicts-builtin",
            f"{raw_id!r} is a built-in node package and cannot be replaced by an add-on",
            hint="rename the package (the manifest id is the installed folder name)",
        )
    return raw_id


def _declared_asset_path(package_dir: Path, entry: object) -> tuple[str, Path]:
    """Return the declared spelling and resolved path of one ``mpAssets`` entry.

    Raises
    ------
    AddonInstallError
        ``addon-manifest-invalid`` for a non-relative or escaping path,
        ``addon-manifest-forbidden-asset`` for a tool-owned name.
    """

    if not isinstance(entry, str) or not entry.strip():
        raise AddonInstallError(
            "addon-manifest-invalid",
            f"mpAssets entries must be non-empty strings, got {entry!r}",
            hint="list relative file paths, for example moa_<id>/__init__.py",
        )
    spelling = entry.strip()
    if "\\" in spelling:
        raise AddonInstallError(
            "addon-manifest-invalid",
            f"mpAssets entry {spelling!r} uses a backslash separator",
            hint="use forward slashes in every declared path",
        )
    pure = PurePosixPath(spelling)
    if pure.is_absolute() or any(part in ("..", "") for part in spelling.split("/")):
        raise AddonInstallError(
            "addon-manifest-invalid",
            f"mpAssets entry {spelling!r} must stay inside the package folder",
            hint="declare a relative path with no leading slash and no '..' segment",
        )
    for part in pure.parts:
        if part in FORBIDDEN_ASSET_NAMES:
            raise AddonInstallError(
                "addon-manifest-forbidden-asset",
                f"mpAssets entry {spelling!r} uses a name the tool owns",
                hint=(
                    f"{' and '.join(FORBIDDEN_ASSET_NAMES)} are written by micro-otter "
                    "and cannot be package assets"
                ),
            )
    resolved = (package_dir / pure).resolve()
    try:
        resolved.relative_to(package_dir.resolve())
    except ValueError as exc:
        raise AddonInstallError(
            "addon-manifest-invalid",
            f"mpAssets entry {spelling!r} escapes the package folder",
            hint="declare a relative path that stays inside the package",
        ) from exc
    return spelling, resolved


def _declared_assets(
    package_dir: Path,
    manifest: dict[str, object],
    *,
    expected_root: str,
) -> tuple[str, ...]:
    """Return every declared asset path, validated and de-duplicated.

    A missing declaration is not an error (a package may ship only node definitions);
    a declaration whose file is absent is, because the staging step would otherwise
    fail later with a much less actionable message. Every declared path must live under
    *expected_root* (``moa_<id>`` / ``moa_<id>_<variant>``), so an add-on can never
    stage under an ``otter_*`` or foreign ``moa_*`` namespace.
    """

    declared = manifest.get("mpAssets")
    if declared is None:
        return ()
    if not isinstance(declared, dict):
        raise AddonInstallError(
            "addon-manifest-invalid",
            "mpAssets must map a node-type selector to a list of relative paths",
            hint=f'use {{"*": ["{expected_root}/__init__.py"]}} or omit mpAssets entirely',
        )

    assets: list[str] = []
    for selector, entries in declared.items():
        if not isinstance(entries, list):
            raise AddonInstallError(
                "addon-manifest-invalid",
                f"mpAssets[{selector!r}] must be a list of relative paths",
                hint="declare one list per selector, even when it holds a single file",
            )
        for entry in entries:
            spelling, resolved = _declared_asset_path(package_dir, entry)
            first_segment = spelling.split("/", 1)[0]
            if first_segment != expected_root:
                raise AddonInstallError(
                    "addon-module-root-invalid",
                    f"mpAssets entry {spelling!r} must live under {expected_root!r}",
                    hint=(
                        f"add-ons use the reserved {ADDON_MODULE_PREFIX}<id> device namespace; "
                        f"this manifest must declare paths under {expected_root!r}"
                    ),
                )
            if not resolved.is_file():
                raise AddonInstallError(
                    "addon-manifest-missing-asset",
                    f"mpAssets declares {spelling!r} but the archive does not contain it",
                    hint="include every declared file in the archive, or drop it from mpAssets",
                )
            if spelling not in assets:
                assets.append(spelling)
    return tuple(assets)


def _tree_size(package_dir: Path) -> int:
    """Return the total size in bytes of every regular file below *package_dir*."""

    total = 0
    for path in package_dir.rglob("*"):
        try:
            if path.is_file():
                total += path.stat().st_size
        except OSError:
            continue
    return total


def _validate_manifest(
    manifest: dict[str, object],
    *,
    package_id: str | None,
    builtin_ids: Collection[str],
) -> tuple[str, str, str | None]:
    """Validate the package header and return ``(id, version, name)``.

    Id validation (against *package_id* and *builtin_ids*) and a non-empty version are
    shared by the one manifest every package ships; ``mpAssets`` is validated per
    variant, not here.
    """

    resolved_id = _validated_package_id(
        manifest, package_id=package_id, builtin_ids=builtin_ids
    )

    raw_version = manifest.get("version")
    if not isinstance(raw_version, str) or not raw_version.strip():
        raise AddonInstallError(
            "addon-manifest-missing-version",
            f"{resolved_id} does not declare a version",
            hint='add a "version" string to the manifest so installs can be compared',
        )

    raw_name = manifest.get("name")
    name = raw_name.strip() if isinstance(raw_name, str) and raw_name.strip() else None
    return resolved_id, raw_version.strip(), name


def _validate_variant_fields(
    package_id: str,
    variant_id: str,
    manifest: dict[str, object],
) -> AddonVariant:
    """Validate a variant entry's fields and return its record.

    ``requiredCapabilities`` and ``hardware`` are both optional in the v2 contract:
    the former defaults to an empty requirement and the latter to ``None``.
    ``precedence`` is optional too, but must be a non-negative integer when declared.
    """

    capabilities = manifest.get("requiredCapabilities")
    if capabilities is None:
        capability_values: tuple[object, ...] = ()
    elif isinstance(capabilities, list):
        capability_values = tuple(capabilities)
    else:
        raise AddonInstallError(
            "addon-manifest-invalid",
            f"{package_id} variant {variant_id!r} requiredCapabilities must be a list",
            hint='declare "requiredCapabilities": ["<capability>"] or omit it',
        )

    hardware = manifest.get("hardware")
    hardware_text: dict[str, str] | None = None
    if isinstance(hardware, Mapping):
        mapped = {
            str(key): str(value)
            for key, value in hardware.items()
            if isinstance(key, str) and isinstance(value, str)
        }
        if mapped:
            hardware_text = mapped

    precedence = manifest.get("precedence")
    if precedence is None:
        precedence_value = 0
    elif isinstance(precedence, bool) or not isinstance(precedence, int) or precedence < 0:
        raise AddonInstallError(
            "addon-manifest-invalid",
            f"{package_id} variant {variant_id!r} precedence must be a non-negative integer",
            hint='set "precedence" to a non-negative integer',
        )
    else:
        precedence_value = precedence

    return AddonVariant(
        id=variant_id,
        module_root=addon_module_root(package_id, variant_id),
        precedence=precedence_value,
        required_capabilities=capability_values,
        hardware=hardware_text,
    )


def _validate_variants(
    directory: Path,
    package_id: str,
    manifest: dict[str, object],
) -> tuple[tuple[AddonVariant, ...], tuple[str, ...]]:
    """Validate every variant of a v2 manifest and return ``(records, assets)``.

    The ``variants`` dict supplies one record per key (``py`` or any other id), each
    validated against its own module root. A missing/empty dict, an empty key, or a
    duplicate ``precedence`` is rejected.
    """

    variants = package_variants(manifest)
    if not variants:
        raise AddonInstallError(
            "addon-manifest-invalid",
            f"{package_id} declares no variants",
            hint='add a "variants" object with at least one entry',
        )

    records: list[AddonVariant] = []
    assets: list[str] = []
    seen_precedences: dict[int, str] = {}
    for variant_id, variant in variants.items():
        if not variant_id or not is_package_id(variant_id):
            raise AddonInstallError(
                "addon-variant-manifest-invalid",
                f"{package_id} declares the invalid variant id {variant_id!r}",
                hint=(
                    "variant ids are the variants dict keys: lowercase letters, digits, "
                    "and underscores, starting with a letter"
                ),
            )
        for asset in _declared_assets(
            directory,
            variant,
            expected_root=addon_module_root(package_id, variant_id),
        ):
            if asset not in assets:
                assets.append(asset)

        record = _validate_variant_fields(package_id, variant_id, variant)
        if record.precedence in seen_precedences:
            raise AddonInstallError(
                "addon-variant-precedence-duplicate",
                f"{package_id} variants {seen_precedences[record.precedence]!r} and "
                f"{variant_id!r} share precedence {record.precedence}",
                hint="give each variant a distinct precedence",
            )
        seen_precedences[record.precedence] = variant_id
        records.append(record)
    return tuple(records), tuple(assets)


def validate_addon_tree(
    package_dir: Path,
    *,
    package_id: str | None = None,
    builtin_ids: Collection[str],
) -> AddonManifest:
    """Validate an extracted add-on package directory and return its manifest.

    Checks, in order: the manifest exists and parses as a JSON object; its ``id`` is a
    non-empty string matching the package-id pattern and equals *package_id* when that
    argument was supplied; ``version`` is a non-empty string; the package ships no
    legacy ``manifest.<variant>.json`` file; the ``variants`` dict is present and every
    variant's ``mpAssets`` entry is a confined relative path under the
    ``moa_<id>`` / ``moa_<id>_<variant>`` module root that names no tool-owned file and
    exists; each variant id is a valid key with a unique ``precedence``; the unpacked
    tree stays within :data:`MAX_UNPACKED_BYTES`; and the id is not one of
    *builtin_ids*. The built-in ids are passed in (rather than imported) so this module
    never depends on the build stack.

    Raises
    ------
    AddonInstallError
        With the stable code for the rule that failed; never a bare ``ValueError``.
    """

    directory = Path(package_dir)
    manifest = _require_manifest_object(directory)
    resolved_id, version, name = _validate_manifest(
        manifest,
        package_id=package_id,
        builtin_ids=builtin_ids,
    )

    legacy = legacy_variant_manifest_paths(directory)
    if legacy:
        raise AddonInstallError(
            "addon-layout-legacy-variant-manifest",
            f"{resolved_id} carries legacy variant manifest file(s): "
            + ", ".join(path.name for path in legacy),
            hint='declare variants under "variants" in manifest.json',
        )

    variants, assets = _validate_variants(directory, resolved_id, manifest)
    module_roots = tuple(variant.module_root for variant in variants)

    size = _tree_size(directory)
    if size > MAX_UNPACKED_BYTES:
        raise AddonInstallError(
            "addon-archive-unpacked-too-large",
            f"{resolved_id} unpacks to {size} bytes, above the {MAX_UNPACKED_BYTES}-byte limit",
            hint="ship only the manifest, node definitions, generators, and mpAssets",
        )

    return AddonManifest(
        id=resolved_id,
        version=version,
        name=name,
        assets=assets,
        module_roots=module_roots,
        variants=variants,
    )


def _archive_members(archive: zipfile.ZipFile, source_label: str) -> tuple[zipfile.ZipInfo, ...]:
    """Return the validated members of *archive*, refusing anything unsafe.

    Refuses, in order: more than :data:`MAX_ENTRIES` members, an absolute or
    parent-traversing path, a backslash separator, a symlink member, a duplicate name,
    and a total unpacked size above :data:`MAX_UNPACKED_BYTES`. A top-level
    ``__MACOSX`` directory (AppleDouble metadata added by a macOS ``zip -r``) is
    skipped before any limit or path rule is applied, so a Finder-made archive installs.

    Raises
    ------
    AddonInstallError
        ``addon-archive-too-many-entries``, ``addon-archive-unsafe-path``,
        ``addon-archive-symlink``, or ``addon-archive-unpacked-too-large``.
    """

    members = tuple(
        member
        for member in archive.infolist()
        if member.filename.split("/")[0] not in IGNORED_ARCHIVE_ROOTS
    )
    if len(members) > MAX_ENTRIES:
        raise AddonInstallError(
            "addon-archive-too-many-entries",
            f"{source_label} holds {len(members)} entries, above the {MAX_ENTRIES} limit",
            hint="archive only the package folder, excluding build output and caches",
        )

    seen: set[str] = set()
    unpacked = 0
    for member in members:
        name = member.filename
        segments = name.rstrip("/").split("/")
        if "\\" in name:
            raise AddonInstallError(
                "addon-archive-unsafe-path",
                f"{source_label} contains {name!r} with a backslash separator",
                hint="re-create the archive with forward-slash separators",
            )
        if name.startswith("/") or any(segment in ("..", ".", "") for segment in segments):
            raise AddonInstallError(
                "addon-archive-unsafe-path",
                f"{source_label} contains the unsafe path {name!r}",
                hint="archive a single package folder with relative paths only",
            )
        if stat.S_ISLNK(member.external_attr >> 16):
            raise AddonInstallError(
                "addon-archive-symlink",
                f"{source_label} contains the symlink {name!r}",
                hint="replace symlinks with real files before archiving",
            )
        if name in seen:
            raise AddonInstallError(
                "addon-archive-unsafe-path",
                f"{source_label} lists {name!r} more than once",
                hint="re-create the archive; duplicate members are ambiguous",
            )
        seen.add(name)
        if not member.is_dir():
            unpacked += member.file_size

    if unpacked > MAX_UNPACKED_BYTES:
        raise AddonInstallError(
            "addon-archive-unpacked-too-large",
            f"{source_label} unpacks to {unpacked} bytes, above the "
            f"{MAX_UNPACKED_BYTES}-byte limit",
            hint="ship only the manifest, node definitions, generators, and mpAssets",
        )
    return tuple(members)


def _select_package_directory(
    root: Path,
    *,
    package_id: str | None,
    source_label: str,
    allow_root_manifest: bool = False,
) -> Path:
    """Return the package directory inside an extracted/copied *root*.

    A single top-level folder is accepted when it holds the manifest
    (``<folder>/manifest.json``). A manifest at the archive root is accepted only
    together with *package_id* (``--as``), because an archive without a package folder
    is indistinguishable from a whole-project dump; a directory source is that package
    folder itself, so *allow_root_manifest* is set for it.

    Raises
    ------
    AddonInstallError
        ``addon-manifest-invalid`` for an archive-root manifest without ``--as``,
        ``addon-archive-no-manifest`` when no package folder can be found.
    """

    if (root / ADDON_MANIFEST_NAME).is_file():
        if package_id is None and not allow_root_manifest:
            raise AddonInstallError(
                "addon-manifest-invalid",
                f"{source_label} stores {ADDON_MANIFEST_NAME} at its root",
                hint="pass --as <id> to confirm the package, or archive the folder itself",
            )
        return root

    children = sorted(
        (child for child in root.iterdir() if child.is_dir() and not child.name.startswith(".")),
        key=lambda path: path.name,
    )
    if len(children) == 1 and (children[0] / ADDON_MANIFEST_NAME).is_file():
        return children[0]
    raise AddonInstallError(
        "addon-archive-no-manifest",
        f"{source_label} does not contain exactly one add-on package folder",
        hint=(
            f"the archive must hold <folder>/{ADDON_MANIFEST_NAME}, or "
            f"{ADDON_MANIFEST_NAME} plus --as <id>"
        ),
    )


def _extract_archive(source: Path, destination: Path, *, package_id: str | None) -> Path:
    """Extract *source* into *destination* and return the package directory inside it.

    Raises
    ------
    AddonInstallError
        ``addon-archive-invalid`` when the file is not a readable zip archive, plus
        every :func:`_archive_members` and :func:`_select_package_directory` failure.
    """

    try:
        with zipfile.ZipFile(source) as archive:
            for member in _archive_members(archive, source.name):
                target = destination / PurePosixPath(member.filename)
                if member.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(member) as reader, target.open("wb") as writer:
                    shutil.copyfileobj(reader, writer)
    except zipfile.BadZipFile as exc:
        raise AddonInstallError(
            "addon-archive-invalid",
            f"{source.name} is not a readable .zip archive",
            hint="re-create the archive with `zip -r` or `git archive`",
        ) from exc
    return _select_package_directory(
        destination, package_id=package_id, source_label=source.name
    )


def prune_addons_root(addons_root: Path) -> tuple[str, ...]:
    """Remove leftover ``.staging``/``.trash`` entries and return what was removed.

    Every entry inside the two tool-owned directories is deleted best-effort, so a crash
    mid-install cannot grow the addons root unbounded. The directories themselves stay,
    and the addons root is never created here.
    """

    removed: list[str] = []
    for directory_name in ADDONS_BOOKKEEPING_DIRS:
        directory = Path(addons_root) / directory_name
        try:
            children = sorted(directory.iterdir())
        except OSError:
            continue
        for child in children:
            shutil.rmtree(child, ignore_errors=True)
            if not child.exists():
                removed.append(f"{directory_name}/{child.name}")
    return tuple(removed)


def _installed_at(now: datetime | None) -> str:
    """Return an ISO-8601 UTC timestamp for the install record."""

    moment = datetime.now(UTC) if now is None else now.astimezone(UTC)
    return moment.isoformat(timespec="seconds")


def _write_install_record(
    package_dir: Path,
    *,
    manifest: AddonManifest,
    source_label: str,
    archive_sha256: str | None,
    now: datetime | None,
) -> None:
    """Write the provenance record into a *staged* package directory.

    The record never reaches an installed tree through this function: it is written
    before the single ``os.replace`` that publishes the package, so an interrupted
    install cannot leave a half-written record behind.
    """

    record: dict[str, object] = {
        "schemaVersion": INSTALL_RECORD_SCHEMA_VERSION,
        "id": manifest.id,
        "version": manifest.version,
        "archive": source_label,
        "archiveSha256": archive_sha256,
        "installedAt": _installed_at(now),
    }
    (package_dir / INSTALL_RECORD_NAME).write_text(
        json.dumps(record, indent=2) + "\n", encoding="utf-8"
    )


def install_addon(
    source: Path,
    *,
    addons_root: Path,
    builtin_ids: Collection[str],
    force: bool = False,
    package_id: str | None = None,
    now: datetime | None = None,
) -> AddonInstallResult:
    """Install one add-on package from *source* into ``<addons_root>/<id>``.

    *source* is a ``.zip`` archive or a package directory (a checkout installs directly).
    The archive is validated before anything is moved, extracted into
    ``<addons_root>/.staging/``, re-validated as a tree, given its ``.installed.json``
    record, and published with one :func:`os.replace`. An existing package is moved to
    ``.trash`` first, and only when *force* is set.

    Raises
    ------
    AddonInstallError
        ``addon-archive-not-found`` for a missing source, ``addon-already-installed``
        without *force*, plus every validation failure.
    """

    source_path = Path(source)
    if not source_path.exists():
        raise AddonInstallError(
            "addon-archive-not-found",
            f"{source_path} does not exist",
            hint="check the path, or run `mo addons list` for what is already installed",
        )

    root = Path(addons_root)
    staging_root = root / STAGING_DIR_NAME
    staging_root.mkdir(parents=True, exist_ok=True)
    archive_sha256: str | None = None
    try:
        staging_dir = Path(tempfile.mkdtemp(dir=staging_root, prefix="install-"))
        if source_path.is_dir():
            shutil.copytree(source_path, staging_dir, dirs_exist_ok=True)
            staged = _select_package_directory(
                staging_dir,
                package_id=package_id,
                source_label=source_path.name,
                allow_root_manifest=True,
            )
        else:
            archive_sha256 = _sha256(source_path)
            size = source_path.stat().st_size
            if size > MAX_ARCHIVE_BYTES:
                raise AddonInstallError(
                    "addon-archive-too-large",
                    f"{source_path.name} is {size} bytes, above the "
                    f"{MAX_ARCHIVE_BYTES}-byte limit",
                    hint="ship only the manifest, node definitions, generators, and mpAssets",
                )
            staged = _extract_archive(source_path, staging_dir, package_id=package_id)

        manifest = validate_addon_tree(
            staged, package_id=package_id, builtin_ids=builtin_ids
        )
        _write_install_record(
            staged,
            manifest=manifest,
            source_label=source_path.name,
            archive_sha256=archive_sha256,
            now=now,
        )

        target = root / manifest.id
        replaced = False
        if target.exists():
            if not force:
                raise AddonInstallError(
                    "addon-already-installed",
                    f"{manifest.id} is already installed",
                    hint=(
                        "re-run with --force to replace it, or "
                        f"`mo addons uninstall {manifest.id}` first"
                    ),
                )
            trash = root / TRASH_DIR_NAME
            trash.mkdir(parents=True, exist_ok=True)
            os.replace(target, trash / f"{manifest.id}-{_timestamp(now)}")
            replaced = True

        os.replace(staged, target)
        return AddonInstallResult(
            id=manifest.id,
            version=manifest.version,
            package_dir=target,
            replaced=replaced,
            archive_sha256=archive_sha256,
        )
    finally:
        prune_addons_root(root)


def uninstall_addon(
    package_id: str,
    *,
    addons_root: Path,
    now: datetime | None = None,
) -> AddonInstallResult:
    """Remove an installed add-on, leaving local inventory as its only state.

    The package directory is moved into ``.trash`` with one :func:`os.replace` and then
    deleted, so a crash cannot leave a half-removed package that still looks installed.
    Removing an add-on never touches firmware images, device filesystems, or the
    collection deploy decision code.

    Raises
    ------
    AddonInstallError
        ``addon-id-invalid`` for a malformed id, ``addon-not-installed`` when the id is
        not installed (the hint lists the installed ids).
    """

    if not is_package_id(package_id):
        raise AddonInstallError(
            "addon-id-invalid",
            f"{package_id!r} is not a valid package id",
            hint="package ids are lowercase letters, digits, and underscores",
        )
    root = Path(addons_root)
    package_dir = root / package_id
    manifest = read_addon_manifest(root, package_id)
    if manifest is None:
        installed = ", ".join(record.id for record in list_installed_addons(root)) or "none"
        raise AddonInstallError(
            "addon-not-installed",
            f"{package_id} is not installed under {root}",
            hint=f"installed add-ons: {installed}",
        )

    trash = root / TRASH_DIR_NAME
    trash.mkdir(parents=True, exist_ok=True)
    os.replace(package_dir, trash / f"{package_id}-{_timestamp(now)}")
    prune_addons_root(root)

    raw_version = manifest.get("version")
    version = (
        raw_version.strip() if isinstance(raw_version, str) and raw_version.strip() else None
    )
    return AddonInstallResult(
        id=package_id,
        version=version,
        package_dir=package_dir,
        replaced=False,
        archive_sha256=None,
    )


def validate_addon_source(
    source: Path,
    *,
    builtin_ids: Collection[str],
    package_id: str | None = None,
) -> AddonManifest:
    """Validate *source* without installing anything.

    A ``.zip`` archive is extracted into a system temporary directory (never into the
    addons root) and removed again afterwards, so ``mo addons validate`` creates no
    state: no staging folder, no package directory, nothing to clean up by hand.

    Raises
    ------
    AddonInstallError
        ``addon-archive-not-found`` for a missing source, plus every validation failure.
    """

    source_path = Path(source)
    if not source_path.exists():
        raise AddonInstallError(
            "addon-archive-not-found",
            f"{source_path} does not exist",
            hint="point the command at the archive or package folder you want to check",
        )

    if source_path.is_dir():
        return validate_addon_tree(
            source_path, package_id=package_id, builtin_ids=builtin_ids
        )

    with tempfile.TemporaryDirectory(prefix="micro-otter-addon-validate-") as staging:
        staged = _extract_archive(source_path, Path(staging), package_id=package_id)
        return validate_addon_tree(staged, package_id=package_id, builtin_ids=builtin_ids)

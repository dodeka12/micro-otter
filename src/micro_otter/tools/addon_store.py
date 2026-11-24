"""Read-only inventory of installed add-on node packages.

An add-on is a node package installed into the user's addons folder
(:attr:`micro_otter.config.Config.addons_dir`) instead of shipping inside
``src/micro_otter/nodes/device/node_pkgs``. The folder layout is deliberately the
``node_pkgs``-relative subtree::

    <addons_root>/<id>/manifest.json
    <addons_root>/<id>/<mpAssets entry>

so an index entry's ``manifest`` value (``"<id>/manifest.json"``) is valid in both
roots and one payload shape serves both the HTTP merge and the on-disk merge.

Two invariants hold for every function in this module:

* **Read-only.** Nothing here creates a directory, writes a file, or repairs a
  manifest; a malformed add-on is skipped instead of "fixed".
* **Provenance never deletes.** The store reports where a package came from. It
  carries no upload flag and cannot suppress the collection deploy path's
  ``missing`` / ``override-required`` decisions.

The module is intentionally dependency-free (standard library only, no
``firmware_compile`` import) so the build stack can import it without a cycle and
the local server can import it without dragging in the build stack.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

ADDON_MANIFEST_NAME = "manifest.json"
"""Manifest file every installed add-on package carries at its root."""

ADDONS_BOOKKEEPING_DIRS = (".staging", ".trash")
"""Tool-owned directories inside the addons root that are never packages."""

INSTALL_RECORD_NAME = ".installed.json"
"""Provenance record written next to an installed add-on's manifest."""

PACKAGE_ID_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")
"""Accepted add-on package ids; also the folder name."""

ADDON_MODULE_PREFIX = "moa_"
"""Reserved device-module namespace for add-on packages.

``otter_*`` stays Micro-Otter-only, so an add-on can never overwrite a shipped module
by declaring the same device root. The prefix is enforced by the install validation
(:mod:`micro_otter.tools.addon_archive`) and the read-only inventory here.
"""

ADDON_VARIANT_MANIFEST_RE = re.compile(r"^manifest\.([a-z][a-z0-9_]*)\.json$")
"""Matches a legacy ``manifest.<variant>.json`` file name and captures the variant id.

The v2 manifest contract keeps every implementation inside one ``manifest.json``
(``variants`` dict); this pattern survives only so :mod:`micro_otter.tools.addon_archive`
can *reject* an archive that still carries the legacy sidecar files.
"""

DEFAULT_VARIANT_ID = "py"
"""Variant id that names a package's default implementation.

The compile resolver speaks this id, so ``packageVariants: {"pulse": "py"}`` forces
the plain MicroPython implementation. It is also the ``variants`` dict key of the
default implementation, whose module root stays ``moa_<id>`` (no ``_py`` suffix).
"""

VARIANT_FIELD = "variant"
"""Legacy manifest key a variant sidecar used to declare its variant id."""

VARIANTS_FIELD = "variants"
"""Manifest key whose dict maps each variant id to that implementation's metadata."""

ADDON_INDEX_ROOT = "addons"
"""Value of the ``root`` key on an index entry that resolves against the addons root."""

BUILTIN_INDEX_RELATIVE = Path("node_pkgs") / "index.json"
"""Built-in node-package index, relative to the device root."""

RUNTIME_ADDONS_KEY = "addons"
"""Key inside ``nodePackages`` that lists installed add-on ids."""

DEVICE_RUNTIME_PREFIX = "/device/runtime/"
"""URL prefix of a served runtime manifest."""

RUNTIME_MANIFEST_NAME = "manifest.json"
"""File a served runtime manifest request resolves to."""



class PackageProvenance(StrEnum):
    """Where a resolved node package came from."""

    BUILTIN = "builtin"
    ADDON = "addon"


@dataclass(frozen=True)
class AddonRecord:
    """One installed add-on package discovered under the addons root."""

    id: str
    """Package id, which is also the folder name."""

    name: str | None
    """Human-readable package name from the manifest, when it declares one."""

    version: str | None
    """Package version from the manifest, when it declares one."""

    package_dir: Path
    """Directory holding the manifest and the package's declared assets."""

    manifest: Mapping[str, object]
    """Parsed manifest object; never empty because a malformed manifest is skipped."""

    archive_sha256: str | None
    """SHA-256 of the archive this package was installed from, when recorded."""

    installed_at: str | None
    """ISO-8601 install timestamp, when the install record carries one."""

    module_roots: tuple[str, ...]
    """Device module roots declared across the base and variant manifests."""

    variants: tuple[str, ...]
    """Variant ids (excluding the base), in manifest order."""

    contract_warnings: tuple[str, ...] = ()
    """Human-readable warnings for a hand-placed package that violates the contract."""


def is_package_id(value: object) -> bool:
    """Return whether *value* may be an add-on package id (and therefore a folder name)."""

    return isinstance(value, str) and bool(PACKAGE_ID_PATTERN.match(value))


def _read_json_object(path: Path) -> Mapping[str, object] | None:
    """Return the JSON object stored at *path*, or ``None`` when it is missing or malformed."""

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _text_field(manifest: Mapping[str, object], key: str) -> str | None:
    """Return the stripped string *key* of *manifest*, or ``None`` when absent or not text."""

    value = manifest.get(key)
    if not isinstance(value, str):
        return None
    return value.strip() or None


def addon_module_root(package_id: str, variant: str | None = None) -> str:
    """Return the device module root for *package_id*, optionally narrowed to *variant*.

    The default root is ``moa_<id>``; a non-default variant narrows it to
    ``moa_<id>_<variant>``. This is the only place the reserved add-on namespace
    spelling is built. ``variant=None`` and ``variant="py"`` both name the default
    implementation and yield ``moa_<id>`` — there is no ``moa_<id>_py``.
    """

    root = f"{ADDON_MODULE_PREFIX}{package_id}"
    if variant and variant != DEFAULT_VARIANT_ID:
        return f"{root}_{variant}"
    return root


def package_variants(manifest: Mapping[str, object]) -> dict[str, Mapping[str, object]]:
    """Return the ``variants`` dict of a v2 *manifest*, or ``{}`` when absent/malformed.

    The v2 manifest declares every implementation under one ``variants`` key; a
    non-mapping value is treated as no variants, matching this module's tolerant
    read-only policy.
    """

    declared = manifest.get(VARIANTS_FIELD)
    if not isinstance(declared, Mapping):
        return {}
    return {
        str(variant_id): variant
        for variant_id, variant in declared.items()
        if isinstance(variant, Mapping)
    }


def variant_ids(manifest: Mapping[str, object]) -> tuple[str, ...]:
    """Return the variant ids a v2 *manifest* declares, in dict order."""

    return tuple(package_variants(manifest).keys())


def legacy_variant_manifest_paths(package_dir: Path) -> tuple[Path, ...]:
    """Return any legacy ``manifest.<variant>.json`` files inside *package_dir*.

    The v2 contract keeps every implementation in ``manifest.json``, so these files are
    leftovers; :mod:`micro_otter.tools.addon_archive` rejects them on install.
    """

    try:
        candidates = sorted(Path(package_dir).iterdir(), key=lambda path: path.name)
    except OSError:
        return ()
    return tuple(
        path
        for path in candidates
        if path.is_file() and ADDON_VARIANT_MANIFEST_RE.match(path.name) is not None
    )


def _asset_first_segments(manifest: Mapping[str, object]) -> tuple[str, ...]:
    """Return the first path segment of every declared ``mpAssets`` entry, in order."""

    declared = manifest.get("mpAssets")
    if not isinstance(declared, Mapping):
        return ()
    segments: list[str] = []
    for entries in declared.values():
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if isinstance(entry, str) and entry.strip():
                segments.append(entry.strip().split("/", 1)[0])
    return tuple(segments)


def _module_root_valid(package_id: str, variant_id: str, manifest: Mapping[str, object]) -> bool:
    """Return whether a variant's declared ``mpAssets`` root matches its module root.

    A variant that declares no ``mpAssets`` (node definitions only) is always valid.
    The expected root is ``moa_<id>`` for the default (``py``) and ``moa_<id>_<variant>``
    otherwise, so an add-on can never stage under an ``otter_*`` or a foreign ``moa_*``
    namespace.
    """

    segments = set(_asset_first_segments(manifest))
    if not segments:
        return True
    expected = addon_module_root(package_id, variant_id)
    return len(segments) == 1 and next(iter(segments)) == expected


def _module_roots_of(
    variants: Mapping[str, Mapping[str, object]],
) -> tuple[str, ...]:
    """Return the declared module roots of a package, in variant order, without repeats.

    These are the actual ``mpAssets`` first segments each variant declares, so a
    violating hand-placed package surfaces its real root (e.g. ``otter_x``) here for
    the listing warning instead of being silently normalised.
    """

    roots: list[str] = []
    for _variant_id, manifest in variants.items():
        for segment in _asset_first_segments(manifest):
            if segment not in roots:
                roots.append(segment)
    return tuple(roots)


def iter_addon_package_dirs(addons_root: Path | None) -> Iterator[tuple[str, Path]]:
    """Yield ``(id, package_dir)`` for every installed add-on package, sorted by id.

    Only an immediate subdirectory whose name matches :data:`PACKAGE_ID_PATTERN` and
    that holds a ``manifest.json`` is a package. :data:`ADDONS_BOOKKEEPING_DIRS` and
    dot-directories are skipped, so a half-extracted archive in ``.staging`` never
    looks installed. A ``None`` root or a missing root yields nothing.
    """

    if addons_root is None:
        return
    try:
        candidates = sorted(Path(addons_root).iterdir(), key=lambda path: path.name)
    except OSError:
        return
    for candidate in candidates:
        package_id = candidate.name
        if package_id in ADDONS_BOOKKEEPING_DIRS or not is_package_id(package_id):
            continue
        if not (candidate / ADDON_MANIFEST_NAME).is_file():
            continue
        yield package_id, candidate


def _contract_warnings(
    package_id: str,
    manifest: Mapping[str, object],
) -> tuple[str, ...]:
    """Return human-readable warnings for a package that violates the v2 contract.

    Covers, in order: a missing/empty ``variants`` object, an ``mpAssets`` root outside
    the ``moa_<id>`` / ``moa_<id>_<variant>`` namespace, a manifest ``id`` that does not
    match the folder name, and duplicate ``precedence`` values across variants. A
    violating package is still *listed* (so it is visible) but is skipped from
    :func:`addon_index_entries`.
    """

    warnings: list[str] = []
    variants = package_variants(manifest)
    if not variants:
        warnings.append(
            "manifest declares no variants; add a variants object with at least one entry"
        )
    for variant_id, variant in variants.items():
        if not _module_root_valid(package_id, variant_id, variant):
            expected = addon_module_root(package_id, variant_id)
            warnings.append(
                f"variants.{variant_id}: every mpAssets root must be {expected} "
                "(moa_ namespace)"
            )
    declared_id = _text_field(manifest, "id")
    if declared_id is not None and declared_id != package_id:
        warnings.append(
            f"manifest.json: manifest id {declared_id!r} does not match the folder "
            f"name {package_id!r}"
        )
    precedences = [
        variant["precedence"]
        for variant in variants.values()
        if isinstance(variant.get("precedence"), int)
    ]
    if len(precedences) != len(set(precedences)):
        warnings.append("variants declare duplicate precedence values")
    return tuple(warnings)


def installed_addons(addons_root: Path | None) -> tuple[AddonRecord, ...]:
    """Return every installed add-on package, in id order.

    A package whose manifest is not a JSON object is skipped: one broken add-on must
    never break the whole inventory. ``name``/``version`` come from the top-level
    manifest; ``variants`` are the ``variants`` dict keys and ``module_roots`` the
    declared ``mpAssets`` first segments. The optional install record supplies
    ``archive_sha256`` and ``installed_at``; a package installed by hand has neither.
    """

    records: list[AddonRecord] = []
    for package_id, package_dir in iter_addon_package_dirs(addons_root):
        manifest = _read_json_object(package_dir / ADDON_MANIFEST_NAME)
        if manifest is None:
            continue
        record = _read_json_object(package_dir / INSTALL_RECORD_NAME) or {}
        records.append(
            AddonRecord(
                id=package_id,
                name=_text_field(manifest, "name"),
                version=_text_field(manifest, "version"),
                package_dir=package_dir,
                manifest=manifest,
                archive_sha256=_text_field(record, "archiveSha256"),
                installed_at=_text_field(record, "installedAt"),
                module_roots=_module_roots_of(package_variants(manifest)),
                variants=variant_ids(manifest),
                contract_warnings=_contract_warnings(package_id, manifest),
            )
        )
    return tuple(records)


def read_addon_manifest(
    addons_root: Path | None,
    package_id: str,
) -> Mapping[str, object] | None:
    """Return the manifest of an installed add-on, or ``None`` when it is not installed.

    This is the single manifest reader; callers never build the path themselves and
    never have to ``stat()`` the addons root.
    """

    if addons_root is None or not is_package_id(package_id):
        return None
    manifest = Path(addons_root) / package_id / ADDON_MANIFEST_NAME
    if not manifest.is_file():
        return None
    return _read_json_object(manifest)


def builtin_package_ids(device_root: Path) -> tuple[str, ...]:
    """Return the built-in package ids from ``device_root/node_pkgs/index.json``.

    Ids keep their index order, and duplicates are preserved exactly as the file
    declares them. A missing or malformed index yields an empty tuple, mirroring the
    build stack's tolerant reader.
    """

    payload = _read_json_object(Path(device_root) / BUILTIN_INDEX_RELATIVE)
    packages = payload.get("packages") if payload is not None else None
    if not isinstance(packages, list):
        return ()
    ids: list[str] = []
    for entry in packages:
        if isinstance(entry, dict):
            package_id = entry.get("id")
            if isinstance(package_id, str) and package_id:
                ids.append(package_id)
    return tuple(ids)


def provenance_of(
    device_root: Path,
    addons_root: Path | None,
    package_id: str,
) -> PackageProvenance | None:
    """Return where *package_id* comes from, or ``None`` when nothing provides it.

    A built-in id wins over an add-on folder with the same name. The install guard
    makes that state unreachable; this function stays total anyway.
    """

    if package_id in builtin_package_ids(device_root):
        return PackageProvenance.BUILTIN
    if read_addon_manifest(addons_root, package_id) is not None:
        return PackageProvenance.ADDON
    return None


def addon_index_entries(addons_root: Path | None) -> tuple[dict[str, str], ...]:
    """Return one ``node_pkgs``-relative index entry per package, in id order.

    Every entry points at ``"<id>/manifest.json"``; the v2 manifest's ``variants`` dict
    holds each implementation, so there is no per-variant entry. The ``manifest`` value
    is deliberately ``node_pkgs``-relative while ``root`` tells the resolver which folder
    to join it against. A package with no variants, one whose ``mpAssets`` root escapes
    the ``moa_`` namespace, or one that does not parse gets no entry, so a broken add-on
    never reaches a client.
    """

    entries: list[dict[str, str]] = []
    for package_id, package_dir in iter_addon_package_dirs(addons_root):
        manifest = _read_json_object(package_dir / ADDON_MANIFEST_NAME)
        if manifest is None:
            continue
        variants = package_variants(manifest)
        if not variants:
            continue
        if any(
            not _module_root_valid(package_id, variant_id, variant)
            for variant_id, variant in variants.items()
        ):
            continue
        entries.append(
            {
                "id": package_id,
                "manifest": f"{package_id}/{ADDON_MANIFEST_NAME}",
                "root": ADDON_INDEX_ROOT,
            }
        )
    return tuple(entries)


def merged_index_payload(device_root: Path, addons_root: Path | None) -> dict[str, object]:
    """Return the built-in index extended with one entry per installed add-on.

    The built-in entries keep their dicts and order; add-ons follow in id order. An
    add-on id that also exists as a built-in is dropped (built-in wins, and the
    install guard keeps the state unreachable). With ``addons_root=None`` the payload
    equals the file that was read, which is what keeps the served index
    byte-identical for an installation without add-ons.
    """

    payload = _read_json_object(Path(device_root) / BUILTIN_INDEX_RELATIVE) or {}
    declared = payload.get("packages")
    builtin_entries: list[object] = list(declared) if isinstance(declared, list) else []
    builtin_ids = {
        entry.get("id")
        for entry in builtin_entries
        if isinstance(entry, dict) and isinstance(entry.get("id"), str)
    }

    merged: list[object] = list(builtin_entries)
    for entry in addon_index_entries(addons_root):
        if entry["id"] in builtin_ids:
            continue
        merged.append(entry)

    result = dict(payload)
    result.setdefault("version", 1)
    result["packages"] = merged
    return result


def addon_asset_path(addons_root: Path | None, parts: Sequence[str]) -> Path | None:
    """Map a ``node_pkgs``-relative path onto the addons root, or ``None``.

    *parts* is the already-split path below ``/device/node_pkgs/``, for example
    ``("<id>", "manifest.json")`` or ``("<id>", "otter_<id>", "driver.py")``. The
    result is ``None`` when the first segment is not an installed add-on, when any
    segment is empty, ``.``, ``..``, absolute, or separator-bearing, or when the
    resolved file would escape the package directory. This is the only path assembly
    allowed for add-on assets.
    """

    if addons_root is None or len(parts) < 2:
        return None
    package_id, *relative_parts = parts
    if not is_package_id(package_id):
        return None
    for segment in relative_parts:
        if not segment or segment in (".", "..") or "/" in segment or "\\" in segment:
            return None
        if Path(segment).is_absolute():
            return None
    if read_addon_manifest(addons_root, package_id) is None:
        return None

    package_dir = (Path(addons_root) / package_id).resolve()
    try:
        resolved = package_dir.joinpath(*relative_parts).resolve()
        resolved.relative_to(package_dir)
    except (OSError, ValueError):
        return None
    return resolved


def addon_conflicts(device_root: Path, addons_root: Path | None) -> tuple[str, ...]:
    """Return built-in ids that also exist as add-on folders.

    ``mo addons list`` warns about these and the install guard rejects them, so the
    tuple is normally empty; it exists to make a hand-copied folder visible instead of
    silently shadowed.
    """

    if addons_root is None:
        return ()
    builtin_ids = set(builtin_package_ids(device_root))
    return tuple(
        package_id
        for package_id, _package_dir in iter_addon_package_dirs(addons_root)
        if package_id in builtin_ids
    )


def addon_inventory_payload(device_root: Path, addons_root: Path | None) -> dict[str, object]:
    """Return the installed add-on inventory as the one wire and CLI payload shape.

    Both the ``addon.install`` / ``addon.uninstall`` result frames and
    ``mo addons list --json-output`` use this dict, so a client decodes one shape and
    the CLI cannot report something the Firmware tab cannot. It is **read-only**:
    nothing here creates, repairs, or deletes a folder, manifest, or install record.

    ``addons`` holds one row per installed package in id order (``id``, ``version``,
    ``name``, ``variants``, ``moduleRoots``, ``packageDir``, ``provenance``,
    ``installedAt``); ``conflicts`` names hand-copied folders that shadow a built-in
    id; ``warnings`` repeats both families as human-readable lines, conflicts first.
    An absent root yields three empty lists, like every other reader in this module.
    """

    records = installed_addons(addons_root)
    conflicts = addon_conflicts(device_root, addons_root)
    return {
        "addons": [
            {
                "id": record.id,
                "version": record.version,
                "name": record.name,
                "variants": list(record.variants),
                "moduleRoots": list(record.module_roots),
                "packageDir": str(record.package_dir),
                "provenance": str(provenance_of(device_root, addons_root, record.id)),
                "installedAt": record.installed_at,
            }
            for record in records
        ],
        "conflicts": list(conflicts),
        "warnings": [
            f"{package_id} shadows a built-in package and is ignored by the build"
            for package_id in conflicts
        ]
        + [
            f"{record.id}: {warning}"
            for record in records
            for warning in record.contract_warnings
        ],
    }


def apply_addons_to_runtime_manifest(
    manifest: Mapping[str, object],
    addon_ids: Sequence[str],
) -> dict[str, object]:
    """Return a copy of *manifest* whose ``nodePackages.addons`` lists *addon_ids*.

    Every other key is preserved and ``global``/``local`` are untouched, so the served
    manifest keeps describing the shipped runtime. ``addons`` is always a sorted list
    (empty when nothing is installed). A ``nodePackages`` mapping is created when it is
    absent; a non-mapping value (the external-collection ``nodePackagesPath`` form,
    where add-ons cannot apply) is left exactly as it is.
    """

    updated: dict[str, object] = dict(manifest)
    declared = updated.get("nodePackages")
    merged_ids = sorted({str(package_id) for package_id in addon_ids})

    if declared is None:
        updated["nodePackages"] = {RUNTIME_ADDONS_KEY: merged_ids}
        return updated
    if not isinstance(declared, Mapping):
        return updated

    node_packages = dict(declared)
    node_packages[RUNTIME_ADDONS_KEY] = merged_ids
    updated["nodePackages"] = node_packages
    return updated


def runtime_manifest_addons(
    device_root: Path,
    request_path: str,
    addons_root: Path | None,
) -> dict[str, object] | None:
    """Return the merged runtime manifest for a manifest request, or ``None``.

    *request_path* is matched here (not in each server) so the two servers cannot
    drift on which requests are synthesized. Only a real
    ``/device/runtime/<id>/manifest.json`` with `<id>` a single path segment resolves;
    a missing or malformed manifest yields ``None`` so the caller can fall through to
    its normal static handling.
    """

    if not request_path.startswith(DEVICE_RUNTIME_PREFIX):
        return None
    if not request_path.endswith(f"/{RUNTIME_MANIFEST_NAME}"):
        return None
    runtime_id = request_path[len(DEVICE_RUNTIME_PREFIX) : -(len(RUNTIME_MANIFEST_NAME) + 1)]
    if not runtime_id or "/" in runtime_id or runtime_id in (".", ".."):
        return None

    manifest = _read_json_object(
        Path(device_root) / "runtime" / runtime_id / RUNTIME_MANIFEST_NAME
    )
    if manifest is None:
        return None
    return apply_addons_to_runtime_manifest(
        manifest,
        [record.id for record in installed_addons(addons_root)],
    )

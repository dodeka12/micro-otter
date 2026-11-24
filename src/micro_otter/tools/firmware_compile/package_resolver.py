"""Node package resolution for firmware build tooling.

Global node packages are registered in ``node_pkgs/index.json``, which maps a stable
package id to the folder holding that package's single ``manifest.json`` (e.g.
``core`` -> ``core/manifest.json``). Each manifest declares its implementations under a
``variants`` dict, so one index entry describes one package and no id is ever shared by
two entries. This module resolves ids to folders and selects one variant per id when
the target capabilities satisfy its ``requiredCapabilities`` (CNF); ties are broken by
each variant's ``precedence`` (higher wins).

A package id resolves against **two** roots: the shipped device tree
(``<device_root>/node_pkgs``) first and the user's add-ons folder
(``<addons_root>/<id>``) second. :class:`PackageRoots` is the only place that turns a
package entry into a path, so no call site re-grows a second ``node_pkgs`` join. Both
roots use the same ``node_pkgs``-relative manifest value, which is what lets one index
entry describe a package in either root.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

from micro_otter.tools.addon_store import (
    DEFAULT_VARIANT_ID,
    addon_index_entries,
    package_variants,
)

from .capability_requirements import evaluate_requirements


class NodePackageRoot(StrEnum):
    """Which root a node package resolves against."""

    DEVICE = "device"
    """The shipped ``<device_root>/node_pkgs`` root."""

    ADDONS = "addons"
    """The user's ``<addons_root>/<id>`` root."""


@dataclass(frozen=True)
class PackageRoots:
    """The two places a node package may live, resolved once per call."""

    device_root: Path
    """Device tree root; its ``node_pkgs`` folder holds the shipped packages."""

    addons_root: Path | None = None
    """Add-ons folder, or ``None`` for built-in-only resolution."""

    @property
    def builtin_node_pkgs(self) -> Path:
        """Return the shipped ``node_pkgs`` directory."""

        return self.device_root / "node_pkgs"

    def root_path(self, root: NodePackageRoot) -> Path:
        """Return the directory a ``node_pkgs``-relative manifest path joins against.

        Raises
        ------
        ValueError
            When *root* is :attr:`NodePackageRoot.ADDONS` but no add-ons folder was
            configured; callers that pass an add-on entry always pass the root.
        """

        if root is NodePackageRoot.ADDONS:
            if self.addons_root is None:
                raise ValueError("an add-on package entry needs an addons root")
            return self.addons_root
        return self.builtin_node_pkgs

    def manifest_path(self, entry: PackageIndexEntry) -> Path:
        """Return the manifest file of *entry* inside its own root."""

        return self.root_path(entry.root) / entry.manifest

    def package_dir(self, entry: PackageIndexEntry) -> Path:
        """Return the package directory of *entry*, i.e. the manifest's parent."""

        return self.manifest_path(entry).parent

    def asset_path(self, package_dir: Path, rel_path: str) -> Path:
        """Join *rel_path* onto *package_dir* and reject escapes.

        Raises
        ------
        ValueError
            When *rel_path* is empty, absolute, separator-bearing on the wrong side, or
            resolves outside *package_dir*; this is the second line of defence behind
            the add-on archive validation and also covers a hand-edited built-in
            manifest.
        """

        if not rel_path or "\\" in rel_path:
            raise ValueError(f"invalid package asset path: {rel_path!r}")
        if rel_path.startswith("/") or any(part in ("..", "") for part in rel_path.split("/")):
            raise ValueError(f"package asset path escapes its package: {rel_path!r}")
        resolved_dir = package_dir.resolve()
        resolved = (resolved_dir / rel_path).resolve()
        try:
            resolved.relative_to(resolved_dir)
        except ValueError as exc:
            raise ValueError(f"package asset path escapes its package: {rel_path!r}") from exc
        return resolved


def package_roots(device_root: Path, addons_root: Path | None = None) -> PackageRoots:
    """Return the resolver input for one call site (the only constructor callers need)."""

    return PackageRoots(device_root=Path(device_root), addons_root=addons_root)


@dataclass(frozen=True)
class PackageIndexEntry:
    """One ``{id, manifest}`` pair from an index, tagged with the root it belongs to."""

    id: str
    manifest: str
    root: NodePackageRoot = NodePackageRoot.DEVICE
    """Which root the ``node_pkgs``-relative *manifest* path resolves against."""


@dataclass(frozen=True)
class ResolvedVariant:
    """A satisfiable variant together with its id, package version, and root.

    ``manifest`` is the selected variant's sub-dict (``mpAssets``,
    ``requiredCapabilities``, ``precedence``, ``title``, …); ``version`` is the
    package's single top-level ``version``, and ``manifest_rel`` points at the one
    ``manifest.json`` the package ships.
    """

    id: str
    variant_id: str
    manifest_rel: str
    manifest: dict
    precedence: int
    root: NodePackageRoot = NodePackageRoot.DEVICE
    version: str | None = None


class VariantUnknownError(ValueError):
    """Raised when an explicit variant override names a variant the package does not have."""

    code = "variant-unknown"
    """Stable error code surfaced in compile-runtime JSON payloads."""

    def __init__(
        self,
        *,
        package_id: str,
        requested: str,
        known: Sequence[str],
    ) -> None:
        self.package_id = package_id
        self.requested = requested
        self.known = tuple(known)
        known_text = ", ".join(self.known) or DEFAULT_VARIANT_ID
        self.hint = f"Known variants for '{package_id}': {known_text}"
        super().__init__(
            f"Unknown variant {requested!r} for node package '{package_id}'"
        )


class VariantNotSelectedError(ValueError):
    """Raised when a multi-variant package is built without an explicit choice."""

    code = "variant-not-selected"
    """Stable error code surfaced in compile-runtime JSON payloads."""

    def __init__(self, *, package_id: str, known: Sequence[str]) -> None:
        self.package_id = package_id
        self.known = tuple(known)
        self.hint = (
            f"Known variants for '{package_id}': " + ", ".join(self.known)
        )
        super().__init__(
            f"Node package '{package_id}' has multiple variants; select one explicitly"
        )


class VariantCapabilitiesUnsatisfiedError(ValueError):
    """Raised when an explicitly requested variant's capabilities are unsatisfied."""

    code = "variant-capabilities-unsatisfied"
    """Stable error code surfaced in compile-runtime JSON payloads."""

    def __init__(
        self,
        *,
        package_id: str,
        variant: str,
        missing: Sequence[Sequence[str]],
    ) -> None:
        self.package_id = package_id
        self.variant = variant
        self.missing = tuple(tuple(group) for group in missing)
        self.hint = (
            f"Variant {variant!r} of '{package_id}' needs capabilities this target "
            "does not provide"
        )
        super().__init__(
            f"Variant {variant!r} of node package '{package_id}' is unsatisfiable on this target"
        )


def load_package_entries(
    device_root: Path,
    *,
    addons_root: Path | None = None,
) -> list[PackageIndexEntry]:
    """Return the ``{id, manifest}`` entries of the built-in index plus the add-ons.

    The shipped entries keep their parsing and order. Installed add-ons follow in id
    order, tagged :attr:`NodePackageRoot.ADDONS`, and an add-on id that a built-in
    entry already declares is dropped (built-in wins; the install guard keeps that
    state unreachable). The function stays total: a missing or malformed index yields
    just the add-on entries, and a broken add-on is skipped by the store.

    Raises
    ------
    ValueError
        Never; callers that then resolve an unknown id raise it themselves, so a
        package declared without an index entry still fails loudly where it matters.
    """

    roots = package_roots(device_root, addons_root)
    try:
        payload = json.loads((roots.builtin_node_pkgs / "index.json").read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        payload = None

    packages = payload.get("packages") if isinstance(payload, dict) else None
    entries: list[PackageIndexEntry] = []
    if isinstance(packages, list):
        for entry in packages:
            if not isinstance(entry, dict):
                continue
            package_id = entry.get("id")
            manifest_rel = entry.get("manifest")
            if (
                isinstance(package_id, str)
                and package_id
                and isinstance(manifest_rel, str)
                and manifest_rel
            ):
                entries.append(PackageIndexEntry(id=package_id, manifest=manifest_rel))

    builtin_ids = {entry.id for entry in entries}
    for addon_entry in addon_index_entries(addons_root):
        if addon_entry["id"] in builtin_ids:
            continue
        entries.append(
            PackageIndexEntry(
                id=addon_entry["id"],
                manifest=addon_entry["manifest"],
                root=NodePackageRoot.ADDONS,
            )
        )

    return entries


def read_package_manifest(
    device_root: Path,
    manifest_rel: str,
    *,
    addons_root: Path | None = None,
    root: NodePackageRoot = NodePackageRoot.DEVICE,
) -> dict:
    """Return the manifest object at ``node_pkgs``-relative *manifest_rel*.

    ``root`` selects which folder the relative path joins against, so an add-on
    manifest is read from the add-ons folder with the very same relative value.

    Raises
    ------
    OSError
        When the manifest file does not exist, matching the previous contract.
    """

    roots = package_roots(device_root, addons_root)
    manifest_path = roots.root_path(root) / manifest_rel
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    return payload if isinstance(payload, dict) else {}


def group_entries_by_id(entries: list[PackageIndexEntry]) -> dict[str, list[PackageIndexEntry]]:
    """Group index entries by package id, keeping index order inside each group."""

    grouped: dict[str, list[PackageIndexEntry]] = {}
    for entry in entries:
        grouped.setdefault(entry.id, []).append(entry)
    return grouped


def _manifest_precedence(manifest: dict) -> int:
    """Return the manifest's ``precedence`` value, defaulting to ``0`` when unusable."""

    value = manifest.get("precedence")
    if isinstance(value, bool):
        return 0
    try:
        precedence = int(value)
    except (TypeError, ValueError):
        return 0
    return precedence if precedence >= 0 else 0


def resolve_variant_entries(
    entries: list[PackageIndexEntry],
    package_id: str,
) -> list[PackageIndexEntry]:
    """Return every index entry declaring *package_id*, in index order.

    Raises
    ------
    ValueError
        When no entry declares the id; the caller turns that into an actionable
        ``unknown-package-id`` error.
    """

    variants = group_entries_by_id(entries).get(package_id)
    if not variants:
        raise ValueError(f"Unknown node package id: {package_id}")
    return variants


def read_package_variants(manifest: Mapping[str, object]) -> dict[str, Mapping[str, object]]:
    """Return the ``variants`` dict of a v2 *manifest*.

    A thin wrapper over :func:`micro_otter.tools.addon_store.package_variants`, kept so
    this resolver's callers import one vocabulary for reading a package's variants.
    """

    return package_variants(manifest)


def select_variant(
    entries: list[PackageIndexEntry],
    package_id: str,
    *,
    device_root: Path,
    addons_root: Path | None = None,
    is_general: Callable[[str], bool],
    has_general_capability: Callable[[str], bool],
    has_pin_capability: Callable[[str], bool],
    requested_variant: str | None = None,
) -> ResolvedVariant | None:
    """Select a satisfiable variant of *package_id*.

    The package's single ``manifest.json`` is read from its own root, so an add-on is
    resolved from the add-ons folder without re-deriving the root at the call site, and
    its ``variants`` dict supplies the candidates. Without *requested_variant*, the
    satisfiable variant with the highest ``precedence`` wins (``None`` when none is
    satisfiable; ``ValueError`` on an ambiguity). With *requested_variant*, only that
    variant id is considered: an unknown id raises :class:`VariantUnknownError`, an
    unsatisfiable one raises :class:`VariantCapabilitiesUnsatisfiedError`, and the
    selected entry is returned without precedence comparison (the caller already chose).
    """

    entry = resolve_variant_entries(entries, package_id)[0]
    manifest = read_package_manifest(
        device_root,
        entry.manifest,
        addons_root=addons_root,
        root=entry.root,
    )
    variants = package_variants(manifest)
    known = list(variants)
    raw_version = manifest.get("version")
    version = raw_version if isinstance(raw_version, str) else None

    package_ok, package_missing = evaluate_requirements(
        manifest.get("requiredCapabilities"),
        is_general,
        has_general_capability,
        has_pin_capability,
    )
    if not package_ok:
        if requested_variant is not None:
            raise VariantCapabilitiesUnsatisfiedError(
                package_id=package_id,
                variant=requested_variant,
                missing=package_missing,
            )
        return None

    if requested_variant is None and len(known) > 1:
        raise VariantNotSelectedError(package_id=package_id, known=known)

    satisfied: list[ResolvedVariant] = []
    for variant_id, variant in variants.items():
        if requested_variant is not None and variant_id != requested_variant:
            continue

        ok, missing = evaluate_requirements(
            variant.get("requiredCapabilities"),
            is_general,
            has_general_capability,
            has_pin_capability,
        )
        if ok:
            satisfied.append(
                ResolvedVariant(
                    id=package_id,
                    variant_id=variant_id,
                    manifest_rel=entry.manifest,
                    manifest=variant,
                    precedence=_manifest_precedence(variant),
                    root=entry.root,
                    version=version,
                )
            )
        elif requested_variant is not None:
            raise VariantCapabilitiesUnsatisfiedError(
                package_id=package_id,
                variant=requested_variant,
                missing=missing,
            )

    if requested_variant is not None:
        if not satisfied:
            raise VariantUnknownError(
                package_id=package_id,
                requested=requested_variant,
                known=known,
            )
        return satisfied[0]

    if not satisfied:
        return None

    satisfied.sort(key=lambda variant: variant.precedence, reverse=True)
    best = satisfied[0]
    if any(variant.precedence == best.precedence for variant in satisfied[1:]):
        raise ValueError(
            f"Ambiguous node package variants for '{package_id}': multiple satisfiable "
            f"variants share precedence {best.precedence}"
        )
    return best

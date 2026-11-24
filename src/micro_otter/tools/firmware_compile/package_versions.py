"""One collector for the package versions and variants a firmware image freezes.

Version collection used to exist twice — inside the compile command and inside
staleness — and both copies refused to answer for a package that ships more than one
manifest. This module answers once: :func:`collect_package_versions` takes the same
:class:`...target_context.TargetPackageContext` staging uses, selects variants through
:func:`...package_resolver.select_variant`, and returns both the versions and the
effective ``packageId → variantId`` map that the firmware identity records.

A variant is an implementation of one package, so ``packageVersions`` stays keyed by
package id: every variant of a package must declare the same ``version``.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from micro_otter.tools.addon_store import PackageProvenance, addon_index_entries

from .package_resolver import (
    NodePackageRoot,
    load_package_entries,
    select_variant,
)
from .target_context import TargetPackageContext
from .version_semver import try_parse_version

__all__ = [
    "PackageVersionInventory",
    "collect_package_versions",
    "read_device_tools_version",
    "read_manifest_version",
]


@dataclass(frozen=True, slots=True)
class PackageVersionInventory:
    """Built-in and add-on package versions that make up one image.

    ``builtin`` and ``addons`` are kept disjoint; an id colliding across the two is
    refused because ``mo addons install`` already guards that case, so a collision
    here can only mean an internal bug. ``variants`` maps every package id that made
    it into the image to the implementation the target froze; it defaults to empty so
    a caller that only records versions keeps working.
    """

    builtin: Mapping[str, str]
    addons: Mapping[str, str]
    variants: Mapping[str, str] = field(default_factory=dict)

    def merged(self) -> dict[str, str]:
        """Return the union, sorted by package id, for the legacy call sites.

        Raises
        ------
        ValueError
            When an id appears in both maps: that would silently drop a package
            otherwise.
        """

        overlap = set(self.builtin) & set(self.addons)
        if overlap:
            raise ValueError(f"built-in/add-on package id collision: {sorted(overlap)}")
        return dict(sorted({**self.builtin, **self.addons}.items()))


def read_manifest_version(path: Path) -> str | None:
    """Return the ``version`` field from *path*, or ``None`` if absent/invalid.

    A missing, unreadable or malformed manifest, and a ``version`` that is not a
    semver string, all yield ``None`` so one broken package never aborts collection.
    """

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    version = payload.get("version") if isinstance(payload, dict) else None
    return version if isinstance(version, str) and try_parse_version(version) else None


def read_device_tools_version(device_root: Path) -> str:
    """Return the device tools manifest version, or ``"0.0.0"`` when unreadable."""

    return read_manifest_version(device_root / "tools" / "manifest.json") or "0.0.0"


def _package_provenance_payload(
    device_root: Path,
    addons_root: Path | None,
) -> dict[str, str]:
    """Return ``{package_id: "builtin" | "addon"}`` for every resolvable package.

    Provenance is reported for the reproducibility payload only; nothing consults it to
    decide what is staged, compiled, or deployed.
    """

    provenance: dict[str, str] = {}
    for entry in load_package_entries(device_root, addons_root=addons_root):
        provenance[entry.id] = (
            PackageProvenance.ADDON.value
            if entry.root is NodePackageRoot.ADDONS
            else PackageProvenance.BUILTIN.value
        )
    return provenance


def _selected_package_ids(
    runtime_payload: Mapping[str, Any],
    package_ids: tuple[str, ...] | None,
    addons_root: Path | None,
) -> set[str]:
    """Return the ids the image would freeze before capability gating.

    This mirrors the compile command's selection exactly: every declared ``global`` and
    ``runtime`` id, narrowed by *package_ids* when given, plus every installed add-on
    under the same narrowing. Non-string and empty ids are ignored.
    """

    package_groups = (
        runtime_payload.get("nodePackages")
        if isinstance(runtime_payload, Mapping)
        else None
    )
    selected: set[str] = set()
    if isinstance(package_groups, Mapping):
        for group_name in ("global", "runtime"):
            group_values = package_groups.get(group_name)
            if isinstance(group_values, list):
                for package_id in group_values:
                    if isinstance(package_id, str) and package_id:
                        selected.add(package_id)
    if package_ids is not None:
        selected &= set(package_ids)
    for entry in addon_index_entries(addons_root):
        if package_ids is None or entry["id"] in package_ids:
            selected.add(entry["id"])
    return selected


def collect_package_versions(
    *,
    device_root: Path,
    runtime_payload: Mapping[str, Any],
    context: TargetPackageContext,
    package_ids: tuple[str, ...] | None = None,
    addons_root: Path | None = None,
    requested_variants: Mapping[str, str] | None = None,
) -> PackageVersionInventory:
    """Return the versions and effective variants of the packages an image freezes.

    *context* answers the variant question exactly as staging does, so the recorded
    identity can never name a different implementation than the image contains.
    ``requested_variants`` is the caller's explicit override map: an unknown or
    unsatisfiable request raises from :func:`...package_resolver.select_variant` and
    surfaces as exit code ``2``, because a request that cannot be honoured must not be
    silently replaced.

    A package with no satisfiable variant is skipped: staging already reported the
    exclusion, and an image that does not contain the package must not claim it
    (Decision D3). ``variants`` therefore covers exactly the frozen packages. One
    package is one version: the selected variant carries the package's single top-level
    ``version``, so there is nothing to reconcile across variants.
    """

    selected = _selected_package_ids(runtime_payload, package_ids, addons_root)
    entries = load_package_entries(device_root, addons_root=addons_root)
    provenance = _package_provenance_payload(device_root, addons_root)

    builtin: dict[str, str] = {}
    addons: dict[str, str] = {}
    variants: dict[str, str] = {}
    for package_id in sorted(selected):
        variant = select_variant(
            entries,
            package_id,
            device_root=device_root,
            addons_root=addons_root,
            is_general=context.is_general,
            has_general_capability=context.has_general_capability,
            has_pin_capability=context.has_pin_capability,
            requested_variant=(requested_variants or {}).get(package_id),
        )
        if variant is None:
            continue
        version = variant.version
        if version is None or try_parse_version(version) is None:
            continue
        if provenance.get(package_id) == PackageProvenance.ADDON.value:
            addons[package_id] = version
        else:
            builtin[package_id] = version
        variants[package_id] = variant.variant_id

    return PackageVersionInventory(builtin=builtin, addons=addons, variants=variants)

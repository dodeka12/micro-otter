"""Manifest resolution for firmware runtime staging."""

from __future__ import annotations

import json
import warnings
from collections.abc import Mapping, Sequence
from pathlib import Path

from micro_otter.tools.addon_store import PackageProvenance, addon_index_entries

from .git_source import capture_git_source
from .mpy_precompile import normalize_mpy_source_excludes
from .package_resolver import (
    NodePackageRoot,
    PackageIndexEntry,
    load_package_entries,
    package_roots,
    select_variant,
)
from .staging_models import RuntimePackageAsset, RuntimePayload
from .staging_runtime_assets import read_runtime_assets_version
from .target_context import TargetPackageContext, resolve_target_package_context
from .target_mapping import resolve_compile_target_resolution
from .version_semver import try_parse_version


class UnknownPackageIdError(ValueError):
    """Raised when requested package ids are not declared by the runtime manifest."""

    code = "unknown-package-id"
    """Stable error code surfaced in compile-runtime JSON payloads."""

    def __init__(self, *, requested: Sequence[str], known: Sequence[str]) -> None:
        self.requested: tuple[str, ...] = tuple(requested)
        self.known: tuple[str, ...] = tuple(known)
        known_text = ", ".join(self.known) if self.known else "(none)"
        self.hint = f"Known package ids for this runtime: {known_text}"
        super().__init__(
            "Unknown node package id(s) for this runtime: " + ", ".join(self.requested)
        )


class PackageNotStagedError(ValueError):
    """Raised when requested package ids are runtime-local and never staged."""

    code = "package-not-staged"
    """Stable error code surfaced in compile-runtime JSON payloads."""

    def __init__(self, *, package_ids: Sequence[str]) -> None:
        self.package_ids: tuple[str, ...] = tuple(package_ids)
        self.hint = (
            "Runtime-local packages live in device/runtime/<runtime_id>/node_pkgs/ and are "
            "never staged into a firmware image; drop them from the selection and deploy "
            "their sources instead."
        )
        super().__init__(
            "Package(s) are runtime-local and cannot be frozen into an image: "
            + ", ".join(self.package_ids)
        )


class VariantPackageNotSelectedError(ValueError):
    """Raised when a variant override names a package that is not selected for the image."""

    code = "variant-package-not-selected"
    """Stable error code surfaced in compile-runtime JSON payloads."""

    def __init__(self, *, package_ids: Sequence[str]) -> None:
        self.package_ids: tuple[str, ...] = tuple(package_ids)
        self.hint = "Select the package before choosing one of its variants"
        super().__init__(
            "Variant override names package(s) not selected for the image: "
            + ", ".join(self.package_ids)
        )


def _read_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _resolve_runtime_dir_name(runtime_index: dict, runtime_id: str) -> str:
    runtimes = runtime_index.get("runtimes", {})
    if runtime_id not in runtimes:
        raise ValueError(f"Unknown runtime id: {runtime_id}")
    runtime_dir = runtimes[runtime_id]
    if not isinstance(runtime_dir, str) or not runtime_dir:
        raise ValueError(f"Invalid runtime mapping for runtime id: {runtime_id}")
    return runtime_dir


def _validate_runtime_target_support(runtime_manifest: dict, target: str) -> None:
    target_info = runtime_manifest.get("deviceTargets", {})
    include = target_info.get("include", [])
    exclude = target_info.get("exclude", [])

    if include and target not in include:
        raise ValueError(f"Runtime does not support target: {target}")
    if target in exclude:
        raise ValueError(f"Runtime excludes target: {target}")


def _flatten_mp_assets(package_manifest: dict) -> list[str]:
    mp_assets = package_manifest.get("mpAssets", {})
    files: list[str] = []
    for _, group_files in mp_assets.items():
        for rel_path in group_files:
            if rel_path not in files:
                files.append(rel_path)
    return files


def _resolve_package_assets(
    device_root: Path,
    package_ids: list[str],
    context: TargetPackageContext,
    *,
    addons_root: Path | None = None,
    package_variants: Mapping[str, str] | None = None,
) -> tuple[RuntimePackageAsset, ...]:
    """Resolve the staged assets of *package_ids* from both package roots.

    ``addons_root=None`` resolves built-in packages only, reproducing the pre-add-on
    behaviour exactly. Each variant's package directory and each declared asset path
    come from :class:`PackageRoots`, so no call site joins ``node_pkgs`` itself.
    ``context`` supplies the target's capability predicates — the same ones version
    collection uses — so staging cannot select a different variant than the identity
    records. ``package_variants`` overrides the auto-selected variant per package id;
    an unknown or unsatisfiable override raises from :func:`select_variant`.
    """

    roots = package_roots(device_root, addons_root)
    entries = load_package_entries(device_root, addons_root=addons_root)

    requested_variant = (package_variants or {}).get

    assets: list[RuntimePackageAsset] = []
    for package_id in package_ids:
        variant = select_variant(
            entries,
            package_id,
            device_root=device_root,
            addons_root=addons_root,
            is_general=context.is_general,
            has_general_capability=context.has_general_capability,
            has_pin_capability=context.has_pin_capability,
            requested_variant=requested_variant(package_id),
        )
        if variant is None:
            warnings.warn(
                f"Excluding node package '{package_id}': missing required capabilities",
                stacklevel=2,
            )
            continue

        package_root = roots.package_dir(
            PackageIndexEntry(
                id=variant.id,
                manifest=variant.manifest_rel,
                root=variant.root,
            )
        )
        package_version = variant.version
        if package_version is None or try_parse_version(str(package_version)) is None:
            raise ValueError(
                f"Node package '{package_id}' manifest version must be semver x.y.z; "
                f"got {package_version!r} (manifest: {variant.manifest_rel})"
            )
        provenance = (
            PackageProvenance.ADDON
            if variant.root is NodePackageRoot.ADDONS
            else PackageProvenance.BUILTIN
        )

        for rel_path in _flatten_mp_assets(variant.manifest):
            assets.append(
                RuntimePackageAsset(
                    package_id=package_id,
                    package_version=package_version,
                    source_path=roots.asset_path(package_root, rel_path),
                    target_rel_path=rel_path,
                    provenance=provenance,
                )
            )

    return tuple(assets)


def _select_package_ids(
    *,
    global_ids: list[str],
    addon_ids: list[str],
    local_ids: list[str],
    requested: Sequence[str] | None,
) -> list[str]:
    """Resolve the caller's package selection against the runtime manifest.

    ``requested`` of ``None``/empty keeps every declared package plus every installed
    add-on: ``global ∪ addons ∪ local``. With no add-ons installed the result is
    identical to the pre-add-on order. Otherwise unknown ids are rejected, and a
    runtime-local-only id keeps failing with ``package-not-staged`` because such a
    package can never be frozen into an image.
    """

    if not requested:
        return global_ids + addon_ids + local_ids

    known = sorted(set(global_ids) | set(addon_ids) | set(local_ids))
    unknown = sorted({pkg for pkg in requested if pkg not in known})
    if unknown:
        raise UnknownPackageIdError(requested=unknown, known=known)

    stageable = set(global_ids) | set(addon_ids)
    local_only = sorted({pkg for pkg in requested if pkg not in stageable})
    if local_only:
        raise PackageNotStagedError(package_ids=local_only)

    return [pkg for pkg in requested if pkg in stageable]


def resolve_runtime_payload(
    workspace_root: Path,
    runtime_id: str,
    target: str,
    device_root: Path | None = None,
    board: str | None = None,
    package_ids: Sequence[str] | None = None,
    *,
    addons_root: Path | None = None,
    package_variants: Mapping[str, str] | None = None,
) -> RuntimePayload:
    """Resolve runtime, tools, and package manifest payload for staging.

    ``package_ids`` freezes an explicit subset of the runtime's declared packages
    into the image; ``None`` keeps every declared package. ``addons_root`` lets a
    selected id resolve against the user's add-ons folder as well; ``None`` means
    "built-in packages only". ``package_variants`` maps a selected package id to the
    variant id to stage instead of auto-selecting one.
    """

    resolved_device_root = (
        (workspace_root / "src" / "micro_otter" / "nodes" / "device")
        if device_root is None
        else device_root
    ).resolve()

    runtime_index_path = resolved_device_root / "runtime" / "manifest.json"
    runtime_index = _read_json(runtime_index_path)

    runtime_dir_name = _resolve_runtime_dir_name(runtime_index, runtime_id)
    runtime_root = (resolved_device_root / "runtime" / runtime_dir_name).resolve()
    runtime_manifest_path = runtime_root / "manifest.json"
    runtime_manifest = _read_json(runtime_manifest_path)
    _validate_runtime_target_support(runtime_manifest, target)

    tools_manifest = _read_json(resolved_device_root / "tools" / "manifest.json")

    package_groups = runtime_manifest.get("nodePackages", {})
    global_ids = [
        pkg_id for pkg_id in package_groups.get("global", []) if isinstance(pkg_id, str) and pkg_id
    ]
    local_ids = [
        pkg_id for pkg_id in package_groups.get("local", []) if isinstance(pkg_id, str) and pkg_id
    ]
    addon_ids = [entry["id"] for entry in addon_index_entries(addons_root)]
    selected_package_ids = _select_package_ids(
        global_ids=global_ids,
        addon_ids=addon_ids,
        local_ids=local_ids,
        requested=package_ids,
    )

    if package_variants:
        unselected = [pkg for pkg in package_variants if pkg not in selected_package_ids]
        if unselected:
            raise VariantPackageNotSelectedError(package_ids=unselected)

    resolved_runtime_id = runtime_manifest.get("id", runtime_id)
    target_resolution = resolve_compile_target_resolution(
        workspace_root=workspace_root,
        runtime_id=resolved_runtime_id,
        board=board if board is not None else target,
    )
    target_context = resolve_target_package_context(
        device_root=resolved_device_root,
        resolution=target_resolution,
    )

    return RuntimePayload(
        runtime_id=resolved_runtime_id,
        runtime_version=runtime_manifest.get("version", "0.0.0"),
        runtime_root=runtime_root,
        runtime_files=tuple(runtime_manifest.get("filesystem", [])),
        tools_files=tuple(tools_manifest.get("files", [])),
        package_assets=_resolve_package_assets(
            resolved_device_root,
            selected_package_ids,
            target_context,
            addons_root=addons_root,
            package_variants=package_variants,
        ),
        runtime_target_id=target_resolution.web_target_id,
        compile_board_id=target_resolution.compile_board,
        compile_port_id=target_resolution.compile_port,
        target_mapping_rule_id=target_resolution.mapping_rule_id,
        target_mapping_source=target_resolution.mapping_source,
        target_mapping_confidence=target_resolution.mapping_confidence,
        allowed_web_target_ids=target_resolution.allowed_web_target_ids,
        web_target_base_id=(
            target_resolution.allowed_web_target_ids[0]
            if target_resolution.allowed_web_target_ids
            else None
        ),
        runtime_name=runtime_manifest.get("name"),
        runtime_description=runtime_manifest.get("description"),
        runtime_assets_version=read_runtime_assets_version(workspace_root),
        git_source=capture_git_source(workspace_root),
        mpy_source_excludes=normalize_mpy_source_excludes(runtime_manifest),
        addon_package_ids=tuple(addon_ids),
    )

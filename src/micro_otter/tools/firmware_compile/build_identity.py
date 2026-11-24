"""Single build-identity resolver shared by every firmware compile consumer.

Three call sites used to recompute the same identity tuple with different inputs
(the pre-build publish guard, the ``device.json`` constituent bake, and the final
publish step). This module computes the tuple once so a build can never reserve
one file name and publish another.

This phase changes no version semantics: ``runtime_firmware_version`` still comes
from the lineage resolver (phase 2 replaces its body with the tag-derived scheme).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from .content_identity import firmware_content_hash
from .git_source import get_repo_name
from .package_versions import PackageVersionInventory
from .staging_runtime_assets import read_packaged_runtime_assets_version
from .version_identity import format_full_firmware_version

if TYPE_CHECKING:
    from .compile_command import NormalizedCompileRuntimeRequest

__all__ = [
    "BuildIdentity",
    "PackageVersionInventory",
    "resolve_build_identity",
]


@dataclass(frozen=True, slots=True)
class BuildIdentity:
    """Every identity field the compile guard, bake, and publish step need.

    ``package_variants`` is the **effective** ``packageId → variantId`` map for every
    package frozen into the image — what the identity describes. The sibling
    ``requested_package_variants`` is what the caller asked for (``None`` when the
    target's own selection decided), so a request the target could not honour never
    reads as the outcome. ``selection["packageVariants"]`` repeats the request for the
    reproducibility record.
    """

    board_name: str
    board_slug: str
    backend: str
    runtime_id: str
    platform_version: str
    micropython_version: str
    runtime_source_version: str
    device_tools_version: str
    runtime_assets_version: str | None
    runtime_firmware_version: str
    packages: PackageVersionInventory
    package_ids: tuple[str, ...] | None
    package_variants: Mapping[str, str] | None
    constituents: Mapping[str, str]
    content_hash: str
    full_version: str
    filename: str
    requested_package_variants: Mapping[str, str] | None = None
    base_version: str = ""
    channel: str = ""
    selection: Mapping[str, Any] = field(default_factory=dict)
    version_source: str = ""
    commit: str | None = None
    distance: int | None = None
    branch: str | None = None
    tag: str | None = None
    released_at_utc: str | None = None
    shallow: bool = False
    warnings: tuple[dict[str, Any], ...] = ()


def _normalize_runtime_semver(value: object) -> str:
    """Return ``value`` when it is a valid semver, else ``"0.0.0"`` with a warning.

    Mirrors :func:`...compile_command._normalize_runtime_semver` without importing
    ``compile_command`` at module load time, which would be circular.
    """

    from .version_semver import VERSION_RE

    if isinstance(value, str) and VERSION_RE.match(value):
        return value
    import warnings

    warnings.warn(
        f"Runtime version {value!r} is not a valid semver; falling back to '0.0.0'. "
        "Check that the runtime manifest has a valid 'version' field.",
        RuntimeWarning,
        stacklevel=3,
    )
    return "0.0.0"

def resolve_build_identity(
    *,
    request: NormalizedCompileRuntimeRequest,
    runtime_payload: Mapping[str, Any],
    micropython_version: str,
    staged_runtime_assets_version: str | None = None,
) -> BuildIdentity:
    """Compute the identity tuple for *request* from one runtime manifest read.

    The caller reads the runtime manifest once and passes it as
    *runtime_payload*, so the guard and the publish step cannot disagree about
    the inputs. *micropython_version* is the already-resolved MicroPython
    version; *staged_runtime_assets_version* is the version the staged image
    actually contains (preferred over the packaged reader when both are set).
    """

    from .compile_command import _collect_constituent_versions
    from .version_identity import resolve_firmware_version

    runtime_source_version = _normalize_runtime_semver(runtime_payload.get("version"))
    device_tools_version, packages = _collect_constituent_versions(
        device_root=request.device_root,
        runtime_payload=runtime_payload,
        package_ids=request.package_ids,
        addons_root=request.addons_root,
        target_resolution=request.target_resolution,
        requested_variants=request.package_variants,
    )

    warnings: list[dict[str, Any]] = []
    packaged_assets_version = read_packaged_runtime_assets_version()
    if staged_runtime_assets_version is not None and packaged_assets_version is not None:
        if staged_runtime_assets_version != packaged_assets_version:
            warnings.append(
                {
                    "code": "runtime-assets-version-mismatch",
                    "staged": staged_runtime_assets_version,
                    "packaged": packaged_assets_version,
                }
            )
    runtime_assets_version = staged_runtime_assets_version or packaged_assets_version

    firmware_identity = resolve_firmware_version(request.workspace_root)
    runtime_firmware_version = firmware_identity.version

    constituents: dict[str, str] = {
        "runtime-source": runtime_source_version,
        "device-tools": device_tools_version,
    }
    if runtime_assets_version is not None:
        constituents["runtime-assets"] = runtime_assets_version

    selection: dict[str, Any] = {
        "packageIds": sorted(request.package_ids) if request.package_ids is not None else None,
        # The *request*, not the outcome: what the image froze lives in
        # ``package_variants`` (and in the content hash's top-level map).
        "packageVariants": dict(request.package_variants or {}),
        "modulePackagingMode": request.build_profile.packaging_mode.value,
        "optimizationLevel": request.build_profile.optimization_level,
    }

    content_hash = firmware_content_hash(
        slug=request.slug,
        backend=request.target.build_backend,
        platform_version=micropython_version,
        runtime_id=request.runtime_id,
        constituents=constituents,
        embedded_packages=packages.builtin,
        addon_packages=packages.addons,
        selection=selection,
        package_variants=packages.variants,
    )

    full_version = format_full_firmware_version(
        micropython_version=micropython_version,
        board_id=request.slug,
        runtime_id=request.runtime_id,
        runtime_firmware_version=runtime_firmware_version,
        content_hash=content_hash,
    )

    filename = f"{get_repo_name(request.workspace_root)}-{full_version}.bin"

    return BuildIdentity(
        board_name=request.board,
        board_slug=request.slug,
        backend=request.target.build_backend,
        runtime_id=request.runtime_id,
        platform_version=micropython_version,
        micropython_version=micropython_version,
        runtime_source_version=runtime_source_version,
        device_tools_version=device_tools_version,
        runtime_assets_version=runtime_assets_version,
        runtime_firmware_version=runtime_firmware_version,
        packages=packages,
        package_ids=request.package_ids,
        package_variants=packages.variants,
        requested_package_variants=request.package_variants,
        constituents=constituents,
        content_hash=content_hash,
        full_version=full_version,
        filename=filename,
        base_version=firmware_identity.base_version,
        channel=firmware_identity.channel,
        selection=selection,
        version_source=firmware_identity.source.value,
        commit=firmware_identity.commit,
        distance=firmware_identity.distance,
        branch=firmware_identity.branch,
        tag=firmware_identity.tag,
        released_at_utc=firmware_identity.released_at_utc,
        shallow=firmware_identity.shallow,
        warnings=tuple(warnings),
    )


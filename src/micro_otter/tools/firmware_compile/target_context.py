"""One authority for the package variants a compile target may stage.

:func:`...package_resolver.select_variant` decides which implementation of a node
package a build freezes, using three capability predicates. Those predicates used to
be derivable only inside the staging resolver, so every other consumer (identity
collection, staleness) either duplicated the derivation or refused to answer.
:class:`TargetPackageContext` names the question and this module is its single
implementation: staging and version collection therefore cannot disagree about which
variant a target offers.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from .board_registry import (
    BOARD_CATALOG_DEFAULT_PATH,
    BoardCatalogError,
    find_board_by_slug,
    load_board_catalog,
)
from .capability_registry import CapabilityRegistry
from .target_mapping import CompileTargetResolution, resolve_compile_target_resolution
from .target_resolution import (
    TargetResolutionError,
    load_effective_target_payload,
    load_raw_target_payload,
)

__all__ = [
    "TargetPackageContext",
    "build_package_gating_context",
    "load_target_payload",
    "resolve_target_package_context",
    "resolve_target_package_context_for_board",
]


def _always_false(_capability: str) -> bool:
    """Answer ``False`` for every capability id (the unresolved-target predicates)."""

    return False


def _get_resource_value(resources: dict | None, dotted_path: str | None) -> int | None:
    """Return the integer at *dotted_path* inside *resources*, or ``None``.

    Called only by :func:`build_package_gating_context` to read a pin capability's
    resource limit (for example ``resources.pins.i2s``).
    """

    if not dotted_path or not isinstance(resources, dict):
        return None
    current: object = resources
    for part in dotted_path.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current if isinstance(current, int) else None


def load_target_payload(device_root: Path, target_id: str | None) -> dict | None:
    """Return the raw ``targets/<target_id>.json`` payload, or ``None``.

    Kept for existing callers/tests as the raw single-file reader; resolution
    through a derivation chain uses :func:`load_effective_target_payload`.
    """

    return load_raw_target_payload(device_root, target_id)


def build_package_gating_context(
    target_payload: dict | None, registry: CapabilityRegistry
) -> tuple[Callable[[str], bool], Callable[[str], bool], Callable[[str], bool]]:
    """Return the three capability predicates :func:`select_variant` consumes.

    ``is_general`` answers whether a capability id belongs to the ``general`` domain,
    ``has_general_capability`` whether the target payload marks it as supported, and
    ``has_pin_capability`` whether the target exposes at least one pin for it. A
    ``None`` payload degrades to "no general capability supported", which is what a
    target without a resolvable payload has always meant.
    """

    general = (target_payload or {}).get("generalCapabilities") or {}
    resources = (target_payload or {}).get("resources") or {}

    def is_general(capability: str) -> bool:
        return registry.get_domain(capability) == "general"

    def has_general_capability(capability: str) -> bool:
        entry = general.get(capability)
        return isinstance(entry, dict) and entry.get("supported") is True

    def has_pin_capability(capability: str) -> bool:
        descriptor = registry.get(capability)
        if not descriptor or not descriptor.get("limitKey"):
            return False
        value = _get_resource_value(resources, descriptor.get("limitKey"))
        return isinstance(value, int) and value > 0

    return is_general, has_general_capability, has_pin_capability


@dataclass(frozen=True, slots=True)
class TargetPackageContext:
    """Capability predicates that decide which package variant a target may stage.

    ``target_id`` is the resolved web target whose payload supplied the predicates
    (``None`` when no target could be resolved). The three callables are exactly the
    arguments :func:`...package_resolver.select_variant` takes, so every consumer
    asks the same question with the same answer.
    """

    target_id: str | None
    is_general: Callable[[str], bool]
    has_general_capability: Callable[[str], bool]
    has_pin_capability: Callable[[str], bool]

    @classmethod
    def none(cls) -> TargetPackageContext:
        """Return the context of an unresolved target: nothing is supported.

        This reproduces the historical ``target_payload=None`` behaviour exactly (no
        ``general`` capability is reported), so only variants that require no
        capabilities remain selectable. Callers that merely *compare* (staleness) use
        it instead of failing when no target can be resolved.
        """

        return cls(
            target_id=None,
            is_general=_always_false,
            has_general_capability=_always_false,
            has_pin_capability=_always_false,
        )


def resolve_target_package_context(
    *,
    device_root: Path,
    resolution: CompileTargetResolution,
) -> TargetPackageContext:
    """Build the context for the target *resolution* already carries.

    The target id is the first of ``resolution.allowed_web_target_ids`` — the same id
    staging reads — and the capability registry is loaded from *device_root*, so a
    build that holds a resolution needs no second resolution to answer the variant
    question. An empty allowed-id tuple yields :meth:`TargetPackageContext.none`, and so
    does an unreadable capability registry: staging reads the same registry and fails
    first when it is truly missing, while identity collection must never turn a
    completed build into an error.
    """

    allowed = resolution.allowed_web_target_ids
    target_id = allowed[0] if isinstance(allowed, tuple | list) and allowed else None
    if not isinstance(target_id, str) or not target_id:
        return TargetPackageContext.none()
    try:
        registry = CapabilityRegistry(device_root / "capabilities")
    except (OSError, json.JSONDecodeError):
        return TargetPackageContext.none()
    try:
        target_payload = load_effective_target_payload(device_root, target_id)
    except TargetResolutionError:
        target_payload = None
    is_general, has_general_capability, has_pin_capability = build_package_gating_context(
        target_payload, registry
    )
    return TargetPackageContext(
        target_id=target_id,
        is_general=is_general,
        has_general_capability=has_general_capability,
        has_pin_capability=has_pin_capability,
    )


def _catalog_board_name(workspace_root: Path, board: str) -> str:
    """Return the catalog *name* for *board*, falling back to the id itself.

    Compile-target mapping rules speak the catalog's board name (for example
    ``ESP32_GENERIC_S3``) while the firmware menu holds a slug
    (``esp32_generic_s3``), so the slug is translated before the mapping is asked.
    A missing or invalid catalog, or an unknown slug, leaves *board* untouched.
    """

    try:
        catalog = load_board_catalog((workspace_root / BOARD_CATALOG_DEFAULT_PATH).resolve())
    except (BoardCatalogError, OSError):
        return board
    spec = find_board_by_slug(catalog, board)
    return spec.name if spec is not None else board


def resolve_target_package_context_for_board(
    *,
    workspace_root: Path,
    device_root: Path,
    runtime_id: str,
    board: str,
) -> TargetPackageContext:
    """Resolve the mapping for *board* and build its package context.

    Used by callers that only hold a board id (staleness), so an unmapped board
    degrades to :meth:`TargetPackageContext.none` instead of propagating
    ``TARGET_MAPPING_NO_MATCH``: a status row must survive a mapping gap. *board* may
    be a catalog name or a catalog slug; the slug is translated through
    :func:`...board_registry.find_board_by_slug`.
    """

    try:
        resolution = resolve_compile_target_resolution(
            workspace_root=workspace_root,
            runtime_id=runtime_id,
            board=_catalog_board_name(workspace_root, board),
        )
    except ValueError:
        return TargetPackageContext.none()
    return resolve_target_package_context(device_root=device_root, resolution=resolution)


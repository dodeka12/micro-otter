"""Boolean (CNF) capability requirement evaluation.

Mirrors ``src/micro_otter/nodes/html/js/core/capability-requirements.ts`` so firmware
build gating and deploy validation agree on the same boolean semantics. ``requiredCapabilities``
is an AND-of-OR-groups: a top-level list whose elements are either a single capability id
(an OR-group of one) or a list of capability ids (an OR-group).
"""

from __future__ import annotations

from collections.abc import Callable


def normalize_requirements(requirements: object) -> list[str | list[str]]:
    if not isinstance(requirements, list):
        return []

    normalized: list[str | list[str]] = []
    for entry in requirements:
        if isinstance(entry, str):
            trimmed = entry.strip()
            if trimmed:
                normalized.append(trimmed)
        elif isinstance(entry, list):
            group = [
                item.strip()
                for item in entry
                if isinstance(item, str) and item.strip()
            ]
            if group:
                normalized.append(group)
    return normalized


def _single_satisfied(
    capability: str,
    is_general: Callable[[str], bool],
    has_general_capability: Callable[[str], bool],
    has_pin_capability: Callable[[str], bool],
) -> bool:
    if is_general(capability):
        return has_general_capability(capability)
    return has_pin_capability(capability)


def evaluate_requirements(
    requirements: object,
    is_general: Callable[[str], bool],
    has_general_capability: Callable[[str], bool],
    has_pin_capability: Callable[[str], bool],
) -> tuple[bool, list[list[str]]]:
    """Return ``(satisfied, missing)`` where ``missing`` lists unsatisfied OR-groups."""
    normalized = normalize_requirements(requirements)
    missing: list[list[str]] = []

    for requirement in normalized:
        group = [requirement] if isinstance(requirement, str) else requirement
        unsatisfied = [
            capability
            for capability in group
            if not _single_satisfied(
                capability, is_general, has_general_capability, has_pin_capability
            )
        ]
        if unsatisfied and len(unsatisfied) == len(group):
            missing.append(unsatisfied)

    return (not missing, missing)

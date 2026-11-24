"""Server-side mirror of the browser's target derivation resolver.

Mirrors ``src/micro_otter/nodes/html/js/data/target-resolution.ts`` (and
``target-resolver.ts``) so firmware package gating and the build-base identity
agree with the browser: a target may derive from a ``baseTargetId`` through a
chain of sparse ``targetData`` overrides, and the terminal id without a base is
the id a firmware build actually uses.
"""

from __future__ import annotations

import json
from pathlib import Path

__all__ = [
    "TargetResolutionError",
    "load_effective_target_payload",
    "load_raw_target_payload",
    "load_target_index",
    "resolve_build_base_target_id",
]

_MAX_CHAIN_DEPTH = 8

#: Keys whose values merge key-wise (base keys kept, override winning).
_KEYWISE_MERGE_KEYS = frozenset({"resources", "generalCapabilities", "capabilityToPins"})


class TargetResolutionError(ValueError):
    """A target derivation chain is broken (unknown base, cycle, depth, openPins)."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


def _as_string(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed or None


def _as_dict(value: object) -> dict | None:
    return value if isinstance(value, dict) else None


def load_target_index(device_root: Path) -> list[dict]:
    """Return the parsed ``targets/index.json`` entries, or an empty list.

    A missing, invalid, or non-object index yields an empty list, so resolution
    can degrade instead of raising on a broken catalog.
    """

    path = device_root / "targets" / "index.json"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(payload, dict):
        return []
    targets = payload.get("targets")
    if not isinstance(targets, list):
        return []
    return [entry for entry in targets if isinstance(entry, dict)]


def _index_file_map(device_root: Path) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for entry in load_target_index(device_root):
        target_id = _as_string(entry.get("id"))
        file = _as_string(entry.get("file"))
        if target_id and file:
            mapping[target_id] = file
    return mapping


def load_raw_target_payload(device_root: Path, target_id: str | None) -> dict | None:
    """Return the raw ``targets/<id>.json`` payload, or ``None``.

    A falsy *target_id*, a missing file and an unreadable, invalid or non-object
    file all yield ``None``. The file name is looked up in ``targets/index.json``
    and falls back to ``<id>.json``.
    """

    if not target_id:
        return None
    file = _index_file_map(device_root).get(target_id) or f"{target_id}.json"
    path = device_root / "targets" / file
    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _merge_pin_capabilities(base: object, override: object) -> dict:
    base_map = base if isinstance(base, dict) else {}
    merged = dict(base_map)
    if not isinstance(override, dict):
        return merged
    for pin, value in override.items():
        if value is None:
            merged.pop(pin, None)
            continue
        base_pin = base_map.get(pin) if isinstance(base_map.get(pin), dict) else {}
        merged[pin] = {**base_pin, **value} if isinstance(value, dict) else value
    return merged


def _merge_keywise(base: object, override: object) -> dict:
    base_map = base if isinstance(base, dict) else {}
    override_map = override if isinstance(override, dict) else {}
    return {**base_map, **override_map}


def _merge_metadata(base: object, override: object) -> dict:
    base_map = base if isinstance(base, dict) else {}
    override_map = override if isinstance(override, dict) else {}
    merged = {**base_map, **override_map}
    base_notes = base_map.get("notes") if isinstance(base_map.get("notes"), list) else []
    override_notes = (
        override_map.get("notes") if isinstance(override_map.get("notes"), list) else []
    )
    if base_notes or override_notes:
        merged["notes"] = [*base_notes, *override_notes]
    return merged


def _merge_payload(base: object, override: object) -> dict:
    """Mirror ``mergeTargetPayload`` (scalars replace, key-wise merges, notes concat)."""

    result = dict(base) if isinstance(base, dict) else {}
    overrides = override if isinstance(override, dict) else {}
    for key, value in overrides.items():
        if key == "openPins":
            # Inheritable-only.
            continue
        if key == "pinCapabilities":
            result["pinCapabilities"] = _merge_pin_capabilities(
                result.get("pinCapabilities"), value
            )
            continue
        if key == "metadata":
            result["metadata"] = _merge_metadata(result.get("metadata"), value)
            continue
        if key in _KEYWISE_MERGE_KEYS:
            result[key] = _merge_keywise(result.get(key), value)
            continue
        result[key] = value
    return result


def _walk_chain(device_root: Path, target_id: str) -> list[tuple[str, dict]] | None:
    """Walk ``baseTargetId`` leaf → terminal base, returning id/payload pairs.

    Returns ``None`` when the leaf id is unknown; raises :class:`TargetResolutionError`
    for a cycle, an unknown base, or excessive depth.
    """

    chain: list[tuple[str, dict]] = []
    visited: set[str] = set()
    current = target_id
    while True:
        payload = load_raw_target_payload(device_root, current)
        if payload is None:
            if not chain:
                return None
            raise TargetResolutionError(
                "ERR_TARGET_BASE_UNKNOWN",
                f"Target config base '{current}' is not a shipped target.",
            )
        if current in visited:
            raise TargetResolutionError(
                "ERR_TARGET_CYCLE",
                f"Target config chain contains a cycle at '{current}'.",
            )
        visited.add(current)
        chain.append((current, payload))
        if len(chain) > _MAX_CHAIN_DEPTH:
            raise TargetResolutionError(
                "ERR_TARGET_CHAIN_LIMIT",
                f"Target config chain exceeds {_MAX_CHAIN_DEPTH} hops.",
            )
        base_id = _as_string(payload.get("baseTargetId"))
        if not base_id:
            return chain
        current = base_id


def resolve_build_base_target_id(device_root: Path, target_id: str | None) -> str | None:
    """Return the terminal build base id for *target_id*, or ``None``.

    The base id is the chain's terminal id — the id whose
    ``compile_target_mappings.json`` rule a firmware build actually uses. An
    unknown leaf id answers ``None``; a broken chain raises
    :class:`TargetResolutionError`.
    """

    if not target_id:
        return None
    chain = _walk_chain(device_root, target_id)
    return chain[-1][0] if chain else None


def load_effective_target_payload(device_root: Path, target_id: str | None) -> dict | None:
    """Return the fully merged payload for *target_id*, or ``None``.

    A derived target's payload is resolved through its whole chain (base-ward
    merge, leaf identity injected). An unknown leaf id answers ``None``; a
    broken chain raises :class:`TargetResolutionError`.
    """

    if not target_id:
        return None
    chain = _walk_chain(device_root, target_id)
    if chain is None:
        return None

    merged = dict(chain[-1][1])
    open_pins_seen = merged.get("openPins") is not None
    for current_id, payload in reversed(chain[:-1]):
        overrides = _as_dict(payload.get("targetData"))
        if overrides is None:
            continue
        merged = _merge_payload(merged, overrides)
        if merged.get("openPins") is not None:
            if open_pins_seen:
                raise TargetResolutionError(
                    "ERR_TARGET_OPEN_PINS_OVERRIDE",
                    f"Target chain declares openPins more than once ('{current_id}').",
                )
            open_pins_seen = True

    leaf_id = chain[0][0]
    leaf_payload = chain[0][1]
    merged["id"] = leaf_id
    merged["targetId"] = leaf_id
    display_name = _as_string(leaf_payload.get("displayName"))
    if display_name is not None:
        merged["displayName"] = display_name
    description = _as_string(leaf_payload.get("description"))
    if description is not None:
        merged["description"] = description
    return merged


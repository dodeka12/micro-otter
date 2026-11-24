"""Compile target mapping resolver for logical web target metadata.

This module resolves mapping metadata without changing authoritative compile
board selection provided by the compile command.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

_MAPPING_PATH = Path("src/micro_otter/nodes/device/targets/compile_target_mappings.json")


@dataclass(frozen=True)
class CompileTargetResolution:
    """Resolved mapping metadata for one compile request."""

    web_target_id: str | None
    allowed_web_target_ids: tuple[str, ...]
    compile_board: str
    compile_port: str
    mapping_rule_id: str
    mapping_source: str
    mapping_confidence: str


@dataclass(frozen=True)
class WebTargetResolution:
    """Server-side resolution of one web ``target_id`` to a build board/backend.

    ``board`` and ``backend`` are ``None`` together when the target's compile rule
    is a wildcard: such a target has no concrete board the server can build.
    """

    target_id: str
    board: str | None
    backend: str | None
    params: Mapping[str, str]
    rule_id: str
    source: str
    confidence: str


class WebTargetUnknownError(ValueError):
    """Raised when a web ``target_id`` matches no mapping rule.

    Carries the offending id and the stable ``code = "target-unknown"`` so the
    WS handler can map it to the documented error without string matching.
    """

    code = "target-unknown"

    def __init__(self, target_id: str) -> None:
        self.target_id = target_id
        super().__init__(f"Unknown web target: {target_id!r}")


class WebBaseTargetUnknownError(ValueError):
    """Raised when a frame's ``baseTargetId`` matches no mapping rule.

    Carries the stable ``code = "base-target-unknown"`` so the WS handler can map
    it without string matching.
    """

    code = "base-target-unknown"

    def __init__(self, base_target_id: str) -> None:
        self.base_target_id = base_target_id
        super().__init__(f"Unknown base target: {base_target_id!r}")


class WebBaseTargetNoMappingError(ValueError):
    """Raised when a frame's ``baseTargetId`` resolves to a wildcard (no board).

    Carries the stable ``code = "base-no-mapping"``; a base that cannot name a
    concrete board cannot drive a build, so the request is rejected before any
    job spawns.
    """

    code = "base-no-mapping"

    def __init__(self, base_target_id: str) -> None:
        self.base_target_id = base_target_id
        super().__init__(f"Base target has no concrete mapping: {base_target_id!r}")


def _normalize_text(value: object, *, field_name: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field_name} must be a string")

    normalized = value.strip()
    if not normalized:
        raise ValueError(f"{field_name} must not be empty")
    return normalized


def _normalize_runtime_id_list(value: object, *, field_name: str, default: list[str]) -> list[str]:
    if value is None:
        value = list(default)

    if not isinstance(value, list):
        raise ValueError(f"{field_name} must be a list of strings")

    normalized: list[str] = []
    for entry in value:
        normalized.append(_normalize_text(entry, field_name=field_name))

    return normalized


def _runtime_allowed_by_lists(runtime_id: str, *, include: list[str], exclude: list[str]) -> bool:
    runtime_included = "*" in include or runtime_id in include
    runtime_excluded = "*" in exclude or runtime_id in exclude
    return runtime_included and not runtime_excluded


def _matches_pattern(value: str, pattern: str) -> bool:
    if pattern == "*":
        return True
    return value == pattern


def _default_resolution(board: str) -> CompileTargetResolution:
    return CompileTargetResolution(
        web_target_id=None,
        allowed_web_target_ids=("generic_micropython",),
        compile_board=board,
        compile_port=board,
        mapping_rule_id="builtin-generic-fallback",
        mapping_source="builtin-default",
        mapping_confidence="fallback",
    )


def build_target_mapping_warning(resolution: CompileTargetResolution) -> str | None:
    """Return categorized warning text for non-exact mapping outcomes."""

    if resolution.mapping_confidence == "exact":
        return None
    if resolution.mapping_confidence == "fallback":
        return (
            "TARGET_MAPPING_FALLBACK: using builtin compile-target constraints "
            f"for board '{resolution.compile_board}'; exact board target remains unset"
        )
    if resolution.mapping_confidence == "wildcard":
        return (
            "TARGET_MAPPING_WILDCARD: compile-target constraints resolved via wildcard rule "
            f"'{resolution.mapping_rule_id}'; exact board target remains unset"
        )
    return (
        "TARGET_MAPPING_PARTIAL: compile-target constraints resolved via partially specific "
        f"rule '{resolution.mapping_rule_id}'; exact board target remains unset"
    )


def _normalize_compile_section(rule: dict, compile_section: dict) -> dict[str, object]:
    """Normalize one rule's ``compile`` object into a backend-typed shape.

    Accepts the current backend-typed form (``board`` + ``backend`` + ``params``)
    and the legacy MicroPython form (``board`` + ``port``) so existing fixtures
    keep working while the shipped file migrates. ``port`` is always derived,
    from ``params["port"]`` first, then the legacy top-level field, then ``board``.
    """

    rule_id = rule.get("id")
    board = _normalize_text(compile_section.get("board"), field_name="rule.compile.board")

    backend_value = compile_section.get("backend")
    backend = (
        _normalize_text(backend_value, field_name="rule.compile.backend")
        if backend_value is not None
        else None
    )

    params_value = compile_section.get("params")
    if params_value is None:
        params: dict[str, str] = {}
    elif not isinstance(params_value, dict):
        raise ValueError(f"mapping rule '{rule_id}' compile.params must be an object of strings")
    else:
        params = {
            _normalize_text(key, field_name="rule.compile.params key"): _normalize_text(
                value, field_name="rule.compile.params value"
            )
            for key, value in params_value.items()
        }

    if "port" in params:
        port = params["port"]
    else:
        legacy_port = compile_section.get("port")
        port = (
            _normalize_text(legacy_port, field_name="rule.compile.port")
            if legacy_port is not None
            else board
        )

    return {
        "board": board,
        "backend": backend,
        "params": params,
        "port": port,
    }


def _load_mapping_rules(workspace_root: Path) -> list[dict]:
    mapping_path = (workspace_root / _MAPPING_PATH).resolve()
    if not mapping_path.is_file():
        return []

    payload = json.loads(mapping_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("compile target mapping file must contain a JSON object")

    schema_version = payload.get("schemaVersion")
    if not isinstance(schema_version, int):
        raise ValueError("compile target mapping file schemaVersion must be an integer")

    rules = payload.get("rules")
    if not isinstance(rules, list):
        raise ValueError("compile target mapping file rules must be a list")

    validated_rules: list[dict] = []
    for index, rule in enumerate(rules):
        if not isinstance(rule, dict):
            raise ValueError(f"mapping rule at index {index} must be an object")

        if "runtimeIdPattern" in rule:
            raise ValueError(
                "rule.runtimeIdPattern is unsupported; use runtimeIdInclude/runtimeIdExclude"
            )

        compile_section = rule.get("compile")
        if not isinstance(compile_section, dict):
            raise ValueError(f"mapping rule '{rule.get('id', index)}' compile must be an object")

        validated_rules.append(
            {
                "id": _normalize_text(rule.get("id"), field_name="rule.id"),
                "webTargetId": _normalize_text(
                    rule.get("webTargetId"), field_name="rule.webTargetId"
                ),
                "runtimeIdInclude": _normalize_runtime_id_list(
                    rule.get("runtimeIdInclude"),
                    field_name="rule.runtimeIdInclude",
                    default=["*"],
                ),
                "runtimeIdExclude": _normalize_runtime_id_list(
                    rule.get("runtimeIdExclude"),
                    field_name="rule.runtimeIdExclude",
                    default=[],
                ),
                "priority": int(rule.get("priority", 0)),
                "compile": _normalize_compile_section(rule, compile_section),
                "index": index,
                "source": str(mapping_path),
            }
        )

    return validated_rules


def _resolve_confidence(rule: dict, *, runtime_id: str, board: str) -> str:
    runtime_include = rule["runtimeIdInclude"]
    runtime_exact = runtime_id in runtime_include and "*" not in runtime_include
    board_exact = rule["compile"]["board"] == board
    if runtime_exact and board_exact:
        return "exact"
    if runtime_exact or board_exact:
        return "partial"
    return "wildcard"


def _resolve_allowed_web_target_ids(matches: list[dict], *, board: str) -> tuple[str, ...]:
    exact_matches = [rule for rule in matches if rule["compile"]["board"] == board]
    source_rules = exact_matches if exact_matches else matches

    seen: set[str] = set()
    ordered: list[str] = []
    for rule in source_rules:
        web_target_id = rule["webTargetId"]
        if web_target_id in seen:
            continue
        seen.add(web_target_id)
        ordered.append(web_target_id)

    return tuple(ordered)


def _pick_highest_priority_rule(matches: list[dict]) -> dict:
    """Return the highest-priority rule, raising on same-priority ambiguity."""

    matches.sort(key=lambda item: (-item["priority"], item["index"]))
    best = matches[0]
    same_priority = [rule for rule in matches if rule["priority"] == best["priority"]]
    if len(same_priority) > 1:
        rule_ids = ", ".join(rule["id"] for rule in same_priority)
        raise ValueError(
            "TARGET_MAPPING_AMBIGUOUS: ambiguous compile target mapping rules with same "
            "priority: "
            f"{rule_ids}. Adjust priorities for deterministic resolution."
        )
    return best


def resolve_compile_target_resolution(
    *,
    workspace_root: Path,
    runtime_id: str,
    board: str,
) -> CompileTargetResolution:
    """Resolve mapping metadata for compile-time target propagation.

    The `board` input remains authoritative and is never overwritten by mapping
    rules. Mapping may only enrich metadata and constrain compatible targets.
    """

    normalized_runtime_id = runtime_id.strip()
    normalized_board = board.strip()
    if not normalized_runtime_id:
        raise ValueError("runtime-id must not be empty")
    if not normalized_board:
        raise ValueError("board must not be empty")

    rules = _load_mapping_rules(workspace_root.resolve())
    if not rules:
        return _default_resolution(normalized_board)

    matches: list[dict] = []
    for rule in rules:
        runtime_matches = _runtime_allowed_by_lists(
            normalized_runtime_id,
            include=rule["runtimeIdInclude"],
            exclude=rule["runtimeIdExclude"],
        )
        board_matches = _matches_pattern(normalized_board, rule["compile"]["board"])
        if runtime_matches and board_matches:
            matches.append(rule)

    if not matches:
        raise ValueError(
            "TARGET_MAPPING_NO_MATCH: no compile target mapping for runtime "
            f"'{normalized_runtime_id}' and board '{normalized_board}'"
        )

    best = _pick_highest_priority_rule(matches)

    compile_port = best["compile"]["port"]
    if compile_port == "*":
        compile_port = normalized_board

    allowed_web_target_ids = _resolve_allowed_web_target_ids(matches, board=normalized_board)

    return CompileTargetResolution(
        web_target_id=None,
        allowed_web_target_ids=allowed_web_target_ids,
        compile_board=normalized_board,
        compile_port=compile_port,
        mapping_rule_id=best["id"],
        mapping_source=best["source"],
        mapping_confidence=_resolve_confidence(
            best,
            runtime_id=normalized_runtime_id,
            board=normalized_board,
        ),
    )


def _resolve_chain_base(workspace_root: Path, target_id: str) -> str | None:
    """Resolve *target_id*'s terminal build base id through the shipped catalog.

    A derived target has no mapping rule; this bridges the gap by walking its
    ``baseTargetId`` chain. Broken chains answer ``None`` (the caller then keeps
    the original ``target-unknown`` path).
    """

    from .target_resolution import resolve_build_base_target_id

    device_root = workspace_root / "src" / "micro_otter" / "nodes" / "device"
    try:
        return resolve_build_base_target_id(device_root, target_id)
    except ValueError:
        return None


def resolve_web_target(
    *,
    target_id: str,
    workspace_root: Path,
    runtime_id: str | None = None,
    base_target_id: str | None = None,
) -> WebTargetResolution:
    """Resolve a web ``target_id`` to the board and backend the server builds.

    ``runtime_id`` narrows matching rules through their include/exclude lists;
    ``None`` (the deploy path has no runtime) matches any runtime. A wildcard
    compile rule resolves to ``board=None``/``backend=None`` — the target has no
    concrete board. An id with no matching rule raises :class:`WebTargetUnknownError`.

    When ``base_target_id`` is provided the mapping is resolved on the *base*
    instead of ``target_id`` (a derived user target inherits its base's board).
    An unknown base raises :class:`WebBaseTargetUnknownError`; a base whose rule
    is a wildcard raises :class:`WebBaseTargetNoMappingError`.
    """

    normalized_target_id = target_id.strip()
    if not normalized_target_id:
        raise ValueError("target-id must not be empty")
    normalized_runtime_id = runtime_id.strip() if runtime_id is not None else None
    if normalized_runtime_id == "":
        raise ValueError("runtime-id must not be empty")
    normalized_base_target_id = base_target_id.strip() if base_target_id is not None else None

    rules = _load_mapping_rules(workspace_root.resolve())
    if not rules:
        if normalized_base_target_id is not None:
            raise WebBaseTargetUnknownError(normalized_base_target_id)
        raise WebTargetUnknownError(normalized_target_id)

    resolution_target_id = (
        normalized_base_target_id if normalized_base_target_id is not None else normalized_target_id
    )

    def _matches_for(candidate_id: str) -> list[dict]:
        found: list[dict] = []
        for rule in rules:
            if rule["webTargetId"] != candidate_id:
                continue
            if normalized_runtime_id is not None and not _runtime_allowed_by_lists(
                normalized_runtime_id,
                include=rule["runtimeIdInclude"],
                exclude=rule["runtimeIdExclude"],
            ):
                continue
            found.append(rule)
        return found

    matches = _matches_for(resolution_target_id)

    if not matches and normalized_base_target_id is None:
        # A derived target id carries no rule of its own; resolve its chain to
        # the terminal build base id and retry on that base's rule.
        base_id = _resolve_chain_base(workspace_root.resolve(), normalized_target_id)
        if base_id and base_id != normalized_target_id:
            matches = _matches_for(base_id)
            if matches:
                resolution_target_id = base_id

    if not matches:
        if normalized_base_target_id is not None:
            raise WebBaseTargetUnknownError(normalized_base_target_id)
        raise WebTargetUnknownError(normalized_target_id)

    best = _pick_highest_priority_rule(matches)
    compile_board = best["compile"]["board"]
    is_wildcard = compile_board == "*"

    if normalized_base_target_id is not None and is_wildcard:
        raise WebBaseTargetNoMappingError(normalized_base_target_id)

    return WebTargetResolution(
        target_id=resolution_target_id,
        board=None if is_wildcard else compile_board,
        backend=None if is_wildcard else best["compile"]["backend"],
        params={} if is_wildcard else dict(best["compile"]["params"]),
        rule_id=best["id"],
        source=best["source"],
        confidence=(
            "wildcard"
            if is_wildcard
            else _resolve_confidence(
                best,
                runtime_id=normalized_runtime_id or "*",
                board=compile_board,
            )
        ),
    )


__all__ = [
    "CompileTargetResolution",
    "WebTargetResolution",
    "WebTargetUnknownError",
    "WebBaseTargetUnknownError",
    "WebBaseTargetNoMappingError",
    "build_target_mapping_warning",
    "resolve_compile_target_resolution",
    "resolve_web_target",
]

"""Firmware version registry and lineage persistence helpers."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .version_semver import try_parse_version, version_sort_key

CONTENT_HASH_RE = re.compile(r"^[0-9a-f]{12}$")
_TARGET_KEY_RE = re.compile(r"^[a-z0-9_]+-[a-z0-9_]+$")

LATEST_VERSIONS_DEFAULT_PATH = Path("src/micro_otter/nodes/device/firmware/latest_versions.json")
RUNTIME_LINEAGE_DEFAULT_PATH = Path("src/micro_otter/nodes/device/firmware/runtime_lineage.json")
RELEASE_MANIFEST_DEFAULT_PATH = Path("src/micro_otter/nodes/device/firmware/release.json")


class VersionRegistryError(ValueError):
    """Raised when registry or lineage payloads are invalid."""


def _read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise VersionRegistryError(f"Version registry file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise VersionRegistryError(f"Invalid JSON in {path}: {exc}") from exc

    if not isinstance(payload, dict):
        raise VersionRegistryError(f"Expected object at root in {path}")
    return payload


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _require_schema_version(payload: dict[str, Any], expected: int, context: str) -> None:
    schema_version = payload.get("schemaVersion")
    if schema_version != expected:
        raise VersionRegistryError(
            f"{context} schemaVersion must be {expected}; got {schema_version!r}"
        )


def _require_semver(value: str, context: str) -> None:
    if not isinstance(value, str) or try_parse_version(value) is None:
        raise VersionRegistryError(f"{context} must be semver x.y.z; got {value!r}")


def _require_content_hash(value: object, context: str) -> None:
    if not isinstance(value, str) or not CONTENT_HASH_RE.match(value):
        raise VersionRegistryError(f"{context} must be 12 lowercase hex chars; got {value!r}")


def _strict_semver(value: object) -> bool:
    """Return whether *value* is a plain ``x.y.z`` with no pre-release/build part."""
    if not isinstance(value, str):
        return False
    parsed = try_parse_version(value)
    return parsed is not None and parsed.prerelease is None and parsed.build is None


def _validate_latest_versions_payload(payload: dict[str, Any]) -> None:
    schema_version = payload.get("schemaVersion")
    if schema_version not in (1, 2):
        raise VersionRegistryError(
            f"latest versions payload schemaVersion must be 1 or 2; got {schema_version!r}"
        )

    targets = payload.get("targets")
    if not isinstance(targets, dict):
        raise VersionRegistryError("latest versions payload must contain object field 'targets'")

    for target_id, entry in targets.items():
        if not isinstance(target_id, str) or not target_id:
            raise VersionRegistryError(
                "latest versions payload target key must be a non-empty string"
            )
        if not _TARGET_KEY_RE.match(target_id):
            raise VersionRegistryError(
                f"latest versions target key {target_id!r} must be '<boardId>-<runtimeId>' "
                "where each component matches [a-z0-9_]+ (e.g. 'esp32-general')"
            )
        if not isinstance(entry, dict):
            raise VersionRegistryError(f"latest versions entry for {target_id!r} must be an object")

        if schema_version == 2:
            channels = entry.get("channels")
            if not isinstance(channels, dict) or not channels:
                raise VersionRegistryError(
                    f"latest versions v2 entry for {target_id!r} must have a non-empty "
                    "'channels' object"
                )
            for channel_id, channel_entry in channels.items():
                if channel_id not in ("release", "dev"):
                    raise VersionRegistryError(
                        f"latest versions channel {channel_id!r} for {target_id!r} must be "
                        "'release' or 'dev'"
                    )
                _validate_latest_channel_entry(channel_entry, f"{target_id}.{channel_id}")
            continue

        for key in (
            "fullVersion",
            "micropythonVersion",
            "boardId",
            "runtimeId",
            "runtimeFirmwareVersion",
            "updatedAtUtc",
        ):
            if key not in entry:
                raise VersionRegistryError(
                    f"latest versions entry for {target_id!r} is missing required key {key!r}"
                )

        _require_semver(str(entry.get("micropythonVersion")), f"micropythonVersion[{target_id}]")
        _require_semver(
            str(entry.get("runtimeFirmwareVersion")), f"runtimeFirmwareVersion[{target_id}]"
        )

        content_hash = entry.get("contentHash")
        if content_hash is not None:
            _require_content_hash(content_hash, f"contentHash[{target_id}]")


def _validate_latest_channel_entry(entry: Any, context: str) -> None:
    """Validate one v2 ``channels.release`` / ``channels.dev`` entry."""

    if not isinstance(entry, dict):
        raise VersionRegistryError(
            f"latest versions channel entry for {context!r} must be an object"
        )
    for key in ("version", "fullVersion", "micropythonVersion", "updatedAtUtc"):
        if key not in entry:
            raise VersionRegistryError(
                f"latest versions channel entry for {context!r} is missing required key {key!r}"
            )
    _require_semver(str(entry.get("version")), f"version[{context}]")
    _require_semver(str(entry.get("micropythonVersion")), f"micropythonVersion[{context}]")
    content_hash = entry.get("contentHash")
    if content_hash is not None:
        _require_content_hash(content_hash, f"contentHash[{context}]")


def _validate_runtime_lineage_payload(payload: dict[str, Any]) -> None:
    schema_version = payload.get("schemaVersion")
    if schema_version not in (2, 3):
        raise VersionRegistryError(
            f"runtime lineage payload schemaVersion must be 2 or 3; got {schema_version!r}"
        )

    lineage = payload.get("lineage")
    if not isinstance(lineage, dict):
        raise VersionRegistryError("runtime lineage payload must contain object field 'lineage'")

    for target_key, target_versions in lineage.items():
        if not isinstance(target_key, str) or not target_key:
            raise VersionRegistryError("runtime lineage target key must be a non-empty string")
        if not _TARGET_KEY_RE.match(target_key):
            raise VersionRegistryError(
                f"runtime lineage target key {target_key!r} must be '<boardId>-<runtimeId>' "
                "where each component matches [a-z0-9_]+ (e.g. 'esp32-general')"
            )
        if not isinstance(target_versions, dict):
            raise VersionRegistryError(
                f"runtime lineage entry for {target_key!r} must be an object"
            )

        for firmware_version, entry in target_versions.items():
            _require_semver(str(firmware_version), f"runtime lineage[{target_key}] key")

            if not isinstance(entry, dict):
                raise VersionRegistryError(
                    f"runtime lineage entry for {target_key!r}[{firmware_version!r}] "
                    "must be an object"
                )

            for key in (
                "micropythonVersion",
                "runtimeSourceVersion",
                "deviceToolsVersion",
                "nodePackages",
                "createdAtUtc",
            ):
                if key not in entry:
                    raise VersionRegistryError(
                        f"runtime lineage entry for {target_key!r}[{firmware_version!r}] "
                        f"is missing required key {key!r}"
                    )

            _require_semver(
                str(entry.get("micropythonVersion")),
                f"micropythonVersion[{target_key}][{firmware_version}]",
            )
            _require_semver(
                str(entry.get("runtimeSourceVersion")),
                f"runtimeSourceVersion[{target_key}][{firmware_version}]",
            )
            _require_semver(
                str(entry.get("deviceToolsVersion")),
                f"deviceToolsVersion[{target_key}][{firmware_version}]",
            )

            node_packages = entry.get("nodePackages")
            if not isinstance(node_packages, dict):
                raise VersionRegistryError(
                    f"nodePackages[{target_key}][{firmware_version}] "
                    "must be an object mapping package->version"
                )
            for package_id, package_version in node_packages.items():
                if not isinstance(package_id, str) or not package_id:
                    raise VersionRegistryError(
                        f"nodePackages[{target_key}][{firmware_version}] "
                        "package id must be non-empty string"
                    )
                _require_semver(
                    str(package_version),
                    f"nodePackages[{target_key}][{firmware_version}][{package_id}]",
                )

            content_hash = entry.get("contentHash")
            if content_hash is not None:
                _require_content_hash(
                    content_hash, f"contentHash[{target_key}][{firmware_version}]"
                )

            if schema_version == 3:
                channel = entry.get("channel")
                if channel not in ("release", "dev"):
                    raise VersionRegistryError(
                        f"runtime lineage v3 entry {target_key!r}[{firmware_version!r}] "
                        f"must have channel 'release' or 'dev'; got {channel!r}"
                    )


def make_target_key(board_id: str, runtime_id: str) -> str:
    """Return canonical latest-versions registry key for a board+runtime pair."""
    return f"{board_id}-{runtime_id}"


def default_latest_versions_payload() -> dict[str, Any]:
    return {"schemaVersion": 1, "targets": {}}


def default_runtime_lineage_payload() -> dict[str, Any]:
    return {"schemaVersion": 2, "lineage": {}}


def load_latest_versions(path: Path) -> dict[str, Any]:
    payload = _read_json(path)
    _validate_latest_versions_payload(payload)
    return normalize_latest_versions(payload)


def normalize_latest_versions(payload: dict[str, Any]) -> dict[str, Any]:
    """Return *payload* in the v2 shape, normalising a v1 payload in place.

    A v1 entry becomes ``channels.release`` with ``version =
    runtimeFirmwareVersion``, ``versionSource = "legacy-lineage"`` (a
    registry-only sentinel, never a live-build source) and the v1 ``contentHash``
    carried over when present, else ``null``.
    """

    if payload.get("schemaVersion") == 2:
        return payload

    targets: dict[str, Any] = {}
    for target_id, entry in payload.get("targets", {}).items():
        if not isinstance(entry, dict):
            continue
        targets[target_id] = {
            "boardId": entry.get("boardId"),
            "runtimeId": entry.get("runtimeId"),
            "channels": {
                "release": {
                    "version": entry.get("runtimeFirmwareVersion"),
                    "fullVersion": entry.get("fullVersion"),
                    "contentHash": entry.get("contentHash"),
                    "micropythonVersion": entry.get("micropythonVersion"),
                    "versionSource": "legacy-lineage",
                    "updatedAtUtc": entry.get("updatedAtUtc"),
                }
            },
        }
    return {"schemaVersion": 2, "targets": targets}


def _newer_channel_entry(a: dict[str, Any], b: dict[str, Any]) -> bool:
    """Return whether channel entry *a* is newer than *b*."""

    a_key = version_sort_key(str(a.get("version") or ""))
    b_key = version_sort_key(str(b.get("version") or ""))
    if a_key != b_key:
        return a_key > b_key
    return str(a.get("updatedAtUtc") or "") >= str(b.get("updatedAtUtc") or "")


def compose_latest_versions(committed: dict[str, Any], history: dict[str, Any]) -> dict[str, Any]:
    """Return the committed payload with the newest history entry per channel.

    Never mutates its inputs. A target present only in *history* is added; a
    channel present only in *committed* is kept. Newest is decided by
    :func:`.version_semver.version_sort_key` on ``version``, with *history*
    winning ties on ``updatedAtUtc``.
    """

    result: dict[str, Any] = {"schemaVersion": 2, "targets": {}}
    committed_targets = committed.get("targets", {}) if isinstance(committed, dict) else {}
    for target_id, entry in committed_targets.items():
        if not isinstance(entry, dict):
            continue
        channels = entry.get("channels")
        result["targets"][target_id] = {
            "boardId": entry.get("boardId"),
            "runtimeId": entry.get("runtimeId"),
            "channels": {
                channel_id: dict(channel_entry)
                for channel_id, channel_entry in channels.items()
                if isinstance(channel_entry, dict)
            },
        }

    builds = history.get("builds", []) if isinstance(history, dict) else []
    for build in builds:
        if not isinstance(build, dict):
            continue
        channel = build.get("channel")
        board_id = build.get("boardId")
        runtime_id = build.get("runtimeId")
        if (
            channel not in ("release", "dev")
            or not isinstance(board_id, str)
            or not isinstance(runtime_id, str)
        ):
            continue
        target_id = f"{board_id}-{runtime_id}"
        target = result["targets"].setdefault(
            target_id, {"boardId": board_id, "runtimeId": runtime_id, "channels": {}}
        )
        candidate = {
            "version": build.get("version"),
            "fullVersion": build.get("fullVersion"),
            "contentHash": build.get("contentHash"),
            "micropythonVersion": build.get("micropythonVersion"),
            "versionSource": build.get("versionSource"),
            "updatedAtUtc": build.get("builtAtUtc"),
        }
        current = target["channels"].get(channel)
        if current is None or _newer_channel_entry(candidate, current):
            target["channels"][channel] = candidate

    return result


def load_runtime_lineage(path: Path) -> dict[str, Any]:
    payload = _read_json(path)
    _validate_runtime_lineage_payload(payload)
    return payload


def write_latest_versions(path: Path, payload: dict[str, Any]) -> None:
    _validate_latest_versions_payload(payload)
    _write_json(path, payload)


def write_runtime_lineage(path: Path, payload: dict[str, Any]) -> None:
    _validate_runtime_lineage_payload(payload)
    _write_json(path, payload)


def update_latest_version(payload: dict[str, Any], target_id: str, entry: dict[str, Any]) -> None:
    _validate_latest_versions_payload(payload)
    if not isinstance(target_id, str) or not target_id:
        raise VersionRegistryError("target_id must be non-empty string")
    payload["targets"][target_id] = entry
    _validate_latest_versions_payload(payload)


def add_lineage_entry_for_target(
    payload: dict[str, Any],
    target_key: str,
    firmware_version: str,
    entry: dict[str, Any],
) -> None:
    """Insert a lineage entry for *target_key* at *firmware_version*.

    Raises :class:`VersionRegistryError` if the key already exists with a
    different entry (immutability guard).
    """
    _validate_runtime_lineage_payload(payload)
    if not isinstance(target_key, str) or not target_key:
        raise VersionRegistryError("target_key must be non-empty string")
    _require_semver(firmware_version, "firmware_version")

    target_lineage = payload["lineage"].setdefault(target_key, {})
    existing = target_lineage.get(firmware_version)
    if existing is not None and existing != entry:
        raise VersionRegistryError(
            f"Lineage entry {target_key!r}[{firmware_version!r}] already exists and is immutable"
        )

    target_lineage[firmware_version] = entry
    _validate_runtime_lineage_payload(payload)


def _parse_semver_tuple(v: str) -> tuple[int, int, int]:
    parts = v.split(".")
    return (int(parts[0]), int(parts[1]), int(parts[2]))


def _semver_sort_key(v: str) -> tuple[int, int, int]:
    return _parse_semver_tuple(v)


def _constituent_bump_level(old: str, new: str) -> str:
    """Return 'major', 'minor', or 'patch' based on which semver component differs."""
    o = _parse_semver_tuple(old)
    n = _parse_semver_tuple(new)
    if o[0] != n[0]:
        return "major"
    if o[1] != n[1]:
        return "minor"
    return "patch"


_BUMP_RANK: dict[str, int] = {"major": 2, "minor": 1, "patch": 0}


def _max_bump_level(a: str, b: str) -> str:
    return a if _BUMP_RANK[a] >= _BUMP_RANK[b] else b


def _apply_bump_level(version: str, level: str) -> str:
    major, minor, patch = _parse_semver_tuple(version)
    if level == "major":
        return f"{major + 1}.0.0"
    if level == "minor":
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"


def resolve_runtime_firmware_version_for_target(
    lineage_payload: dict[str, Any],
    target_key: str,
    *,
    micropython_version: str,
    runtime_source_version: str,
    device_tools_version: str,
    node_packages: dict[str, str],
    runtime_assets_version: str | None = None,
) -> str | None:
    """Return the highest firmware version recorded for *target_key* whose
    constituent versions exactly match all of the supplied arguments, or
    ``None`` if no entry matches.
    """
    target_lineage = lineage_payload.get("lineage", {}).get(target_key, {})
    matched_keys: list[str] = []
    for firmware_version, entry in target_lineage.items():
        if (
            isinstance(entry, dict)
            and entry.get("micropythonVersion") == micropython_version
            and entry.get("runtimeSourceVersion") == runtime_source_version
            and entry.get("deviceToolsVersion") == device_tools_version
            and entry.get("nodePackages") == node_packages
            and entry.get("runtimeAssetsVersion") == runtime_assets_version
        ):
            matched_keys.append(firmware_version)
    if not matched_keys:
        return None

    return max(matched_keys, key=_semver_sort_key)


def next_firmware_version_for_target(
    lineage_payload: dict[str, Any],
    target_key: str,
    *,
    micropython_version: str,
    runtime_source_version: str,
    device_tools_version: str,
    node_packages: dict[str, str],
    runtime_assets_version: str | None = None,
    fallback: str = "0.1.0",
) -> str:
    """Determine the next firmware version by comparing current constituent versions
    against the highest existing lineage entry for *target_key*.

    The firmware version is bumped at the highest level of change observed across all
    constituent semvers (micropython, runtime source, device tools, node packages):

    - Any constituent differs in its **major** component → major bump
    - Any constituent differs in its **minor** component (and none in major) → minor bump
    - All constituents differ only in **patch** components → patch bump

    A node package being added or removed (rather than updated) is treated as a minor bump.
    If the lineage has no entries for *target_key*, *fallback* is returned unchanged.
    """
    target_lineage = lineage_payload.get("lineage", {}).get(target_key, {})
    valid_versions = [v for v in target_lineage if _strict_semver(v)]
    if not valid_versions:
        return fallback

    highest_fw = max(valid_versions, key=_semver_sort_key)
    highest_entry = target_lineage[highest_fw]
    if not isinstance(highest_entry, dict):
        return fallback

    overall_bump = "patch"

    scalar_pairs = [
        (highest_entry.get("micropythonVersion", ""), micropython_version),
        (highest_entry.get("runtimeSourceVersion", ""), runtime_source_version),
        (highest_entry.get("deviceToolsVersion", ""), device_tools_version),
    ]
    for old_v, new_v in scalar_pairs:
        if (
            _strict_semver(old_v)
            and _strict_semver(new_v)
            and old_v != new_v
        ):
            overall_bump = _max_bump_level(overall_bump, _constituent_bump_level(old_v, new_v))

    old_packages: dict[str, str] = highest_entry.get("nodePackages") or {}
    for pkg_id in set(old_packages) | set(node_packages):
        old_pkg_v = old_packages.get(pkg_id)
        new_pkg_v = node_packages.get(pkg_id)
        if old_pkg_v is None or new_pkg_v is None:
            overall_bump = _max_bump_level(overall_bump, "minor")
        elif (
            _strict_semver(old_pkg_v)
            and _strict_semver(new_pkg_v)
            and old_pkg_v != new_pkg_v
        ):
            overall_bump = _max_bump_level(
                overall_bump, _constituent_bump_level(old_pkg_v, new_pkg_v)
            )

    old_assets_v: str | None = highest_entry.get("runtimeAssetsVersion")
    new_assets_v = runtime_assets_version
    if old_assets_v != new_assets_v:
        if old_assets_v is None or new_assets_v is None:
            overall_bump = _max_bump_level(overall_bump, "minor")
        elif _strict_semver(old_assets_v) and _strict_semver(new_assets_v):
            overall_bump = _max_bump_level(
                overall_bump, _constituent_bump_level(old_assets_v, new_assets_v)
            )

    return _apply_bump_level(highest_fw, overall_bump)


@dataclass(frozen=True, slots=True)
class ReleaseManifest:
    """Validated contents of the committed ``release.json`` file."""

    release_version: str
    kind: str
    released_at_utc: str | None
    tag: str | None


def load_release_manifest(path: Path) -> ReleaseManifest:
    """Load and validate a ``release.json`` file, returning a frozen manifest.

    Validation rules (decision 3): ``releaseVersion`` is a plain ``X.Y.Z`` with no
    pre-release or build part; ``kind`` is ``stable`` or ``prerelease`` (metadata
    only); ``releasedAtUtc`` is ISO-8601 with a ``Z`` suffix or ``null``; ``tag``,
    when present, is exactly ``firmware-v<releaseVersion>``.
    """

    payload = _read_json(path)
    release_version = payload.get("releaseVersion")
    if not isinstance(release_version, str) or not _strict_semver(release_version):
        raise VersionRegistryError(
            f"release.json releaseVersion must be a plain x.y.z; got {release_version!r}"
        )

    kind = payload.get("kind")
    if kind not in ("stable", "prerelease"):
        raise VersionRegistryError(
            f"release.json kind must be 'stable' or 'prerelease'; got {kind!r}"
        )

    released_at_utc = payload.get("releasedAtUtc")
    if released_at_utc is not None:
        if not isinstance(released_at_utc, str) or not released_at_utc.endswith("Z"):
            raise VersionRegistryError(
                f"release.json releasedAtUtc must be ISO-8601 with a Z suffix; "
                f"got {released_at_utc!r}"
            )

    tag = payload.get("tag")
    if tag is not None:
        expected = f"firmware-v{release_version}"
        if tag != expected:
            raise VersionRegistryError(
                f"release.json tag must be exactly {expected!r}; got {tag!r}"
            )

    return ReleaseManifest(
        release_version=release_version,
        kind=kind,
        released_at_utc=released_at_utc,
        tag=tag,
    )

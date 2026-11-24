"""Firmware version identity parsing and bump decision helpers."""

from __future__ import annotations

import os
import re
import subprocess
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

from .version_semver import (
    CHANNEL_DEV,
    CHANNEL_RELEASE,
    VERSION_RE,
    channel_of,
    parse_version,
    version_sort_key,
)

IDENTIFIER_RE = re.compile(r"^[a-z0-9_]+$")
CONTENT_HASH_RE = re.compile(r"^[0-9a-f]{12}$")
COMMIT_PREFIX_RE = re.compile(r"^(?P<type>[a-zA-Z]+)(?P<breaking>!)?(?:\([^)]+\))?:")

COMMIT_TYPE_TO_BUMP = {
    "feat": "minor",
    "fix": "patch",
    "perf": "patch",
    "refactor": "patch",
    "style": "patch",
    "docs": "patch",
    "test": "patch",
    "build": "patch",
    "ci": "patch",
    "chore": "patch",
    "revert": "patch",
}


class VersionIdentityError(ValueError):
    """Raised when version identity or bump decision input is invalid."""


@dataclass(frozen=True, slots=True)
class FullFirmwareVersion:
    """Normalized full firmware version components."""

    micropython_version: str
    board_id: str
    runtime_id: str
    runtime_firmware_version: str
    content_hash: str | None = None
    channel: str = CHANNEL_RELEASE
    is_prerelease: bool = False


class VersionSource(StrEnum):
    """How the runtime firmware version was derived.

    ``legacy-lineage`` is deliberately absent: it is a registry-only sentinel,
    never a source for a live build.
    """

    GIT_RELEASE_TAG = "git-release-tag"
    GIT_DEV = "git-dev"
    NO_TAG_DEV = "no-tag-dev"
    NO_GIT_RELEASE_FILE = "no-git-release-file"
    OVERRIDE_ENV = "override-env"


@dataclass(frozen=True, slots=True)
class FirmwareVersionIdentity:
    """The resolved firmware version plus how it was derived."""

    version: str
    base_version: str
    channel: str
    source: VersionSource
    commit: str | None = None
    distance: int | None = None
    tag: str | None = None
    branch: str | None = None
    released_at_utc: str | None = None
    shallow: bool = False


class FirmwareVersionUnresolvedError(ValueError):
    """Raised when no release base can be resolved (no git, no ``release.json``)."""


class ReleaseManifestBaseMismatchError(ValueError):
    """Raised when a tag base differs from ``release.json.releaseVersion``."""


@dataclass(frozen=True, slots=True)
class BumpDecision:
    """Commit-driven runtime firmware bump decision."""

    bump_type: str | None
    file_classes: tuple[str, ...]
    commit_type: str | None
    has_breaking_change: bool


def _require_semver(value: str, field_name: str) -> None:
    if not isinstance(value, str) or not VERSION_RE.match(value):
        raise VersionIdentityError(f"{field_name} must be semver x.y.z; got {value!r}")


def _require_identifier(value: str, field_name: str) -> None:
    if not isinstance(value, str) or not value or not IDENTIFIER_RE.match(value):
        raise VersionIdentityError(
            f"{field_name} must match [a-z0-9_]+ "
            "(lowercase alphanumeric and underscore only, no hyphens) "
            f"and be non-empty; got {value!r}"
        )


def _require_content_hash(value: str) -> None:
    if not isinstance(value, str) or not CONTENT_HASH_RE.match(value):
        raise VersionIdentityError(
            f"content_hash must be 12 lowercase hex characters; got {value!r}"
        )


def firmware_version_sort_key(value: str) -> tuple:
    """Return a total-ordering key for a runtime firmware version string.

    Delegates to :func:`.version_semver.version_sort_key`, the single version
    ordering authority shared by image lookup (:mod:`...firmware_deploy`) and the
    firmware inventory (:mod:`...firmware_inventory`), so "latest" never
    disagrees between the two surfaces.
    """

    return version_sort_key(value)


def format_full_firmware_version(
    micropython_version: str,
    board_id: str,
    runtime_id: str,
    runtime_firmware_version: str,
    content_hash: str | None = None,
) -> str:
    """Render normalized full firmware version string.

    When *content_hash* is given the name appends it
    (``<micropython>-<board>-<runtime>-<runtimeFirmware>-<hash>``); without it the
    legacy form is produced. The runtime firmware version may now carry a
    pre-release/build tail (``1.0.1-dev.7.gabc1234``), which is validated with the
    shared :data:`.version_semver.VERSION_RE` grammar rather than the old strict
    ``x.y.z`` check.
    """

    _require_semver(micropython_version, "micropython_version")
    _require_identifier(board_id, "board_id")
    _require_identifier(runtime_id, "runtime_id")
    parse_version(runtime_firmware_version.lower())

    base = f"{micropython_version}-{board_id}-{runtime_id}-{runtime_firmware_version.lower()}"
    if content_hash is None:
        return base
    _require_content_hash(content_hash)
    return f"{base}-{content_hash}"


def parse_full_firmware_version(value: str) -> FullFirmwareVersion:
    """Parse full firmware version string into normalized components.

    Parses tail-first so the runtime firmware version may itself contain hyphens
    and dots (a pre-release such as ``1.0.1-dev.7.gabc1234``). The legacy
    four-segment form and the five-segment form that appends the content hash
    both parse; the four-segment form yields ``content_hash=None``.
    """

    if not isinstance(value, str):
        raise VersionIdentityError("full firmware version must be a string")

    parts = value.split("-")
    content_hash: str | None = None
    if parts and CONTENT_HASH_RE.match(parts[-1]):
        content_hash = parts[-1]
        parts = parts[:-1]
    if len(parts) < 4:
        raise VersionIdentityError(
            "full firmware version must follow "
            "<micropython>-<board>-<runtime>-<runtimeFirmware>[-<contentHash>]"
        )

    micropython_version, board_id, runtime_id = parts[:3]
    runtime_firmware_version = "-".join(parts[3:])
    format_full_firmware_version(
        micropython_version=micropython_version,
        board_id=board_id,
        runtime_id=runtime_id,
        runtime_firmware_version=runtime_firmware_version,
        content_hash=content_hash,
    )

    return FullFirmwareVersion(
        micropython_version=micropython_version,
        board_id=board_id,
        runtime_id=runtime_id,
        runtime_firmware_version=runtime_firmware_version,
        content_hash=content_hash,
        channel=channel_of(runtime_firmware_version),
        is_prerelease=bool(parse_version(runtime_firmware_version).prerelease),
    )


def classify_changed_file(path: str) -> str:
    """Classify changed file path for runtime firmware bump scope."""

    normalized = path.replace("\\", "/")
    if normalized.startswith("src/micro_otter/nodes/device/runtime/"):
        return "runtime-source"
    if normalized.startswith("src/micro_otter/nodes/device/tools/"):
        return "device-tools"
    if normalized.startswith("src/micro_otter/nodes/device/node_pkgs/"):
        return "node-package"
    if normalized.startswith("src/micro_otter/tools/firmware_compile/runtime_assets/"):
        return "runtime-assets"
    return "other"


def decide_runtime_firmware_bump(
    commit_message: str,
    changed_paths: Iterable[str],
) -> BumpDecision:
    """Determine bump type from commit intent plus changed file classes."""

    file_classes = tuple(sorted({classify_changed_file(path) for path in changed_paths}))
    relevant = {"runtime-source", "device-tools", "node-package", "runtime-assets"}

    if not relevant.intersection(file_classes):
        return BumpDecision(
            bump_type=None,
            file_classes=file_classes,
            commit_type=None,
            has_breaking_change=False,
        )

    first_line = commit_message.strip().splitlines()[0] if commit_message.strip() else ""
    match = COMMIT_PREFIX_RE.match(first_line)
    if not match:
        raise VersionIdentityError(
            "Commit message must use Conventional Commit prefix (e.g. feat:, fix:)"
        )

    has_breaking_change = bool(match.group("breaking")) or bool(
        re.search(r"^BREAKING CHANGE", commit_message, re.MULTILINE)
    )
    commit_type = match.group("type").lower()

    if has_breaking_change:
        return BumpDecision(
            bump_type="major",
            file_classes=file_classes,
            commit_type=commit_type,
            has_breaking_change=True,
        )

    bump_type = COMMIT_TYPE_TO_BUMP.get(commit_type)
    if bump_type is None:
        raise VersionIdentityError(
            f"Commit type {commit_type!r} does not map to a runtime firmware bump"
        )

    return BumpDecision(
        bump_type=bump_type,
        file_classes=file_classes,
        commit_type=commit_type,
        has_breaking_change=False,
    )


class MicropythonVersionError(ValueError):
    """Raised when the MicroPython interpreter version cannot be resolved."""


def _tag_version(tag: str) -> str:
    """Return the ``X.Y.Z`` base a ``firmware-v*`` tag names."""

    prefix = "firmware-v"
    if not tag.startswith(prefix):
        raise VersionIdentityError(f"tag {tag!r} does not use the {prefix!r} prefix")
    return tag[len(prefix) :]


def resolve_firmware_version(
    workspace_root: Path, *, environ: Mapping[str, str] | None = None
) -> FirmwareVersionIdentity:
    """Resolve the firmware version for *workspace_root* per the locked scheme.

    Order: a valid ``MICRO_OTTER_FIRMWARE_VERSION`` override wins; otherwise the
    newest reachable ``firmware-v*`` tag supplies the base (exactly the base at
    the tag, ``<base>-dev.<n>.g<sha7>`` past it); a tagless checkout falls back to
    ``release.json`` (``<base>-dev.0.g<sha7>``); no git at all falls back to the
    ``release.json`` base with ``no-git-release-file``. Missing ``release.json`` in
    either fallback raises :class:`FirmwareVersionUnresolvedError`.
    """

    from .git_source import (
        commit_distance_since,
        current_branch,
        current_commit,
        is_shallow_repository,
        latest_release_tag,
    )
    from .version_registry import RELEASE_MANIFEST_DEFAULT_PATH, load_release_manifest

    env = os.environ if environ is None else environ
    override = env.get("MICRO_OTTER_FIRMWARE_VERSION", "").strip()
    if override:
        parsed = parse_version(override)
        base = f"{parsed.major}.{parsed.minor}.{parsed.patch}"
        return FirmwareVersionIdentity(
            version=override,
            base_version=base,
            channel=channel_of(override),
            source=VersionSource.OVERRIDE_ENV,
        )

    release_path = workspace_root / RELEASE_MANIFEST_DEFAULT_PATH
    manifest = load_release_manifest(release_path) if release_path.is_file() else None

    commit = current_commit(workspace_root)
    branch = current_branch(workspace_root)
    shallow = is_shallow_repository(workspace_root)

    if commit is not None:
        tag = latest_release_tag(workspace_root)
        if tag is not None:
            base = _tag_version(tag)
            if manifest is not None and manifest.release_version != base:
                raise ReleaseManifestBaseMismatchError(
                    f"tag {tag!r} base {base!r} disagrees with release.json "
                    f"releaseVersion {manifest.release_version!r}"
                )
            distance = commit_distance_since(workspace_root, tag)
            if distance == 0:
                return FirmwareVersionIdentity(
                    version=base,
                    base_version=base,
                    channel=channel_of(base),
                    source=VersionSource.GIT_RELEASE_TAG,
                    commit=commit,
                    distance=0,
                    tag=tag,
                    branch=branch,
                    released_at_utc=manifest.released_at_utc if manifest else None,
                    shallow=shallow,
                )
            return FirmwareVersionIdentity(
                version=f"{base}-dev.{distance}.g{commit[:7]}",
                base_version=base,
                channel=CHANNEL_DEV,
                source=VersionSource.GIT_DEV,
                commit=commit,
                distance=distance,
                tag=tag,
                branch=branch,
                released_at_utc=manifest.released_at_utc if manifest else None,
                shallow=shallow,
            )

        if manifest is None:
            raise FirmwareVersionUnresolvedError(
                "no reachable firmware-v* tag and no release.json; add a release.json "
                "or tag a release"
            )
        base = manifest.release_version
        return FirmwareVersionIdentity(
            version=f"{base}-dev.0.g{commit[:7]}",
            base_version=base,
            channel=CHANNEL_DEV,
            source=VersionSource.NO_TAG_DEV,
            commit=commit,
            distance=0,
            tag=None,
            branch=branch,
            released_at_utc=manifest.released_at_utc,
            shallow=shallow,
        )

    if manifest is None:
        raise FirmwareVersionUnresolvedError(
            "git unavailable and no release.json; add a release.json or build inside "
            "a repository"
        )
    base = manifest.release_version
    return FirmwareVersionIdentity(
        version=base,
        base_version=base,
        channel=channel_of(base),
        source=VersionSource.NO_GIT_RELEASE_FILE,
        released_at_utc=manifest.released_at_utc,
        shallow=shallow,
    )


def resolve_micropython_version(micropython_root: Path) -> str:
    """Resolve the MicroPython interpreter version as a strict semver string.

    Resolution order:
    1. ``MICROPYTHON_VERSION`` environment variable (strip leading ``v``).
    2. ``git describe --tags --abbrev=0`` on *micropython_root*.

    Raises ``MicropythonVersionError`` if neither source produces a valid semver.
    """
    env_value = os.environ.get("MICROPYTHON_VERSION", "")
    if env_value:
        stripped = env_value.lstrip("v")
        if VERSION_RE.match(stripped):
            return stripped

    try:
        result = subprocess.run(
            ["git", "describe", "--tags", "--abbrev=0"],
            cwd=micropython_root,
            capture_output=True,
            text=True,
            check=True,
        )
        tag = result.stdout.strip().lstrip("v")
        if VERSION_RE.match(tag):
            return tag
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass

    raise MicropythonVersionError(
        f"Cannot resolve MicroPython interpreter version: "
        f"MICROPYTHON_VERSION env var is unset or invalid, "
        f"and git describe on {micropython_root} failed."
    )

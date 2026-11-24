"""The single semver grammar shared by every firmware version surface.

A firmware version is a plain ``X.Y.Z`` base plus an optional pre-release and an
optional build-metadata tail. This module owns the grammar and the total order,
so ``format``/``parse`` in :mod:`.version_identity`, the inventory, deploy and
staleness all agree on what a version means.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

CHANNEL_RELEASE = "release"
CHANNEL_DEV = "dev"

VERSION_RE = re.compile(
    r"^(?P<major>0|[1-9]\d*)\.(?P<minor>0|[1-9]\d*)\.(?P<patch>0|[1-9]\d*)"
    r"(?:-(?P<prerelease>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
    r"(?:\+(?P<build>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$"
)

__all__ = [
    "CHANNEL_DEV",
    "CHANNEL_RELEASE",
    "SemanticVersion",
    "VERSION_RE",
    "VersionSyntaxError",
    "channel_of",
    "is_prerelease",
    "parse_version",
    "select_latest",
    "try_parse_version",
    "version_sort_key",
]


class VersionSyntaxError(ValueError):
    """Raised when a value is not a valid firmware version."""


@dataclass(frozen=True, slots=True)
class SemanticVersion:
    """Parsed firmware version: numeric core plus optional pre-release/build."""

    major: int
    minor: int
    patch: int
    prerelease: str | None = None
    build: str | None = None

    @property
    def is_prerelease(self) -> bool:
        """Return whether a pre-release part is present."""
        return self.prerelease is not None

    @property
    def channel(self) -> str:
        """Return the channel a pre-release implies (``dev`` or ``release``)."""
        return CHANNEL_DEV if self.is_prerelease else CHANNEL_RELEASE


def parse_version(value: str) -> SemanticVersion:
    """Parse *value* into a :class:`SemanticVersion`, raising on invalid input."""
    if not isinstance(value, str):
        raise VersionSyntaxError(f"version must be a string; got {value!r}")
    match = VERSION_RE.match(value)
    if match is None:
        raise VersionSyntaxError(f"invalid firmware version: {value!r}")
    return SemanticVersion(
        major=int(match.group("major")),
        minor=int(match.group("minor")),
        patch=int(match.group("patch")),
        prerelease=match.group("prerelease"),
        build=match.group("build"),
    )


def try_parse_version(value: str) -> SemanticVersion | None:
    """Return the parsed version, or ``None`` instead of raising."""
    try:
        return parse_version(value)
    except VersionSyntaxError:
        return None


def _prerelease_key(value: str) -> tuple[tuple[int, Any], ...]:
    """Encode pre-release identifiers for semver precedence.

    Numeric identifiers (``(0, int)``) always rank below alphanumeric ones
    (``(1, str)``), and Python tuple comparison then orders segments correctly
    with a shorter identifier list losing to a longer equal-prefix one.
    """
    return tuple(
        (0, int(part)) if part.isdigit() else (1, part)
        for part in value.split(".")
    )


def version_sort_key(value: str) -> tuple:
    """Return a total-ordering key for a firmware version string.

    Semver values order numerically (release above pre-release, numeric
    pre-release segments compared numerically, build metadata ignored); a
    non-semver string ranks below every semver value and orders against other
    non-semver strings by the raw text, so a stray filename can never make the
    newest-image pick ambiguous.
    """
    parsed = try_parse_version(value)
    if parsed is None:
        return (0, value)
    release_rank = 1 if parsed.prerelease is None else 0
    pre_key = _prerelease_key(parsed.prerelease) if parsed.prerelease is not None else ()
    return (1, parsed.major, parsed.minor, parsed.patch, release_rank, pre_key)


def is_prerelease(value: object) -> bool:
    """Return whether *value* carries a pre-release part.

    Accepts a version string, a :class:`SemanticVersion`, or a full identity
    object exposing ``.version`` (e.g. ``FirmwareVersionIdentity``). A string
    that is not semver has no pre-release and returns ``False``.
    """
    if isinstance(value, str):
        parsed = try_parse_version(value)
        return parsed is not None and parsed.prerelease is not None
    if isinstance(value, SemanticVersion):
        return value.prerelease is not None
    version = getattr(value, "version", None)
    if isinstance(version, str):
        return is_prerelease(version)
    raise TypeError(f"cannot derive prerelease status from {value!r}")


def channel_of(value: object) -> str:
    """Return ``CHANNEL_DEV`` or ``CHANNEL_RELEASE`` for *value*.

    Accepts a version string, a :class:`SemanticVersion`, or a full identity
    object exposing ``.channel`` / ``.version``. The channel is always derived
    from the version string — never from release metadata — so the two cannot
    disagree.
    """
    if isinstance(value, str):
        return CHANNEL_DEV if is_prerelease(value) else CHANNEL_RELEASE
    if isinstance(value, SemanticVersion):
        return value.channel
    channel = getattr(value, "channel", None)
    if isinstance(channel, str) and channel in (CHANNEL_RELEASE, CHANNEL_DEV):
        return channel
    version = getattr(value, "version", None)
    if isinstance(version, str):
        return channel_of(version)
    raise TypeError(f"cannot derive channel from {value!r}")


def select_latest(values: Iterable[str], *, channel: str | None = None) -> str | None:
    """Return the newest value, the newest in one channel, or ``None``."""
    candidates = list(values)
    if channel is not None:
        candidates = [v for v in candidates if channel_of(v) == channel]
    if not candidates:
        return None
    return max(candidates, key=version_sort_key)

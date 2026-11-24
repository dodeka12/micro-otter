"""Backend-agnostic resolved contents for one firmware build.

The shared layer resolves *what* goes into a firmware (these contents); the
build backend owns *how* the contents become an artifact. Nothing in this
module is a filesystem destination — staging locations belong to the backend.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from .git_source import GitSource
from .staging_models import ConstituentVersions, RuntimePayload

MPY_FREEZE = "mpy-freeze"
NO_EMBEDDING = "none"


@dataclass(frozen=True)
class ResolvedFileEntry:
    """One resolved file: its on-disk source and in-firmware relative path."""

    source_path: Path
    target_rel_path: str


@dataclass(frozen=True)
class ResolvedContents:
    """Backend-agnostic description of what goes into a firmware image.

    ``not_embedded_packages`` lists declared packages the backend cannot embed
    (its ``embedding()`` capability is not ``mpy-freeze``); those packages flow
    through the source-upload path instead.
    """

    runtime_id: str
    runtime_version: str
    file_entries: tuple[ResolvedFileEntry, ...]
    node_packages: Mapping[str, str | None]
    not_embedded_packages: tuple[str, ...]
    constituent_versions: ConstituentVersions | None
    git_source: GitSource | None


def build_resolved_contents(
    payload: RuntimePayload,
    *,
    embedding: str,
    constituent_versions: ConstituentVersions | None = None,
) -> ResolvedContents:
    """Map a resolved runtime payload into backend-agnostic contents.

    *embedding* is the build backend's ``embedding()`` capability. When it is
    ``mpy-freeze`` every declared package is embeddable; otherwise every
    declared package is recorded as ``not_embedded_packages`` so the
    source-upload path carries it.
    """

    file_entries = tuple(
        ResolvedFileEntry(source_path=asset.source_path, target_rel_path=asset.target_rel_path)
        for asset in payload.package_assets
    )
    node_packages = {asset.package_id: asset.package_version for asset in payload.package_assets}
    not_embedded = () if embedding == MPY_FREEZE else tuple(node_packages)

    return ResolvedContents(
        runtime_id=payload.runtime_id,
        runtime_version=payload.runtime_version,
        file_entries=file_entries,
        node_packages=node_packages,
        not_embedded_packages=not_embedded,
        constituent_versions=constituent_versions,
        git_source=payload.git_source,
    )


__all__ = [
    "MPY_FREEZE",
    "NO_EMBEDDING",
    "ResolvedContents",
    "ResolvedFileEntry",
    "build_resolved_contents",
]

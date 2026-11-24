"""Shared staging data models for firmware-embedded runtime compilation."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

from micro_otter.tools.addon_store import PackageProvenance

from .git_source import GitSource

if TYPE_CHECKING:
    from .build_precompile import PrecompileResult


@dataclass(frozen=True, slots=True)
class ConstituentVersions:
    """Version identifiers for each constituent of a compiled firmware image."""

    micropython_version: str
    runtime_source_version: str
    runtime_firmware_version: str
    device_tools_version: str
    node_packages: dict[str, str]
    runtime_assets_version: str | None = None
    addon_packages: dict[str, str] = field(default_factory=dict)
    package_variants: dict[str, str] = field(default_factory=dict)
    frozen_addons: dict[str, dict[str, str]] = field(default_factory=dict)

    def to_dict(self) -> dict[str, object]:
        """Return the ``device.json`` constituent-version object.

        ``runtimeAssetsVersion`` is emitted only when set and ``addonPackages`` /
        ``packageVariants`` / ``frozenAddons`` only when non-empty, so an image built
        without add-ons or without a recorded variant produces the same ``device.json``
        as before.
        """

        payload: dict[str, object] = {
            "micropythonVersion": self.micropython_version,
            "runtimeSourceVersion": self.runtime_source_version,
            "runtimeFirmwareVersion": self.runtime_firmware_version,
            "deviceToolsVersion": self.device_tools_version,
            "nodePackages": dict(self.node_packages),
        }
        if self.runtime_assets_version is not None:
            payload["runtimeAssetsVersion"] = self.runtime_assets_version
        if self.addon_packages:
            payload["addonPackages"] = dict(self.addon_packages)
        if self.package_variants:
            payload["packageVariants"] = dict(self.package_variants)
        if self.frozen_addons:
            payload["frozenAddons"] = {
                package_id: dict(record) for package_id, record in self.frozen_addons.items()
            }
        return payload


@dataclass(frozen=True, slots=True)
class RuntimePackageAsset:
    """Single resolved package asset staged into firmware modules tree."""

    package_id: str
    package_version: str | None
    source_path: Path
    target_rel_path: str
    provenance: PackageProvenance = PackageProvenance.BUILTIN
    """Where the asset came from; cosmetic metadata that never changes staging."""


@dataclass(frozen=True, slots=True)
class RuntimePayload:
    """Normalized resolved payload for one runtime staging run."""

    runtime_id: str
    runtime_version: str
    runtime_root: Path
    runtime_files: tuple[str, ...]
    tools_files: tuple[str, ...]
    package_assets: tuple[RuntimePackageAsset, ...]
    runtime_target_id: str | None = None
    compile_board_id: str | None = None
    compile_port_id: str | None = None
    target_mapping_rule_id: str | None = None
    target_mapping_source: str | None = None
    target_mapping_confidence: str | None = None
    allowed_web_target_ids: tuple[str, ...] = ()
    """Web target ids this firmware's board can onboard, in mapping order."""
    web_target_base_id: str | None = None
    """Terminal build base id this image was built against, or ``None``."""
    runtime_name: str | None = None
    runtime_description: str | None = None
    runtime_assets_version: str | None = None
    git_source: GitSource | None = None
    mpy_source_excludes: tuple[str, ...] = ()
    addon_package_ids: tuple[str, ...] = ()
    """Installed add-on ids offered to this run, in id order (empty without add-ons)."""


@dataclass(frozen=True, slots=True)
class StagingConflict:
    """Collision detected for same target path from different sources."""

    target_rel_path: str
    first_source: Path
    second_source: Path
    reason: str = "duplicate-target-path"


@dataclass(frozen=True, slots=True)
class StagingFileEntry:
    """Single staged file mapping from source to target path."""

    source_path: Path
    target_rel_path: str
    origin: str
    package_id: str | None = None
    package_version: str | None = None


@dataclass(slots=True)
class StagingPreflightResult:
    """Result of target mapping and duplicate-path preflight checks."""

    entries: list[StagingFileEntry] = field(default_factory=list)
    conflicts: list[StagingConflict] = field(default_factory=list)


@dataclass(slots=True)
class StagingCleanResult:
    """Managed cleanup execution result."""

    deleted_paths: list[Path] = field(default_factory=list)
    dry_run: bool = False


@dataclass(slots=True)
class StagingStartupResult:
    """Startup staging execution result."""

    files_discovered: int = 0
    files_written: int = 0
    dry_run: bool = False


@dataclass(slots=True)
class StagingExecutionReport:
    """Top-level staging execution report for dry-run/full-run modes."""

    dry_run: bool
    runtime_id: str
    runtime_version: str
    target: str
    modules_path: Path
    files_discovered: int = 0
    files_copied: int = 0
    files_startup_written: int = 0
    static_asset_files_embedded: int = 0
    static_asset_raw_bytes: int = 0
    static_asset_compressed_bytes: int = 0
    conflicts: list[StagingConflict] = field(default_factory=list)
    embedded_manifest_path: Path | None = None
    embedded_hashes_path: Path | None = None
    runtime_assets_version: str | None = None
    git_source: dict | None = None
    precompile: PrecompileResult | None = None


@dataclass(frozen=True, slots=True)
class EmbeddedHashRecord:
    """Hash entry for deterministic embedded metadata output."""

    path: str
    file_hash: str
    file_kind: str
    source: str = "embedded"
    package_id: str | None = None
    package_version: str | None = None


@dataclass(slots=True)
class StagingCopyResult:
    """Execution result summary for staging/copy pipelines."""

    files_discovered: int = 0
    files_copied: int = 0
    files_skipped: int = 0
    conflicts: list[StagingConflict] = field(default_factory=list)

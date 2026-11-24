"""Canonical path mapping and collision preflight checks for staging."""

from __future__ import annotations

from pathlib import Path

from micro_otter.tools.addon_store import ADDON_MODULE_PREFIX

from .staging_models import (
    RuntimePayload,
    StagingConflict,
    StagingFileEntry,
    StagingPreflightResult,
)


def _canonicalize_package_target(package_id: str, target_rel_path: str) -> str:
    parts = Path(target_rel_path).parts
    if not parts:
        raise ValueError("Package target path must not be empty")

    # New layout: any otter_* or moa_* module namespace is already canonical at
    # the top level. This intentionally does not key off the package id, because
    # the deployed module can differ from the id (e.g. id "audio" -> module
    # "otter_audio_viper"; add-on id "pulse" -> module "moa_pulse_viper").
    if parts[0].startswith("otter_") or parts[0].startswith(ADDON_MODULE_PREFIX):
        return target_rel_path

    # Legacy layout: libs/<pkg_id>/<module> — strip and rebuild
    module_parts = parts
    if len(parts) >= 3 and parts[0] == "libs":
        module_parts = parts[2:]

    if not module_parts:
        raise ValueError(f"Invalid package module target path: {target_rel_path}")

    return str(Path(f"otter_{package_id}") / Path(*module_parts))


def build_staging_preflight(payload: RuntimePayload, device_root: Path) -> StagingPreflightResult:
    """Build deterministic staging mappings and detect duplicate targets."""

    device_root = device_root.resolve()
    runtime_root = payload.runtime_root.resolve()
    tools_root = (device_root / "tools").resolve()

    result = StagingPreflightResult()

    # Keep source-order deterministic behavior from manifest payloads.
    for rel_path in payload.runtime_files:
        result.entries.append(
            StagingFileEntry(
                source_path=(runtime_root / rel_path).resolve(),
                target_rel_path=rel_path,
                origin="runtime",
            )
        )

    for rel_path in payload.tools_files:
        target_rel = rel_path if rel_path.startswith("tools/") else str(Path("tools") / rel_path)
        result.entries.append(
            StagingFileEntry(
                source_path=(tools_root / rel_path).resolve(),
                target_rel_path=target_rel,
                origin="tools",
            )
        )

    for asset in payload.package_assets:
        result.entries.append(
            StagingFileEntry(
                source_path=asset.source_path.resolve(),
                target_rel_path=_canonicalize_package_target(
                    asset.package_id, asset.target_rel_path
                ),
                origin="package",
                package_id=asset.package_id,
                package_version=asset.package_version,
            )
        )

    seen: dict[str, Path] = {}
    for entry in result.entries:
        if entry.target_rel_path in seen:
            result.conflicts.append(
                StagingConflict(
                    target_rel_path=entry.target_rel_path,
                    first_source=seen[entry.target_rel_path],
                    second_source=entry.source_path,
                )
            )
            continue
        seen[entry.target_rel_path] = entry.source_path

    return result

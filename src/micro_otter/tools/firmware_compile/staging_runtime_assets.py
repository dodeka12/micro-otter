"""Copy runtime-agnostic compile-owned runtime asset modules."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from .staging_models import StagingFileEntry
from .staging_paths import StagingPaths

RUNTIME_ASSET_RELATIVE_PATHS = (
    "otter_runtime/bootstrap_setup_contract.py",
    "otter_runtime/bootstrap_setup_startup.py",
    "otter_runtime/embedded_metadata_api.py",
)


def resolve_runtime_assets_root(workspace_root: Path) -> Path:
    """Resolve the compile-owned runtime_assets directory."""
    local_assets_root = (Path(__file__).resolve().parent / "runtime_assets").resolve()
    if local_assets_root.exists() and local_assets_root.is_dir():
        return local_assets_root

    return (
        workspace_root
        / "src"
        / "micro_otter"
        / "tools"
        / "firmware_compile"
        / "runtime_assets"
    ).resolve()


def read_manifest_version(manifest_path: Path) -> str | None:
    """Read the ``version`` field of a runtime assets manifest, or None if unavailable."""
    if not manifest_path.exists():
        return None
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return None
        return data.get("version") or None
    except (json.JSONDecodeError, OSError):
        return None


def read_runtime_assets_version(workspace_root: Path) -> str | None:
    """Read the version from runtime_assets/manifest.json, or None if unavailable."""
    return read_manifest_version(resolve_runtime_assets_root(workspace_root) / "manifest.json")


def read_packaged_runtime_assets_version() -> str | None:
    """Read the runtime assets version shipped next to this package, if available."""
    return read_manifest_version(
        (Path(__file__).resolve().parent / "runtime_assets" / "manifest.json").resolve()
    )


def stage_runtime_agnostic_assets(
    paths: StagingPaths,
    dry_run: bool = False,
) -> list[StagingFileEntry]:
    """Stage runtime-agnostic runtime modules from compile-owned assets."""

    assets_root = resolve_runtime_assets_root(paths.workspace_root)
    modules_root = paths.modules_path.resolve()
    entries: list[StagingFileEntry] = []

    for rel_path in RUNTIME_ASSET_RELATIVE_PATHS:
        source = (assets_root / rel_path).resolve()
        if not source.exists() or not source.is_file():
            raise FileNotFoundError(f"Missing compile runtime asset file: {source}")

        target = (modules_root / rel_path).resolve()
        entries.append(
            StagingFileEntry(
                source_path=source,
                target_rel_path=rel_path,
                origin="compile-runtime-assets",
            )
        )

        target.parent.mkdir(parents=True, exist_ok=True)
        if not dry_run:
            shutil.copy2(source, target)

    return entries

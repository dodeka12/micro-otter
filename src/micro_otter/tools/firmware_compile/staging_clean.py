"""Managed cleanup logic for staging destination subtree."""

from __future__ import annotations

import shutil
from pathlib import Path

from micro_otter.tools.addon_store import ADDON_MODULE_PREFIX

from .staging_models import StagingCleanResult
from .staging_paths import StagingPaths

_DEFAULT_MANAGED_DIRS = (
    "tools",
    "libs",
    "otter_runtime",
    "otter_core",
    "otter_webview",
    "otter_stdmo",
    "otter_audio_viper",
    "otter_power",
    "otter_mqtt",
    "otter_vars",
    "otter_led",
    # Legacy module roots left behind by earlier package ids and
    # canonicalization rules; they are no longer staged but must still be
    # cleaned so stale copies do not leak into the next firmware build.
    "otter_audio",
    "otter_otter_audio_viper",
    "app",
    "otter",
)
_DEFAULT_MANAGED_FILES = ("main.py",)


def _ensure_within_modules_root(modules_root: Path, candidate: Path) -> None:
    try:
        candidate.resolve().relative_to(modules_root.resolve())
    except ValueError as exc:
        raise ValueError(f"Refusing to clean path outside modules root: {candidate}") from exc


def _addon_module_dirs(modules_root: Path) -> list[Path]:
    """Return every top-level ``moa_*`` directory under *modules_root*.

    Add-on roots are not in the static managed-dir tuple because they are unbounded
    (one per installed package id and variant). Sweeping them here means a rebuild
    that switches an add-on package between base and variant cannot leave the other
    root's ``.py``/``.mpy`` files behind.
    """

    try:
        entries = sorted(modules_root.iterdir(), key=lambda path: path.name)
    except OSError:
        return []
    return [
        entry
        for entry in entries
        if entry.is_dir() and entry.name.startswith(ADDON_MODULE_PREFIX)
    ]


def clean_managed_subtree(
    paths: StagingPaths,
    managed_dirs: tuple[str, ...] = _DEFAULT_MANAGED_DIRS,
    managed_files: tuple[str, ...] = _DEFAULT_MANAGED_FILES,
    dry_run: bool = False,
) -> StagingCleanResult:
    """Wipe managed staging destination subtree with guard rails."""

    modules_root = paths.modules_path.resolve()
    result = StagingCleanResult(dry_run=dry_run)

    for rel_dir in managed_dirs:
        candidate = (modules_root / rel_dir).resolve()
        _ensure_within_modules_root(modules_root, candidate)
        if not candidate.exists():
            continue
        result.deleted_paths.append(candidate)
        if not dry_run:
            shutil.rmtree(candidate)

    for candidate in _addon_module_dirs(modules_root):
        _ensure_within_modules_root(modules_root, candidate)
        if not candidate.exists():
            continue
        result.deleted_paths.append(candidate)
        if not dry_run:
            shutil.rmtree(candidate)

    for rel_file in managed_files:
        candidate = (modules_root / rel_file).resolve()
        _ensure_within_modules_root(modules_root, candidate)
        if not candidate.exists() or not candidate.is_file():
            continue
        result.deleted_paths.append(candidate)
        if not dry_run:
            candidate.unlink()

    return result

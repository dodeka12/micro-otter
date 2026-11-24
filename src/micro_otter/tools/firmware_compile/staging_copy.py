"""Deterministic file copy pipeline for staging."""

from __future__ import annotations

import shutil

from .staging_models import StagingCopyResult, StagingPreflightResult
from .staging_paths import StagingPaths


def execute_staging_copy(
    paths: StagingPaths,
    preflight: StagingPreflightResult,
    dry_run: bool = False,
) -> StagingCopyResult:
    """Copy staged files into modules destination with deterministic behavior."""

    if preflight.conflicts:
        raise ValueError("Cannot execute staging copy while conflicts are present")

    result = StagingCopyResult(files_discovered=len(preflight.entries))
    modules_root = paths.modules_path.resolve()

    for entry in preflight.entries:
        source = entry.source_path.resolve()
        if not source.exists() or not source.is_file():
            raise FileNotFoundError(f"Missing staging source file: {source}")

        target = (modules_root / entry.target_rel_path).resolve()
        target.parent.mkdir(parents=True, exist_ok=True)

        if dry_run:
            result.files_copied += 1
            continue

        shutil.copy2(source, target)
        result.files_copied += 1

    return result

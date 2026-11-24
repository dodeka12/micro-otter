"""Path resolution and validation for runtime staging."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

_DEFAULT_MICROPYTHON_ROOT = Path("src/micropython")
_TARGET_PATTERN = re.compile(r"^[a-z0-9_\-]+$")


@dataclass(frozen=True, slots=True)
class StagingPaths:
    """Resolved paths used by staging/build operations."""

    workspace_root: Path
    micropython_root: Path
    target: str
    modules_path: Path


def _validate_target(target: str) -> str:
    normalized = target.strip().lower()
    if not normalized:
        raise ValueError("Target must not be empty")
    if not _TARGET_PATTERN.match(normalized):
        raise ValueError(f"Invalid target value: {target}")
    return normalized


def resolve_staging_paths(
    workspace_root: Path,
    target: str,
    micropython_root: Path | None = None,
    modules_path: Path | None = None,
) -> StagingPaths:
    """Resolve and validate target-aware staging paths.

    Args:
        workspace_root: Repository workspace root.
        target: Selected MicroPython target/port identifier (for example esp32, rp2).
        micropython_root: Optional override of MicroPython clone root.
        modules_path: Optional override of modules destination directory.
    """

    root = workspace_root.resolve()
    selected_target = _validate_target(target)

    resolved_micropython_root = (
        (root / _DEFAULT_MICROPYTHON_ROOT) if micropython_root is None else micropython_root
    ).resolve()
    if not resolved_micropython_root.exists() or not resolved_micropython_root.is_dir():
        raise ValueError(f"Invalid MicroPython root: {resolved_micropython_root}")

    resolved_modules_path = (
        resolved_micropython_root / "ports" / selected_target / "modules"
        if modules_path is None
        else modules_path
    ).resolve()

    if resolved_modules_path == resolved_micropython_root:
        raise ValueError("Modules path must not be the MicroPython root")

    try:
        resolved_modules_path.relative_to(resolved_micropython_root)
    except ValueError as exc:
        raise ValueError(
            "Modules path must be located under the selected MicroPython root"
        ) from exc

    return StagingPaths(
        workspace_root=root,
        micropython_root=resolved_micropython_root,
        target=selected_target,
        modules_path=resolved_modules_path,
    )

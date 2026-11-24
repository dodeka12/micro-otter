"""Build profile boundary models for phase-4 firmware compile integration."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class ModulePackagingMode(str, Enum):
    """Supported module packaging modes for build integration."""

    SOURCE_PY = "source-py"
    COMPILED_MPY = "compiled-mpy"


@dataclass(frozen=True)
class BuildProfile:
    """Normalized build profile inputs for toolchain orchestration."""

    runtime_id: str
    board: str
    packaging_mode: ModulePackagingMode = ModulePackagingMode.SOURCE_PY
    optimization_level: int | None = None
    include_all_compatible_packages: bool = True


def default_build_profile(*, runtime_id: str, board: str) -> BuildProfile:
    """Create the default source-first build profile."""

    return BuildProfile(runtime_id=runtime_id, board=board)


def normalize_build_profile(
    *,
    runtime_id: str,
    board: str,
    packaging_mode: str | ModulePackagingMode | None = None,
    optimization_level: int | None = None,
    include_all_compatible_packages: bool = True,
) -> BuildProfile:
    """Normalize and validate build profile inputs."""

    normalized_runtime_id = runtime_id.strip()
    if not normalized_runtime_id:
        raise ValueError("runtime-id must not be empty")

    normalized_board = board.strip()
    if not normalized_board:
        raise ValueError("board must not be empty")

    selected_mode = ModulePackagingMode.SOURCE_PY
    if packaging_mode is not None:
        if isinstance(packaging_mode, ModulePackagingMode):
            selected_mode = packaging_mode
        else:
            normalized_mode = packaging_mode.strip().lower()
            aliases = {
                "source": ModulePackagingMode.SOURCE_PY,
                "source-py": ModulePackagingMode.SOURCE_PY,
                "py": ModulePackagingMode.SOURCE_PY,
                "compiled-mpy": ModulePackagingMode.COMPILED_MPY,
                "mpy": ModulePackagingMode.COMPILED_MPY,
            }
            if normalized_mode not in aliases:
                raise ValueError(f"Unsupported module packaging mode: {packaging_mode}")
            selected_mode = aliases[normalized_mode]

    if optimization_level is not None and optimization_level < 0:
        raise ValueError("optimization-level must be >= 0")

    return BuildProfile(
        runtime_id=normalized_runtime_id,
        board=normalized_board,
        packaging_mode=selected_mode,
        optimization_level=optimization_level,
        include_all_compatible_packages=include_all_compatible_packages,
    )

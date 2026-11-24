"""Toolchain asset lookup for Micro-Otter.

This package is the single place that knows where the toolchain assets under
``deploy/toolchain`` live on disk. A later milestone (M7) ships the same assets
inside the wheel under ``micro_otter/toolchain/assets``; :func:`assets_dir` then
prefers the packaged copy without any call site changing.
"""

from __future__ import annotations

from .assets import (
    ASSETS_ENV_VAR,
    ToolchainAssetsNotFound,
    assets_dir,
    bootstrap_script_path,
    clear_assets_cache,
    doctor_script_path,
    launcher_path,
    script_path,
    versions_env_path,
)

__all__ = [
    "ASSETS_ENV_VAR",
    "ToolchainAssetsNotFound",
    "assets_dir",
    "bootstrap_script_path",
    "clear_assets_cache",
    "doctor_script_path",
    "launcher_path",
    "script_path",
    "versions_env_path",
]

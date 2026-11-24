"""Firmware build backend seam: protocol, shared types, and registry.

Import contract types from this package. Adapter modules are intentionally not
imported here: the registry loads ``esp_idf`` by module path on first use, so
importing the seam never drags in orchestration-side effects.
"""

from __future__ import annotations

from .base import (
    BackendStatus,
    BuildBackend,
    BuildBackendError,
    BuildBackendUnavailableError,
    BuildEvent,
    BuildEventKind,
    BuildRequest,
    BuildResult,
    NoAvailableBuildBackendError,
    StreamCallback,
    UnknownBuildBackendError,
    UnsupportedBuildTargetError,
)
from .registry import (
    AUTO_BACKEND_ID,
    BUILD_BACKEND_ENTRY_POINT_GROUP,
    BUILD_BACKEND_ENV_VAR,
    get_backend,
    iter_entry_point_backends,
    known_backend_ids,
    normalize_target,
    register_backend,
    reset_registry,
    select_backend,
    select_backend_for_board,
)

__all__ = [
    "AUTO_BACKEND_ID",
    "BUILD_BACKEND_ENTRY_POINT_GROUP",
    "BUILD_BACKEND_ENV_VAR",
    "BackendStatus",
    "BuildBackend",
    "BuildBackendError",
    "BuildBackendUnavailableError",
    "BuildEvent",
    "BuildEventKind",
    "BuildRequest",
    "BuildResult",
    "NoAvailableBuildBackendError",
    "StreamCallback",
    "UnknownBuildBackendError",
    "UnsupportedBuildTargetError",
    "get_backend",
    "iter_entry_point_backends",
    "known_backend_ids",
    "normalize_target",
    "register_backend",
    "reset_registry",
    "select_backend",
    "select_backend_for_board",
]

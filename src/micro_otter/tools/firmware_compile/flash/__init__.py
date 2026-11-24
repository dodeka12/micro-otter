"""Firmware flash backend seam: protocol, shared types, and registry.

Import contract types from this package. Adapter modules are intentionally not
imported here: the registry loads ``esptool`` by module path on first use, so
importing the seam never drags in tool-side effects.
"""

from __future__ import annotations

from .base import (
    FirmwareImageNotFoundError,
    FlashBackend,
    FlashBackendError,
    FlashBackendUnavailableError,
    FlashCommandError,
    FlashEventKind,
    FlashRequest,
    FlashResult,
    FlashToolMissingError,
    MonitorNotSupportedError,
    NoAvailableFlashBackendError,
    UnknownFlashBackendError,
    UnsupportedFlashChipError,
)
from .registry import (
    AUTO_FLASH_BACKEND_ID,
    FLASH_BACKEND_ENTRY_POINT_GROUP,
    FLASH_BACKEND_ENV_VAR,
    get_flash_backend,
    iter_entry_point_flash_backends,
    known_flash_backend_ids,
    normalize_chip,
    register_flash_backend,
    reset_flash_registry,
    select_flash_backend,
    select_flash_backend_for_board,
)

__all__ = [
    "AUTO_FLASH_BACKEND_ID",
    "FLASH_BACKEND_ENTRY_POINT_GROUP",
    "FLASH_BACKEND_ENV_VAR",
    "FirmwareImageNotFoundError",
    "FlashBackend",
    "FlashBackendError",
    "FlashBackendUnavailableError",
    "FlashCommandError",
    "FlashEventKind",
    "FlashRequest",
    "FlashResult",
    "FlashToolMissingError",
    "MonitorNotSupportedError",
    "NoAvailableFlashBackendError",
    "UnknownFlashBackendError",
    "UnsupportedFlashChipError",
    "get_flash_backend",
    "iter_entry_point_flash_backends",
    "known_flash_backend_ids",
    "normalize_chip",
    "register_flash_backend",
    "reset_flash_registry",
    "select_flash_backend",
    "select_flash_backend_for_board",
]

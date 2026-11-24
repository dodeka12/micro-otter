"""Flash backend registry, entry-point discovery, and selection.

Selection is the single place where the flash path decides which backend serves a
request, so callers never import a concrete adapter. Built-in adapters are loaded
lazily by module path, which keeps importing this module free of tool-side
effects.
"""

from __future__ import annotations

import importlib
import logging
import os
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from importlib import metadata
from typing import TYPE_CHECKING

from .base import (
    FlashBackend,
    FlashBackendUnavailableError,
    NoAvailableFlashBackendError,
    UnknownFlashBackendError,
    UnsupportedFlashChipError,
)

if TYPE_CHECKING:  # pragma: no cover - typing only, keeps the import graph flat
    from ..board_registry import BoardSpec

FLASH_BACKEND_ENV_VAR = "MICRO_OTTER_FLASH_BACKEND"
FLASH_BACKEND_ENTRY_POINT_GROUP = "micro_otter.flash_backends"
AUTO_FLASH_BACKEND_ID = "auto"

_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class _BackendSpec:
    """Lazy import coordinates for a built-in flash backend adapter."""

    backend_id: str
    module: str
    attribute: str


_BUILTIN_SPECS: tuple[_BackendSpec, ...] = (
    _BackendSpec(
        backend_id="esptool",
        module="micro_otter.tools.firmware_compile.flash.esptool",
        attribute="EsptoolFlashBackend",
    ),
)

_REGISTERED: dict[str, FlashBackend] = {}


def register_flash_backend(backend: FlashBackend) -> None:
    """Register *backend* so lookups and ``auto`` selection can find it.

    Registering an id that already exists as a built-in replaces the built-in for
    the rest of the process, which lets embedders and tests swap adapters.
    """

    _REGISTERED[backend.id] = backend


def reset_flash_registry() -> None:
    """Drop every programmatic registration, restoring built-in defaults."""

    _REGISTERED.clear()


def normalize_chip(chip: str) -> str:
    """Return the canonical comparison form for an esptool chip id."""

    return chip.strip().lower()


def _normalize_chips(chips: Iterable[str]) -> tuple[str, ...]:
    """Normalize an iterable of chip ids, preserving order and dropping repeats."""

    normalized: list[str] = []
    for chip in chips:
        candidate = normalize_chip(chip)
        if candidate and candidate not in normalized:
            normalized.append(candidate)
    return tuple(normalized)


def _coerce_backend(loaded: object, *, description: str) -> FlashBackend:
    """Return a backend instance from an entry-point class, factory, or instance."""

    candidate = loaded() if isinstance(loaded, type) else loaded
    if isinstance(candidate, FlashBackend):
        return candidate
    raise TypeError(f"flash backend {description!r} does not implement FlashBackend")


def _load_spec(spec: _BackendSpec) -> FlashBackend:
    """Import and instantiate the adapter described by *spec*."""

    module = importlib.import_module(spec.module)
    factory = getattr(module, spec.attribute)
    return _coerce_backend(factory, description=spec.backend_id)


def _entry_point_backends() -> tuple[tuple[str, FlashBackend], ...]:
    """Return ``(name, backend)`` pairs discovered from the entry-point group.

    A broken or misbehaving entry point is skipped with a warning so one bad
    third-party distribution cannot break every flash invocation.
    """

    try:
        discovered = tuple(metadata.entry_points(group=FLASH_BACKEND_ENTRY_POINT_GROUP))
    except Exception as error:  # pragma: no cover - depends on installed metadata
        _LOGGER.warning(
            "Unable to read %s entry points: %s", FLASH_BACKEND_ENTRY_POINT_GROUP, error
        )
        return ()

    loaded: list[tuple[str, FlashBackend]] = []
    seen: set[str] = set()
    for entry_point in sorted(discovered, key=lambda item: str(getattr(item, "name", ""))):
        name = str(getattr(entry_point, "name", "") or "").strip()
        if not name or name in seen:
            continue
        try:
            backend = _coerce_backend(entry_point.load(), description=name)
        except Exception as error:
            _LOGGER.warning("Skipping flash backend entry point %r: %s", name, error)
            continue
        seen.add(name)
        loaded.append((name, backend))
    return tuple(loaded)


def iter_entry_point_flash_backends() -> tuple[FlashBackend, ...]:
    """Return out-of-tree flash backends sorted by entry-point name."""

    return tuple(backend for _name, backend in _entry_point_backends())


def known_flash_backend_ids() -> tuple[str, ...]:
    """Return every visible flash backend id in resolution order."""

    ids = list(_REGISTERED)
    for spec in _BUILTIN_SPECS:
        if spec.backend_id not in ids:
            ids.append(spec.backend_id)
    for name, backend in _entry_point_backends():
        for candidate in (name, backend.id):
            if candidate not in ids:
                ids.append(candidate)
    return tuple(ids)


def get_flash_backend(backend_id: str) -> FlashBackend:
    """Return the flash backend registered under *backend_id*.

    Resolution order is: programmatic registration, built-in adapter, then an
    entry point whose name or backend id matches.
    """

    normalized = backend_id.strip()
    if not normalized:
        raise UnknownFlashBackendError(backend_id, known_backend_ids=known_flash_backend_ids())

    registered = _REGISTERED.get(normalized)
    if registered is not None:
        return registered

    for spec in _BUILTIN_SPECS:
        if spec.backend_id == normalized:
            return _load_spec(spec)

    for name, backend in _entry_point_backends():
        if normalized in (name, backend.id):
            return backend

    raise UnknownFlashBackendError(normalized, known_backend_ids=known_flash_backend_ids())


def _concrete_choice(value: str | None) -> str | None:
    """Return *value* as a backend id unless it is blank or ``auto``."""

    if value is None:
        return None
    normalized = value.strip()
    if not normalized or normalized.lower() == AUTO_FLASH_BACKEND_ID:
        return None
    return normalized


def _environment_choice(environ: Mapping[str, str] | None = None) -> str | None:
    """Return the concrete backend id from ``MICRO_OTTER_FLASH_BACKEND``, if any."""

    source = os.environ if environ is None else environ
    return _concrete_choice(source.get(FLASH_BACKEND_ENV_VAR))


def _is_selectable(backend: FlashBackend, chip: str) -> bool:
    """Return True when *backend* is available and can flash *chip*."""

    try:
        if chip not in _normalize_chips(backend.supported_chips()):
            return False
        return backend.status().available
    except Exception as error:
        _LOGGER.warning("Flash backend %r reported an unusable status: %s", backend.id, error)
        return False


def _require_available(backend: FlashBackend) -> None:
    """Raise when a hard-selected backend reports that it cannot run."""

    try:
        status = backend.status()
    except Exception as error:
        raise FlashBackendUnavailableError(
            backend.id, detail=str(error) or type(error).__name__
        ) from error
    if not status.available:
        raise FlashBackendUnavailableError(backend.id, detail=status.detail)


def _candidate_backends() -> tuple[FlashBackend, ...]:
    """Return backends in ``auto`` order: built-ins, registrations, entry points."""

    ordered_ids: list[str] = [spec.backend_id for spec in _BUILTIN_SPECS]
    ordered_ids.extend(backend_id for backend_id in _REGISTERED if backend_id not in ordered_ids)
    for name, _backend in _entry_point_backends():
        if name not in ordered_ids:
            ordered_ids.append(name)

    candidates: list[FlashBackend] = []
    for backend_id in ordered_ids:
        try:
            candidates.append(get_flash_backend(backend_id))
        except UnknownFlashBackendError:
            # An adapter that disappeared between discovery and resolution is
            # simply not a candidate any more.
            continue
        except Exception as error:
            _LOGGER.warning("Skipping flash backend %r: %s", backend_id, error)
            continue
    return tuple(candidates)


def _select_auto(chip: str) -> FlashBackend:
    """Return the first candidate in ``auto`` order that can flash *chip*."""

    considered: list[str] = []
    for backend in _candidate_backends():
        if backend.id in considered:
            continue
        considered.append(backend.id)
        if _is_selectable(backend, chip):
            return backend
    raise NoAvailableFlashBackendError(chip, considered_backend_ids=considered)


def select_flash_backend(
    *,
    chip: str,
    requested: str | None = None,
    board_default: str | None = None,
    environ: Mapping[str, str] | None = None,
) -> FlashBackend:
    """Return the flash backend that should flash *chip*.

    Precedence is: explicit ``requested`` id (CLI/API), a concrete
    ``MICRO_OTTER_FLASH_BACKEND`` value, the board-catalog ``board_default``,
    then ``auto``. The first two are hard choices and raise structured errors;
    the board default is a soft preference that falls through to ``auto``.
    """

    normalized_chip = normalize_chip(chip)
    if not normalized_chip:
        raise ValueError("chip must not be empty")

    hard_choice = _concrete_choice(requested) or _environment_choice(environ)
    if hard_choice is not None:
        backend = get_flash_backend(hard_choice)
        _require_available(backend)
        _require_supported(backend, normalized_chip)
        return backend

    preference = _concrete_choice(board_default)
    if preference is not None:
        try:
            backend = get_flash_backend(preference)
        except UnknownFlashBackendError as error:
            _LOGGER.warning("Ignoring board default flash backend: %s", error)
        else:
            if _is_selectable(backend, normalized_chip):
                return backend
            _LOGGER.info(
                "Board default flash backend %r cannot flash %r; falling back to auto",
                backend.id,
                normalized_chip,
            )

    return _select_auto(normalized_chip)


def _require_supported(backend: FlashBackend, chip: str) -> None:
    """Raise when a hard-selected backend cannot flash *chip*."""

    supported = _normalize_chips(backend.supported_chips())
    if chip not in supported:
        raise UnsupportedFlashChipError(backend.id, chip, supported_chips=supported)


def select_flash_backend_for_board(
    board_spec: BoardSpec,
    *,
    chip: str | None = None,
    requested: str | None = None,
    environ: Mapping[str, str] | None = None,
) -> FlashBackend:
    """Return the flash backend for *board_spec* without re-deriving precedence.

    The catalog's ``flash_backend`` becomes the soft ``board_default``, so an
    explicit request or a concrete ``MICRO_OTTER_FLASH_BACKEND`` value still wins
    and an unavailable catalog default falls through to ``auto``. ``chip``
    defaults to the board's catalog chip.
    """

    return select_flash_backend(
        chip=chip or board_spec.chip,
        requested=requested,
        board_default=board_spec.flash_backend,
        environ=environ,
    )

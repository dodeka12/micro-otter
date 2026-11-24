"""Build backend registry, entry-point discovery, and selection.

Selection is the single place where the compile pipeline decides which backend
serves a request, so callers never import a concrete adapter. Built-in adapters
are loaded lazily by module path, which keeps importing this module free of
toolchain side effects.
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
    BuildBackend,
    BuildBackendUnavailableError,
    NoAvailableBuildBackendError,
    UnknownBuildBackendError,
    UnsupportedBuildTargetError,
)

if TYPE_CHECKING:  # pragma: no cover - typing only, avoids an import cycle risk
    from ..board_registry import BoardSpec

BUILD_BACKEND_ENV_VAR = "MICRO_OTTER_BUILD_BACKEND"
BUILD_BACKEND_ENTRY_POINT_GROUP = "micro_otter.build_backends"
AUTO_BACKEND_ID = "auto"

_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class _BackendSpec:
    """Lazy import coordinates for a built-in backend adapter."""

    backend_id: str
    module: str
    attribute: str


_BUILTIN_SPECS: tuple[_BackendSpec, ...] = (
    _BackendSpec(
        backend_id="esp-idf",
        module="micro_otter.tools.firmware_compile.backends.esp_idf",
        attribute="EspIdfBackend",
    ),
)

_REGISTERED: dict[str, BuildBackend] = {}


def register_backend(backend: BuildBackend) -> None:
    """Register *backend* so lookups and ``auto`` selection can find it.

    Registering an id that already exists as a built-in replaces the built-in
    for the rest of the process, which lets embedders and tests swap adapters.
    """

    _REGISTERED[backend.id] = backend


def reset_registry() -> None:
    """Drop every programmatic registration, restoring built-in defaults."""

    _REGISTERED.clear()


def normalize_target(target: str) -> str:
    """Return the canonical comparison form for a compile target."""

    return target.strip().lower()


def _normalize_targets(targets: Iterable[str]) -> tuple[str, ...]:
    """Normalize an iterable of target ids, preserving order and dropping repeats."""

    normalized: list[str] = []
    for target in targets:
        candidate = normalize_target(target)
        if candidate and candidate not in normalized:
            normalized.append(candidate)
    return tuple(normalized)


def _coerce_backend(loaded: object, *, description: str) -> BuildBackend:
    """Return a backend instance from an entry-point class, factory, or instance."""

    candidate = loaded() if isinstance(loaded, type) else loaded
    if isinstance(candidate, BuildBackend):
        return candidate
    raise TypeError(f"build backend {description!r} does not implement BuildBackend")


def _load_spec(spec: _BackendSpec) -> BuildBackend:
    """Import and instantiate the adapter described by *spec*."""

    module = importlib.import_module(spec.module)
    factory = getattr(module, spec.attribute)
    return _coerce_backend(factory, description=spec.backend_id)


def _entry_point_backends() -> tuple[tuple[str, BuildBackend], ...]:
    """Return ``(name, backend)`` pairs discovered from the entry-point group.

    A broken or misbehaving entry point is skipped with a warning so one bad
    third-party distribution cannot break every compile invocation.
    """

    try:
        discovered = tuple(metadata.entry_points(group=BUILD_BACKEND_ENTRY_POINT_GROUP))
    except Exception as error:  # pragma: no cover - depends on installed metadata
        _LOGGER.warning(
            "Unable to read %s entry points: %s", BUILD_BACKEND_ENTRY_POINT_GROUP, error
        )
        return ()

    loaded: list[tuple[str, BuildBackend]] = []
    seen: set[str] = set()
    for entry_point in sorted(discovered, key=lambda item: str(getattr(item, "name", ""))):
        name = str(getattr(entry_point, "name", "") or "").strip()
        if not name or name in seen:
            continue
        try:
            backend = _coerce_backend(entry_point.load(), description=name)
        except Exception as error:
            _LOGGER.warning("Skipping build backend entry point %r: %s", name, error)
            continue
        seen.add(name)
        loaded.append((name, backend))
    return tuple(loaded)


def iter_entry_point_backends() -> tuple[BuildBackend, ...]:
    """Return out-of-tree backends sorted by entry-point name."""

    return tuple(backend for _name, backend in _entry_point_backends())


def known_backend_ids() -> tuple[str, ...]:
    """Return every visible backend id in resolution order."""

    ids = list(_REGISTERED)
    for spec in _BUILTIN_SPECS:
        if spec.backend_id not in ids:
            ids.append(spec.backend_id)
    for name, backend in _entry_point_backends():
        for candidate in (name, backend.id):
            if candidate not in ids:
                ids.append(candidate)
    return tuple(ids)


def get_backend(backend_id: str) -> BuildBackend:
    """Return the backend registered under *backend_id*.

    Resolution order is: programmatic registration, built-in adapter, then an
    entry point whose name or backend id matches.
    """

    normalized = backend_id.strip()
    if not normalized:
        raise UnknownBuildBackendError(backend_id, known_backend_ids=known_backend_ids())

    registered = _REGISTERED.get(normalized)
    if registered is not None:
        return registered

    for spec in _BUILTIN_SPECS:
        if spec.backend_id == normalized:
            return _load_spec(spec)

    for name, backend in _entry_point_backends():
        if normalized in (name, backend.id):
            return backend

    raise UnknownBuildBackendError(normalized, known_backend_ids=known_backend_ids())


def _concrete_choice(value: str | None) -> str | None:
    """Return *value* as a backend id unless it is blank or ``auto``."""

    if value is None:
        return None
    normalized = value.strip()
    if not normalized or normalized.lower() == AUTO_BACKEND_ID:
        return None
    return normalized


def _environment_choice(environ: Mapping[str, str] | None = None) -> str | None:
    """Return the concrete backend id from ``MICRO_OTTER_BUILD_BACKEND``, if any."""

    source = os.environ if environ is None else environ
    return _concrete_choice(source.get(BUILD_BACKEND_ENV_VAR))


def _is_selectable(backend: BuildBackend, target: str) -> bool:
    """Return True when *backend* is available and can build *target*."""

    try:
        supported = _normalize_targets(backend.supported_targets())
        if target not in supported:
            return False
        return backend.status().available
    except Exception as error:
        _LOGGER.warning("Build backend %r reported an unusable status: %s", backend.id, error)
        return False


def _require_available(backend: BuildBackend) -> None:
    """Raise when a hard-selected backend reports that it cannot run."""

    try:
        status = backend.status()
    except Exception as error:
        raise BuildBackendUnavailableError(
            backend.id, detail=str(error) or type(error).__name__
        ) from error
    if not status.available:
        raise BuildBackendUnavailableError(backend.id, detail=status.detail)


def _require_supported(backend: BuildBackend, target: str) -> None:
    """Raise when a hard-selected backend cannot build *target*."""

    supported = _normalize_targets(backend.supported_targets())
    if target not in supported:
        raise UnsupportedBuildTargetError(backend.id, target, supported_targets=supported)


def _candidate_backends() -> tuple[BuildBackend, ...]:
    """Return backends in ``auto`` order: built-ins, registrations, entry points."""

    ordered_ids: list[str] = [spec.backend_id for spec in _BUILTIN_SPECS]
    ordered_ids.extend(backend_id for backend_id in _REGISTERED if backend_id not in ordered_ids)
    for name, _backend in _entry_point_backends():
        if name not in ordered_ids:
            ordered_ids.append(name)

    candidates: list[BuildBackend] = []
    for backend_id in ordered_ids:
        try:
            candidates.append(get_backend(backend_id))
        except UnknownBuildBackendError:
            # An adapter that disappeared between discovery and resolution is
            # simply not a candidate any more.
            continue
        except Exception as error:
            _LOGGER.warning("Skipping build backend %r: %s", backend_id, error)
            continue
    return tuple(candidates)


def _select_auto(target: str) -> BuildBackend:
    """Return the first candidate in ``auto`` order that can build *target*."""

    considered: list[str] = []
    for backend in _candidate_backends():
        if backend.id in considered:
            continue
        considered.append(backend.id)
        if _is_selectable(backend, target):
            return backend
    raise NoAvailableBuildBackendError(target, considered_backend_ids=considered)


def select_backend(
    *,
    target: str,
    requested: str | None = None,
    board_default: str | None = None,
    environ: Mapping[str, str] | None = None,
) -> BuildBackend:
    """Return the build backend that should serve *target*.

    Precedence is: explicit ``requested`` id (CLI/API), a concrete
    ``MICRO_OTTER_BUILD_BACKEND`` value, the board-catalog ``board_default``,
    then ``auto``. The first two are hard choices and raise structured errors;
    the board default is a soft preference that falls through to ``auto``.
    """

    normalized_target = normalize_target(target)
    if not normalized_target:
        raise ValueError("target must not be empty")

    hard_choice = _concrete_choice(requested) or _environment_choice(environ)
    if hard_choice is not None:
        backend = get_backend(hard_choice)
        _require_available(backend)
        _require_supported(backend, normalized_target)
        return backend

    preference = _concrete_choice(board_default)
    if preference is not None:
        try:
            backend = get_backend(preference)
        except UnknownBuildBackendError as error:
            _LOGGER.warning("Ignoring board default build backend: %s", error)
        else:
            if _is_selectable(backend, normalized_target):
                return backend
            _LOGGER.info(
                "Board default build backend %r cannot build %r; falling back to auto",
                backend.id,
                normalized_target,
            )

    return _select_auto(normalized_target)


def select_backend_for_board(
    board_spec: BoardSpec,
    *,
    target: str | None = None,
    requested: str | None = None,
    environ: Mapping[str, str] | None = None,
) -> BuildBackend:
    """Return the build backend for *board_spec* without re-deriving precedence.

    The catalog's ``build_backend`` becomes the soft ``board_default``, so an
    explicit request or a concrete ``MICRO_OTTER_BUILD_BACKEND`` value still wins
    and an unavailable catalog default falls through to ``auto``. ``target``
    defaults to the board's chip, which is the normalized compile target id.
    """

    return select_backend(
        target=target or board_spec.chip,
        requested=requested,
        board_default=board_spec.build_backend,
        environ=environ,
    )

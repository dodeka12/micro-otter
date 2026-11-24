# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
"""Capability payload behind ``GET /api/server-capabilities``.

The payload is the single answer a headless client reads before it offers a
firmware action: which features exist, which build and flash backends are
installed, and whether a released firmware index is configured. It is derived on
every request from backend ``status()`` snapshots (documented as device-free) and
the resolved :class:`~micro_otter.config.Config`, so an edited
``micro-otter.toml`` takes effect without a restart.

Two invariants hold here:

- Nothing in this module builds, flashes, opens a serial port, or mutates state.
- ``features`` only gates *firmware* jobs. It never gates collection deploys or
  node-package source uploads, which the web app decides independently (see
  ``docs/dev/deployment/deployment-system-architecture.md``).
"""

from __future__ import annotations

import functools
import importlib.util
import json
import logging
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from micro_otter import __version__
from micro_otter.config import Config

from .addon_store import installed_addons
from .firmware_compile.backends import (
    BackendStatus,
    BuildBackend,
    get_backend,
    iter_entry_point_backends,
    known_backend_ids,
)
from .firmware_compile.flash import (
    FlashBackend,
    get_flash_backend,
    iter_entry_point_flash_backends,
    known_flash_backend_ids,
)
from .host_policy import is_loopback_host

SERVER_TYPE = "micro-otter"
"""Value of the ``serverType`` key; identifies a Micro-Otter server to a client."""

FeatureId = Literal[
    "firmware-compile",
    "firmware-deploy",
    "local-package-scan",
    "serial-bridge",
    "node-package-addons",
    "local-file-access",
]

FEATURE_FIRMWARE_COMPILE: FeatureId = "firmware-compile"
FEATURE_FIRMWARE_DEPLOY: FeatureId = "firmware-deploy"
FEATURE_LOCAL_PACKAGE_SCAN: FeatureId = "local-package-scan"
FEATURE_SERIAL_BRIDGE: FeatureId = "serial-bridge"
FEATURE_NODE_PACKAGE_ADDONS: FeatureId = "node-package-addons"
FEATURE_LOCAL_FILE_ACCESS: FeatureId = "local-file-access"

FIRMWARE_SOURCES: tuple[str, ...] = ("local",)
"""Image sources this iteration can offer; release sources arrive with M8."""

RELEASE_INDEX_URL = ""
"""Placeholder until a released-firmware index exists (M8)."""

CAPABILITY_KEYS: tuple[str, ...] = (
    "serverType",
    "version",
    "features",
    "buildBackends",
    "flashBackends",
    "firmwareSources",
    "releaseIndexUrl",
    "webappBuildServedVersion",
    "webappBuildSourceVersion",
)
"""Exactly the keys :func:`build_server_capabilities` returns.

There is deliberately no ``schemaVersion``: clients must ignore unknown keys so a
later iteration can add one without breaking an installed client.
"""

_PACKAGE_DIR = Path(__file__).resolve().parent.parent
"""The ``micro_otter`` package directory; two levels up is the repo root."""


def resolve_static_root(package_dir: Path, *, repo_root: Path | None = None) -> Path:
    """Resolve the directory the local server serves the web app from.

    A production build wins over the TypeScript source tree. Candidates are tried
    in order: ``<repo_root>/_dist/webapp`` (``npm run build`` in a source
    checkout), ``<package_dir>/dist/webapp`` (a bundle shipped next to an
    installed package), and finally ``<package_dir>/nodes`` (the source tree,
    which only works behind Vite). Called at import time here and in
    :mod:`micro_otter.tools.serial_bridge`, so both servers share one web root.

    Args:
        package_dir: The ``micro_otter`` package directory (parent of ``tools``).
        repo_root: Repository root; defaults to ``package_dir.parent.parent``.

    Returns:
        The first candidate that contains an ``index.html``, else the source tree.
    """

    root = repo_root if repo_root is not None else package_dir.parent.parent
    for candidate in (root / "_dist" / "webapp", package_dir / "dist" / "webapp"):
        if (candidate / "index.html").is_file():
            return candidate
    return package_dir / "nodes"


def _read_version_json(path: Path) -> str | None:
    """Return the ``version`` field of the JSON file at *path*, or ``None``.

    A missing, unreadable or malformed file is a content problem, not a crash: the stale-build check
    treats it as "unknown" and stays silent rather than accusing a build it cannot identify.

    Args:
        path: Version file to read.

    Returns:
        The trimmed version string, or ``None`` when no usable value is present.
    """

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 - an unreadable version is a content problem, not a crash
        return None
    version = payload.get("version") if isinstance(payload, dict) else None
    if isinstance(version, str) and version.strip():
        return version.strip()
    return None


def detect_stale_static_root(static_root: Path, package_version: str) -> tuple[str, str] | None:
    """Detect a ``_dist/webapp`` build stamped by a version other than the running package.

    :func:`resolve_static_root` deliberately prefers a production build over the source tree, so a
    forgotten ``npm run build`` silently serves an old bundle — node-package manifests in
    ``_dist/webapp/device/node_pkgs`` keep their old versions and the app then reports "firmware
    current" against stale package metadata.

    The comparison target is the installed package version, not the source tree: the bundle's
    ``html/version.json`` and the package both come from a Python build now, so two numbers that
    disagree mean the served bundle was built from a different checkout or release.

    Args:
        static_root: Directory the server serves the web app from.
        package_version: Version of the running ``micro_otter`` package
            (``micro_otter.__version__``).

    Returns:
        ``(served_version, package_version)`` when *static_root* is a ``_dist/webapp`` build whose
        stamped version differs from the running package, otherwise ``None``.
    """

    if static_root.name != "webapp" or static_root.parent.name != "_dist":
        return None
    served_version = _read_version_json(static_root / "html" / "version.json")
    if served_version is None or served_version == package_version:
        return None
    return served_version, package_version


_STATIC_ROOT = resolve_static_root(_PACKAGE_DIR)

_LOGGER = logging.getLogger(__name__)

_STALE_STATIC_ROOT = detect_stale_static_root(_STATIC_ROOT, __version__)
"""``(served, package)`` when the served build belongs to another package version, else ``None``."""

if _STALE_STATIC_ROOT is not None:
    _LOGGER.warning(
        "Serving a stale web-app build from %s (version %s) while the package reports %s; "
        "run `npm run build` to refresh it.",
        _STATIC_ROOT,
        _STALE_STATIC_ROOT[0],
        _STALE_STATIC_ROOT[1],
    )

__all__ = [
    "CAPABILITY_KEYS",
    "FEATURE_FIRMWARE_COMPILE",
    "FEATURE_FIRMWARE_DEPLOY",
    "FEATURE_LOCAL_PACKAGE_SCAN",
    "FEATURE_NODE_PACKAGE_ADDONS",
    "FEATURE_SERIAL_BRIDGE",
    "FIRMWARE_SOURCES",
    "RELEASE_INDEX_URL",
    "SERVER_TYPE",
    "BackendDescriptor",
    "build_backend_descriptor",
    "build_server_capabilities",
    "detect_stale_static_root",
    "read_app_version",
    "resolve_static_root",
]


@dataclass(frozen=True)
class BackendDescriptor:
    """Availability snapshot of one build or flash backend in the payload.

    ``available=False`` always carries a human ``reason`` so a client can show
    why a button is disabled. ``targets`` lists the compile targets (build
    backends) or supported chips (flash backends) and stays empty when the
    backend is unavailable, because probing a missing toolchain costs time and
    tells the client nothing it can act on.
    """

    id: str
    available: bool
    version: str | None
    reason: str | None
    targets: tuple[str, ...]

    def to_payload(self) -> dict[str, object]:
        """Return this descriptor as the JSON-serialisable contract shape."""

        return {
            "id": self.id,
            "available": self.available,
            "version": self.version,
            "reason": self.reason,
            "targets": list(self.targets),
        }


def _descriptor_reason(status: BackendStatus) -> str | None:
    """Return the human reason for *status*, preferring ``detail``.

    ``detail`` is free-form adapter prose; ``missing_requirements`` is the
    structured list, so it is the fallback for adapters that only fill that in.
    """

    detail = (status.detail or "").strip()
    if detail:
        return detail
    if status.missing_requirements:
        return ", ".join(status.missing_requirements)
    return None


def _is_flash_backend(backend: BuildBackend | FlashBackend) -> bool:
    """Return whether *backend* is a flash backend.

    Both protocols are structural, so the expensive-ish flash-only hook decides:
    a build backend exposes ``supported_targets`` and a flash backend exposes
    ``supported_chips``.
    """

    return hasattr(backend, "supported_chips") and not hasattr(backend, "supported_targets")


def build_backend_descriptor(backend: BuildBackend | FlashBackend) -> BackendDescriptor:
    """Return the payload descriptor for *backend*.

    ``status()`` is read exactly once; the target/chip probe only runs when the
    backend reported itself available, so an uninstalled toolchain is never
    probed beyond what the adapter's own ``status()`` did.
    """

    status = backend.status()
    targets: tuple[str, ...] = ()
    if status.available:
        try:
            if _is_flash_backend(backend):
                targets = tuple(backend.supported_chips())
            else:
                targets = tuple(backend.supported_targets())
        except Exception as error:  # noqa: BLE001 - discovery must not fail the endpoint
            _LOGGER.warning("Backend %r could not list targets: %s", status.backend_id, error)
            targets = ()
    return BackendDescriptor(
        id=status.backend_id or backend.id,
        available=status.available,
        version=status.version,
        reason=_descriptor_reason(status),
        targets=targets,
    )


def read_app_version() -> str:
    """Return the version of the running ``micro_otter`` package.

    This is the single implementation of the version read; ``serial_bridge``
    delegates here so ``GET /api/version`` and the capability payload can never
    disagree. The value is ``micro_otter.__version__`` — the installed
    distribution's version — and not the served bundle's stamp: a bundle built
    from another checkout is exactly what :func:`detect_stale_static_root`
    reports, and the endpoint that clients probe must describe the code they are
    talking to.
    """

    return __version__


def _iter_backends(kind: Literal["build", "flash"]) -> Iterator[BuildBackend | FlashBackend]:
    """Yield every visible backend of *kind*, entry-point backends first.

    Entry-point backends come first so a third party can shadow a built-in id,
    matching ``registry.known_backend_ids`` ordering. Resolution failures are
    logged and skipped, mirroring ``registry._entry_point_backends``: one broken
    adapter must not break the endpoint.
    """

    if kind == "build":
        entry_points: tuple[BuildBackend | FlashBackend, ...] = tuple(iter_entry_point_backends())
        known_ids = known_backend_ids()
        resolve: Callable[[str], BuildBackend | FlashBackend] = get_backend
    else:
        entry_points = tuple(iter_entry_point_flash_backends())
        known_ids = known_flash_backend_ids()
        resolve = get_flash_backend

    seen = {backend.id for backend in entry_points}
    yield from entry_points
    for backend_id in known_ids:
        if backend_id in seen:
            continue
        try:
            backend = resolve(backend_id)
        except Exception as error:  # noqa: BLE001 - availability probing must not raise
            _LOGGER.warning(
                "Skipping %s backend %r in capability payload: %s", kind, backend_id, error
            )
            continue
        if backend.id in seen:
            continue
        seen.add(backend.id)
        yield backend


def _descriptors(kind: Literal["build", "flash"]) -> list[BackendDescriptor]:
    """Return one descriptor per visible backend of *kind*."""

    descriptors: list[BackendDescriptor] = []
    for backend in _iter_backends(kind):
        try:
            descriptors.append(build_backend_descriptor(backend))
        except Exception as error:  # noqa: BLE001 - one probe must not break discovery
            _LOGGER.warning("Skipping %s backend %r: %s", kind, backend.id, error)
    return descriptors


@functools.lru_cache(maxsize=1)
def _serial_support_available() -> bool:
    """Return whether the ``pyserial-asyncio`` transport is importable.

    ``firmware-deploy`` needs it because the flash flow keeps a monitor on the
    board over the same transport as ``WS /serial``. The answer is cached per
    process: installed distributions do not change while the server runs.
    """

    return importlib.util.find_spec("serial_asyncio") is not None


def _addons_installed(config: Config) -> bool:
    """Return whether the add-ons folder holds at least one installed package.

    Discovery is not a firmware job, so this answer is independent of
    ``enable_compile`` / ``enable_deploy``; it only says whether the palette can offer
    add-on packages.
    """

    return bool(installed_addons(config.addons_dir))


def _feature_ids(
    build_descriptors: list[BackendDescriptor],
    flash_descriptors: list[BackendDescriptor],
    *,
    config: Config,
) -> list[FeatureId]:
    """Derive the advertised features in the documented order.

    ``firmware-compile`` needs ``enable_compile`` plus an available build backend
    that advertises at least one target. ``firmware-deploy`` needs
    ``enable_deploy`` plus an available flash backend with at least one chip and
    importable serial support. ``serial-bridge`` and ``local-package-scan`` are
    always advertised: both work without any toolchain. ``node-package-addons`` is
    advertised only while an add-on is installed, and is additive for clients that
    ignore unknown feature ids. ``local-file-access`` is advertised last and only
    while the server is bound to a loopback host, because it lets a browser
    enumerate this machine's filesystem.
    """

    features: list[FeatureId] = [FEATURE_SERIAL_BRIDGE, FEATURE_LOCAL_PACKAGE_SCAN]
    if config.enable_compile and any(
        descriptor.available and descriptor.targets for descriptor in build_descriptors
    ):
        features.append(FEATURE_FIRMWARE_COMPILE)
    if (
        config.enable_deploy
        and any(descriptor.available and descriptor.targets for descriptor in flash_descriptors)
        and _serial_support_available()
    ):
        features.append(FEATURE_FIRMWARE_DEPLOY)
    if _addons_installed(config):
        features.append(FEATURE_NODE_PACKAGE_ADDONS)
    if is_loopback_host(config.host):
        features.append(FEATURE_LOCAL_FILE_ACCESS)
    return features


def build_server_capabilities(*, config: Config, version: str | None = None) -> dict[str, object]:
    """Return the capability payload for *config*.

    The result has exactly :data:`CAPABILITY_KEYS`. Backend probes are cheap by
    contract, so the payload is built per request rather than cached; that keeps
    the advertisement honest after an adapter is installed or a flag flipped.
    Pass *version* to override the reported app version, for tests.

    ``webappBuildServedVersion`` / ``webappBuildSourceVersion`` carry the
    :func:`detect_stale_static_root` pair — the served bundle's stamp and the
    running package version — and stay ``None`` while those agree, so a client can
    surface "run ``npm run build``". The ``SourceVersion`` name predates the move
    to a single version source; the key stays for payload compatibility.
    """

    build_descriptors = _descriptors("build")
    flash_descriptors = _descriptors("flash")
    stale_build = detect_stale_static_root(_STATIC_ROOT, __version__)
    return {
        "serverType": SERVER_TYPE,
        "version": read_app_version() if version is None else version,
        "features": _feature_ids(build_descriptors, flash_descriptors, config=config),
        "buildBackends": [descriptor.to_payload() for descriptor in build_descriptors],
        "flashBackends": [descriptor.to_payload() for descriptor in flash_descriptors],
        "firmwareSources": list(FIRMWARE_SOURCES),
        "releaseIndexUrl": RELEASE_INDEX_URL,
        "webappBuildServedVersion": stale_build[0] if stale_build else None,
        "webappBuildSourceVersion": stale_build[1] if stale_build else None,
    }

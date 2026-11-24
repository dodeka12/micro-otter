"""Single lookup point for the toolchain assets shipped under ``deploy/toolchain``.

Nothing else in the package may build a path into the toolchain assets: the launcher, the
bootstrap/doctor scripts, and the shared version pins are all resolved here so a later milestone can
swap the checkout copy for a packaged copy (``importlib.resources``) without touching call sites.
"""

from __future__ import annotations

import functools
import importlib.resources
import os
from pathlib import Path

ASSETS_ENV_VAR = "MICRO_OTTER_TOOLCHAIN_ASSETS"
"""Environment variable naming an explicit toolchain asset root."""

PACKAGE_NAME = "micro_otter.toolchain"
"""Package that would carry a packaged copy of the assets under ``assets/``."""

_VERSION_MARKER = Path("deploy") / "toolchain" / "versions.env"
"""Repository-relative marker proving a directory is the checkout asset root."""

_ENV_HINT = "set MICRO_OTTER_TOOLCHAIN_ASSETS to the deploy/toolchain directory"
"""Remedy quoted in :class:`ToolchainAssetsNotFound` raised for a bad override."""


class ToolchainAssetsNotFound(RuntimeError):
    """Raised when no toolchain asset root, or no asset below it, can be found.

    ``hint`` carries the actionable remedy so the CLI can print it without
    re-deriving the message.
    """

    def __init__(self, message: str, *, hint: str = _ENV_HINT) -> None:
        super().__init__(message)
        self.hint = hint


def _env_override_assets_dir() -> Path | None:
    """Return the directory named by :data:`ASSETS_ENV_VAR`, or ``None`` when unset.

    An override that does not name an existing directory is an error rather
    than a fall-through, so a typo never silently resolves to a different
    toolchain.
    """

    raw = os.environ.get(ASSETS_ENV_VAR, "").strip()
    if not raw:
        return None

    candidate = Path(raw).expanduser()
    if not candidate.is_dir():
        raise ToolchainAssetsNotFound(
            f"{ASSETS_ENV_VAR} points at {candidate}, which is not a directory",
            hint=f"point {ASSETS_ENV_VAR} at the deploy/toolchain directory",
        )
    return candidate.resolve()


def _checkout_assets_dir() -> Path | None:
    """Return the ``deploy/toolchain`` directory of the running checkout, if any."""

    for parent in Path(__file__).resolve().parents:
        marker = parent / _VERSION_MARKER
        if marker.is_file():
            return marker.parent.resolve()
    return None


def _packaged_assets_dir() -> Path | None:
    """Return the packaged ``assets`` directory when one ships inside the wheel."""

    try:
        candidate = Path(str(importlib.resources.files(PACKAGE_NAME).joinpath("assets")))
    except (ModuleNotFoundError, TypeError):  # pragma: no cover - defensive
        return None
    return candidate.resolve() if candidate.is_dir() else None


@functools.lru_cache(maxsize=1)
def assets_dir() -> Path:
    """Return the directory holding the toolchain assets.

    Resolution order: :data:`ASSETS_ENV_VAR`, the checkout copy found by walking
    up from this module, then the packaged copy. Call :func:`clear_assets_cache`
    after changing the environment in tests.
    """

    override = _env_override_assets_dir()
    if override is not None:
        return override

    checkout = _checkout_assets_dir()
    if checkout is not None:
        return checkout

    packaged = _packaged_assets_dir()
    if packaged is not None:
        return packaged

    raise ToolchainAssetsNotFound(
        "toolchain assets not found; tried "
        f"{ASSETS_ENV_VAR}, a checkout copy containing {_VERSION_MARKER.as_posix()}, "
        f"and a packaged copy under {PACKAGE_NAME}/assets"
    )


def clear_assets_cache() -> None:
    """Drop the memoized asset root so tests can change the environment safely."""

    assets_dir.cache_clear()


def script_path(*parts: str) -> Path:
    """Return ``assets_dir()/parts`` and fail loudly when the asset is missing."""

    root = assets_dir()
    candidate = root.joinpath(*parts)
    if not candidate.exists():
        raise ToolchainAssetsNotFound(
            f"toolchain asset missing: {candidate} (asset root: {root})",
            hint=f"restore {candidate.relative_to(root).as_posix()} in the toolchain assets",
        )
    return candidate


def launcher_path() -> Path:
    """Return the repository-owned ``idf.py`` launcher."""

    return script_path("esp-idf", "idf.py")


def bootstrap_script_path(backend: str = "esp-idf") -> Path:
    """Return the bootstrap script for *backend*."""

    return script_path(backend, "bootstrap.sh")


def doctor_script_path(backend: str = "esp-idf") -> Path:
    """Return the doctor script for *backend*."""

    return script_path(backend, "doctor.sh")


def versions_env_path(backend: str | None = None) -> Path:
    """Return the shared pin file, or the optional backend-specific one.

    Only the shared file is guaranteed to exist; a backend-specific file is
    optional, so its path is returned without an existence check.
    """

    if backend is None:
        return script_path("versions.env")
    return assets_dir() / backend / "versions.env"

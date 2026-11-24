# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
"""Package identity: the installed version of ``micro-otter``.

``__version__`` has three producers, in priority order:

1. ``_version.py`` — written by hatch-vcs at install/build time from the git tag, and an ignored
   build output, never tracked.
2. ``importlib.metadata`` — the installed distribution's metadata, which covers a wheel whose
   ``_version.py`` was not generated (a bare source checkout after ``pip install .``).
3. ``"0.0.0+unknown"`` — nothing resolved the version; callers must not crash on it.

A future reader who re-adds a tracked ``_version.py`` or a hand-written version string breaks the
first producer, so keep this chain the only source of truth.
"""

from __future__ import annotations

try:  # written by hatch-vcs at install/build time
    from ._version import __version__
except ImportError:  # bare source checkout
    try:
        from importlib.metadata import version as _package_version

        __version__ = _package_version("micro-otter")
    except Exception:  # no metadata either
        __version__ = "0.0.0+unknown"

__all__ = ["__version__"]

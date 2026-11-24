"""Tests for the three producers behind ``micro_otter.__version__``.

The chain in ``micro_otter/__init__.py`` is the only place the installed version is resolved, so a
regression there silently mislabels every artifact. Each test reloads the package with exactly one
producer available instead of trusting whatever the developer's environment happens to provide.
"""

from __future__ import annotations

import importlib
import importlib.metadata
import sys
from types import ModuleType

import pytest

import micro_otter


@pytest.fixture(autouse=True)
def _restore_package_version() -> None:
    """Reload ``micro_otter`` after each test so a blocked import cannot leak."""

    yield
    importlib.reload(micro_otter)


def _reload_without_version_module(monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    """Reload ``micro_otter`` with ``._version`` unimportable, as in a bare checkout.

    A ``None`` entry in ``sys.modules`` makes the following import raise ``ImportError``; that is
    the documented way to simulate a missing generated module without deleting the file.
    """

    monkeypatch.setitem(sys.modules, "micro_otter._version", None)
    return importlib.reload(micro_otter)


def test_version_resolves_to_unknown_without_any_producer(monkeypatch: pytest.MonkeyPatch) -> None:
    """No generated file and no installed metadata yields the explicit sentinel, not an error."""

    def _missing(name: str) -> str:
        raise importlib.metadata.PackageNotFoundError(name)

    monkeypatch.setattr(importlib.metadata, "version", _missing)
    module = _reload_without_version_module(monkeypatch)

    assert module.__version__ == "0.0.0+unknown"


def test_version_resolves_to_installed_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    """A wheel whose ``_version.py`` is missing still reports its distribution metadata."""

    monkeypatch.setattr(importlib.metadata, "version", lambda name: "1.43.0")
    module = _reload_without_version_module(monkeypatch)

    assert module.__version__ == "1.43.0"


def test_generated_version_file_outranks_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    """hatch-vcs' ``_version.py`` wins over the installed metadata when both are present."""

    generated = pytest.importorskip("micro_otter._version")
    monkeypatch.setattr(importlib.metadata, "version", lambda name: "9.9.9")

    module = importlib.reload(micro_otter)

    assert module.__version__ == generated.__version__

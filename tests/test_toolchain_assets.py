"""Tests for the single toolchain asset lookup point.

``micro_otter.toolchain.assets`` is the only module that knows where the
``deploy/toolchain`` assets live, so these tests pin the resolution order
(environment override, checkout copy, packaged copy) and the failure hints that
the CLI surfaces to users.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest

from micro_otter import toolchain as toolchain_package
from micro_otter.toolchain import (
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

REPO_ROOT = Path(__file__).resolve().parents[1]
CHECKOUT_ASSETS = REPO_ROOT / "deploy" / "toolchain"


@pytest.fixture(autouse=True)
def _clear_assets(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Drop the memoized asset root and any override around each test."""

    monkeypatch.delenv(ASSETS_ENV_VAR, raising=False)
    clear_assets_cache()
    yield
    clear_assets_cache()


def _fake_asset_root(tmp_path: Path, *, launcher: bool = True) -> Path:
    """Return a throwaway asset root, optionally carrying a launcher."""

    root = tmp_path / "assets"
    (root / "esp-idf").mkdir(parents=True)
    if launcher:
        (root / "esp-idf" / "idf.py").write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    return root


def test_assets_dir_finds_checkout_copy() -> None:
    """Without an override the repository checkout supplies the assets."""

    assert assets_dir() == CHECKOUT_ASSETS.resolve()


def test_assets_dir_prefers_env_override(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """An explicit ``MICRO_OTTER_TOOLCHAIN_ASSETS`` wins over the checkout copy."""

    root = _fake_asset_root(tmp_path)
    monkeypatch.setenv(ASSETS_ENV_VAR, str(root))
    clear_assets_cache()

    assert assets_dir() == root.resolve()


def test_assets_dir_rejects_env_override_that_is_not_a_directory(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """A typo in the override fails loudly instead of resolving elsewhere."""

    monkeypatch.setenv(ASSETS_ENV_VAR, str(tmp_path / "missing"))
    clear_assets_cache()

    with pytest.raises(ToolchainAssetsNotFound) as excinfo:
        assets_dir()

    assert ASSETS_ENV_VAR in str(excinfo.value)
    assert ASSETS_ENV_VAR in excinfo.value.hint


def test_assets_dir_reports_all_locations_when_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The error names every location that was tried."""

    monkeypatch.setattr(toolchain_package.assets, "_checkout_assets_dir", lambda: None)
    monkeypatch.setattr(toolchain_package.assets, "_packaged_assets_dir", lambda: None)
    clear_assets_cache()

    with pytest.raises(ToolchainAssetsNotFound) as excinfo:
        assets_dir()

    message = str(excinfo.value)
    assert ASSETS_ENV_VAR in message
    assert "deploy/toolchain/versions.env" in message
    assert "micro_otter.toolchain/assets" in message


def test_assets_dir_falls_back_to_packaged_copy(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """A wheel without the checkout still resolves assets from the package."""

    packaged = _fake_asset_root(tmp_path)
    monkeypatch.setattr(toolchain_package.assets, "_checkout_assets_dir", lambda: None)
    monkeypatch.setattr(toolchain_package.assets, "_packaged_assets_dir", lambda: packaged)
    clear_assets_cache()

    assert launcher_path() == packaged / "esp-idf" / "idf.py"


def test_assets_dir_is_memoized_until_cleared(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """The cache keeps repeated lookups cheap and only a reset re-reads the env."""

    first = assets_dir()
    alternative = _fake_asset_root(tmp_path)
    monkeypatch.setenv(ASSETS_ENV_VAR, str(alternative))

    assert assets_dir() == first

    clear_assets_cache()

    assert assets_dir() == alternative.resolve()


def test_launcher_and_script_paths_resolve_under_assets_dir(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Every public helper returns ``assets_dir()`` joined with its asset path."""

    root = _fake_asset_root(tmp_path)
    (root / "bootstrap.sh").write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    (root / "esp-idf" / "bootstrap.sh").write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    (root / "esp-idf" / "doctor.sh").write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    (root / "versions.env").write_text("ESP_IDF_VERSION=v5.4.1\n", encoding="utf-8")
    monkeypatch.setenv(ASSETS_ENV_VAR, str(root))
    clear_assets_cache()

    assert launcher_path() == root.resolve() / "esp-idf" / "idf.py"
    assert script_path("bootstrap.sh") == root.resolve() / "bootstrap.sh"
    assert bootstrap_script_path() == root.resolve() / "esp-idf" / "bootstrap.sh"
    assert bootstrap_script_path("esp-idf") == root.resolve() / "esp-idf" / "bootstrap.sh"
    assert doctor_script_path() == root.resolve() / "esp-idf" / "doctor.sh"


def test_script_path_reports_missing_asset_with_restore_hint(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """A missing asset names the file and the asset root, and says how to restore it."""

    root = _fake_asset_root(tmp_path, launcher=False)
    monkeypatch.setenv(ASSETS_ENV_VAR, str(root))
    clear_assets_cache()

    with pytest.raises(ToolchainAssetsNotFound) as excinfo:
        launcher_path()

    message = str(excinfo.value)
    assert "esp-idf/idf.py" in message
    assert str(root.resolve()) in message
    assert "restore esp-idf/idf.py" in excinfo.value.hint


def test_versions_env_path_selects_backend_file(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """The shared pin file is checked; a backend-specific one is returned unchecked."""

    root = _fake_asset_root(tmp_path)
    (root / "versions.env").write_text("ESP_IDF_VERSION=v5.4.1\n", encoding="utf-8")
    monkeypatch.setenv(ASSETS_ENV_VAR, str(root))
    clear_assets_cache()

    assert versions_env_path() == root.resolve() / "versions.env"
    assert versions_env_path().is_file()
    assert versions_env_path("esp-idf") == root.resolve() / "esp-idf" / "versions.env"


def test_checkout_assets_directory_carries_the_launcher_and_pins() -> None:
    """The real checkout ships the launcher, the dispatchers, and the pin source."""

    assert launcher_path().is_file()
    assert script_path("bootstrap.sh").is_file()
    assert script_path("doctor.sh").is_file()
    assert versions_env_path().is_file()

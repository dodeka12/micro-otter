"""Tests for the installed-wheel smoke checks ``tools/wheel_smoke.py``."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from tools.wheel_smoke import (
    TITLE_MARKER,
    check_capabilities,
    check_index_html,
    check_installed_layout,
    main,
)

from micro_otter import __version__ as installed_version
from micro_otter.toolchain import ASSETS_ENV_VAR
from micro_otter.tools.server_capabilities import CAPABILITY_KEYS, SERVER_TYPE

VERSION = "1.43.0"


def _make_layout(
    tmp_path: Path,
    *,
    version: str = VERSION,
    stamp: str | None = None,
    webapp: bool = True,
    assets: bool = True,
    launcher: bool = True,
) -> Path:
    """Create a temp package tree mimicking the installed wheel and return its dir.

    Args:
        tmp_path: Pytest temporary directory.
        version: Package version the layout reports.
        stamp: Bundle ``version.json`` stamp; defaults to *version*.
        webapp: Whether to create the ``dist/webapp`` bundle.
        assets: Whether to create the toolchain asset files.
        launcher: Whether to create ``esp-idf/idf.py`` (requires *assets*).

    Returns:
        The fake ``micro_otter`` package directory.
    """

    package_dir = tmp_path / "micro_otter"
    if webapp:
        webapp_dir = package_dir / "dist" / "webapp"
        (webapp_dir / "html").mkdir(parents=True)
        (webapp_dir / "index.html").write_text(TITLE_MARKER, encoding="utf-8")
        (webapp_dir / "html" / "version.json").write_text(
            json.dumps({"version": stamp if stamp is not None else version}), encoding="utf-8"
        )
    if assets:
        assets_dir = package_dir / "toolchain" / "assets"
        (assets_dir / "esp-idf").mkdir(parents=True)
        (assets_dir / "versions.env").write_text("ESP_IDF_VERSION=v5.5.2\n", encoding="utf-8")
        (assets_dir / "esp-idf" / "bootstrap.sh").write_text(
            "#!/usr/bin/env bash\n", encoding="utf-8"
        )
        if launcher:
            (assets_dir / "esp-idf" / "idf.py").write_text(
                "#!/usr/bin/env bash\n", encoding="utf-8"
            )
    return package_dir


def _point_assets(monkeypatch: pytest.MonkeyPatch, package_dir: Path) -> None:
    """Point ``assets_dir()`` at the fake layout's toolchain assets."""

    monkeypatch.setenv(ASSETS_ENV_VAR, str(package_dir / "toolchain" / "assets"))


def test_check_installed_layout_passes(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """A faithful wheel layout with the asset root inside the package is healthy."""

    package_dir = _make_layout(tmp_path)
    _point_assets(monkeypatch, package_dir)
    assert check_installed_layout(package_dir, VERSION) == []


def test_check_installed_layout_fails_without_webapp(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """A package without ``dist/webapp`` is reported."""

    package_dir = _make_layout(tmp_path, webapp=False)
    _point_assets(monkeypatch, package_dir)
    failures = check_installed_layout(package_dir, VERSION)
    assert any("web app does not resolve" in failure for failure in failures)


def test_check_installed_layout_fails_when_stamp_differs(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """A bundle stamped with another version is reported."""

    package_dir = _make_layout(tmp_path, stamp="1.42.0")
    _point_assets(monkeypatch, package_dir)
    failures = check_installed_layout(package_dir, VERSION)
    assert any("bundle version stamp" in failure for failure in failures)


def test_check_installed_layout_fails_when_asset_root_empty(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """An empty asset root is reported via the missing ESP-IDF bootstrap."""

    package_dir = _make_layout(tmp_path, assets=False)
    (package_dir / "toolchain" / "assets").mkdir(parents=True)
    _point_assets(monkeypatch, package_dir)
    failures = check_installed_layout(package_dir, VERSION)
    assert any("toolchain asset missing: esp-idf bootstrap" in failure for failure in failures)


def test_check_installed_layout_fails_when_launcher_missing(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """A missing ``idf.py`` launcher is reported."""

    package_dir = _make_layout(tmp_path, launcher=False)
    _point_assets(monkeypatch, package_dir)
    failures = check_installed_layout(package_dir, VERSION)
    assert any("toolchain asset missing: idf.py launcher" in failure for failure in failures)


def test_check_index_html_accepts_the_built_bundle() -> None:
    """A document with the title marker and a non-empty stamp is healthy."""

    text = f"<html><head>{TITLE_MARKER}</head><body/></html>"
    assert check_index_html(text, VERSION) == []


def test_check_index_html_fails_for_an_empty_body() -> None:
    """An empty body is reported for the marker and the empty stamp."""

    assert check_index_html("", "") != []


def test_check_capabilities_accepts_a_healthy_payload() -> None:
    """A payload carrying every key and the right identity/version is healthy."""

    payload = {key: None for key in CAPABILITY_KEYS}
    payload["serverType"] = SERVER_TYPE
    payload["version"] = VERSION
    assert check_capabilities(payload, VERSION) == []


def test_check_capabilities_fails_for_foreign_server_type() -> None:
    """A foreign ``serverType`` is reported."""

    payload = {key: None for key in CAPABILITY_KEYS}
    payload["serverType"] = "other"
    payload["version"] = VERSION
    assert any("serverType" in failure for failure in check_capabilities(payload, VERSION))


def test_check_capabilities_fails_for_mismatched_version() -> None:
    """A mismatched version is reported."""

    payload = {key: None for key in CAPABILITY_KEYS}
    payload["serverType"] = SERVER_TYPE
    payload["version"] = "9.9.9"
    assert any("version is" in failure for failure in check_capabilities(payload, VERSION))


def test_check_capabilities_fails_for_a_missing_key() -> None:
    """A payload missing one capability key is reported."""

    payload = {key: None for key in CAPABILITY_KEYS if key != "features"}
    payload["serverType"] = SERVER_TYPE
    payload["version"] = VERSION
    assert any(
        "missing capability key" in failure for failure in check_capabilities(payload, VERSION)
    )


def _write_payload(tmp_path: Path, payload: dict) -> Path:
    """Write *payload* as JSON and return the file path."""

    path = tmp_path / "capabilities.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def _healthy_payload() -> dict:
    """Return a capability payload matching the installed package."""

    payload = {key: None for key in CAPABILITY_KEYS}
    payload["serverType"] = SERVER_TYPE
    payload["version"] = installed_version
    return payload


def test_main_capabilities_exits_zero_for_a_healthy_payload(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """``main --capabilities`` returns 0 for a healthy payload."""

    path = _write_payload(tmp_path, _healthy_payload())
    assert main(["--capabilities", str(path)]) == 0
    assert "passed" in capsys.readouterr().out


def test_main_capabilities_exits_two_for_invalid_json(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """``main --capabilities`` returns 2 for a file that is not valid JSON."""

    path = tmp_path / "bad.json"
    path.write_text("{not json", encoding="utf-8")
    assert main(["--capabilities", str(path)]) == 2


def test_main_capabilities_exits_two_with_failing_lines(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """``main --capabilities`` returns 2 and prints the failing lines."""

    payload = _healthy_payload()
    payload["serverType"] = "other"
    path = _write_payload(tmp_path, payload)
    assert main(["--capabilities", str(path)]) == 2
    assert "failure:" in capsys.readouterr().err

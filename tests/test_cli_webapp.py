"""Tests for ``micro-otter webapp build``.

The command is a thin surface, so the tests pin its option list, its URL validation and its
rendering; the build itself is replaced by a stub, and ``tests/test_webapp_build.py`` covers the
real orchestration.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from micro_otter.cli import app
from micro_otter.cli import webapp as webapp_cli
from micro_otter.tools.webapp_build import WebappBuildResult
from micro_otter.tools.webapp_errors import WebappError

runner = CliRunner()


def _invoke(*args: str) -> tuple[int, str, str]:
    """Run the CLI with *args* and return ``(exit_code, stdout, stderr)``."""

    result = runner.invoke(app, ["webapp", *args])
    return result.exit_code, result.stdout, result.stderr


def _result(
    tmp_path: Path, *, npm_output: str = "", firmware_page: bool = False
) -> WebappBuildResult:
    """Return a build result that looks like a real one without running npm."""

    out_dir = tmp_path / "out"
    return WebappBuildResult(
        out_dir=out_dir,
        manifest_path=out_dir / "webapp-build.json",
        app_version="1.43.0",
        file_count=7,
        firmware_page=out_dir / "firmware" / "index.html" if firmware_page else None,
        npm_output=npm_output,
    )


class StubBuild:
    """Stand in for ``run_webapp_build``: record the call and return a fixed result."""

    def __init__(self, result: WebappBuildResult, *, error: WebappError | None = None) -> None:
        self.result = result
        self.error = error
        self.calls: list[dict[str, object]] = []

    def __call__(self, **kwargs: object) -> WebappBuildResult:
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return self.result


def test_build_help_lists_every_option() -> None:
    exit_code, stdout, _stderr = _invoke("build", "--help")

    assert exit_code == 0
    for option in (
        "--out",
        "--firmware-index",
        "--docs-url",
        "--public-url",
        "--no-build",
        "--json-output",
        "--config",
    ):
        assert option in stdout
    assert "_dist/webapp-hosted" in stdout


def test_invalid_docs_url_exits_one_with_its_code() -> None:
    exit_code, _stdout, stderr = _invoke("build", "--out", "/tmp/out", "--docs-url", "not-a-url")

    assert exit_code == 1
    assert "webapp-build-docs-url-invalid" in stderr
    assert "hint:" in stderr


def test_relative_public_url_is_refused() -> None:
    exit_code, _stdout, stderr = _invoke(
        "build", "--out", "/tmp/out", "--public-url", "/otter"
    )

    assert exit_code == 1
    assert "webapp-build-public-url-invalid" in stderr


def test_public_url_with_a_path_is_refused_and_lists_the_root_fetches() -> None:
    exit_code, _stdout, stderr = _invoke(
        "build", "--out", "/tmp/out", "--public-url", "https://example.invalid/sub"
    )

    assert exit_code == 1
    assert "webapp-build-public-url-invalid" in stderr
    assert "/html/version.json" in stderr
    assert "/device/*" in stderr
    assert "root of a vhost" in stderr


@pytest.mark.parametrize(
    "public_url", ["https://example.invalid", "https://example.invalid/"]
)
def test_root_public_urls_are_accepted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, public_url: str
) -> None:
    stub = StubBuild(_result(tmp_path))
    monkeypatch.setattr(webapp_cli, "run_webapp_build", stub)

    exit_code, _stdout, stderr = _invoke(
        "build", "--out", str(tmp_path / "out"), "--public-url", public_url
    )

    assert exit_code == 0, stderr
    assert stub.calls[0]["public_url"] == public_url


def test_happy_path_prints_the_summary_table(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    stub = StubBuild(_result(tmp_path, npm_output="vite building... done"))
    monkeypatch.setattr(webapp_cli, "run_webapp_build", stub)

    exit_code, stdout, stderr = _invoke("build", "--out", str(tmp_path / "out"))

    assert exit_code == 0, stderr
    assert "vite building... done" in stdout
    for row in ("Out dir", "App version", "Files", "Firmware page", "Manifest"):
        assert row in stdout
    assert "1.43.0" in stdout
    assert stub.calls[0]["skip_build"] is False


def test_no_build_flag_reaches_the_orchestration(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    stub = StubBuild(_result(tmp_path))
    monkeypatch.setattr(webapp_cli, "run_webapp_build", stub)

    exit_code, _stdout, _stderr = _invoke("build", "--out", str(tmp_path / "out"), "--no-build")

    assert exit_code == 0
    assert stub.calls[0]["skip_build"] is True


def test_firmware_index_reaches_the_orchestration(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    stub = StubBuild(_result(tmp_path, firmware_page=True))
    monkeypatch.setattr(webapp_cli, "run_webapp_build", stub)

    exit_code, stdout, _stderr = _invoke(
        "build",
        "--out",
        str(tmp_path / "out"),
        "--firmware-index",
        str(tmp_path / "index.json"),
    )

    assert exit_code == 0
    assert stub.calls[0]["firmware_index"] == tmp_path / "index.json"
    assert "firmware" in stdout


def test_json_output_uses_camel_case_keys(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    stub = StubBuild(_result(tmp_path, firmware_page=True))
    monkeypatch.setattr(webapp_cli, "run_webapp_build", stub)

    exit_code, stdout, stderr = _invoke(
        "build", "--out", str(tmp_path / "out"), "--json-output"
    )

    assert exit_code == 0, stderr
    payload = json.loads(stdout)
    assert set(payload) == {
        "outDir",
        "appVersion",
        "fileCount",
        "firmwarePage",
        "manifestPath",
    }
    assert payload["appVersion"] == "1.43.0"
    assert payload["fileCount"] == 7


def test_a_build_failure_prints_its_code_and_hint(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    error = WebappError(
        "webapp-build-out-dir-unsafe", "out is the wheel payload", hint="pick another directory"
    )
    monkeypatch.setattr(webapp_cli, "run_webapp_build", StubBuild(_result(tmp_path), error=error))

    exit_code, _stdout, stderr = _invoke("build", "--out", str(tmp_path / "out"))

    assert exit_code == 1
    assert "webapp-build-out-dir-unsafe: out is the wheel payload" in stderr
    assert "hint: pick another directory" in stderr


def test_a_missing_config_file_exits_two() -> None:
    exit_code, _stdout, stderr = _invoke("build", "--config", "/nonexistent.toml")

    assert exit_code == 2
    assert "configuration error" in stderr

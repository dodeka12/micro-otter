"""Tests for ``micro_otter.tools.webapp_build``.

Every guard in the module's table is reached through an injected runner, so the suite never starts
npm, needs Node.js, or touches the network; the runner materialises the fixture bundle instead.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from collections.abc import Callable
from pathlib import Path

import pytest

from micro_otter.tools import webapp_build
from micro_otter.tools.webapp_build import (
    WEBAPP_DOCS_URL_ENV,
    WEBAPP_HOSTED_ENV,
    WEBAPP_OUT_ENV,
    run_webapp_build,
)
from micro_otter.tools.webapp_errors import WebappError

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "webapp"
"""``index.json`` (a two-board release index) and ``bundle/`` (a tiny built bundle)."""

INDEX = FIXTURES / "index.json"
BUNDLE = FIXTURES / "bundle"
"""The fixture build output. Not named ``dist``: `.gitignore` ignores that directory name."""


class FakeRunner:
    """Record each npm invocation and write a bundle into the requested output directory."""

    def __init__(
        self, *, returncode: int = 0, stdout: str = "built", stderr: str = ""
    ) -> None:
        self.calls: list[dict[str, object]] = []
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr
        self.on_run: Callable[[Path], None] | None = materialise_bundle

    def __call__(
        self,
        argv: list[str],
        *,
        cwd: Path,
        env: dict[str, str],
        capture_output: bool,
        text: bool,
        check: bool,
    ) -> subprocess.CompletedProcess[str]:
        self.calls.append(
            {
                "argv": list(argv),
                "cwd": Path(cwd),
                "env": dict(env),
                "capture_output": capture_output,
                "text": text,
                "check": check,
            }
        )
        if self.on_run is not None:
            self.on_run(Path(env[WEBAPP_OUT_ENV]))
        return subprocess.CompletedProcess(list(argv), self.returncode, self.stdout, self.stderr)


def materialise_bundle(out_dir: Path) -> None:
    """Copy the fixture bundle into *out_dir*, standing in for `vite build`."""

    shutil.copytree(BUNDLE, out_dir, dirs_exist_ok=True)


def _workspace(tmp_path: Path, *, node_modules: bool = True) -> Path:
    """Create a fake source checkout at *tmp_path*/``checkout``."""

    workspace = tmp_path / "checkout"
    workspace.mkdir()
    (workspace / "package.json").write_text("{}\n", encoding="utf-8")
    (workspace / "vite.config.js").write_text("export default {};\n", encoding="utf-8")
    if node_modules:
        (workspace / "node_modules").mkdir()
    return workspace


def test_reports_a_missing_source_checkout(tmp_path: Path) -> None:
    workspace = tmp_path / "empty"
    workspace.mkdir()
    runner = FakeRunner()

    with pytest.raises(WebappError) as raised:
        run_webapp_build(workspace=workspace, out_dir=tmp_path / "out", run=runner)

    assert raised.value.code == "webapp-build-source-missing"
    assert raised.value.hint is not None
    assert runner.calls == []


def test_reports_a_missing_vite_config(tmp_path: Path) -> None:
    workspace = _workspace(tmp_path)
    (workspace / "vite.config.js").unlink()

    with pytest.raises(WebappError) as raised:
        run_webapp_build(workspace=workspace, out_dir=tmp_path / "out", run=FakeRunner())

    assert raised.value.code == "webapp-build-source-missing"
    assert "vite.config.js" in str(raised.value)


def test_reports_a_missing_npm(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    workspace = _workspace(tmp_path)
    runner = FakeRunner()
    monkeypatch.setattr(webapp_build.shutil, "which", lambda _name: None)

    with pytest.raises(WebappError) as raised:
        run_webapp_build(workspace=workspace, out_dir=tmp_path / "out", run=runner)

    assert raised.value.code == "webapp-build-tool-missing"
    assert runner.calls == []


def test_reports_missing_dependencies(tmp_path: Path) -> None:
    workspace = _workspace(tmp_path, node_modules=False)

    with pytest.raises(WebappError) as raised:
        run_webapp_build(workspace=workspace, out_dir=tmp_path / "out", run=FakeRunner())

    assert raised.value.code == "webapp-build-dependencies-missing"
    assert "npm ci" in (raised.value.hint or "")


def test_skips_the_dependency_guard_without_building(tmp_path: Path) -> None:
    workspace = _workspace(tmp_path, node_modules=False)
    out_dir = tmp_path / "out"
    materialise_bundle(out_dir)

    result = run_webapp_build(
        workspace=workspace, out_dir=out_dir, skip_build=True, run=FakeRunner()
    )

    assert result.app_version == "1.43.0"


def test_refuses_the_wheel_payload_out_dir(tmp_path: Path) -> None:
    workspace = _workspace(tmp_path)
    runner = FakeRunner()

    with pytest.raises(WebappError) as raised:
        run_webapp_build(
            workspace=workspace, out_dir=workspace / "_dist" / "webapp", run=runner
        )

    assert raised.value.code == "webapp-build-out-dir-unsafe"
    assert "_dist/webapp" in str(raised.value)
    assert runner.calls == []


def test_refuses_a_path_inside_the_wheel_payload(tmp_path: Path) -> None:
    workspace = _workspace(tmp_path)

    with pytest.raises(WebappError) as raised:
        run_webapp_build(
            workspace=workspace,
            out_dir=workspace / "_dist" / "webapp" / "assets",
            run=FakeRunner(),
        )

    assert raised.value.code == "webapp-build-out-dir-unsafe"


def test_reports_a_missing_bundle_for_no_build(tmp_path: Path) -> None:
    workspace = _workspace(tmp_path)
    runner = FakeRunner()

    with pytest.raises(WebappError) as raised:
        run_webapp_build(
            workspace=workspace,
            out_dir=tmp_path / "out",
            skip_build=True,
            run=runner,
        )

    assert raised.value.code == "webapp-build-output-missing"
    assert runner.calls == []


def test_reports_a_failing_npm(tmp_path: Path) -> None:
    workspace = _workspace(tmp_path)
    runner = FakeRunner(returncode=2, stdout="", stderr="vite: syntax error")

    with pytest.raises(WebappError) as raised:
        run_webapp_build(workspace=workspace, out_dir=tmp_path / "out", run=runner)

    assert raised.value.code == "webapp-build-failed"
    assert "code 2" in str(raised.value)
    assert "re-run" in (raised.value.hint or "")


def test_sets_the_hosted_environment_for_npm(tmp_path: Path) -> None:
    workspace = _workspace(tmp_path)
    out_dir = tmp_path / "out"
    runner = FakeRunner()

    run_webapp_build(
        workspace=workspace,
        out_dir=out_dir,
        docs_url="https://example.invalid/install",
        run=runner,
    )

    assert len(runner.calls) == 1
    call = runner.calls[0]
    assert call["argv"] == ["npm", "run", "build"]
    assert call["cwd"] == workspace
    assert call["capture_output"] is True
    assert call["text"] is True
    assert call["check"] is False
    env = call["env"]
    assert isinstance(env, dict)
    assert env[WEBAPP_HOSTED_ENV] == "1"
    assert env[WEBAPP_OUT_ENV] == str(out_dir.resolve())
    assert env[WEBAPP_DOCS_URL_ENV] == "https://example.invalid/install"


def test_removes_a_stale_docs_url(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    workspace = _workspace(tmp_path)
    runner = FakeRunner()
    monkeypatch.setenv(WEBAPP_DOCS_URL_ENV, "https://stale.invalid/")

    run_webapp_build(workspace=workspace, out_dir=tmp_path / "out", run=runner)

    env = runner.calls[0]["env"]
    assert isinstance(env, dict)
    assert WEBAPP_DOCS_URL_ENV not in env


def test_happy_path_describes_the_finished_tree(tmp_path: Path) -> None:
    workspace = _workspace(tmp_path)
    out_dir = tmp_path / "out"
    runner = FakeRunner(stdout="vite building", stderr="chunk size warning")

    result = run_webapp_build(
        workspace=workspace,
        out_dir=out_dir,
        docs_url="https://example.invalid/install",
        firmware_index=INDEX,
        public_url="https://example.invalid/",
        run=runner,
    )

    assert result.out_dir == out_dir.resolve()
    assert result.app_version == "1.43.0"
    assert result.npm_output == "vite building\nchunk size warning"
    assert result.firmware_page == out_dir.resolve() / "firmware" / "index.html"
    assert result.manifest_path == out_dir.resolve() / "webapp-build.json"

    document = json.loads(result.manifest_path.read_text(encoding="utf-8"))
    assert document["schemaVersion"] == "webapp-build/v1"
    assert document["hosted"] is True
    assert document["publicUrl"] == "https://example.invalid/"

    paths = [entry["path"] for entry in document["files"]]
    assert result.file_count == len(paths)
    assert "webapp-build.json" not in paths
    # The page is listed, so the manifest was written after the page render.
    assert "firmware/index.html" in paths
    assert document["firmwarePage"]["path"] == "firmware/index.html"
    assert document["firmwarePage"]["entryCount"] == 2
    assert document["firmwarePage"]["indexSha256"] == hashlib.sha256(
        INDEX.read_bytes()
    ).hexdigest()
    for entry in document["files"]:
        path = out_dir.resolve() / entry["path"]
        assert entry["sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()


def test_reports_a_missing_version_file(tmp_path: Path) -> None:
    workspace = _workspace(tmp_path)
    runner = FakeRunner()

    def _write_index_only(out_dir: Path) -> None:
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "index.html").write_text("<html></html>", encoding="utf-8")

    runner.on_run = _write_index_only

    with pytest.raises(WebappError) as raised:
        run_webapp_build(workspace=workspace, out_dir=tmp_path / "out", run=runner)

    assert raised.value.code == "webapp-build-failed"
    assert "html/version.json" in str(raised.value)


def test_no_build_reuses_the_existing_bundle(tmp_path: Path) -> None:
    workspace = _workspace(tmp_path)
    out_dir = tmp_path / "out"
    materialise_bundle(out_dir)
    runner = FakeRunner()

    result = run_webapp_build(
        workspace=workspace,
        out_dir=out_dir,
        firmware_index=INDEX,
        public_url="https://example.invalid/",
        skip_build=True,
        run=runner,
    )

    assert runner.calls == []
    assert result.npm_output == ""
    assert result.app_version == "1.43.0"
    assert (out_dir / "firmware" / "index.html").is_file()
    assert result.manifest_path.is_file()

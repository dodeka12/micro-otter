"""Tests for ``micro-otter webapp upload``.

The command is a thin surface over
:func:`micro_otter.tools.webapp_upload.run_webapp_upload`, so the tests pin its option list, the
credential sourcing, the redaction and the rendering; the transfer itself is stubbed, and
``tests/test_webapp_upload.py`` covers the real orchestration.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from typer.testing import CliRunner

from micro_otter.cli import app
from micro_otter.cli import webapp as webapp_cli
from micro_otter.tools.webapp_errors import WebappError
from micro_otter.tools.webapp_upload import (
    UPLOAD_HOST_ENV,
    UPLOAD_PASSWORD_ENV,
    UPLOAD_PATH_ENV,
    UPLOAD_USER_ENV,
    UploadFile,
    UploadPlan,
    UploadResult,
    UploadTarget,
)

runner = CliRunner()

ROOT = "/www/example"
"""Remote directory the stub plan publishes into."""


def _invoke(*args: str) -> tuple[int, str, str]:
    """Run ``mo webapp upload`` with *args* and return ``(exit_code, stdout, stderr)``."""

    result = runner.invoke(app, ["webapp", "upload", *args])
    return result.exit_code, result.stdout, result.stderr


def _plan(tmp_path: Path) -> UploadPlan:
    """Return a two-file plan that looks like a real one without touching a server."""

    target = UploadTarget(host="example.invalid", user="deploy", remote_path=ROOT)
    files = (
        UploadFile(
            local=tmp_path / "dist" / "assets" / "main.js",
            remote=f"{ROOT}/assets/main.js",
            size=10,
            sha256="0" * 64,
        ),
        UploadFile(
            local=tmp_path / "dist" / "index.html",
            remote=f"{ROOT}/index.html",
            size=530,
            sha256="0" * 64,
        ),
    )
    return UploadPlan(
        target=target,
        files=files,
        directories=(ROOT, f"{ROOT}/assets"),
        manifest_path=tmp_path / "dist" / "webapp-build.json",
    )


def _result(
    tmp_path: Path,
    *,
    verified: bool = False,
    dry_run: bool = False,
    pruned: tuple[str, ...] = (),
    checks: tuple[str, ...] = (),
) -> UploadResult:
    """Return an upload result matching :func:`_plan`."""

    plan = _plan(tmp_path)
    return UploadResult(
        file_count=len(plan.files),
        byte_count=540,
        directories=len(plan.directories),
        pruned=pruned,
        verified=verified,
        dry_run=dry_run,
        manifest_path=plan.manifest_path,
        plan=plan,
        checks=checks,
    )


class StubUpload:
    """Stand in for ``run_webapp_upload``: record the call and return a fixed result."""

    def __init__(self, result: UploadResult, *, error: WebappError | None = None) -> None:
        self.result = result
        self.error = error
        self.calls: list[dict[str, Any]] = []

    def __call__(self, **kwargs: Any) -> UploadResult:
        """Record the keyword arguments and return the canned result."""

        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return self.result


def _target_args() -> list[str]:
    """Return the three flags every upload needs."""

    return ["--host", "example.invalid", "--user", "deploy", "--remote-path", ROOT]


def test_upload_help_lists_every_option() -> None:
    exit_code, stdout, _stderr = _invoke("--help")

    assert exit_code == 0
    for option in (
        "--source",
        "--host",
        "--user",
        "--remote-path",
        "--port",
        "--identity-file",
        "--known-hosts",
        "--accept-new-host-key",
        "--prune",
        "--verify",
        "--dry-run",
        "--yes",
        "--json-output",
        "--config",
    ):
        assert option in stdout
    assert "_dist/webapp-hosted" in stdout
    assert "--password" not in stdout


def test_missing_host_exits_one_with_its_code(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (UPLOAD_HOST_ENV, UPLOAD_USER_ENV, UPLOAD_PATH_ENV):
        monkeypatch.delenv(name, raising=False)

    exit_code, _stdout, stderr = _invoke("--user", "deploy", "--remote-path", ROOT)

    assert exit_code == 1
    assert "webapp-upload-target-invalid" in stderr
    assert UPLOAD_HOST_ENV in stderr


def test_happy_path_prints_the_summary_table_and_the_checks(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    stub = StubUpload(
        _result(
            tmp_path,
            verified=True,
            pruned=(f"{ROOT}/old.html",),
            checks=("Prune: removed 1 stale files", "Files: 2 of 2 match the manifest"),
        )
    )
    monkeypatch.setattr(webapp_cli, "run_webapp_upload", stub)

    exit_code, stdout, stderr = _invoke(*_target_args())

    assert exit_code == 0, stderr
    for row in ("Host", "Remote path", "Files", "Bytes", "Directories", "Pruned", "Verified"):
        assert row in stdout
    assert "deploy@example.invalid" in stdout
    assert "Files: 2 of 2 match the manifest" in stdout


def test_the_plan_is_printed_for_a_dry_run(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    stub = StubUpload(
        _result(tmp_path, dry_run=True, checks=("Dry run: nothing was transferred",))
    )
    monkeypatch.setattr(webapp_cli, "run_webapp_upload", stub)

    exit_code, stdout, stderr = _invoke(*_target_args(), "--dry-run")

    assert exit_code == 0, stderr
    assert stub.calls[0]["dry_run"] is True
    assert f"{ROOT}/index.html" in stdout
    assert "Dry run: nothing was transferred" in stdout


def test_json_output_uses_camel_case_keys(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    stub = StubUpload(_result(tmp_path, verified=True, pruned=(f"{ROOT}/old.html",)))
    monkeypatch.setattr(webapp_cli, "run_webapp_upload", stub)

    exit_code, stdout, stderr = _invoke(*_target_args(), "--json-output")

    assert exit_code == 0, stderr
    payload = json.loads(stdout)
    assert set(payload) == {
        "fileCount",
        "byteCount",
        "directories",
        "pruned",
        "verified",
        "dryRun",
        "manifestPath",
    }
    assert payload["fileCount"] == 2
    assert payload["pruned"] == [f"{ROOT}/old.html"]
    assert payload["verified"] is True
    assert payload["dryRun"] is False


def test_flags_reach_the_target(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    stub = StubUpload(_result(tmp_path))
    monkeypatch.setattr(webapp_cli, "run_webapp_upload", stub)

    exit_code, _stdout, stderr = _invoke(
        "--source",
        str(tmp_path / "dist"),
        "--host",
        "example.invalid",
        "--user",
        "deploy",
        "--remote-path",
        f"{ROOT}/",
        "--port",
        "2222",
        "--identity-file",
        "/keys/id_ed25519",
        "--known-hosts",
        "/keys/known_hosts",
        "--accept-new-host-key",
    )

    assert exit_code == 0, stderr
    target = stub.calls[0]["target"]
    assert isinstance(target, UploadTarget)
    assert target.host == "example.invalid"
    assert target.user == "deploy"
    assert target.remote_path == ROOT
    assert target.port == 2222
    assert target.identity_file == Path("/keys/id_ed25519")
    assert target.known_hosts == Path("/keys/known_hosts")
    assert target.accept_new_host_key is True
    assert stub.calls[0]["source_dir"] == tmp_path / "dist"



def test_prune_verify_and_yes_reach_the_orchestration(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    stub = StubUpload(_result(tmp_path, verified=True))
    monkeypatch.setattr(webapp_cli, "run_webapp_upload", stub)

    exit_code, _stdout, stderr = _invoke(*_target_args(), "--prune", "--verify", "--yes")

    assert exit_code == 0, stderr
    call = stub.calls[0]
    assert call["prune"] is True
    assert call["verify"] is True
    assert call["assume_yes"] is True
    assert call["confirm"] is None


def test_a_prune_without_yes_asks_before_removing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    stub = StubUpload(_result(tmp_path))
    monkeypatch.setattr(webapp_cli, "run_webapp_upload", stub)

    exit_code, _stdout, stderr = _invoke(*_target_args(), "--prune")

    assert exit_code == 0, stderr
    assert stub.calls[0]["assume_yes"] is False
    assert callable(stub.calls[0]["confirm"])


def test_json_output_never_asks_either(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    stub = StubUpload(_result(tmp_path))
    monkeypatch.setattr(webapp_cli, "run_webapp_upload", stub)

    exit_code, _stdout, stderr = _invoke(*_target_args(), "--prune", "--json-output")

    assert exit_code == 0, stderr
    assert stub.calls[0]["confirm"] is None


def test_the_password_comes_from_the_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(UPLOAD_PASSWORD_ENV, "hunter2")
    stub = StubUpload(_result(tmp_path))
    monkeypatch.setattr(webapp_cli, "run_webapp_upload", stub)

    exit_code, _stdout, stderr = _invoke(*_target_args())

    assert exit_code == 0, stderr
    assert stub.calls[0]["password"] == "hunter2"


def test_a_dry_run_hands_over_no_password(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(UPLOAD_PASSWORD_ENV, "hunter2")
    stub = StubUpload(_result(tmp_path, dry_run=True))
    monkeypatch.setattr(webapp_cli, "run_webapp_upload", stub)

    exit_code, _stdout, stderr = _invoke(*_target_args(), "--dry-run")

    assert exit_code == 0, stderr
    assert stub.calls[0]["password"] is None


def test_a_failure_prints_its_code_and_hint(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    error = WebappError(
        "webapp-upload-sftp-missing",
        "sftp was not found on PATH",
        hint="install the OpenSSH client",
    )
    monkeypatch.setattr(webapp_cli, "run_webapp_upload", StubUpload(_result(tmp_path), error=error))

    exit_code, _stdout, stderr = _invoke(*_target_args())

    assert exit_code == 1
    assert "webapp-upload-sftp-missing: sftp was not found on PATH" in stderr
    assert "hint: install the OpenSSH client" in stderr


def test_the_password_is_redacted_from_every_line(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(UPLOAD_PASSWORD_ENV, "hunter2")
    error = WebappError(
        "webapp-upload-connect-failed",
        "sftp could not connect: password hunter2 rejected",
        hint="rotate hunter2 and re-run",
    )
    monkeypatch.setattr(webapp_cli, "run_webapp_upload", StubUpload(_result(tmp_path), error=error))

    exit_code, stdout, stderr = _invoke(*_target_args())

    assert exit_code == 1
    assert "hunter2" not in stdout + stderr
    assert "*** rejected" in stderr
    assert "hint: rotate *** and re-run" in stderr


def test_an_interrupted_upload_exits_130(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    error = WebappError(
        "webapp-upload-interrupted",
        "upload interrupted; 5 files were planned and index.html was not published",
        hint="re-run the upload",
        exit_code=130,
    )
    monkeypatch.setattr(webapp_cli, "run_webapp_upload", StubUpload(_result(tmp_path), error=error))

    exit_code, _stdout, stderr = _invoke(*_target_args())

    assert exit_code == 130
    assert "webapp-upload-interrupted" in stderr
    assert "index.html was not published" in stderr


def test_a_missing_config_file_exits_two() -> None:
    exit_code, _stdout, stderr = _invoke("--config", "/nonexistent.toml")

    assert exit_code == 2
    assert "configuration error" in stderr


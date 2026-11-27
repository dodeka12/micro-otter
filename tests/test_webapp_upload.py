"""Tests for ``micro_otter.tools.webapp_upload``.

Nothing here touches a network: the plan, the rendered batch, the argv and the verification are pure
functions, and the end-to-end cases run ``tests/fixtures/bin/sftp`` — a POSIX ``sh`` script that
records the invocation and replays a canned directory listing — through the real transport seam.
"""

from __future__ import annotations

import os
import shutil
import stat
import subprocess
from pathlib import Path
from types import MappingProxyType
from typing import Any

import pytest

from micro_otter.tools import webapp_manifest, webapp_upload
from micro_otter.tools.webapp_errors import WebappError
from micro_otter.tools.webapp_upload import (
    UPLOAD_HOST_ENV,
    UPLOAD_IDENTITY_FILE_ENV,
    UPLOAD_PASSWORD_ENV,
    UPLOAD_PATH_ENV,
    UPLOAD_PORT_ENV,
    UPLOAD_USER_ENV,
    UploadFile,
    UploadPlan,
    UploadTarget,
    build_child_env,
    build_sftp_argv,
    list_remote,
    normalise_remote_path,
    parse_remote_listing,
    plan_directories,
    plan_upload,
    prune_candidates,
    redact,
    render_listing_batch,
    render_sftp_batch,
    require_password_support,
    resolve_target,
    run_sftp,
    run_webapp_upload,
    sort_for_publication,
    verify_public,
    verify_remote,
    write_askpass,
)

BUNDLE = Path(__file__).resolve().parent / "fixtures" / "webapp" / "bundle"
"""The fixture build: ``index.html``, ``html/version.json`` and ``html/locales/en.json``."""

FAKE_BIN = Path(__file__).resolve().parent / "fixtures" / "bin"
"""Directory holding the fake ``sftp`` that prefixing ``PATH`` makes the transport use."""

ROOT = "/www/example"
"""Remote directory every plan in this module publishes into."""


def _build(tmp_path: Path, *, public_url: str | None = None) -> Path:
    """Copy the fixture bundle, add a hashed asset and write a matching manifest."""

    tree = tmp_path / "dist"
    shutil.copytree(BUNDLE, tree)
    (tree / "assets").mkdir()
    (tree / "assets" / "main-abc123.js").write_text(
        "console.log('otter');\n", encoding="utf-8"
    )
    document = webapp_manifest.payload(
        "1.43.0",
        hosted=True,
        public_url=public_url,
        firmware_page=None,
        files=webapp_manifest.collect_files(tree),
    )
    webapp_manifest.write_manifest(tree, document)
    return tree


def _manifest(tree: Path) -> dict[str, Any]:
    """Return the manifest of *tree*."""

    return webapp_manifest.read_manifest(tree / webapp_manifest.MANIFEST_NAME)


def _target(**overrides: Any) -> UploadTarget:
    """Return a target for ``example.invalid`` with *overrides* applied."""

    values: dict[str, Any] = {"host": "example.invalid", "user": "deploy", "remote_path": ROOT}
    values.update(overrides)
    return UploadTarget(**values)


def _plan(tree: Path) -> UploadPlan:
    """Return the plan that publishes *tree* to :data:`ROOT`."""

    return plan_upload(tree, _manifest(tree), _target())


def _relatives(plan: UploadPlan, root: str = ROOT) -> list[str]:
    """Return the plan's remote paths relative to *root*, in publication order."""

    return [item.remote.removeprefix(root + "/") for item in plan.files]


class FakeRunner:
    """Stand in for ``subprocess.run``: record the call, keep the batch, replay a result."""

    def __init__(
        self,
        *,
        returncode: int = 0,
        stdout: str = "",
        stderr: str = "",
        error: BaseException | None = None,
    ) -> None:
        self.calls: list[dict[str, Any]] = []
        self.batch_text = ""
        self.batch_mode = 0
        self.batch_file: Path | None = None
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr
        self.error = error

    def __call__(self, argv: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        """Record *argv* and the batch file it names, then return the canned result."""

        batch_file = Path(argv[argv.index("-b") + 1])
        self.batch_file = batch_file
        self.batch_text = batch_file.read_text(encoding="utf-8")
        self.batch_mode = stat.S_IMODE(batch_file.stat().st_mode)
        self.calls.append({"argv": list(argv), **kwargs})
        if self.error is not None:
            raise self.error
        return subprocess.CompletedProcess(list(argv), self.returncode, self.stdout, self.stderr)


def test_plan_publishes_assets_first_and_index_html_last(tmp_path: Path) -> None:
    plan = _plan(_build(tmp_path))

    assert _relatives(plan) == [
        "assets/main-abc123.js",
        "html/locales/en.json",
        "html/version.json",
        "webapp-build.json",
        "index.html",
    ]


def test_plan_lists_every_remote_directory_parents_first(tmp_path: Path) -> None:
    plan = _plan(_build(tmp_path))

    assert plan.directories == (
        ROOT,
        f"{ROOT}/assets",
        f"{ROOT}/html",
        f"{ROOT}/html/locales",
    )


def test_plan_sizes_and_hashes_come_from_the_manifest(tmp_path: Path) -> None:
    tree = _build(tmp_path)
    plan = _plan(tree)

    entries = {entry["path"]: entry for entry in _manifest(tree)["files"]}
    for item in plan.files:
        relative = item.remote.removeprefix(ROOT + "/")
        assert item.local == (tree / relative).resolve()
        assert item.size == (tree / relative).stat().st_size
        if relative in entries:
            assert item.sha256 == entries[relative]["sha256"]
    manifest_entry = plan.files[3]
    assert manifest_entry.remote.endswith(webapp_manifest.MANIFEST_NAME)
    assert manifest_entry.size == (tree / webapp_manifest.MANIFEST_NAME).stat().st_size


def test_plan_records_the_manifest_path(tmp_path: Path) -> None:
    tree = _build(tmp_path)

    assert _plan(tree).manifest_path == (tree / webapp_manifest.MANIFEST_NAME).resolve()


def test_plan_refuses_a_file_the_build_no_longer_has(tmp_path: Path) -> None:
    tree = _build(tmp_path)
    (tree / "html" / "locales" / "en.json").unlink()

    with pytest.raises(WebappError) as raised:
        _plan(tree)

    assert raised.value.code == "webapp-upload-source-invalid"
    assert "does not exist" in str(raised.value)


def test_plan_refuses_a_file_that_changed_since_the_build(tmp_path: Path) -> None:
    tree = _build(tmp_path)
    with (tree / "index.html").open("a", encoding="utf-8") as handle:
        handle.write("<!-- edited after the build -->\n")

    with pytest.raises(WebappError) as raised:
        _plan(tree)

    assert raised.value.code == "webapp-upload-source-invalid"
    assert "bytes but the manifest lists" in str(raised.value)


def test_plan_refuses_a_path_that_resolves_outside_the_source(tmp_path: Path) -> None:
    tree = _build(tmp_path)
    outside = tmp_path / "outside.json"
    outside.write_text('{"outside": true}\n', encoding="utf-8")
    locale = tree / "html" / "locales" / "en.json"
    locale.unlink()
    locale.symlink_to(outside)

    with pytest.raises(WebappError) as raised:
        _plan(tree)

    assert raised.value.code == "webapp-upload-source-invalid"
    assert "resolves outside" in str(raised.value)


def test_plan_refuses_a_manifest_without_index_html(tmp_path: Path) -> None:
    tree = _build(tmp_path)
    document = _manifest(tree)
    document["files"] = [
        entry for entry in document["files"] if entry["path"] != "index.html"
    ]
    webapp_manifest.write_manifest(tree, document)

    with pytest.raises(WebappError) as raised:
        _plan(tree)

    assert raised.value.code == "webapp-upload-source-invalid"
    assert "no index.html" in str(raised.value)


def test_plan_refuses_an_invalid_manifest(tmp_path: Path) -> None:
    tree = _build(tmp_path)
    document = _manifest(tree)
    document["schemaVersion"] = "webapp-build/v2"
    webapp_manifest.write_manifest(tree, document)

    with pytest.raises(WebappError) as raised:
        _plan(tree)

    assert raised.value.code == "webapp-upload-manifest-invalid"


def test_plan_refuses_a_source_that_is_not_a_directory(tmp_path: Path) -> None:
    tree = _build(tmp_path)

    with pytest.raises(WebappError) as raised:
        plan_upload(tmp_path / "missing", _manifest(tree), _target())

    assert raised.value.code == "webapp-upload-source-invalid"


def _upload_file(remote: str, size: int = 1) -> UploadFile:
    """Return an upload file entry for the ordering tests."""

    return UploadFile(
        local=Path("/tmp") / remote.replace("/", "_"),
        remote=remote,
        size=size,
        sha256="0" * 64,
    )


def test_sort_for_publication_hoists_version_manifest_and_index() -> None:
    files = [
        _upload_file(f"{ROOT}/index.html"),
        _upload_file(f"{ROOT}/webapp-build.json"),
        _upload_file(f"{ROOT}/html/version.json"),
        _upload_file(f"{ROOT}/assets/b.js"),
        _upload_file(f"{ROOT}/assets/a.js"),
    ]

    ordered = sort_for_publication(files, root=ROOT)

    assert [item.remote.removeprefix(ROOT + "/") for item in ordered] == [
        "assets/a.js",
        "assets/b.js",
        "html/version.json",
        "webapp-build.json",
        "index.html",
    ]


def test_sort_for_publication_tolerates_a_missing_manifest_file() -> None:
    files = [_upload_file(f"{ROOT}/index.html"), _upload_file(f"{ROOT}/assets/a.js")]

    assert [item.remote for item in sort_for_publication(files, root=ROOT)] == [
        f"{ROOT}/assets/a.js",
        f"{ROOT}/index.html",
    ]


def test_plan_directories_keeps_parents_first() -> None:
    directories = plan_directories(
        ROOT,
        [f"{ROOT}/html/locales/en.json", f"{ROOT}/device/firmware/boards.json"],
    )

    assert directories == (
        ROOT,
        f"{ROOT}/device",
        f"{ROOT}/html",
        f"{ROOT}/device/firmware",
        f"{ROOT}/html/locales",
    )


def test_prune_candidates_lists_only_unplanned_paths_under_the_root(tmp_path: Path) -> None:
    plan = _plan(_build(tmp_path))
    listing = MappingProxyType(
        {
            f"{ROOT}/index.html": 1,
            f"{ROOT}/old.html": 12,
            f"{ROOT}/assets/stale.js": 7,
            "/elsewhere/other.html": 3,
        }
    )

    assert prune_candidates(plan, listing) == (
        f"{ROOT}/assets/stale.js",
        f"{ROOT}/old.html",
    )



def test_remote_path_is_normalised_without_a_trailing_separator() -> None:
    assert normalise_remote_path("/www/example/") == "/www/example"
    assert normalise_remote_path("  /www/example  ") == "/www/example"
    assert normalise_remote_path("/www/example") == "/www/example"


@pytest.mark.parametrize(
    "value",
    ["", "   ", "www/example", "/", "//", "/www/../example", "/www//example", "/www/./x"],
)
def test_an_unusable_remote_path_is_refused(value: str) -> None:
    with pytest.raises(WebappError) as raised:
        normalise_remote_path(value)

    assert raised.value.code == "webapp-upload-target-invalid"
    assert raised.value.hint


@pytest.mark.parametrize(
    ("overrides", "message"),
    [({"port": 0}, "outside 1-65535"), ({"port": 70000}, "outside 1-65535")],
)
def test_an_impossible_port_is_refused(overrides: dict[str, Any], message: str) -> None:
    with pytest.raises(WebappError) as raised:
        _target(**overrides)

    assert raised.value.code == "webapp-upload-target-invalid"
    assert message in str(raised.value)


def test_the_destination_is_user_at_host() -> None:
    assert _target().destination == "deploy@example.invalid"


def test_render_sftp_batch_is_exact(tmp_path: Path) -> None:
    plan = _plan(_build(tmp_path))

    batch = render_sftp_batch(plan, prune=(f"{ROOT}/old.html",))

    local = plan.files[0].local.parent.parent
    assert batch == (
        f'-mkdir "{ROOT}"\n'
        f'-mkdir "{ROOT}/assets"\n'
        f'-mkdir "{ROOT}/html"\n'
        f'-mkdir "{ROOT}/html/locales"\n'
        f'put -p "{local}/assets/main-abc123.js" "{ROOT}/assets/main-abc123.js"\n'
        f'put -p "{local}/html/locales/en.json" "{ROOT}/html/locales/en.json"\n'
        f'put -p "{local}/html/version.json" "{ROOT}/html/version.json"\n'
        f'put -p "{local}/webapp-build.json" "{ROOT}/webapp-build.json"\n'
        f'put -p "{local}/index.html" "{ROOT}/index.html"\n'
        f'-rm "{ROOT}/old.html"\n'
    )
    assert "\n\n" not in batch


def test_render_sftp_batch_without_prune_removes_nothing(tmp_path: Path) -> None:
    batch = render_sftp_batch(_plan(_build(tmp_path)))

    assert "-rm" not in batch
    assert batch.endswith('"\n')


def test_render_sftp_batch_refuses_a_path_it_cannot_quote(tmp_path: Path) -> None:
    plan = _plan(_build(tmp_path))

    with pytest.raises(WebappError) as raised:
        render_sftp_batch(plan, prune=(f'{ROOT}/od"d.html',))

    assert raised.value.code == "webapp-upload-target-invalid"


def test_render_listing_batch_lists_one_directory() -> None:
    assert render_listing_batch(f"{ROOT}/html") == f'-ls -l "{ROOT}/html"\n'


def test_argv_for_key_auth_without_an_identity_file(tmp_path: Path) -> None:
    plan = _plan(_build(tmp_path))

    argv = build_sftp_argv(plan, batch_file=Path("/tmp/batch"), password=False)

    assert argv == [
        "sftp",
        "-q",
        "-b",
        "/tmp/batch",
        "-P",
        "22",
        "-o",
        "ConnectTimeout=20",
        "-o",
        "BatchMode=yes",
        "-o",
        "PreferredAuthentications=publickey",
        "deploy@example.invalid",
    ]


def test_argv_for_key_auth_with_an_identity_file(tmp_path: Path) -> None:
    tree = _build(tmp_path)
    plan = plan_upload(
        tree,
        _manifest(tree),
        _target(identity_file=Path("/home/deploy/.ssh/id_ed25519"), port=2222),
    )

    argv = build_sftp_argv(plan, batch_file=Path("/tmp/batch"), password=False)

    assert argv[argv.index("-P") + 1] == "2222"
    assert argv[argv.index("-i") + 1] == "/home/deploy/.ssh/id_ed25519"
    assert "BatchMode=yes" in argv


def test_argv_for_password_auth_disables_publickey(tmp_path: Path) -> None:
    plan = _plan(_build(tmp_path))

    argv = build_sftp_argv(plan, batch_file=Path("/tmp/batch"), password=True)

    assert "PreferredAuthentications=password" in argv
    assert "PubkeyAuthentication=no" in argv
    assert "NumberOfPasswordPrompts=1" in argv
    assert "BatchMode=yes" not in argv
    assert "PreferredAuthentications=publickey" not in argv


def test_argv_pins_known_hosts_and_never_accepts_a_new_key_by_default(
    tmp_path: Path,
) -> None:
    tree = _build(tmp_path)
    pinned = plan_upload(
        tree, _manifest(tree), _target(known_hosts=Path("/etc/known_hosts"))
    )

    argv = build_sftp_argv(pinned, batch_file=Path("/tmp/batch"), password=False)

    assert "UserKnownHostsFile=/etc/known_hosts" in argv
    assert "StrictHostKeyChecking=accept-new" not in argv


def test_argv_accepts_a_new_host_key_only_when_asked(tmp_path: Path) -> None:
    tree = _build(tmp_path)
    plan = plan_upload(tree, _manifest(tree), _target(accept_new_host_key=True))

    argv = build_sftp_argv(plan, batch_file=Path("/tmp/batch"), password=False)

    assert "StrictHostKeyChecking=accept-new" in argv



LISTING = """\
-rw-r--r--    1 deploy deploy     530 Nov 26 09:00 index.html
-rw-r--r--    1 deploy deploy      26 Nov 26 09:00 a file with spaces.json
drwxr-xr-x    2 deploy deploy    4096 Nov 26 09:00 assets
lrwxrwxrwx    1 deploy deploy       9 Nov 26 09:00 link.html -> index.html
drwxr-xr-x    5 deploy deploy    4096 Nov 26 09:00 .
drwxr-xr-x    5 deploy deploy    4096 Nov 26 09:00 ..
-rw-r--r--    1 deploy deploy    1234 Nov 26  2025 version.json
Connection closed
"""
"""A realistic ``ls -l`` payload: files, spaces, a directory, a symlink, ``.``/``..``, noise."""


def test_parse_remote_listing_keeps_regular_files_only() -> None:
    assert parse_remote_listing(LISTING) == {
        "index.html": 530,
        "a file with spaces.json": 26,
        "version.json": 1234,
    }


@pytest.mark.parametrize(
    "line",
    [
        "-rw-r--r-- 1 deploy deploy Nov 26 09:00 truncated.html",
        "-rw-r--r-- 1 deploy deploy 12 Nov 26 09:00",
        "Couldn't stat remote file: No such file or directory",
        "",
    ],
)
def test_parse_remote_listing_ignores_what_it_cannot_read(line: str) -> None:
    assert parse_remote_listing(line) == {}


def test_run_sftp_requires_the_openssh_client(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(webapp_upload.shutil, "which", lambda _name: None)

    with pytest.raises(WebappError) as raised:
        run_sftp(plan=_plan(_build(tmp_path)), batch_text="", password=False)

    assert raised.value.code == "webapp-upload-sftp-missing"
    assert "OpenSSH" in (raised.value.hint or "")


def test_run_sftp_writes_a_private_batch_and_removes_it(tmp_path: Path) -> None:
    runner = FakeRunner()

    run_sftp(
        plan=_plan(_build(tmp_path)),
        batch_text='put -p "/a" "/b"\n',
        password=False,
        env={"MICRO_OTTER_UPLOAD_TEST": "1"},
        run=runner,
        use_setsid=False,
    )

    assert runner.batch_text == 'put -p "/a" "/b"\n'
    assert runner.batch_mode == 0o600
    assert runner.batch_file is not None and not runner.batch_file.exists()
    call = runner.calls[0]
    assert call["env"] == {"MICRO_OTTER_UPLOAD_TEST": "1"}
    assert call["capture_output"] is True
    assert call["text"] is True
    assert call["check"] is False
    assert call["timeout"] == webapp_upload.SFTP_TIMEOUT_SECONDS


def test_run_sftp_prefixes_setsid_only_for_password_auth(tmp_path: Path) -> None:
    plan = _plan(_build(tmp_path))
    password_runner = FakeRunner()
    key_runner = FakeRunner()

    run_sftp(plan=plan, batch_text="", password=True, run=password_runner, use_setsid=True)
    run_sftp(plan=plan, batch_text="", password=False, run=key_runner, use_setsid=True)

    assert password_runner.calls[0]["argv"][0] == "setsid"
    assert password_runner.calls[0]["argv"][1] == "sftp"
    assert key_runner.calls[0]["argv"][0] == "sftp"


def test_run_sftp_maps_exit_255_to_a_connection_failure(tmp_path: Path) -> None:
    runner = FakeRunner(returncode=255, stderr="deploy@example.invalid: Permission denied")

    with pytest.raises(WebappError) as raised:
        run_sftp(plan=_plan(_build(tmp_path)), batch_text="", password=False, run=runner)

    assert raised.value.code == "webapp-upload-connect-failed"
    assert "Permission denied" in str(raised.value)
    assert "deploy@example.invalid" in str(raised.value)


def test_run_sftp_maps_other_failures_to_a_transfer_failure(tmp_path: Path) -> None:
    runner = FakeRunner(returncode=1, stderr="Couldn't write to remote file")

    with pytest.raises(WebappError) as raised:
        run_sftp(plan=_plan(_build(tmp_path)), batch_text="", password=False, run=runner)

    assert raised.value.code == "webapp-upload-put-failed"
    assert "code 1" in str(raised.value)
    assert "Couldn't write to remote file" in str(raised.value)


def test_run_sftp_redacts_the_password_from_its_diagnostics(tmp_path: Path) -> None:
    runner = FakeRunner(returncode=255, stderr="password hunter2 rejected")

    with pytest.raises(WebappError) as raised:
        run_sftp(
            plan=_plan(_build(tmp_path)),
            batch_text="",
            password=True,
            secret="hunter2",
            run=runner,
        )

    assert "hunter2" not in str(raised.value)
    assert "*** rejected" in str(raised.value)


def test_run_sftp_reports_a_timeout_as_a_connection_failure(tmp_path: Path) -> None:
    runner = FakeRunner(error=subprocess.TimeoutExpired("sftp", 600))

    with pytest.raises(WebappError) as raised:
        run_sftp(
            plan=_plan(_build(tmp_path)), batch_text="", password=False, run=runner, timeout=600
        )

    assert raised.value.code == "webapp-upload-connect-failed"
    assert "600 seconds" in str(raised.value)


def test_list_remote_attributes_each_name_to_its_directory(tmp_path: Path) -> None:
    plan = _plan(_build(tmp_path))
    listing = (
        "-rw-r--r-- 1 deploy deploy 530 Nov 26 09:00 index.html\n"
        "-rw-r--r-- 1 deploy deploy 7 Nov 26 09:00 main-abc123.js\n"
    )
    runner = FakeRunner(stdout=listing)

    result = list_remote(plan, password=False, run=runner, use_setsid=False)

    assert len(runner.calls) == len(plan.directories)
    assert result[f"{ROOT}/index.html"] == 530
    assert result[f"{ROOT}/assets/main-abc123.js"] == 7



def test_resolve_target_uses_flags_before_the_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(UPLOAD_HOST_ENV, "env.invalid")
    monkeypatch.setenv(UPLOAD_USER_ENV, "envuser")
    monkeypatch.setenv(UPLOAD_PATH_ENV, "/env/path")
    monkeypatch.setenv(UPLOAD_PORT_ENV, "2200")
    monkeypatch.setenv(UPLOAD_IDENTITY_FILE_ENV, "/env/id_ed25519")

    target = resolve_target(
        host="flag.invalid",
        user="flaguser",
        remote_path="/flag/path",
        port=2222,
        identity_file=Path("/flag/id_ed25519"),
        known_hosts=Path("/flag/known_hosts"),
        accept_new_host_key=True,
    )

    assert target.host == "flag.invalid"
    assert target.user == "flaguser"
    assert target.remote_path == "/flag/path"
    assert target.port == 2222
    assert target.identity_file == Path("/flag/id_ed25519")
    assert target.known_hosts == Path("/flag/known_hosts")
    assert target.accept_new_host_key is True


def test_resolve_target_falls_back_to_the_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(UPLOAD_HOST_ENV, "env.invalid")
    monkeypatch.setenv(UPLOAD_USER_ENV, "envuser")
    monkeypatch.setenv(UPLOAD_PATH_ENV, "/env/path/")
    monkeypatch.setenv(UPLOAD_PORT_ENV, "2200")
    monkeypatch.setenv(UPLOAD_IDENTITY_FILE_ENV, "~/keys/id_ed25519")

    target = resolve_target(
        host=None,
        user=None,
        remote_path=None,
        port=None,
        identity_file=None,
        known_hosts=None,
        accept_new_host_key=False,
    )

    assert target.host == "env.invalid"
    assert target.user == "envuser"
    assert target.remote_path == "/env/path"
    assert target.port == 2200
    assert target.identity_file == Path("~/keys/id_ed25519").expanduser()
    assert target.known_hosts is None
    assert target.accept_new_host_key is False


def test_resolve_target_defaults_the_port_to_twenty_two(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name in (UPLOAD_HOST_ENV, UPLOAD_USER_ENV, UPLOAD_PATH_ENV, UPLOAD_PORT_ENV):
        monkeypatch.delenv(name, raising=False)

    target = resolve_target(
        host="example.invalid",
        user="deploy",
        remote_path=ROOT,
        port=None,
        identity_file=None,
        known_hosts=None,
        accept_new_host_key=False,
    )

    assert target.port == 22


@pytest.mark.parametrize(
    ("argument", "env_name", "flag"),
    [
        ("host", UPLOAD_HOST_ENV, "--host"),
        ("user", UPLOAD_USER_ENV, "--user"),
        ("remote_path", UPLOAD_PATH_ENV, "--remote-path"),
    ],
)
def test_resolve_target_names_the_value_that_is_missing(
    monkeypatch: pytest.MonkeyPatch, argument: str, env_name: str, flag: str
) -> None:
    values: dict[str, Any] = {"host": "example.invalid", "user": "deploy", "remote_path": ROOT}
    values[argument] = None
    for name in (UPLOAD_HOST_ENV, UPLOAD_USER_ENV, UPLOAD_PATH_ENV):
        monkeypatch.delenv(name, raising=False)

    with pytest.raises(WebappError) as raised:
        resolve_target(
            port=None,
            identity_file=None,
            known_hosts=None,
            accept_new_host_key=False,
            **values,
        )

    assert raised.value.code == "webapp-upload-target-invalid"
    assert flag in (raised.value.hint or "")
    assert env_name in (raised.value.hint or "")


def test_an_unparsable_env_port_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(UPLOAD_PORT_ENV, "not-a-port")

    with pytest.raises(WebappError) as raised:
        resolve_target(
            host="example.invalid",
            user="deploy",
            remote_path=ROOT,
            port=None,
            identity_file=None,
            known_hosts=None,
            accept_new_host_key=False,
        )

    assert raised.value.code == "webapp-upload-target-invalid"
    assert "not a port number" in str(raised.value)


def test_write_askpass_prints_only_the_password(tmp_path: Path) -> None:
    path = write_askpass(tmp_path)

    body = path.read_text(encoding="utf-8")
    assert stat.S_IMODE(path.stat().st_mode) == 0o700
    assert body.startswith("#!/bin/sh\n")
    assert body.count("\n") == 2
    assert f'${UPLOAD_PASSWORD_ENV}' in body


def test_build_child_env_carries_the_askpass_contract(tmp_path: Path) -> None:
    askpass = write_askpass(tmp_path)

    env = build_child_env("hunter2", askpass)

    assert env["SSH_ASKPASS"] == str(askpass)
    assert env["SSH_ASKPASS_REQUIRE"] == "force"
    assert env[UPLOAD_PASSWORD_ENV] == "hunter2"


def test_build_child_env_is_unchanged_without_a_password() -> None:
    env = build_child_env(None, None)

    assert env == dict(os.environ)
    assert "SSH_ASKPASS" not in env
    assert "SSH_ASKPASS_REQUIRE" not in env


def test_redact_replaces_every_occurrence() -> None:
    assert redact("a hunter2 b hunter2", "hunter2") == "a *** b ***"
    assert redact("nothing to hide", None) == "nothing to hide"
    assert redact("nothing to hide", "") == "nothing to hide"


def test_password_auth_needs_a_detached_terminal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(webapp_upload.sys, "platform", "linux")

    with pytest.raises(WebappError) as raised:
        require_password_support(use_setsid=False)

    assert raised.value.code == "webapp-upload-credentials-missing"
    assert "--identity-file" in (raised.value.hint or "")
    assert "SSH_ASKPASS_REQUIRE" in (raised.value.hint or "")


@pytest.mark.parametrize(
    ("platform", "setsid"),
    [("linux", True), ("darwin", False)],
)
def test_password_auth_is_allowed_when_askpass_can_be_driven(
    monkeypatch: pytest.MonkeyPatch, platform: str, setsid: bool
) -> None:
    monkeypatch.setattr(webapp_upload.sys, "platform", platform)

    require_password_support(use_setsid=setsid)



def _full_listing(plan: UploadPlan, *, sizes: dict[str, int] | None = None) -> dict[str, int]:
    """Return the listing a successful upload produces, with optional size overrides."""

    overrides = sizes or {}
    return {item.remote: overrides.get(item.remote, item.size) for item in plan.files}


def test_verify_remote_accepts_a_full_match(tmp_path: Path) -> None:
    plan = _plan(_build(tmp_path))

    verify_remote(plan, _full_listing(plan))


def test_verify_remote_names_a_file_whose_size_differs(tmp_path: Path) -> None:
    plan = _plan(_build(tmp_path))
    listing = _full_listing(plan, sizes={f"{ROOT}/index.html": 1})

    with pytest.raises(WebappError) as raised:
        verify_remote(plan, listing)

    assert raised.value.code == "webapp-upload-verify-mismatch"
    assert f"{ROOT}/index.html" in str(raised.value)
    assert "0 of 5 files are missing" in str(raised.value)
    assert "1 differ in size" in str(raised.value)


def test_verify_remote_counts_missing_files_and_shows_ten(tmp_path: Path) -> None:
    plan = _plan(_build(tmp_path))
    listing = _full_listing(plan)
    for item in plan.files[:2]:
        del listing[item.remote]

    with pytest.raises(WebappError) as raised:
        verify_remote(plan, listing)

    message = str(raised.value)
    assert "2 of 5 files are missing" in message
    assert plan.files[0].remote in message
    assert plan.files[1].remote in message


def test_verify_remote_truncates_a_long_list_of_offenders(tmp_path: Path) -> None:
    files = tuple(_upload_file(f"{ROOT}/asset-{index}.js") for index in range(12))
    plan = UploadPlan(
        target=_target(),
        files=files,
        directories=(ROOT,),
        manifest_path=tmp_path / "webapp-build.json",
    )

    with pytest.raises(WebappError) as raised:
        verify_remote(plan, {})

    assert "12 of 12 files are missing" in str(raised.value)
    assert "(+2 more)" in str(raised.value)


def test_verify_public_is_skipped_without_a_public_url(tmp_path: Path) -> None:
    manifest = _manifest(_build(tmp_path))

    def fail(_url: str) -> Any:  # pragma: no cover - must not be called
        raise AssertionError("no public URL, so nothing may be fetched")

    assert verify_public(manifest, fail) is None


def test_verify_public_compares_the_served_version(tmp_path: Path) -> None:
    manifest = _manifest(_build(tmp_path, public_url="https://example.invalid/"))
    requested: list[str] = []

    def fetch(url: str) -> Any:
        requested.append(url)
        return {"version": "1.43.0"}

    assert verify_public(manifest, fetch) == "1.43.0"
    assert requested == ["https://example.invalid/html/version.json"]


def test_verify_public_reports_a_different_version_with_its_hint(tmp_path: Path) -> None:
    manifest = _manifest(_build(tmp_path, public_url="https://example.invalid/"))

    with pytest.raises(WebappError) as raised:
        verify_public(manifest, lambda _url: {"version": "1.42.0"})

    assert raised.value.code == "webapp-upload-version-mismatch"
    assert "1.42.0" in str(raised.value)
    assert "1.43.0" in str(raised.value)
    assert "cache" in (raised.value.hint or "")


def test_verify_public_reports_a_network_failure(tmp_path: Path) -> None:
    manifest = _manifest(_build(tmp_path, public_url="https://example.invalid/"))

    def fetch(_url: str) -> Any:
        raise OSError("Name or service not known")

    with pytest.raises(WebappError) as raised:
        verify_public(manifest, fetch)

    assert raised.value.code == "webapp-upload-verify-failed"
    assert "Name or service not known" in str(raised.value)



def test_dry_run_returns_the_plan_without_a_transport(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def explode(*_args: Any, **_kwargs: Any) -> Any:  # pragma: no cover - must not run
        raise AssertionError("a dry run must not start a process")

    monkeypatch.setattr(webapp_upload.sys, "platform", "linux")
    result = run_webapp_upload(
        source_dir=_build(tmp_path),
        target=_target(),
        password="hunter2",
        dry_run=True,
        run=explode,
        use_setsid=False,
    )

    assert result.dry_run is True
    assert result.file_count == 5
    assert result.byte_count == sum(item.size for item in result.plan.files)
    assert result.directories == 4
    assert result.pruned == ()
    assert result.verified is False
    assert result.checks == ("Dry run: nothing was transferred",)


def test_a_missing_manifest_names_the_directory(tmp_path: Path) -> None:
    with pytest.raises(WebappError) as raised:
        run_webapp_upload(source_dir=tmp_path, target=_target(), dry_run=True)

    assert raised.value.code == "webapp-upload-manifest-invalid"
    assert str(tmp_path) in str(raised.value)
    assert "mo webapp build" in (raised.value.hint or "")


def test_an_interrupted_transfer_carries_exit_code_130(tmp_path: Path) -> None:
    def interrupt(*_args: Any, **_kwargs: Any) -> Any:
        raise KeyboardInterrupt

    with pytest.raises(WebappError) as raised:
        run_webapp_upload(
            source_dir=_build(tmp_path), target=_target(), run=interrupt, use_setsid=False
        )

    error = raised.value
    assert error.code == "webapp-upload-interrupted"
    assert error.exit_code == 130
    assert "5 files were planned" in str(error)
    assert "index.html was not published" in str(error)


@pytest.fixture()
def fake_sftp(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Path]:
    """Put the fake ``sftp`` first on ``PATH`` and return its log and listing files."""

    log = tmp_path / "sftp.log"
    listing = tmp_path / "listing.txt"
    monkeypatch.setenv("PATH", f"{FAKE_BIN}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("FAKE_SFTP_LOG", str(log))
    monkeypatch.setenv("FAKE_SFTP_LISTING_FILE", str(listing))
    return {"log": log, "listing": listing}


def _write_listing(
    target_file: Path,
    plan: UploadPlan,
    *,
    sizes: dict[str, int] | None = None,
    extra: tuple[str, ...] = (),
) -> None:
    """Write the fake ``sftp`` listing: every planned file, plus *extra* stale paths."""

    overrides = sizes or {}
    lines = [
        f"{item.remote}|-rw-r--r-- 1 deploy deploy "
        f"{overrides.get(item.remote, item.size)} Nov 26 09:00 "
        f"{item.remote.rsplit('/', 1)[-1]}"
        for item in plan.files
    ]
    lines.extend(
        f"{path}|-rw-r--r-- 1 deploy deploy 4 Nov 26 09:00 {path.rsplit('/', 1)[-1]}"
        for path in extra
    )
    target_file.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _log_text(log: Path) -> str:
    """Return the fake ``sftp`` log, or an empty string when it was never invoked."""

    return log.read_text(encoding="utf-8") if log.exists() else ""


def _logged(log: Path, prefix: str) -> list[str]:
    """Return the logged batch lines starting with *prefix*, in order."""

    return [line for line in _log_text(log).splitlines() if line.startswith(prefix)]


def _remote_paths(lines: list[str]) -> list[str]:
    """Return the remote path of each logged ``put -p`` line."""

    return [line.rsplit('" "', 1)[-1].strip('"') for line in lines]


def test_upload_publishes_in_publication_order(
    tmp_path: Path, fake_sftp: dict[str, Path]
) -> None:
    result = run_webapp_upload(source_dir=_build(tmp_path), target=_target())

    assert _remote_paths(_logged(fake_sftp["log"], "put -p ")) == [
        f"{ROOT}/assets/main-abc123.js",
        f"{ROOT}/html/locales/en.json",
        f"{ROOT}/html/version.json",
        f"{ROOT}/webapp-build.json",
        f"{ROOT}/index.html",
    ]
    assert result.pruned == ()
    assert result.verified is False
    assert result.checks == ()


def test_upload_verifies_the_host_and_skips_the_missing_public_url(
    tmp_path: Path, fake_sftp: dict[str, Path]
) -> None:
    tree = _build(tmp_path)
    _write_listing(fake_sftp["listing"], _plan(tree))

    def fail(_url: str) -> Any:  # pragma: no cover - no public URL to fetch
        raise AssertionError("the build records no public URL")

    result = run_webapp_upload(
        source_dir=tree, target=_target(), verify=True, fetch_json=fail
    )

    assert result.verified is True
    assert result.checks == (
        "Files: 5 of 5 match the manifest",
        "Public version: skipped (no --public-url in the build)",
    )


def test_upload_verifies_the_public_version(
    tmp_path: Path, fake_sftp: dict[str, Path]
) -> None:
    tree = _build(tmp_path, public_url="https://example.invalid/")
    _write_listing(fake_sftp["listing"], _plan(tree))

    result = run_webapp_upload(
        source_dir=tree,
        target=_target(),
        verify=True,
        fetch_json=lambda _url: {"version": "1.43.0"},
    )

    assert result.verified is True
    assert "Public version: 1.43.0 (matches the manifest)" in result.checks


def test_upload_verification_names_a_size_that_does_not_match(
    tmp_path: Path, fake_sftp: dict[str, Path]
) -> None:
    tree = _build(tmp_path)
    _write_listing(
        fake_sftp["listing"], _plan(tree), sizes={f"{ROOT}/index.html": 3}
    )

    with pytest.raises(WebappError) as raised:
        run_webapp_upload(source_dir=tree, target=_target(), verify=True)

    assert raised.value.code == "webapp-upload-verify-mismatch"
    assert f"{ROOT}/index.html" in str(raised.value)



def test_a_connect_failure_is_coded_and_quoted(
    tmp_path: Path, fake_sftp: dict[str, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FAKE_SFTP_EXIT", "255")
    monkeypatch.setenv("FAKE_SFTP_STDERR", "deploy@example.invalid: Permission denied (publickey).")

    with pytest.raises(WebappError) as raised:
        run_webapp_upload(source_dir=_build(tmp_path), target=_target())

    assert raised.value.code == "webapp-upload-connect-failed"
    assert raised.value.exit_code == 1
    assert "Permission denied (publickey)." in str(raised.value)


def test_prune_removes_exactly_the_files_the_manifest_does_not_list(
    tmp_path: Path, fake_sftp: dict[str, Path]
) -> None:
    tree = _build(tmp_path)
    _write_listing(
        fake_sftp["listing"],
        _plan(tree),
        extra=(f"{ROOT}/old.html", f"{ROOT}/assets/stale.js"),
    )

    result = run_webapp_upload(
        source_dir=tree, target=_target(), prune=True, assume_yes=True
    )

    assert result.pruned == (f"{ROOT}/assets/stale.js", f"{ROOT}/old.html")
    assert result.checks == ("Prune: removed 2 stale files",)
    assert _logged(fake_sftp["log"], "-rm ") == [
        f'-rm "{ROOT}/assets/stale.js"',
        f'-rm "{ROOT}/old.html"',
    ]
    text = _log_text(fake_sftp["log"])
    assert text.rindex("put -p ") < text.index("-rm ")


def test_prune_can_be_declined(tmp_path: Path, fake_sftp: dict[str, Path]) -> None:
    tree = _build(tmp_path)
    _write_listing(fake_sftp["listing"], _plan(tree), extra=(f"{ROOT}/old.html",))
    asked: list[str] = []

    def decline(question: str) -> bool:
        asked.append(question)
        return False

    result = run_webapp_upload(source_dir=tree, target=_target(), prune=True, confirm=decline)

    assert asked == ["Delete 1 stale remote file(s)?"]
    assert result.pruned == ()
    assert result.checks == ("Prune: 1 stale files kept (needs --yes or a confirmation)",)
    assert _logged(fake_sftp["log"], "-rm ") == []


def test_prune_without_a_confirmation_keeps_the_files(
    tmp_path: Path, fake_sftp: dict[str, Path]
) -> None:
    tree = _build(tmp_path)
    _write_listing(fake_sftp["listing"], _plan(tree), extra=(f"{ROOT}/old.html",))

    result = run_webapp_upload(source_dir=tree, target=_target(), prune=True)

    assert result.pruned == ()
    assert "stale files kept" in result.checks[0]
    assert _logged(fake_sftp["log"], "-rm ") == []


def test_prune_refuses_to_remove_the_version_document(
    tmp_path: Path, fake_sftp: dict[str, Path]
) -> None:
    tree = _build(tmp_path)
    document = _manifest(tree)
    document["files"] = [
        entry for entry in document["files"] if entry["path"] != "html/version.json"
    ]
    webapp_manifest.write_manifest(tree, document)
    _write_listing(
        fake_sftp["listing"], _plan(tree), extra=(f"{ROOT}/html/version.json",)
    )

    with pytest.raises(WebappError) as raised:
        run_webapp_upload(
            source_dir=tree, target=_target(), prune=True, assume_yes=True
        )

    assert raised.value.code == "webapp-upload-prune-unsafe"
    assert "html/version.json" in str(raised.value)
    assert _logged(fake_sftp["log"], "put -p ") == []


def test_a_dry_run_never_invokes_the_transport(
    tmp_path: Path, fake_sftp: dict[str, Path]
) -> None:
    result = run_webapp_upload(source_dir=_build(tmp_path), target=_target(), dry_run=True)

    assert result.dry_run is True
    assert fake_sftp["log"].exists() is False


def test_the_password_never_reaches_a_message(
    tmp_path: Path, fake_sftp: dict[str, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FAKE_SFTP_EXIT", "255")
    monkeypatch.setenv("FAKE_SFTP_STDERR", "password hunter2 rejected")
    # Forcing the macOS branch keeps the test independent of whether `setsid` is installed; the
    # fake `sftp` is then spawned directly, and it records the environment it received.
    monkeypatch.setattr(webapp_upload.sys, "platform", "darwin")

    with pytest.raises(WebappError) as raised:
        run_webapp_upload(
            source_dir=_build(tmp_path), target=_target(), password="hunter2"
        )

    assert "hunter2" not in str(raised.value)
    assert "*** rejected" in str(raised.value)
    assert "PASSWORD hunter2" in _log_text(fake_sftp["log"])


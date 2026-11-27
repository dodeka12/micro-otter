"""``mo webapp upload``: publish a built hosted bundle to any SFTP host.

The transfer is described first, then executed. :func:`plan_upload` turns the manifest of
:mod:`micro_otter.tools.webapp_manifest` into an :class:`UploadPlan` — every file with its absolute
local path, its remote path and its size, plus the remote directories it needs — and
:func:`sort_for_publication` fixes the order of that plan so an interrupted transfer can never leave
a site pointing at assets that are not there:

    assets (sorted) → ``html/version.json`` → ``webapp-build.json`` → ``index.html``

``index.html`` is the file a visitor loads first and ``html/version.json`` is the document a
verification step reads, so both are published last. ``webapp-build.json`` ships too: it tells a
future operator which build is live, and because it is second-to-last it never describes a tree that
is not there yet.

The plan is executed by the system ``sftp`` client through one batch file per pass, behind a
transport seam (:func:`run_sftp`) that a test replaces. No Python dependency is added and no
credential is stored: host, user, path, key and known-hosts arrive as flags or
``MICRO_OTTER_UPLOAD_*`` variables, and the password reaches ``sftp`` only through an askpass script
inside a temporary directory (see :func:`write_askpass`), never through an argv, a log line or a
``--json`` payload. ``micro-otter.toml`` is tracked in git, which is why it is never read for
credentials (locked decision 6).

Failures carry stable codes, all prefixed ``webapp-upload-``:

=============================  =====================================================
Code                           Raised when
=============================  =====================================================
``target-invalid``             host, user or remote path missing or unusable
``source-invalid``             the build output is missing, stale or escaping
``manifest-invalid``           ``webapp-build.json`` is absent or not a valid build
``prune-unsafe``               pruning would remove ``index.html``/``version.json``
``sftp-missing``               no ``sftp`` on ``PATH`` (OpenSSH client required)
``credentials-missing``        password auth cannot be driven without a terminal
``connect-failed``             ``sftp`` exited ``255`` (connection/auth failure)
``put-failed``                 ``sftp`` exited non-zero for any other reason
``verify-mismatch``            the host does not hold the files the manifest lists
``version-mismatch``           the public URL serves a different ``version.json``
``verify-failed``              the public URL could not be read at all
``interrupted``                Ctrl-C during the transfer (exit code ``130``)
=============================  =====================================================
"""

from __future__ import annotations

import json
import os
import posixpath
import re
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib import request as urllib_request

from micro_otter.tools import webapp_manifest
from micro_otter.tools.webapp_errors import WebappError

UPLOAD_HOST_ENV = "MICRO_OTTER_UPLOAD_HOST"
"""Environment variable naming the SFTP host."""

UPLOAD_USER_ENV = "MICRO_OTTER_UPLOAD_USER"
"""Environment variable naming the SFTP user."""

UPLOAD_PATH_ENV = "MICRO_OTTER_UPLOAD_PATH"
"""Environment variable naming the absolute remote directory to publish into."""

UPLOAD_PORT_ENV = "MICRO_OTTER_UPLOAD_PORT"
"""Environment variable naming the SSH port when ``--port`` is absent."""

UPLOAD_IDENTITY_FILE_ENV = "MICRO_OTTER_UPLOAD_IDENTITY_FILE"
"""Environment variable naming the private key for publickey auth."""

UPLOAD_PASSWORD_ENV = "MICRO_OTTER_UPLOAD_PASSWORD"
"""Environment variable holding the SFTP password; the only place it may be supplied."""

UPLOAD_KNOWN_HOSTS_ENV = "MICRO_OTTER_UPLOAD_KNOWN_HOSTS"
"""Environment variable naming a ``known_hosts`` file to pin the host key against."""

DEFAULT_PORT = 22
"""SSH port used when neither ``--port`` nor ``MICRO_OTTER_UPLOAD_PORT`` says otherwise."""

INDEX_FILE = "index.html"
"""The entry point a visitor loads; always published last."""

VERSION_FILE = "html/version.json"
"""The version document ``--verify`` reads; always published second-to-last."""

PRUNE_FORBIDDEN: tuple[str, ...] = (INDEX_FILE, VERSION_FILE)
"""Relative paths ``--prune`` refuses to remove: a live site needs both."""

SFTP_TIMEOUT_SECONDS = 600
"""Wall-clock budget for one ``sftp`` invocation."""

PUBLIC_FETCH_TIMEOUT_SECONDS = 15
"""Timeout of the single HTTP GET ``--verify`` performs against the public URL."""

ASKPASS_REQUIRE_SUPPORTED_PLATFORMS = ("darwin",)
"""Platforms whose ``ssh`` drives ``SSH_ASKPASS`` without ``setsid`` (macOS has no ``setsid``)."""

_ASKPASS_SCRIPT = '#!/bin/sh\nprintf \'%s\\n\' "$MICRO_OTTER_UPLOAD_PASSWORD"\n'
"""Body of the generated askpass helper: the password and nothing else."""

_UNSAFE_QUOTED_CHARACTERS = ('"', "\n", "\r", "\0")
"""Characters a quoted ``sftp`` argument cannot survive, so a path holding one is refused."""

_LISTING_PATTERN = re.compile(
    r"^(?P<mode>[-dlbcps])(?P<permissions>[-rwxstST]{9})[.+@]?\s+\d+\s+\S+\s+\S+\s+"
    r"(?P<size>\d+)\s+(?P<month>[A-Z][a-z]{2})\s+\d{1,2}\s+"
    r"(?P<stamp>\d{1,2}:\d{2}|\d{4})\s+(?P<name>.+?)\s*$"
)
"""One ``ls -l`` line; anything that does not match is ignored rather than guessed at."""



@dataclass(frozen=True)
class UploadTarget:
    """Where a publication goes and how to authenticate against it."""

    host: str
    """Host name or address of the SFTP server."""

    user: str
    """User to authenticate as."""

    remote_path: str
    """Absolute remote directory the bundle is published into, normalised."""

    port: int = DEFAULT_PORT
    """SSH port."""

    identity_file: Path | None = None
    """Private key for publickey auth; ``None`` lets OpenSSH pick from its defaults."""

    known_hosts: Path | None = None
    """``known_hosts`` file to pin the host key against; ``None`` keeps OpenSSH's default."""

    accept_new_host_key: bool = False
    """Whether an unknown host key may be accepted (``StrictHostKeyChecking=accept-new``)."""

    def __post_init__(self) -> None:
        """Normalise the remote path and reject an unusable target.

        Raises:
            WebappError: ``webapp-upload-target-invalid`` for an empty host or user, an
                out-of-range port, or a remote path that is not an absolute normalised directory.
        """

        for name, value in (("host", self.host), ("user", self.user)):
            if not value.strip():
                raise _fail(
                    "webapp-upload-target-invalid",
                    f"the SFTP {name} is empty",
                    f"pass --{name} or set "
                    f"{UPLOAD_HOST_ENV if name == 'host' else UPLOAD_USER_ENV}",
                )
        if not 1 <= self.port <= 65535:
            raise _fail(
                "webapp-upload-target-invalid",
                f"port {self.port} is outside 1-65535",
                f"pass --port or set {UPLOAD_PORT_ENV}",
            )
        object.__setattr__(self, "remote_path", normalise_remote_path(self.remote_path))

    @property
    def destination(self) -> str:
        """Return the ``user@host`` argument handed to ``sftp``."""

        return f"{self.user}@{self.host}"


def normalise_remote_path(value: str) -> str:
    """Return *value* as an absolute remote directory without a trailing separator.

    The path is used verbatim in the ``sftp`` batch, so it has to be normalised already: it must
    start with ``/``, name at least one directory, and hold no empty, ``.`` or ``..`` segment.

    Raises:
        WebappError: ``webapp-upload-target-invalid`` when the path cannot be used as given.
    """

    hint = "give an absolute directory such as `/www/example/`"
    raw = value.strip()
    if not raw:
        raise _fail(
            "webapp-upload-target-invalid",
            "the remote path is empty",
            f"{hint}, or set {UPLOAD_PATH_ENV}",
        )
    if not raw.startswith("/"):
        raise _fail(
            "webapp-upload-target-invalid",
            f"the remote path {value!r} is relative",
            hint,
        )
    # A trailing separator is what people paste from a browser, so it is the one thing normalised
    # away here; everything else has to be right already, because the path is used verbatim.
    trimmed = raw.rstrip("/")
    if not trimmed:
        raise _fail(
            "webapp-upload-target-invalid",
            f"the remote path {value!r} is the server root",
            f"{hint}; publishing into `/` would let `--prune` delete the server root",
        )
    segments = trimmed.split("/")[1:]
    for segment in segments:
        if segment in ("", ".", ".."):
            raise _fail(
                "webapp-upload-target-invalid",
                f"the remote path {value!r} holds an empty, `.` or `..` segment",
                hint,
            )
    return trimmed


@dataclass(frozen=True)
class UploadFile:
    """One file of a publication."""

    local: Path
    """Absolute path of the file on this machine."""

    remote: str
    """Absolute path of the file on the host."""

    size: int
    """Size in bytes, as recorded by the manifest."""

    sha256: str
    """SHA-256 of the file, as recorded by the manifest."""


@dataclass(frozen=True)
class UploadPlan:
    """Everything a publication decides: what goes where, in which order."""

    target: UploadTarget
    """Host, user and directory the plan publishes into."""

    files: tuple[UploadFile, ...]
    """Files in publication order; the last entry is always ``index.html``."""

    directories: tuple[str, ...]
    """Remote directories the files need, parents first, including the target root."""

    manifest_path: Path
    """Absolute path of the ``webapp-build.json`` the plan was derived from."""


def _fail(code: str, message: str, hint: str, *, exit_code: int = 1) -> WebappError:
    """Return an upload failure carrying *code*, *message*, *hint* and an exit code."""

    return WebappError(code, message, hint=hint, exit_code=exit_code)


def _source_error(message: str, hint: str) -> WebappError:
    """Return a ``webapp-upload-source-invalid`` failure about the build output."""

    return _fail("webapp-upload-source-invalid", message, hint)


def redact(text: str, secret: str | None) -> str:
    """Return *text* with every occurrence of *secret* replaced by ``***``.

    Applied to the ``sftp`` diagnostics, to the ``--json`` payload and to every message the CLI
    prints, so a password can never reach a log, a terminal or a CI transcript.
    """

    if not secret:
        return text
    return text.replace(secret, "***")


def _quote(path: str, *, code: str) -> str:
    """Return *path* quoted for an ``sftp`` batch line.

    Args:
        path: Absolute local (native) or remote (POSIX) path.
        code: Failure code to raise when the path cannot be quoted safely.

    Raises:
        WebappError: *code* when the path holds ``"``, a newline, a carriage return or NUL — any
            of which would rewrite the batch instead of naming a file.
    """

    for character in _UNSAFE_QUOTED_CHARACTERS:
        if character in path:
            raise _fail(
                code,
                f"the path {path!r} contains {character!r}, which an sftp batch cannot quote",
                "rename the file or directory so it holds no quote and no newline",
            )
    return f'"{path}"'


def _remote_join(root: str, relative: str) -> str:
    """Return the remote path of *relative* inside *root*, always POSIX."""

    return posixpath.join(root, relative)


def _relative_to_root(remote: str, root: str) -> str:
    """Return *remote* relative to *root* as a POSIX path."""

    return posixpath.relpath(remote, root)


def sort_for_publication(files: Sequence[UploadFile], *, root: str) -> tuple[UploadFile, ...]:
    """Order *files* so a failed transfer cannot leave a broken site behind.

    Hashed assets and everything else keep their sorted order first, then ``html/version.json``,
    then ``webapp-build.json``, then ``index.html``. *root* is the remote directory the plan
    publishes into, which is what makes the three hoisted names unambiguous.
    """

    hoisted = (VERSION_FILE, webapp_manifest.MANIFEST_NAME, INDEX_FILE)
    assets = sorted(
        (item for item in files if _relative_to_root(item.remote, root) not in hoisted),
        key=lambda item: item.remote,
    )
    tail = [
        item
        for name in hoisted
        for item in files
        if _relative_to_root(item.remote, root) == name
    ]
    return (*assets, *tail)


def plan_directories(root: str, remotes: Sequence[str]) -> tuple[str, ...]:
    """Return every remote directory *remotes* need, parents first, including *root*."""

    wanted = {root}
    for remote in remotes:
        parent = posixpath.dirname(remote)
        while parent.startswith(root) and parent not in wanted:
            wanted.add(parent)
            if parent == root:
                break
            parent = posixpath.dirname(parent)
    return tuple(sorted(wanted, key=lambda path: (path.count("/"), path)))



def plan_upload(
    source_dir: Path,
    manifest: Mapping[str, Any],
    target: UploadTarget,
) -> UploadPlan:
    """Describe the transfer of *source_dir* to *target* from *manifest*.

    The manifest is validated again here, so a caller can never plan a tree the build would not
    have written. Every listed file is resolved under *source_dir* (a path that escapes it, a
    missing file or a file whose size no longer matches is refused), and ``webapp-build.json`` is
    added to the publication because it tells an operator which build is live.

    Args:
        source_dir: Build output directory holding ``webapp-build.json``.
        manifest: A ``webapp-build/v1`` document, typically from
            :func:`micro_otter.tools.webapp_manifest.read_manifest`.
        target: Host, user and remote directory to publish into.

    Returns:
        The plan, with :func:`sort_for_publication`'s order applied.

    Raises:
        WebappError: ``webapp-upload-manifest-invalid`` for an unusable manifest and
            ``webapp-upload-source-invalid`` for a missing, stale or escaping file.
    """

    webapp_manifest.validate_manifest(manifest)
    source = source_dir.resolve()
    if not source.is_dir():
        raise _source_error(
            f"{source_dir} is not a directory",
            "run `mo webapp build` first, or pass --source",
        )

    planned: list[UploadFile] = []
    for entry in manifest["files"]:
        relative = entry["path"]
        local = (source / relative).resolve()
        if not local.is_relative_to(source):
            raise _source_error(
                f"the manifest path {relative!r} resolves outside {source}",
                "rebuild with `mo webapp build`",
            )
        if not local.is_file():
            raise _source_error(
                f"{local} is listed in the manifest but does not exist",
                "rebuild with `mo webapp build`",
            )
        size = local.stat().st_size
        if size != entry["size"]:
            raise _source_error(
                f"{local} is {size} bytes but the manifest lists {entry['size']}",
                "rebuild with `mo webapp build`",
            )
        planned.append(
            UploadFile(
                local=local,
                remote=_remote_join(target.remote_path, relative),
                size=size,
                sha256=entry["sha256"],
            )
        )

    if INDEX_FILE not in {entry["path"] for entry in manifest["files"]}:
        raise _source_error(
            f"the manifest lists no {INDEX_FILE}",
            "rebuild with `mo webapp build`; a publication without index.html is not a site",
        )

    manifest_local = source / webapp_manifest.MANIFEST_NAME
    if not manifest_local.is_file():
        raise _source_error(
            f"{manifest_local} does not exist",
            "run `mo webapp build` first; it writes webapp-build.json last",
        )
    planned.append(
        UploadFile(
            local=manifest_local.resolve(),
            remote=_remote_join(target.remote_path, webapp_manifest.MANIFEST_NAME),
            size=manifest_local.stat().st_size,
            sha256=webapp_manifest.sha256_file(manifest_local),
        )
    )

    files = sort_for_publication(planned, root=target.remote_path)
    return UploadPlan(
        target=target,
        files=files,
        directories=plan_directories(target.remote_path, [item.remote for item in files]),
        manifest_path=manifest_local.resolve(),
    )


def prune_candidates(plan: UploadPlan, remote_files: Mapping[str, int]) -> tuple[str, ...]:
    """Return the remote paths under the plan's root that the plan does not publish.

    *remote_files* maps absolute remote paths to the size the host reports. Only names the host
    shows can be candidates — nothing is guessed — and the caller decides whether to act on them.
    """

    planned = {item.remote for item in plan.files}
    return tuple(
        sorted(
            path
            for path in remote_files
            if path not in planned and path.startswith(plan.target.remote_path + "/")
        )
    )



@dataclass(frozen=True)
class UploadResult:
    """What one ``mo webapp upload`` did.

    Credentials and the raw remote listing are deliberately absent: this object is what the CLI
    renders and what ``--json-output`` serialises, so it must be safe to print anywhere.
    """

    file_count: int
    """Number of files the plan published (including ``webapp-build.json``)."""

    byte_count: int
    """Total size of those files in bytes."""

    directories: int
    """Number of remote directories the plan creates or reuses."""

    pruned: tuple[str, ...]
    """Remote paths that were removed after a successful transfer."""

    verified: bool
    """Whether the post-upload checks ran and passed."""

    dry_run: bool
    """Whether nothing was transferred because ``--dry-run`` was passed."""

    manifest_path: Path
    """Absolute path of the manifest the plan was derived from."""

    plan: UploadPlan
    """The publication itself, so the CLI can print it without rebuilding it."""

    checks: tuple[str, ...] = ()
    """Human-readable outcome of the prune and verify phases, in that order."""


def render_sftp_batch(plan: UploadPlan, *, prune: Sequence[str] = ()) -> str:
    """Render the ``sftp -b`` batch that publishes *plan*.

    Every directory is created first (the leading ``-`` makes an existing directory a non-error,
    the only tolerated failure in the batch), then every file is ``put -p`` in plan order, then the
    ``prune`` candidates are removed. The result ends with a newline and holds no blank line.

    Args:
        plan: The publication to render.
        prune: Absolute remote paths to delete after the transfer.

    Raises:
        WebappError: ``webapp-upload-target-invalid``/``webapp-upload-source-invalid`` for a path an
            ``sftp`` batch cannot quote safely.
    """

    remote_code = "webapp-upload-target-invalid"
    lines = [
        f"-mkdir {_quote(directory, code=remote_code)}" for directory in plan.directories
    ]
    lines.extend(
        f"put -p {_quote(str(item.local), code='webapp-upload-source-invalid')} "
        f"{_quote(item.remote, code=remote_code)}"
        for item in plan.files
    )
    lines.extend(f"-rm {_quote(path, code=remote_code)}" for path in prune)
    return "\n".join(lines) + "\n"


def render_listing_batch(directory: str) -> str:
    """Render the one-line batch that lists a single remote directory.

    One listing per invocation is deliberate: ``sftp`` prints a directory listing without naming
    the directory it came from, so a single batch over several directories could not be attributed
    back to them.
    """

    return f"-ls -l {_quote(directory, code='webapp-upload-target-invalid')}\n"


def build_sftp_argv(plan: UploadPlan, *, batch_file: Path, password: bool) -> list[str]:
    """Return the ``sftp`` argv for *plan*, reading its commands from *batch_file*.

    Key auth is the default (``BatchMode=yes`` plus ``publickey``); ``password`` switches to
    password auth, which the caller must drive through an askpass helper. An unknown host key is
    only accepted when the target says so.

    Args:
        plan: The publication being transferred.
        batch_file: File holding :func:`render_sftp_batch`'s output.
        password: Whether to authenticate with a password instead of a key.
    """

    target = plan.target
    argv = [
        "sftp",
        "-q",
        "-b",
        str(batch_file),
        "-P",
        str(target.port),
        "-o",
        "ConnectTimeout=20",
    ]
    if password:
        argv += [
            "-o",
            "PreferredAuthentications=password",
            "-o",
            "PubkeyAuthentication=no",
            "-o",
            "NumberOfPasswordPrompts=1",
        ]
    else:
        argv += ["-o", "BatchMode=yes", "-o", "PreferredAuthentications=publickey"]
        if target.identity_file is not None:
            argv += ["-i", str(target.identity_file)]
    if target.known_hosts is not None:
        argv += ["-o", f"UserKnownHostsFile={target.known_hosts}"]
    if target.accept_new_host_key:
        argv += ["-o", "StrictHostKeyChecking=accept-new"]
    argv.append(target.destination)
    return argv


def _use_setsid(use_setsid: bool | None) -> bool:
    """Return whether ``setsid`` is available, unless the caller decided it already."""

    if use_setsid is not None:
        return use_setsid
    return shutil.which("setsid") is not None
def run_sftp(
    *,
    plan: UploadPlan,
    batch_text: str,
    password: bool,
    env: Mapping[str, str] | None = None,
    secret: str | None = None,
    timeout: int = SFTP_TIMEOUT_SECONDS,
    run: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
    use_setsid: bool | None = None,
) -> subprocess.CompletedProcess[str]:
    """Run the system ``sftp`` over *batch_text* and return the completed process.

    The batch is written to a ``0o600`` file inside a temporary directory that is removed
    afterwards, so no leftover file describes the transfer. In password mode the call is detached
    with ``setsid`` when it is available, which is what lets OpenSSH reach the askpass helper
    instead of the terminal.

    Args:
        plan: The publication the batch describes.
        batch_text: Output of :func:`render_sftp_batch` or :func:`render_listing_batch`.
        password: Whether the run authenticates with a password.
        env: Child environment; defaults to the process environment.
        secret: Value to redact from every diagnostic this function reports.
        timeout: Seconds ``sftp`` may run.
        run: ``subprocess.run``-compatible callable, injected by tests.
        use_setsid: Force the ``setsid`` decision; defaults to "use it when installed".

    Returns:
        The completed process, successful by definition (a failure is raised).

    Raises:
        WebappError: ``webapp-upload-sftp-missing`` when no client is installed,
            ``webapp-upload-connect-failed`` for exit ``255`` or a timeout, and
            ``webapp-upload-put-failed`` for any other non-zero exit.
    """

    if shutil.which("sftp") is None:
        raise _fail(
            "webapp-upload-sftp-missing",
            "sftp was not found on PATH",
            "install the OpenSSH client, which provides `sftp`",
        )

    temp_dir = Path(tempfile.mkdtemp(prefix="micro-otter-webapp-upload-"))
    try:
        batch_file = temp_dir / "upload.batch"
        batch_file.write_text(batch_text, encoding="utf-8")
        batch_file.chmod(0o600)
        argv = build_sftp_argv(plan, batch_file=batch_file, password=password)
        if password and _use_setsid(use_setsid):
            argv = ["setsid", *argv]
        try:
            completed = run(
                argv,
                env=dict(env) if env is not None else dict(os.environ),
                capture_output=True,
                text=True,
                check=False,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired as error:
            raise _fail(
                "webapp-upload-connect-failed",
                f"sftp did not finish within {timeout} seconds",
                "check the connection and re-run the upload",
            ) from error
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

    if completed.returncode == 0:
        return completed

    diagnostics = redact((completed.stderr or "").strip(), secret) or "no diagnostics"
    if completed.returncode == 255:
        raise _fail(
            "webapp-upload-connect-failed",
            f"sftp could not connect to {plan.target.destination}: {diagnostics}",
            "check --host, --user, --port and the host key; "
            "pass --known-hosts to pin it or --accept-new-host-key for a new host",
        )
    raise _fail(
        "webapp-upload-put-failed",
        f"sftp exited with code {completed.returncode} while uploading to "
        f"{plan.target.destination}: {diagnostics}",
        "re-run the upload; files already in place are overwritten",
    )


def parse_remote_listing(text: str) -> dict[str, int]:
    """Parse ``ls -l`` output into ``{name: size}``.

    Lines that are not regular files (directories, symlinks, devices, unparseable diagnostics) and
    the ``.``/``..`` entries are dropped: the caller compares only what it can see and never
    guesses a size.
    """

    listing: dict[str, int] = {}
    for line in text.splitlines():
        match = _LISTING_PATTERN.match(line)
        if match is None or match.group("mode") in ("d", "l"):
            continue
        name = match.group("name")
        if name in (".", ".."):
            continue
        listing[name] = int(match.group("size"))
    return listing


def list_remote(
    plan: UploadPlan,
    *,
    password: bool,
    env: Mapping[str, str] | None = None,
    secret: str | None = None,
    run: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
    use_setsid: bool | None = None,
) -> dict[str, int]:
    """Return ``{absolute remote path: size}`` for every directory *plan* uses.

    Each directory is listed in its own ``sftp`` invocation so the printed names stay attributable
    to it. A directory that does not exist yet is not an error: ``-ls`` tolerates it.
    """

    listing: dict[str, int] = {}
    for directory in plan.directories:
        completed = run_sftp(
            plan=plan,
            batch_text=render_listing_batch(directory),
            password=password,
            env=env,
            secret=secret,
            run=run,
            use_setsid=use_setsid,
        )
        for name, size in parse_remote_listing(completed.stdout or "").items():
            listing[_remote_join(directory, name)] = size
    return listing


    if use_setsid is not None:
        return use_setsid
    return shutil.which("setsid") is not None



def _environment_value(name: str) -> str | None:
    """Return *name* from the environment, or ``None`` when it is unset or blank."""

    value = os.environ.get(name, "").strip()
    return value or None


def _path_value(value: Path | None, name: str) -> Path | None:
    """Return the flag value, else the path in *name*, expanded for ``~``."""

    if value is not None:
        return value
    from_env = _environment_value(name)
    return Path(from_env).expanduser() if from_env is not None else None


def resolve_target(
    *,
    host: str | None,
    user: str | None,
    remote_path: str | None,
    port: int | None,
    identity_file: Path | None,
    known_hosts: Path | None,
    accept_new_host_key: bool,
) -> UploadTarget:
    """Return the :class:`UploadTarget` a flag, ``MICRO_OTTER_UPLOAD_*`` or a default describes.

    The precedence is flag → environment → default, and a missing required value names itself
    instead of failing generically. Nothing is read from ``micro-otter.toml``: the file is tracked
    in git, so it can never hold a credential (locked decision 6).

    Raises:
        WebappError: ``webapp-upload-target-invalid`` naming the value that is missing or unusable.
    """

    resolved_host = (host or "").strip() or _environment_value(UPLOAD_HOST_ENV)
    if not resolved_host:
        raise _fail(
            "webapp-upload-target-invalid",
            "no SFTP host given",
            f"pass --host or set {UPLOAD_HOST_ENV}",
        )
    resolved_user = (user or "").strip() or _environment_value(UPLOAD_USER_ENV)
    if not resolved_user:
        raise _fail(
            "webapp-upload-target-invalid",
            "no SFTP user given",
            f"pass --user or set {UPLOAD_USER_ENV}",
        )
    resolved_path = (remote_path or "").strip() or _environment_value(UPLOAD_PATH_ENV)
    if not resolved_path:
        raise _fail(
            "webapp-upload-target-invalid",
            "no remote path given",
            f"pass --remote-path or set {UPLOAD_PATH_ENV}, "
            "for example --remote-path /www/example",
        )

    resolved_port = port
    if resolved_port is None:
        raw_port = _environment_value(UPLOAD_PORT_ENV)
        if raw_port is not None:
            try:
                resolved_port = int(raw_port)
            except ValueError as error:
                raise _fail(
                    "webapp-upload-target-invalid",
                    f"{UPLOAD_PORT_ENV}={raw_port!r} is not a port number",
                    f"set {UPLOAD_PORT_ENV} to a number between 1 and 65535",
                ) from error

    return UploadTarget(
        host=resolved_host,
        user=resolved_user,
        remote_path=resolved_path,
        port=DEFAULT_PORT if resolved_port is None else resolved_port,
        identity_file=_path_value(identity_file, UPLOAD_IDENTITY_FILE_ENV),
        known_hosts=_path_value(known_hosts, UPLOAD_KNOWN_HOSTS_ENV),
        accept_new_host_key=accept_new_host_key,
    )


def write_askpass(directory: Path) -> Path:
    """Write the ``0o700`` askpass helper into *directory* and return its path.

    OpenSSH runs the helper instead of prompting the terminal; it prints the password from
    ``MICRO_OTTER_UPLOAD_PASSWORD`` and nothing else, which is why the password only ever lives in
    the child environment of one ``sftp`` call.
    """

    path = directory / "askpass.sh"
    path.write_text(_ASKPASS_SCRIPT, encoding="utf-8")
    path.chmod(0o700)
    return path


def build_child_env(password: str | None, askpass: Path | None) -> dict[str, str]:
    """Return the environment handed to ``sftp``.

    With a password it carries ``SSH_ASKPASS``, ``SSH_ASKPASS_REQUIRE=force`` (OpenSSH 8.4+) and
    the password itself, which the helper script reads. Without one it is the process environment
    unchanged, so key and agent auth behave exactly as in a normal ``ssh`` session.
    """

    env = dict(os.environ)
    if password and askpass is not None:
        env["SSH_ASKPASS"] = str(askpass)
        env["SSH_ASKPASS_REQUIRE"] = "force"
        env[UPLOAD_PASSWORD_ENV] = password
    return env


def require_password_support(*, use_setsid: bool | None = None) -> None:
    """Require a way to answer OpenSSH's password prompt without a terminal.

    ``sftp -b`` never reads the terminal, so a password only works through ``SSH_ASKPASS``; the
    helper has to survive the caller's terminal going away, which is what ``setsid`` provides.
    macOS drives askpass without it, so that platform is exempt.

    Raises:
        WebappError: ``webapp-upload-credentials-missing`` when the helper could not be detached.
    """

    if sys.platform in ASKPASS_REQUIRE_SUPPORTED_PLATFORMS:
        return
    if _use_setsid(use_setsid):
        return
    raise _fail(
        "webapp-upload-credentials-missing",
        "password authentication needs an askpass helper detached from the terminal, and `setsid` "
        "is not installed",
        "use key auth (--identity-file or MICRO_OTTER_UPLOAD_IDENTITY_FILE); the batch mode used "
        "here needs SSH_ASKPASS_REQUIRE=force from OpenSSH 8.4 or newer for a password to work",
    )



def _first_paths(paths: Sequence[str], limit: int = 10) -> str:
    """Return up to *limit* paths as one comma-separated string, noting what was left out."""

    shown = ", ".join(paths[:limit])
    if len(paths) <= limit:
        return shown
    return f"{shown} (+{len(paths) - limit} more)"


def verify_remote(plan: UploadPlan, listing: Mapping[str, int]) -> None:
    """Check that every planned file exists on the host with the size the manifest records.

    Args:
        plan: The publication that was just transferred.
        listing: ``{absolute remote path: size}`` as :func:`list_remote` reports it.

    Raises:
        WebappError: ``webapp-upload-verify-mismatch`` naming the first ten offending paths and the
            two counts.
    """

    missing = [item.remote for item in plan.files if item.remote not in listing]
    differing = [
        item.remote
        for item in plan.files
        if item.remote in listing and listing[item.remote] != item.size
    ]
    if not missing and not differing:
        return
    offenders = _first_paths([*missing, *differing])
    raise _fail(
        "webapp-upload-verify-mismatch",
        f"{len(missing)} of {len(plan.files)} files are missing and {len(differing)} differ in "
        f"size on {plan.target.destination}: {offenders}",
        "re-run the upload; if it keeps failing check the remote quota and the target directory",
    )


def _fetch_json_url(url: str) -> Any:
    """Fetch *url* and return its JSON body.

    The one HTTP call this module makes outside ``sftp``; it uses ``urllib`` only, so no dependency
    is added. Injected in tests so no test touches the network.
    """

    with urllib_request.urlopen(url, timeout=PUBLIC_FETCH_TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8"))


def verify_public(
    manifest: Mapping[str, Any],
    fetch_json: Callable[[str], Any] | None = None,
) -> str | None:
    """Compare the public ``html/version.json`` with the manifest.

    Args:
        manifest: The ``webapp-build/v1`` document that was published.
        fetch_json: Callable returning the decoded JSON body of a URL; defaults to
            :func:`_fetch_json_url`.

    Returns:
        The served version, or ``None`` when the build records no ``publicUrl`` (nothing to check,
        and no guess about where the site might be).

    Raises:
        WebappError: ``webapp-upload-version-mismatch`` when the served version is not the built
            one, ``webapp-upload-verify-failed`` when the URL cannot be read at all.
    """

    public_url = manifest.get("publicUrl")
    if not isinstance(public_url, str) or not public_url.strip():
        return None
    url = public_url.strip().rstrip("/") + "/" + VERSION_FILE
    fetch = fetch_json or _fetch_json_url
    try:
        document = fetch(url)
    except Exception as error:  # noqa: BLE001 - any transport failure is one code, never a pass
        raise _fail(
            "webapp-upload-verify-failed",
            f"{url} could not be read: {error}",
            "check --public-url and that the host serves the bundle, then re-run with --verify",
        ) from error
    version = document.get("version") if isinstance(document, Mapping) else None
    expected = manifest.get("appVersion")
    if version != expected:
        raise _fail(
            "webapp-upload-version-mismatch",
            f"{url} serves {version!r} but the build is {expected!r}",
            "the CDN or a previous deployment is still serving; "
            "re-run with --verify after the cache expires",
        )
    return version if isinstance(version, str) else None



def run_webapp_upload(
    *,
    source_dir: Path,
    target: UploadTarget,
    password: str | None = None,
    prune: bool = False,
    verify: bool = False,
    dry_run: bool = False,
    assume_yes: bool = False,
    confirm: Callable[[str], bool] | None = None,
    fetch_json: Callable[[str], Any] | None = None,
    run: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
    use_setsid: bool | None = None,
) -> UploadResult:
    """Publish *source_dir* to *target*, in the order that cannot break the live site.

    The manifest is read and validated (never the directory walked), the plan is built, and only
    then does anything leave the machine. ``--prune`` first lists the directories the plan uses,
    proposes the names the manifest does not contain, and deletes them **after** a fully successful
    transfer — never ``index.html`` or ``html/version.json``. ``--verify`` compares the host against
    the manifest and, when the build records a ``publicUrl``, the served ``version.json`` too.

    Each directory is listed in its own ``sftp`` call, because ``sftp`` prints a listing without
    naming the directory it came from; ``--verify`` therefore costs one connection per directory
    and ``--prune`` twice that. Both are opt-in, so the plain upload stays one connection.

    Args:
        source_dir: Build output directory holding ``webapp-build.json``.
        target: Host, user, remote directory and authentication material.
        password: SFTP password from the environment or a hidden prompt, or ``None`` for key auth.
        prune: Remove remote files the manifest does not list, after confirmation.
        verify: Check the host and the public version after the transfer.
        dry_run: Build and return the plan without connecting or prompting.
        assume_yes: Skip the prune confirmation; never skips the plan.
        confirm: Confirmation callable; when ``None`` a prune proposal is kept, not applied.
        fetch_json: Callable returning the decoded JSON of a URL, for ``--verify``; injected by
            tests so no test touches the network.
        run: ``subprocess.run``-compatible callable, injected by tests.
        use_setsid: Force the ``setsid`` decision in :func:`require_password_support`.

    Returns:
        An :class:`UploadResult` describing what was transferred and verified.

    Raises:
        WebappError: Any ``webapp-upload-*`` failure; ``webapp-upload-interrupted`` carries exit
            code ``130``.
    """

    source = source_dir.resolve()
    manifest_path = source / webapp_manifest.MANIFEST_NAME
    manifest = webapp_manifest.read_manifest(manifest_path)
    webapp_manifest.validate_manifest(manifest)
    plan = plan_upload(source, manifest, target)

    file_count = len(plan.files)
    byte_count = sum(item.size for item in plan.files)
    if dry_run:
        return UploadResult(
            file_count=file_count,
            byte_count=byte_count,
            directories=len(plan.directories),
            pruned=(),
            verified=False,
            dry_run=True,
            manifest_path=manifest_path,
            plan=plan,
            checks=("Dry run: nothing was transferred",),
        )

    checks: list[str] = []
    approved: tuple[str, ...] = ()
    verified = False
    temp_dir = Path(tempfile.mkdtemp(prefix="micro-otter-webapp-credentials-"))
    try:
        askpass: Path | None = None
        if password:
            require_password_support(use_setsid=use_setsid)
            askpass = write_askpass(temp_dir)
        env = build_child_env(password, askpass)
        run_kwargs: dict[str, Any] = {
            "password": bool(password),
            "env": env,
            "secret": password,
            "run": run,
            "use_setsid": use_setsid,
        }
        # Only `--prune` needs to know what the host already holds: `--verify` reads the state
        # after the transfer, so a second listing pass would only cost connections.
        listing = list_remote(plan, **run_kwargs) if prune else {}
        candidates = prune_candidates(plan, listing) if prune else ()
        if candidates:
            forbidden = [
                path
                for path in candidates
                if _relative_to_root(path, target.remote_path) in PRUNE_FORBIDDEN
            ]
            if forbidden:
                raise _fail(
                    "webapp-upload-prune-unsafe",
                    f"pruning would remove {_first_paths(forbidden)}",
                    "index.html and html/version.json are what a live site needs; "
                    "rebuild with `mo webapp build` and re-run without --prune",
                )
            approved = candidates
            if not assume_yes:
                question = f"Delete {len(candidates)} stale remote file(s)?"
                if confirm is None or not confirm(question):
                    approved = ()
                    checks.append(
                        f"Prune: {len(candidates)} stale files kept "
                        "(needs --yes or a confirmation)"
                    )
        if approved:
            checks.append(f"Prune: removed {len(approved)} stale files")
        try:
            run_sftp(plan=plan, batch_text=render_sftp_batch(plan, prune=approved), **run_kwargs)
        except KeyboardInterrupt as error:
            raise _fail(
                "webapp-upload-interrupted",
                f"upload interrupted; {file_count} files were planned and index.html was not "
                "published, so the site still serves its previous release",
                "re-run the upload; files already in place are overwritten",
                exit_code=130,
            ) from error
        if verify:
            verify_remote(plan, list_remote(plan, **run_kwargs))
            served = verify_public(manifest, fetch_json)
            checks.append(f"Files: {file_count} of {file_count} match the manifest")
            checks.append(
                f"Public version: {served} (matches the manifest)"
                if served is not None
                else "Public version: skipped (no --public-url in the build)"
            )
            verified = True
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

    return UploadResult(
        file_count=file_count,
        byte_count=byte_count,
        directories=len(plan.directories),
        pruned=approved,
        verified=verified,
        dry_run=False,
        manifest_path=manifest_path,
        plan=plan,
        checks=tuple(checks),
    )


__all__ = [
    "ASKPASS_REQUIRE_SUPPORTED_PLATFORMS",
    "DEFAULT_PORT",
    "INDEX_FILE",
    "PRUNE_FORBIDDEN",
    "PUBLIC_FETCH_TIMEOUT_SECONDS",
    "SFTP_TIMEOUT_SECONDS",
    "UPLOAD_HOST_ENV",
    "UPLOAD_IDENTITY_FILE_ENV",
    "UPLOAD_KNOWN_HOSTS_ENV",
    "UPLOAD_PASSWORD_ENV",
    "UPLOAD_PATH_ENV",
    "UPLOAD_PORT_ENV",
    "UPLOAD_USER_ENV",
    "VERSION_FILE",
    "UploadFile",
    "UploadPlan",
    "UploadResult",
    "UploadTarget",
    "build_child_env",
    "build_sftp_argv",
    "list_remote",
    "normalise_remote_path",
    "parse_remote_listing",
    "plan_directories",
    "plan_upload",
    "prune_candidates",
    "redact",
    "render_listing_batch",
    "render_sftp_batch",
    "require_password_support",
    "resolve_target",
    "run_sftp",
    "run_webapp_upload",
    "sort_for_publication",
    "verify_public",
    "verify_remote",
    "write_askpass",
]

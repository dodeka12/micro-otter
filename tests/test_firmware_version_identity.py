"""Tests for the tag-derived firmware version resolver."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from micro_otter.tools.firmware_compile.version_identity import (
    FirmwareVersionUnresolvedError,
    ReleaseManifestBaseMismatchError,
    VersionSource,
    resolve_firmware_version,
)

RELEASE_PATH = Path("src/micro_otter/nodes/device/firmware/release.json")
GIT = shutil.which("git")

requires_git = pytest.mark.skipif(GIT is None, reason="git is unavailable")


def _write_release_manifest(workspace: Path, release_version: str = "1.0.0") -> None:
    path = workspace / RELEASE_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "releaseVersion": release_version,
                "kind": "stable",
                "releasedAtUtc": None,
                "tag": f"firmware-v{release_version}",
            }
        ),
        encoding="utf-8",
    )


def _git(workspace: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=workspace,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def _init_repo(workspace: Path) -> str:
    workspace.mkdir(parents=True, exist_ok=True)
    _git(workspace, "init", "-q")
    _git(workspace, "config", "user.email", "test@example.com")
    _git(workspace, "config", "user.name", "Test")
    _git(workspace, "config", "tag.gpgsign", "false")
    _git(workspace, "config", "commit.gpgsign", "false")
    (workspace / "file.txt").write_text("hello\n", encoding="utf-8")
    _git(workspace, "add", ".")
    _git(workspace, "commit", "-qm", "initial")
    return _git(workspace, "rev-parse", "HEAD")


def _commit(workspace: Path, message: str) -> str:
    (workspace / "file.txt").write_text(message + "\n", encoding="utf-8")
    _git(workspace, "add", ".")
    _git(workspace, "commit", "-qm", message)
    return _git(workspace, "rev-parse", "HEAD")


@requires_git
def test_no_tag_uses_release_json_base(tmp_path: Path) -> None:
    _init_repo(tmp_path)
    _write_release_manifest(tmp_path)
    commit = _commit(tmp_path, "one more")

    identity = resolve_firmware_version(tmp_path, environ={})

    assert identity.version == f"1.0.0-dev.0.g{commit[:7]}"
    assert identity.source is VersionSource.NO_TAG_DEV
    assert identity.channel == "dev"
    assert identity.distance == 0


@requires_git
def test_tagged_head_is_the_release(tmp_path: Path) -> None:
    commit = _init_repo(tmp_path)
    _write_release_manifest(tmp_path)
    _git(tmp_path, "tag", "firmware-v1.0.0")

    identity = resolve_firmware_version(tmp_path, environ={})

    assert identity.version == "1.0.0"
    assert identity.source is VersionSource.GIT_RELEASE_TAG
    assert identity.channel == "release"
    assert identity.distance == 0
    assert identity.commit == commit
    assert identity.tag == "firmware-v1.0.0"


@requires_git
def test_one_commit_past_tag_is_dev(tmp_path: Path) -> None:
    _init_repo(tmp_path)
    _write_release_manifest(tmp_path)
    _git(tmp_path, "tag", "firmware-v1.0.0")
    commit = _commit(tmp_path, "after release")

    identity = resolve_firmware_version(tmp_path, environ={})

    assert identity.version == f"1.0.0-dev.1.g{commit[:7]}"
    assert identity.source is VersionSource.GIT_DEV
    assert identity.channel == "dev"
    assert identity.distance == 1


def test_no_git_uses_release_json(tmp_path: Path) -> None:
    _write_release_manifest(tmp_path)

    identity = resolve_firmware_version(tmp_path, environ={})

    assert identity.version == "1.0.0"
    assert identity.source is VersionSource.NO_GIT_RELEASE_FILE
    assert identity.channel == "release"


def test_no_git_and_no_release_json_raises(tmp_path: Path) -> None:
    with pytest.raises(FirmwareVersionUnresolvedError):
        resolve_firmware_version(tmp_path, environ={})


@requires_git
def test_tag_base_mismatch_raises(tmp_path: Path) -> None:
    _init_repo(tmp_path)
    _write_release_manifest(tmp_path, release_version="2.0.0")
    _git(tmp_path, "tag", "firmware-v1.0.0")

    with pytest.raises(ReleaseManifestBaseMismatchError):
        resolve_firmware_version(tmp_path, environ={})


def test_override_env_wins(tmp_path: Path) -> None:
    identity = resolve_firmware_version(
        tmp_path, environ={"MICRO_OTTER_FIRMWARE_VERSION": "1.2.3-dev.1.gabc1234"}
    )

    assert identity.version == "1.2.3-dev.1.gabc1234"
    assert identity.base_version == "1.2.3"
    assert identity.source is VersionSource.OVERRIDE_ENV


def test_override_env_invalid_raises(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        resolve_firmware_version(
            tmp_path, environ={"MICRO_OTTER_FIRMWARE_VERSION": "not-a-version"}
        )

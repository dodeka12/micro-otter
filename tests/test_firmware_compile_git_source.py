"""Tests for git_source capture module."""

import subprocess
from pathlib import Path
from unittest.mock import patch

from micro_otter.tools.firmware_compile.git_source import (
    GitSource,
    _parse_repo_name_from_url,
    _run_git,
    capture_git_source,
    get_repo_name,
)

# --- GitSource.to_dict ---


def test_git_source_to_dict_returns_expected_keys():
    source = GitSource(
        origin_url="https://github.com/example/repo.git",
        branch="main",
        commit_hash="abc123def456",
    )
    result = source.to_dict()
    assert result == {
        "branch": "main",
        "commitHash": "abc123def456",
        "shallow": False,
    }


def test_git_source_to_dict_with_none_fields():
    source = GitSource(origin_url=None, branch=None, commit_hash="abc123")
    result = source.to_dict()
    assert result == {
        "branch": None,
        "commitHash": "abc123",
        "shallow": False,
    }


# --- _run_git ---


def test_run_git_returns_stripped_output(tmp_path: Path):
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = subprocess.CompletedProcess(
            args=["git", "rev-parse", "HEAD"],
            returncode=0,
            stdout="  abc123\n",
            stderr="",
        )
        result = _run_git(["rev-parse", "HEAD"], tmp_path)
    assert result == "abc123"


def test_run_git_returns_none_on_nonzero_exit(tmp_path: Path):
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = subprocess.CompletedProcess(
            args=["git", "rev-parse", "HEAD"],
            returncode=128,
            stdout="",
            stderr="fatal: not a git repository",
        )
        result = _run_git(["rev-parse", "HEAD"], tmp_path)
    assert result is None


def test_run_git_returns_none_on_os_error(tmp_path: Path):
    with patch("subprocess.run", side_effect=OSError("git not found")):
        result = _run_git(["rev-parse", "HEAD"], tmp_path)
    assert result is None


def test_run_git_returns_none_on_timeout(tmp_path: Path):
    with patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd="git", timeout=5)):
        result = _run_git(["rev-parse", "HEAD"], tmp_path)
    assert result is None


def test_run_git_returns_none_for_empty_stdout(tmp_path: Path):
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = subprocess.CompletedProcess(
            args=["git", "rev-parse", "HEAD"],
            returncode=0,
            stdout="   \n",
            stderr="",
        )
        result = _run_git(["rev-parse", "HEAD"], tmp_path)
    assert result is None


# --- capture_git_source ---


def test_capture_git_source_returns_none_when_not_in_repo(tmp_path: Path):
    # tmp_path is a real directory but not a git repo.
    result = capture_git_source(tmp_path)
    assert result is None


def test_capture_git_source_returns_git_source_with_all_fields(tmp_path: Path):
    def fake_run_git(args, cwd):
        if args[0] == "rev-parse" and args[1] == "HEAD":
            return "deadbeef1234"
        if args[0] == "remote":
            return "https://github.com/example/repo.git"
        if args == ["rev-parse", "--abbrev-ref", "HEAD"]:
            return "feature-branch"
        return None

    with patch(
        "micro_otter.tools.firmware_compile.git_source._run_git",
        side_effect=fake_run_git,
    ):
        result = capture_git_source(tmp_path)

    assert result is not None
    assert result.commit_hash == "deadbeef1234"
    assert result.origin_url == "https://github.com/example/repo.git"
    assert result.branch == "feature-branch"


def test_capture_git_source_returns_none_when_commit_unavailable(tmp_path: Path):
    with patch(
        "micro_otter.tools.firmware_compile.git_source._run_git",
        return_value=None,
    ):
        result = capture_git_source(tmp_path)
    assert result is None


def test_capture_git_source_allows_partial_fields(tmp_path: Path):
    def fake_run_git(args, cwd):
        if args[0] == "rev-parse" and args[1] == "HEAD":
            return "cafebabe5678"
        # No remote, no branch
        return None

    with patch(
        "micro_otter.tools.firmware_compile.git_source._run_git",
        side_effect=fake_run_git,
    ):
        result = capture_git_source(tmp_path)

    assert result is not None
    assert result.commit_hash == "cafebabe5678"
    assert result.origin_url is None
    assert result.branch is None


def test_capture_git_source_in_actual_workspace():
    # Integration check: running in the actual repo should return a valid GitSource.
    workspace = Path(__file__).resolve().parent.parent
    result = capture_git_source(workspace)
    # The workspace is a real git repo.
    assert result is not None
    assert isinstance(result.commit_hash, str) and len(result.commit_hash) == 40
    assert result.branch is not None
    d = result.to_dict()
    assert set(d.keys()) == {"branch", "commitHash", "shallow"}


# --- _parse_repo_name_from_url ---


def test_parse_repo_name_strips_git_suffix_from_https_url():
    assert _parse_repo_name_from_url("https://github.com/user/my-repo.git") == "my-repo"


def test_parse_repo_name_handles_https_url_without_git_suffix():
    assert _parse_repo_name_from_url("https://github.com/user/my-repo") == "my-repo"


def test_parse_repo_name_strips_git_suffix_from_ssh_url():
    assert _parse_repo_name_from_url("git@github.com:user/my-repo.git") == "my-repo"


def test_parse_repo_name_handles_ssh_url_without_git_suffix():
    assert _parse_repo_name_from_url("git@github.com:user/my-repo") == "my-repo"


def test_parse_repo_name_handles_trailing_slash():
    assert _parse_repo_name_from_url("https://github.com/user/my-repo/") == "my-repo"


# --- get_repo_name ---


def test_get_repo_name_uses_origin_url_when_available(tmp_path: Path):
    with patch(
        "micro_otter.tools.firmware_compile.git_source._run_git",
        return_value="https://github.com/user/my-repo.git",
    ):
        result = get_repo_name(tmp_path)
    assert result == "my-repo"


def test_get_repo_name_falls_back_to_folder_name_when_no_remote(tmp_path: Path):
    with patch(
        "micro_otter.tools.firmware_compile.git_source._run_git",
        return_value=None,
    ):
        result = get_repo_name(tmp_path)
    assert result == tmp_path.name


def test_get_repo_name_in_actual_workspace():
    workspace = Path(__file__).resolve().parent.parent
    origin_url = _run_git(["remote", "get-url", "origin"], workspace)
    assert origin_url is not None
    assert get_repo_name(workspace) == _parse_repo_name_from_url(origin_url)

"""Git repository source information capture for firmware compile traceability."""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class GitSource:
    """Captured git repository state at compile time."""

    origin_url: str | None
    branch: str | None
    commit_hash: str | None
    shallow: bool = False

    def to_dict(self) -> dict:
        """Return JSON-serializable dict representation.

        ``originUrl`` is deliberately omitted: it embeds the developer repository
        URL and has no consumer, so a new entry never reintroduces it.
        """

        return {
            "branch": self.branch,
            "commitHash": self.commit_hash,
            "shallow": self.shallow,
        }


def _run_git(args: list[str], cwd: Path) -> str | None:
    """Run a git command and return stripped stdout, or None on any failure."""
    try:
        result = subprocess.run(
            ["git"] + args,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            return result.stdout.strip() or None
        return None
    except (OSError, subprocess.TimeoutExpired):
        return None


def _parse_repo_name_from_url(url: str) -> str:
    """Extract the repository name from a git remote URL.

    Handles HTTPS (https://github.com/user/repo.git) and SSH
    (git@github.com:user/repo.git) forms.
    """
    name = url.rstrip("/").split("/")[-1]
    if name.endswith(".git"):
        name = name[:-4]
    return name


def get_repo_name(workspace_root: Path) -> str:
    """Return the git repository name for workspace_root.

    Parses the name from the 'origin' remote URL when available.
    Falls back to ``workspace_root.name`` (the folder name) if git is
    unavailable or no remote is configured.
    """
    origin_url = _run_git(["remote", "get-url", "origin"], workspace_root)
    if origin_url:
        return _parse_repo_name_from_url(origin_url)
    return workspace_root.name


def capture_git_source(workspace_root: Path) -> GitSource | None:
    """Capture git origin URL, branch, and commit hash for workspace_root.

    Returns None if git is not available or the directory is not a git repository.
    Returns a GitSource with partial None fields if only some information is available
    (e.g. no remote named 'origin').
    """
    commit_hash = _run_git(["rev-parse", "HEAD"], workspace_root)
    if commit_hash is None:
        return None

    origin_url = _run_git(["remote", "get-url", "origin"], workspace_root)
    branch = _run_git(["rev-parse", "--abbrev-ref", "HEAD"], workspace_root)

    return GitSource(
        origin_url=origin_url,
        branch=branch,
        commit_hash=commit_hash,
    )


def latest_release_tag(root: Path, *, prefix: str = "firmware-v") -> str | None:
    """Return the newest reachable release tag for *root*, or ``None``.

    ``git describe --tags --abbrev=0 --match "<prefix>*"`` finds the newest tag
    reachable from ``HEAD``; when it fails (no matching tag reachable), falls back
    to ``git tag --list --sort=-v:refname --merged HEAD`` so a tag on an unrelated
    branch never becomes the base.
    """
    tag = _run_git(["describe", "--tags", "--abbrev=0", "--match", f"{prefix}*"], root)
    if tag:
        return tag
    listed = _run_git(["tag", "--list", "--sort=-v:refname", "--merged", "HEAD"], root)
    if not listed:
        return None
    for candidate in listed.splitlines():
        if candidate.startswith(prefix):
            return candidate
    return None


def commit_distance_since(root: Path, rev: str) -> int | None:
    """Return the commit count from *rev* to ``HEAD``, or ``None`` when unknown."""
    count = _run_git(["rev-list", "--count", f"{rev}..HEAD"], root)
    if count is None:
        return None
    try:
        return int(count)
    except ValueError:
        return None


def tag_commit(root: Path, tag: str) -> str | None:
    """Return the commit a lightweight or annotated *tag* points at, or ``None``."""
    peeled = _run_git(["rev-list", "-n", "1", tag], root)
    if peeled:
        return peeled
    return _run_git(["rev-parse", f"{tag}^{{}}"], root)


def current_commit(root: Path) -> str | None:
    """Return the full ``HEAD`` commit hash, or ``None``."""
    return _run_git(["rev-parse", "HEAD"], root)


def current_branch(root: Path) -> str | None:
    """Return the current branch name, or ``None`` (detached HEAD / no git)."""
    return _run_git(["rev-parse", "--abbrev-ref", "HEAD"], root)


def is_shallow_repository(root: Path) -> bool:
    """Return whether the repository at *root* is a shallow clone."""
    return (root / ".git" / "shallow").is_file()

"""Integration tests binding the CLI path helpers to the configuration resolver.

``cli/app.py`` keeps ``_resolve_workspace_root`` and ``_resolve_default_micropython_root``
as private functions because many commands and tests patch them; these tests pin the
delegation contract so the resolver stays the single source of truth.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from micro_otter.cli.app import _resolve_default_micropython_root, _resolve_workspace_root


def test_workspace_root_honours_micro_otter_workspace(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    workspace = tmp_path / "workspace"
    (workspace / "src" / "micro_otter").mkdir(parents=True)
    (workspace / "pyproject.toml").write_text("", encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("MICRO_OTTER_WORKSPACE", str(workspace))

    assert _resolve_workspace_root() == workspace.resolve()


def test_default_micropython_root_honours_toolchain_dir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    toolchain_dir = tmp_path / "toolchain"
    installed = toolchain_dir / "micropython"
    installed.mkdir(parents=True)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("MICRO_OTTER_TOOLCHAIN_DIR", str(toolchain_dir))

    assert _resolve_default_micropython_root(tmp_path) == installed.resolve()


def test_workspace_root_walks_up_to_project_markers(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    workspace = tmp_path / "repo"
    nested = workspace / "src" / "micro_otter" / "cli"
    nested.mkdir(parents=True)
    (workspace / "pyproject.toml").write_text("", encoding="utf-8")
    monkeypatch.chdir(nested)
    monkeypatch.delenv("MICRO_OTTER_WORKSPACE", raising=False)

    assert _resolve_workspace_root() == workspace.resolve()

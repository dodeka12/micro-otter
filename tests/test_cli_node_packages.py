"""Tests for ``micro-otter node-packages`` (alias ``np``).

The command is a thin renderer over :mod:`...local_package_scan`, so these tests
pin the CLI surface — both output modes, the default runtime, and the
``--sync-local`` write — against a miniature device tree.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest import mock

from typer.testing import CliRunner

from micro_otter.cli import app

runner = CliRunner()


def _write_json(path: Path, payload: object) -> Path:
    """Write *payload* as JSON to *path*, creating parents, and return the path."""

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def _workspace(tmp_path: Path, *, local_ids: tuple[str, ...] = ()) -> Path:
    """Build a workspace whose device tree holds two global packages."""

    workspace = tmp_path / "workspace"
    device_root = workspace / "src" / "micro_otter" / "nodes" / "device"
    _write_json(
        device_root / "node_pkgs" / "index.json",
        {
            "version": 1,
            "packages": [
                {"id": "alpha", "manifest": "alpha/manifest.json"},
                {"id": "beta", "manifest": "beta/manifest.json"},
            ],
        },
    )
    for package_id, version in (("alpha", "1.0.0"), ("beta", "2.0.0")):
        _write_json(
            device_root / "node_pkgs" / package_id / "manifest.json",
            {"id": package_id, "name": package_id.title(), "version": version},
        )
    _write_json(
        device_root / "runtime" / "general" / "manifest.json",
        {
            "id": "general",
            "nodePackages": {"global": ["alpha", "beta"], "local": list(local_ids)},
        },
    )
    _write_json(
        device_root / "runtime" / "general" / "node_pkgs" / "local_one" / "manifest.json",
        {"id": "local_one", "name": "Local One", "version": "0.1.0"},
    )
    return workspace


def _invoke(workspace: Path, *args: str):
    """Run the command with the workspace and add-ons folder redirected."""

    with (
        mock.patch("micro_otter.cli.app._resolve_workspace_root", return_value=workspace),
        mock.patch(
            "micro_otter.cli.app._resolve_addons_root",
            return_value=workspace / "addons",
        ),
    ):
        return runner.invoke(app, list(args))


def test_node_packages_json_lists_packages(tmp_path: Path):
    workspace = _workspace(tmp_path)

    result = _invoke(workspace, "node-packages", "--json-output")

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["schemaVersion"] == 1
    assert payload["runtime"] == {"id": "general"}
    assert [entry["id"] for entry in payload["packages"]] == ["alpha", "beta", "local_one"]
    assert [entry["staged"] for entry in payload["packages"]] == [True, True, False]
    assert [entry["source"] for entry in payload["packages"]] == [
        "global",
        "global",
        "runtime-local",
    ]
    assert payload["warnings"] == []
    assert "sync" not in payload
    assert all(
        entry["manifestPath"] is None or Path(entry["manifestPath"]).is_file()
        for entry in payload["packages"]
    )


def test_node_packages_defaults_to_general_runtime(tmp_path: Path):
    workspace = _workspace(tmp_path)

    default_run = _invoke(workspace, "np", "--json-output")
    explicit_run = _invoke(workspace, "np", "--runtime-id", "general", "--json-output")

    assert default_run.exit_code == 0
    assert json.loads(default_run.stdout)["runtime"] == {"id": "general"}
    assert json.loads(default_run.stdout) == json.loads(explicit_run.stdout)


def test_node_packages_human_output_includes_staged_column(tmp_path: Path):
    workspace = _workspace(tmp_path)

    result = _invoke(workspace, "node-packages")

    assert result.exit_code == 0
    assert "Staged" in result.stdout
    assert "alpha" in result.stdout
    assert "local_one" in result.stdout
    assert "None" not in result.stdout


def test_node_packages_sync_local_writes_manifest(tmp_path: Path):
    workspace = _workspace(tmp_path, local_ids=("ghost",))
    manifest_path = (
        workspace
        / "src"
        / "micro_otter"
        / "nodes"
        / "device"
        / "runtime"
        / "general"
        / "manifest.json"
    )

    result = _invoke(workspace, "node-packages", "--sync-local", "--json-output")

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["sync"] == {
        "written": True,
        "previous": ["ghost"],
        "current": ["local_one"],
        "skipped": [],
    }
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["nodePackages"]["local"] == ["local_one"]


def test_node_packages_reports_unknown_runtime(tmp_path: Path):
    workspace = _workspace(tmp_path)

    result = _invoke(workspace, "node-packages", "--runtime-id", "nope")

    assert result.exit_code == 2
    assert "runtime-not-found" in result.stderr
    assert "hint: Available runtime ids: general" in result.stderr

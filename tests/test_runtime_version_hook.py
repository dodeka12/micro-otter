from __future__ import annotations

import importlib.util
import json
from pathlib import Path


def _load_hook_module():
    hook_path = Path("hooks/device_version_hook.py").resolve()
    spec = importlib.util.spec_from_file_location("device_version_hook", hook_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_resolve_bump_type_uses_commit_message_and_relevant_paths():
    hook = _load_hook_module()
    bump_type = hook.resolve_bump_type(
        "feat: update runtime",
        [Path("src/micro_otter/nodes/device/runtime/general/main.py")],
    )

    assert bump_type == "minor"


# ---------------------------------------------------------------------------
# Step 2: node-package and tools manifest detection tests
# ---------------------------------------------------------------------------

_DEVICE_ROOT_REL = Path("src/micro_otter/nodes/device")
_NODE_PKGS_ROOT = _DEVICE_ROOT_REL / "node_pkgs"
_TOOLS_ROOT = _DEVICE_ROOT_REL / "tools"


def _make_device_tree(root: Path) -> None:
    """Create minimal device tree with manifest stubs."""
    for pkg in ("core", "webview"):
        m = root / _NODE_PKGS_ROOT / pkg / "manifest.json"
        m.parent.mkdir(parents=True, exist_ok=True)
        m.write_text(json.dumps({"id": pkg, "version": "1.0.0"}), encoding="utf-8")
    tools_m = root / _TOOLS_ROOT / "manifest.json"
    tools_m.parent.mkdir(parents=True, exist_ok=True)
    tools_m.write_text(json.dumps({"version": "0.1.0"}), encoding="utf-8")


def test_find_node_package_manifests_detects_pkg_file_change(tmp_path: Path, monkeypatch):
    hook = _load_hook_module()
    _make_device_tree(tmp_path)
    monkeypatch.setattr(hook, "DEVICE_ROOT", tmp_path / _DEVICE_ROOT_REL)
    monkeypatch.setattr(hook, "DEVICE_ROOT_REL", _DEVICE_ROOT_REL)

    staged = [_NODE_PKGS_ROOT / "core" / "libs" / "core" / "system.py"]
    result = hook.find_node_package_manifests_requiring_bump(staged)
    assert result == {(tmp_path / _NODE_PKGS_ROOT / "core" / "manifest.json").resolve()}


def test_find_node_package_manifests_ignores_manifest_itself(tmp_path: Path, monkeypatch):
    hook = _load_hook_module()
    _make_device_tree(tmp_path)
    monkeypatch.setattr(hook, "DEVICE_ROOT", tmp_path / _DEVICE_ROOT_REL)
    monkeypatch.setattr(hook, "DEVICE_ROOT_REL", _DEVICE_ROOT_REL)

    staged = [_NODE_PKGS_ROOT / "core" / "manifest.json"]
    result = hook.find_node_package_manifests_requiring_bump(staged)
    assert result == set()


def test_find_node_package_manifests_detects_multiple_packages(tmp_path: Path, monkeypatch):
    hook = _load_hook_module()
    _make_device_tree(tmp_path)
    monkeypatch.setattr(hook, "DEVICE_ROOT", tmp_path / _DEVICE_ROOT_REL)
    monkeypatch.setattr(hook, "DEVICE_ROOT_REL", _DEVICE_ROOT_REL)

    staged = [
        _NODE_PKGS_ROOT / "core" / "libs" / "core" / "system.py",
        _NODE_PKGS_ROOT / "webview" / "libs" / "webview" / "__init__.py",
    ]
    result = hook.find_node_package_manifests_requiring_bump(staged)
    expected = {
        (tmp_path / _NODE_PKGS_ROOT / "core" / "manifest.json").resolve(),
        (tmp_path / _NODE_PKGS_ROOT / "webview" / "manifest.json").resolve(),
    }
    assert result == expected


def test_find_tools_manifest_detects_tools_file_change(tmp_path: Path, monkeypatch):
    hook = _load_hook_module()
    _make_device_tree(tmp_path)
    monkeypatch.setattr(hook, "DEVICE_ROOT", tmp_path / _DEVICE_ROOT_REL)
    monkeypatch.setattr(hook, "DEVICE_ROOT_REL", _DEVICE_ROOT_REL)

    staged = [_TOOLS_ROOT / "wifi_manager.py"]
    result = hook.find_tools_manifest_requiring_bump(staged)
    assert result == (tmp_path / _TOOLS_ROOT / "manifest.json").resolve()


def test_find_tools_manifest_ignores_manifest_itself(tmp_path: Path, monkeypatch):
    hook = _load_hook_module()
    _make_device_tree(tmp_path)
    monkeypatch.setattr(hook, "DEVICE_ROOT", tmp_path / _DEVICE_ROOT_REL)
    monkeypatch.setattr(hook, "DEVICE_ROOT_REL", _DEVICE_ROOT_REL)

    staged = [_TOOLS_ROOT / "manifest.json"]
    result = hook.find_tools_manifest_requiring_bump(staged)
    assert result is None


def _make_full_device_tree_for_bump(root: Path) -> dict:
    """Create device tree and return absolute paths for use in monkeypatching."""
    device_root = root / _DEVICE_ROOT_REL
    # runtime manifest
    rt_dir = device_root / "runtime" / "general"
    rt_dir.mkdir(parents=True, exist_ok=True)
    rt_manifest = rt_dir / "manifest.json"
    rt_manifest.write_text(
        json.dumps({"id": "general", "version": "1.0.0", "nodePackages": {}}),
        encoding="utf-8",
    )
    # node pkg
    pkg_dir = device_root / "node_pkgs" / "core"
    pkg_dir.mkdir(parents=True, exist_ok=True)
    pkg_manifest = pkg_dir / "manifest.json"
    pkg_manifest.write_text(json.dumps({"id": "core", "version": "1.0.0"}), encoding="utf-8")
    # tools
    tools_dir = device_root / "tools"
    tools_dir.mkdir(parents=True, exist_ok=True)
    tools_manifest = tools_dir / "manifest.json"
    tools_manifest.write_text(json.dumps({"version": "0.1.0"}), encoding="utf-8")
    return {
        "device_root": device_root,
        "pkg_manifest": pkg_manifest,
        "tools_manifest": tools_manifest,
        "rt_manifest": rt_manifest,
    }


def test_main_bumps_node_package_manifest(tmp_path: Path, monkeypatch):

    hook = _load_hook_module()
    paths = _make_full_device_tree_for_bump(tmp_path)
    device_root = paths["device_root"]
    pkg_manifest = paths["pkg_manifest"]

    monkeypatch.setattr(hook, "ROOT", tmp_path)
    monkeypatch.setattr(hook, "DEVICE_ROOT", device_root)
    monkeypatch.setattr(hook, "DEVICE_ROOT_REL", _DEVICE_ROOT_REL)
    monkeypatch.setattr(hook, "RUNTIME_ROOT", device_root / "runtime")
    monkeypatch.setattr(hook, "RUNTIME_ROOT_REL", _DEVICE_ROOT_REL / "runtime")
    monkeypatch.setattr(hook, "stage_file", lambda path: None)
    # Simulate the manifest existing in HEAD with its current version
    monkeypatch.setattr(
        hook,
        "read_version_from_head",
        lambda path: hook.parse_version(json.loads(path.read_text())["version"]),
    )

    staged = [_NODE_PKGS_ROOT / "core" / "libs" / "core" / "system.py"]
    monkeypatch.setattr(hook, "get_staged_paths", lambda: staged)

    commit_msg_path = tmp_path / "COMMIT_EDITMSG"
    commit_msg_path.write_text("fix: update core node lib", encoding="utf-8")

    import sys
    monkeypatch.setattr(sys, "argv", ["hook", str(commit_msg_path)])

    try:
        hook.main()
    except hook.DeviceVersionError:
        pass  # expected — bumped and staged

    updated = json.loads(pkg_manifest.read_text(encoding="utf-8"))
    assert updated["version"] == "1.0.1"


def test_main_bumps_tools_manifest(tmp_path: Path, monkeypatch):
    hook = _load_hook_module()
    paths = _make_full_device_tree_for_bump(tmp_path)
    device_root = paths["device_root"]
    tools_manifest = paths["tools_manifest"]

    monkeypatch.setattr(hook, "ROOT", tmp_path)
    monkeypatch.setattr(hook, "DEVICE_ROOT", device_root)
    monkeypatch.setattr(hook, "DEVICE_ROOT_REL", _DEVICE_ROOT_REL)
    monkeypatch.setattr(hook, "RUNTIME_ROOT", device_root / "runtime")
    monkeypatch.setattr(hook, "RUNTIME_ROOT_REL", _DEVICE_ROOT_REL / "runtime")
    monkeypatch.setattr(hook, "stage_file", lambda path: None)
    # Simulate the manifest existing in HEAD with its current version
    monkeypatch.setattr(
        hook,
        "read_version_from_head",
        lambda path: hook.parse_version(json.loads(path.read_text())["version"]),
    )

    staged = [_TOOLS_ROOT / "wifi_manager.py"]
    monkeypatch.setattr(hook, "get_staged_paths", lambda: staged)

    commit_msg_path = tmp_path / "COMMIT_EDITMSG"
    commit_msg_path.write_text("fix: update wifi manager", encoding="utf-8")

    import sys
    monkeypatch.setattr(sys, "argv", ["hook", str(commit_msg_path)])

    try:
        hook.main()
    except hook.DeviceVersionError:
        pass  # expected — bumped and staged

    updated = json.loads(tools_manifest.read_text(encoding="utf-8"))
    assert updated["version"] == "0.1.1"


# ---------------------------------------------------------------------------
# runtime_assets manifest detection tests
# ---------------------------------------------------------------------------

_RUNTIME_ASSETS_ROOT_REL = Path(
    "src/micro_otter/tools/firmware_compile/runtime_assets"
)


def _make_runtime_assets_tree(root: Path) -> Path:
    """Create a minimal runtime_assets directory with a manifest stub."""
    assets_root = root / _RUNTIME_ASSETS_ROOT_REL
    assets_root.mkdir(parents=True, exist_ok=True)
    manifest = assets_root / "manifest.json"
    manifest.write_text(json.dumps({"version": "1.0.0"}), encoding="utf-8")
    return assets_root


def test_find_runtime_assets_manifest_detects_file_change(tmp_path: Path, monkeypatch):
    hook = _load_hook_module()
    assets_root = _make_runtime_assets_tree(tmp_path)
    monkeypatch.setattr(hook, "RUNTIME_ASSETS_ROOT", assets_root)
    monkeypatch.setattr(hook, "RUNTIME_ASSETS_ROOT_REL", _RUNTIME_ASSETS_ROOT_REL)

    staged = [_RUNTIME_ASSETS_ROOT_REL / "otter_runtime" / "embedded_metadata_api.py"]
    result = hook.find_runtime_assets_manifest_requiring_bump(staged)

    assert result == assets_root / "manifest.json"


def test_find_runtime_assets_manifest_ignores_manifest_itself(tmp_path: Path, monkeypatch):
    hook = _load_hook_module()
    assets_root = _make_runtime_assets_tree(tmp_path)
    monkeypatch.setattr(hook, "RUNTIME_ASSETS_ROOT", assets_root)
    monkeypatch.setattr(hook, "RUNTIME_ASSETS_ROOT_REL", _RUNTIME_ASSETS_ROOT_REL)

    staged = [_RUNTIME_ASSETS_ROOT_REL / "manifest.json"]
    result = hook.find_runtime_assets_manifest_requiring_bump(staged)

    assert result is None


def test_find_runtime_assets_manifest_returns_none_for_unrelated_paths(tmp_path: Path, monkeypatch):
    hook = _load_hook_module()
    assets_root = _make_runtime_assets_tree(tmp_path)
    monkeypatch.setattr(hook, "RUNTIME_ASSETS_ROOT", assets_root)
    monkeypatch.setattr(hook, "RUNTIME_ASSETS_ROOT_REL", _RUNTIME_ASSETS_ROOT_REL)

    staged = [Path("src/micro_otter/nodes/device/runtime/general/main.py")]
    result = hook.find_runtime_assets_manifest_requiring_bump(staged)

    assert result is None


def test_main_bumps_runtime_assets_manifest(tmp_path: Path, monkeypatch):
    hook = _load_hook_module()
    paths = _make_full_device_tree_for_bump(tmp_path)
    device_root = paths["device_root"]
    assets_root = _make_runtime_assets_tree(tmp_path)
    assets_manifest = assets_root / "manifest.json"

    monkeypatch.setattr(hook, "ROOT", tmp_path)
    monkeypatch.setattr(hook, "DEVICE_ROOT", device_root)
    monkeypatch.setattr(hook, "DEVICE_ROOT_REL", _DEVICE_ROOT_REL)
    monkeypatch.setattr(hook, "RUNTIME_ROOT", device_root / "runtime")
    monkeypatch.setattr(hook, "RUNTIME_ROOT_REL", _DEVICE_ROOT_REL / "runtime")
    monkeypatch.setattr(hook, "RUNTIME_ASSETS_ROOT", assets_root)
    monkeypatch.setattr(hook, "RUNTIME_ASSETS_ROOT_REL", _RUNTIME_ASSETS_ROOT_REL)
    monkeypatch.setattr(hook, "stage_file", lambda path: None)
    # Simulate the manifest existing in HEAD with its current version
    monkeypatch.setattr(
        hook,
        "read_version_from_head",
        lambda path: hook.parse_version(json.loads(path.read_text())["version"]),
    )

    staged = [_RUNTIME_ASSETS_ROOT_REL / "otter_runtime" / "embedded_metadata_api.py"]
    monkeypatch.setattr(hook, "get_staged_paths", lambda: staged)

    commit_msg_path = tmp_path / "COMMIT_EDITMSG"
    commit_msg_path.write_text("fix: update bootstrap API", encoding="utf-8")

    import sys
    monkeypatch.setattr(sys, "argv", ["hook", str(commit_msg_path)])

    try:
        hook.main()
    except hook.DeviceVersionError:
        pass  # expected — bumped and staged

    updated = json.loads(assets_manifest.read_text(encoding="utf-8"))
    assert updated["version"] == "1.0.1"


def test_bump_manifest_version_skips_new_file_with_no_head_version(tmp_path: Path, monkeypatch):
    """A manifest with no HEAD version (brand-new file) is not bumped."""
    hook = _load_hook_module()
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({"version": "1.1.0"}), encoding="utf-8")

    monkeypatch.setattr(hook, "ROOT", tmp_path)
    monkeypatch.setattr(hook, "read_version_from_head", lambda path: None)
    monkeypatch.setattr(hook, "stage_file", lambda path: None)

    result = hook.bump_manifest_version(manifest, "minor")

    assert result is None
    assert json.loads(manifest.read_text())["version"] == "1.1.0"


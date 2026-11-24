"""Tests for the device-side ``.mpy`` caches of installed add-on packages."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from unittest import mock

import pytest

from micro_otter.tools.addon_archive import install_addon, validate_addon_tree
from micro_otter.tools.addon_store import addon_index_entries
from micro_otter.tools.firmware_compile import mpy_precompile
from micro_otter.tools.firmware_compile.mpy_precompile import (
    MANIFEST_PROFILE_KEY,
    MpyManifestPrecompileRequest,
    run_manifest_mpy_precompile,
    save_json,
    update_manifests_with_profile,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
FIXTURE_ARCHIVE = REPO_ROOT / "tests" / "fixtures" / "addons" / "sample_addon.zip"
BUILTIN_IDS = ("core",)
EMIT_ARGS = ("--emit", "bytecode")

_FAKE_MPY_CROSS = """#!/usr/bin/env python3
import sys

args = sys.argv[1:]
if args == ["--version"]:
    print("MicroPython v1.27.0; mpy-cross emitting mpy v6.3")
    sys.exit(0)
out = args[args.index("-o") + 1]
with open(out, "wb") as handle:
    handle.write(b"mpy")
"""


def _write_json(path: Path, payload: object) -> None:
    """Write *payload* as JSON to *path*, creating parents."""

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _fake_mpy_cross(tmp_path: Path) -> Path:
    """Create an executable that behaves like ``mpy-cross`` and return its path."""

    binary = tmp_path / "bin" / "mpy-cross"
    binary.parent.mkdir(parents=True, exist_ok=True)
    binary.write_text(_FAKE_MPY_CROSS, encoding="utf-8")
    binary.chmod(0o755)
    return binary


def _device_root(tmp_path: Path) -> Path:
    """Create a device tree without Python sources, so only the add-on contributes."""

    device_root = tmp_path / "device"
    _write_json(device_root / "runtime" / "manifest.json", {"runtimes": {}})
    _write_json(device_root / "tools" / "manifest.json", {"files": []})
    (device_root / "node_pkgs").mkdir(parents=True, exist_ok=True)
    _write_json(device_root / "node_pkgs" / "index.json", {"version": 1, "packages": []})
    return device_root


def _install_fixture_addon(tmp_path: Path) -> Path:
    """Install the checked-in add-on fixture and return the addons root."""

    addons_root = tmp_path / "addons"
    install_addon(FIXTURE_ARCHIVE, addons_root=addons_root, builtin_ids=BUILTIN_IDS)
    return addons_root


def _tree_snapshot(root: Path) -> dict[str, str]:
    """Return ``{relative path: sha256}`` for every file below *root*."""

    snapshot: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        if path.is_file():
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            snapshot[path.relative_to(root).as_posix()] = digest
    return snapshot


def _request(
    device_root: Path,
    addons_root: Path | None,
    **overrides,
) -> MpyManifestPrecompileRequest:
    """Return a manifest precompile request pointing at the fixture roots."""

    return MpyManifestPrecompileRequest(
        device_root=device_root,
        mpy_cross=overrides.pop("mpy_cross", None),
        emit="bytecode",
        addons_root=addons_root,
        **overrides,
    )


def test_compile_mpy_covers_installed_addons(tmp_path: Path) -> None:
    device_root = _device_root(tmp_path)
    addons_root = _install_fixture_addon(tmp_path)
    compiler = _fake_mpy_cross(tmp_path)
    package_dir = addons_root / "sample_addon"
    device_packages_before = _tree_snapshot(device_root / "node_pkgs")

    result = run_manifest_mpy_precompile(
        _request(device_root, addons_root, mpy_cross=compiler)
    )

    assert result.compiled_count == 2
    assert result.addon_manifests_updated == 1
    assert result.addons_skipped is False
    cache_root = package_dir / "moa_sample_addon" / "__mpycache__" / result.profile_hash
    assert (cache_root / "__init__.mpy").is_file()
    assert (cache_root / "generator.mpy").is_file()

    manifest = json.loads((package_dir / "manifest.json").read_text(encoding="utf-8"))
    profile = manifest[MANIFEST_PROFILE_KEY][result.profile_hash]
    assert profile["emit"] == "bytecode"
    assert set(profile) == {"mpyCrossVersion", "emit", "smallIntBits", "march", "marchFlags"}

    # Only the add-on root had sources, so the shipped package tree is untouched.
    assert _tree_snapshot(device_root / "node_pkgs") == device_packages_before
    assert list(device_root.rglob("__mpycache__")) == []


def test_second_compile_mpy_run_rewrites_nothing(tmp_path: Path) -> None:
    device_root = _device_root(tmp_path)
    addons_root = _install_fixture_addon(tmp_path)
    compiler = _fake_mpy_cross(tmp_path)
    manifest_path = addons_root / "sample_addon" / "manifest.json"

    first = run_manifest_mpy_precompile(_request(device_root, addons_root, mpy_cross=compiler))
    bytes_after_first = manifest_path.read_bytes()

    second = run_manifest_mpy_precompile(_request(device_root, addons_root, mpy_cross=compiler))

    assert first.addon_manifests_updated == 1
    assert second.addon_manifests_updated == 0
    assert second.node_package_manifests_updated == 0
    assert manifest_path.read_bytes() == bytes_after_first
    assert list(manifest_path.parent.glob("*.tmp")) == []


def _install_variant_addon(tmp_path: Path) -> tuple[Path, Path]:
    """Install a single-manifest ``pulse`` add-on and return ``(addons_root, package_dir)``."""

    source = tmp_path / "build" / "pulse"
    for relative in ("moa_pulse/__init__.py", "moa_pulse_viper/__init__.py"):
        target = source / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("# stub\n", encoding="utf-8")
    (source / "manifest.json").write_text(
        json.dumps(
            {
                "id": "pulse",
                "version": "1.0.0",
                "manifestVersion": 2,
                "variants": {
                    "py": {"mpAssets": {"*": ["moa_pulse/__init__.py"]}},
                    "viper": {
                        "requiredCapabilities": ["viper"],
                        "hardware": {"en": "ESP32", "de": "ESP32"},
                        "precedence": 10,
                        "mpAssets": {"*": ["moa_pulse_viper/__init__.py"]},
                    },
                },
            }
        ),
        encoding="utf-8",
    )
    addons_root = tmp_path / "addons"
    install_addon(source, addons_root=addons_root, builtin_ids=BUILTIN_IDS)
    return addons_root, addons_root / "pulse"


def test_compile_mpy_records_profiles_in_the_manifest(tmp_path: Path) -> None:
    device_root = _device_root(tmp_path)
    addons_root, package_dir = _install_variant_addon(tmp_path)
    compiler = _fake_mpy_cross(tmp_path)

    result = run_manifest_mpy_precompile(_request(device_root, addons_root, mpy_cross=compiler))

    assert result.compiled_count == 2
    assert result.addon_manifests_updated == 1
    manifest = json.loads((package_dir / "manifest.json").read_text(encoding="utf-8"))
    assert MANIFEST_PROFILE_KEY in manifest


def test_skip_addons_leaves_the_addon_tree_byte_identical(tmp_path: Path) -> None:
    device_root = _device_root(tmp_path)
    addons_root = _install_fixture_addon(tmp_path)
    compiler = _fake_mpy_cross(tmp_path)
    before = _tree_snapshot(addons_root)

    result = run_manifest_mpy_precompile(_request(device_root, None, mpy_cross=compiler))

    assert result.addons_skipped is True
    assert result.addon_manifests_updated == 0
    assert result.compiled_count == 0
    assert _tree_snapshot(addons_root) == before


def test_dry_run_writes_nothing(tmp_path: Path) -> None:
    device_root = _device_root(tmp_path)
    addons_root = _install_fixture_addon(tmp_path)
    compiler = _fake_mpy_cross(tmp_path)
    before = _tree_snapshot(addons_root)

    result = run_manifest_mpy_precompile(
        _request(device_root, addons_root, mpy_cross=compiler, dry_run=True, clean=True)
    )

    assert result.compiled_count == 2
    assert result.addon_manifests_updated == 0
    assert result.node_package_manifests_updated == 0
    assert _tree_snapshot(addons_root) == before
    assert list(addons_root.rglob("__mpycache__")) == []


def test_clean_removes_a_previous_addon_cache_only_when_not_dry_run(tmp_path: Path) -> None:
    device_root = _device_root(tmp_path)
    addons_root = _install_fixture_addon(tmp_path)
    compiler = _fake_mpy_cross(tmp_path)
    stale = addons_root / "sample_addon" / "__mpycache__" / "stale" / "__init__.mpy"
    stale.parent.mkdir(parents=True)
    stale.write_bytes(b"old")

    run_manifest_mpy_precompile(
        _request(device_root, addons_root, mpy_cross=compiler, dry_run=True, clean=True)
    )
    assert stale.is_file()

    run_manifest_mpy_precompile(
        _request(device_root, addons_root, mpy_cross=compiler, clean=True)
    )
    assert not stale.exists()


def test_save_json_replaces_atomically_and_leaves_no_temp_file(tmp_path: Path) -> None:
    target = tmp_path / "manifest.json"
    save_json(target, {"id": "sample_addon", "version": "1.0.0"})
    original = target.read_text(encoding="utf-8")

    with mock.patch.object(mpy_precompile.os, "replace", side_effect=OSError("disk full")):
        with pytest.raises(OSError):
            save_json(target, {"id": "sample_addon", "version": "2.0.0"})

    assert target.read_text(encoding="utf-8") == original
    assert list(tmp_path.glob("*.tmp")) == []


def test_save_json_writes_a_sibling_temp_file_name(tmp_path: Path) -> None:
    target = tmp_path / "manifest.json"
    seen: list[Path] = []
    real_replace = os.replace

    def spy(source, destination):
        seen.append(Path(source))
        real_replace(source, destination)

    with mock.patch.object(mpy_precompile.os, "replace", side_effect=spy):
        save_json(target, {"id": "sample_addon"})

    assert seen and seen[0].parent == target.parent
    assert seen[0].name != target.name
    assert list(tmp_path.glob("*.tmp")) == []


def test_update_manifests_with_profile_preserves_unowned_keys(tmp_path: Path) -> None:
    manifest_path = tmp_path / "manifest.json"
    manifest = {
        "id": "sample_addon",
        "version": "1.0.0",
        "mpAssets": {"*": ["moa_sample_addon/__init__.py"]},
        "requiredCapabilities": [{"anyOf": ["wifi"]}],
        "precedence": 5,
        "x-unknown": {"keep": True},
    }
    _write_json(manifest_path, manifest)
    manifest_map = {"sample_addon:manifest": (manifest_path, manifest)}
    compile_params = {"emit": "bytecode", "smallIntBits": 31}

    updated = update_manifests_with_profile(manifest_map, "abc123", compile_params)

    assert updated == 1
    written = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert written["mpAssets"] == manifest["mpAssets"]
    assert written["requiredCapabilities"] == manifest["requiredCapabilities"]
    assert written["precedence"] == 5
    assert written["x-unknown"] == {"keep": True}
    assert written[MANIFEST_PROFILE_KEY] == {"abc123": compile_params}
    assert list(written) == [*manifest, MANIFEST_PROFILE_KEY]
    # The caller's in-memory payload is not mutated.
    assert MANIFEST_PROFILE_KEY not in manifest


def test_update_manifests_with_profile_is_idempotent(tmp_path: Path) -> None:
    manifest_path = tmp_path / "manifest.json"
    manifest = {"id": "sample_addon", "version": "1.0.0"}
    _write_json(manifest_path, manifest)
    manifest_map = {"sample_addon:manifest": (manifest_path, manifest)}
    compile_params = {"emit": "bytecode"}

    assert update_manifests_with_profile(manifest_map, "abc123", compile_params) == 1
    bytes_after_first = manifest_path.read_bytes()

    assert update_manifests_with_profile(manifest_map, "abc123", compile_params) == 0
    assert manifest_path.read_bytes() == bytes_after_first


def test_reinstall_after_compile_mpy_still_validates(tmp_path: Path) -> None:
    device_root = _device_root(tmp_path)
    addons_root = _install_fixture_addon(tmp_path)
    compiler = _fake_mpy_cross(tmp_path)
    run_manifest_mpy_precompile(_request(device_root, addons_root, mpy_cross=compiler))

    manifest = validate_addon_tree(addons_root / "sample_addon", builtin_ids=BUILTIN_IDS)

    assert manifest.id == "sample_addon"
    assert manifest.version == "1.0.0"
    assert manifest.assets == (
        "moa_sample_addon/__init__.py",
        "moa_sample_addon/generator.py",
    )


def test_addon_index_entries_are_unaffected_by_profiles(tmp_path: Path) -> None:
    device_root = _device_root(tmp_path)
    addons_root = _install_fixture_addon(tmp_path)
    compiler = _fake_mpy_cross(tmp_path)
    before = addon_index_entries(addons_root)

    run_manifest_mpy_precompile(_request(device_root, addons_root, mpy_cross=compiler))

    assert addon_index_entries(addons_root) == before

"""Tests for the read-only node-package inventory and the manifest sync.

Every fixture builds a miniature ``device/`` tree instead of pointing at the real
one, so the tests stay fast and can express broken packages that the shipped tree
does not contain.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from micro_otter.tools.firmware_compile.local_package_scan import (
    GLOBAL_PACKAGE_SOURCE,
    RUNTIME_LOCAL_PACKAGE_SOURCE,
    RUNTIME_MANIFEST_INVALID,
    RUNTIME_NOT_FOUND,
    LocalPackageScanError,
    build_package_scan_payload,
    scan_local_packages,
    update_runtime_local_packages,
)


def _write_json(path: Path, payload: object) -> Path:
    """Write *payload* as JSON to *path*, creating parents, and return the path."""

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def _package_manifest(
    root: Path,
    package_id: str,
    *,
    name: str | None = None,
    version: str = "1.0.0",
    required_capabilities: object = None,
) -> Path:
    """Create one package manifest under ``<root>/node_pkgs`` and return its path."""

    payload: dict[str, object] = {
        "id": package_id,
        "name": name if name is not None else package_id.title(),
        "version": version,
    }
    if required_capabilities is not None:
        payload["requiredCapabilities"] = required_capabilities
    return _write_json(root / "node_pkgs" / package_id / "manifest.json", payload)


def _runtime_manifest(
    root: Path,
    *,
    runtime_id: str = "general",
    global_ids: tuple[str, ...] = ("alpha", "beta"),
    local_ids: tuple[str, ...] = (),
    extra: dict[str, object] | None = None,
) -> Path:
    """Create one runtime manifest and return its path."""

    payload: dict[str, object] = {
        "id": runtime_id,
        "nodePackages": {"global": list(global_ids), "local": list(local_ids)},
        "filesystem": ["manifest.json", "main.py"],
    }
    if extra:
        payload.update(extra)
    return _write_json(root / "runtime" / runtime_id / "manifest.json", payload)


def _device_tree(tmp_path: Path, **runtime_manifest_kwargs: object) -> Path:
    """Build a miniature device tree with three global and one runtime-local package."""

    device_root = tmp_path / "device"
    _write_json(
        device_root / "node_pkgs" / "index.json",
        {
            "version": 1,
            "packages": [
                {"id": "alpha", "manifest": "alpha/manifest.json"},
                {"id": "beta", "manifest": "beta/manifest.json"},
                {"id": "gamma", "manifest": "gamma/manifest.json"},
            ],
        },
    )
    _package_manifest(device_root, "alpha", name="Alpha", version="1.0.0")
    _package_manifest(
        device_root,
        "beta",
        name="Beta",
        version="2.0.0",
        required_capabilities=["viper"],
    )
    _package_manifest(device_root, "gamma", name="Gamma", version="3.0.0")
    _runtime_manifest(device_root, **runtime_manifest_kwargs)
    _package_manifest(
        device_root / "runtime" / "general",
        "local_only",
        name="Local Only",
        version="0.1.0",
    )
    return device_root


def _records_by_id(scan) -> dict:
    """Return the scan's records keyed by package id."""

    return {record.id: record for record in scan.packages}


# --- 4.1 scan ----------------------------------------------------------------


def test_scan_reports_global_packages_in_index_order(tmp_path: Path):
    device_root = _device_tree(tmp_path)

    scan = scan_local_packages(device_root=device_root, runtime_id="general")

    global_ids = [
        record.id for record in scan.packages if record.source == GLOBAL_PACKAGE_SOURCE
    ]
    assert global_ids == ["alpha", "beta", "gamma"]
    records = _records_by_id(scan)
    assert records["alpha"].name == "Alpha"
    assert records["alpha"].version == "1.0.0"
    assert records["alpha"].manifest_path == (
        device_root / "node_pkgs" / "alpha" / "manifest.json"
    )


def test_scan_marks_runtime_local_packages(tmp_path: Path):
    device_root = _device_tree(tmp_path)

    scan = scan_local_packages(device_root=device_root, runtime_id="general")

    local = [
        record for record in scan.packages if record.source == RUNTIME_LOCAL_PACKAGE_SOURCE
    ]
    assert [record.id for record in local] == ["local_only"]
    assert local[0].name == "Local Only"
    assert local[0].version == "0.1.0"
    assert local[0].staged is False
    assert local[0].gated_out is False
    # Global packages come first, runtime-local packages are appended.
    assert scan.packages[-1].id == "local_only"


def test_scan_marks_gated_out_packages_with_missing_capabilities(tmp_path: Path):
    device_root = _device_tree(tmp_path)

    scan = scan_local_packages(
        device_root=device_root,
        runtime_id="general",
        capabilities={},
    )

    records = _records_by_id(scan)
    assert records["alpha"].staged is True
    assert records["beta"].staged is False
    assert records["beta"].gated_out is True
    assert records["beta"].missing_capabilities == ("viper",)


def test_scan_treats_omitted_capabilities_as_satisfied(tmp_path: Path):
    device_root = _device_tree(tmp_path)

    scan = scan_local_packages(device_root=device_root, runtime_id="general")

    records = _records_by_id(scan)
    assert records["beta"].staged is True
    assert records["beta"].gated_out is False
    assert records["beta"].missing_capabilities == ()


def test_scan_tolerates_directory_without_manifest(tmp_path: Path):
    device_root = _device_tree(tmp_path)
    (device_root / "node_pkgs" / "broken").mkdir(parents=True)
    _write_json(
        device_root / "node_pkgs" / "index.json",
        {
            "version": 1,
            "packages": [
                {"id": "alpha", "manifest": "alpha/manifest.json"},
                {"id": "broken", "manifest": "broken/manifest.json"},
            ],
        },
    )

    scan = scan_local_packages(device_root=device_root, runtime_id="general")

    broken = _records_by_id(scan)["broken"]
    assert broken.name is None
    assert broken.version is None
    assert broken.manifest_path is None
    assert broken.staged is False
    assert broken.gated_out is False
    assert any("unreadable manifest" in warning for warning in scan.warnings)


def test_scan_tolerates_malformed_manifest_as_warning(tmp_path: Path):
    device_root = _device_tree(tmp_path)
    (device_root / "node_pkgs" / "gamma" / "manifest.json").write_text(
        "{not json", encoding="utf-8"
    )

    scan = scan_local_packages(device_root=device_root, runtime_id="general")

    gamma = _records_by_id(scan)["gamma"]
    assert gamma.name is None
    assert gamma.version is None
    assert any("gamma" in warning for warning in scan.warnings)


def test_scan_reports_package_absent_from_runtime_manifest_as_not_staged(tmp_path: Path):
    device_root = _device_tree(tmp_path)

    scan = scan_local_packages(device_root=device_root, runtime_id="general")

    gamma = _records_by_id(scan)["gamma"]
    assert gamma.staged is False
    assert gamma.gated_out is False
    assert gamma.missing_capabilities == ()


def test_scan_raises_runtime_not_found_for_unknown_runtime(tmp_path: Path):
    device_root = _device_tree(tmp_path)

    with pytest.raises(LocalPackageScanError) as excinfo:
        scan_local_packages(device_root=device_root, runtime_id="nope")

    error = excinfo.value
    assert error.code == RUNTIME_NOT_FOUND
    assert error.exit_code == 2
    assert error.hint is not None
    assert "general" in error.hint
    assert error.details["runtimeId"] == "nope"


def test_scan_raises_for_invalid_runtime_manifest(tmp_path: Path):
    device_root = _device_tree(tmp_path)
    manifest_path = device_root / "runtime" / "general" / "manifest.json"
    manifest_path.write_text("[]", encoding="utf-8")

    with pytest.raises(LocalPackageScanError) as excinfo:
        scan_local_packages(device_root=device_root, runtime_id="general")

    assert excinfo.value.code == RUNTIME_MANIFEST_INVALID


def test_package_scan_payload_shape(tmp_path: Path):
    device_root = _device_tree(tmp_path)
    scan = scan_local_packages(device_root=device_root, runtime_id="general")

    payload = build_package_scan_payload(scan)

    assert payload["schemaVersion"] == 1
    assert payload["runtime"] == {"id": "general"}
    assert payload["warnings"] == list(scan.warnings)
    first = payload["packages"][0]
    assert first == {
        "id": "alpha",
        "name": "Alpha",
        "version": "1.0.0",
        "source": "global",
        "staged": True,
        "gatedOut": False,
        "missingCapabilities": [],
        "manifestPath": str(device_root / "node_pkgs" / "alpha" / "manifest.json"),
    }


# --- 4.2 sync ----------------------------------------------------------------


def _read_manifest(device_root: Path, runtime_id: str = "general") -> dict:
    """Return the parsed runtime manifest of *runtime_id*."""

    path = device_root / "runtime" / runtime_id / "manifest.json"
    return json.loads(path.read_text(encoding="utf-8"))


def test_sync_reports_drift_without_writing_by_default(tmp_path: Path):
    device_root = _device_tree(tmp_path)
    _runtime_manifest(device_root, local_ids=("ghost",))
    before = (device_root / "runtime" / "general" / "manifest.json").read_text(
        encoding="utf-8"
    )

    result = update_runtime_local_packages(device_root=device_root, runtime_id="general")

    assert result.written is False
    assert result.previous == ("ghost",)
    assert result.current == ("local_only",)
    after = (device_root / "runtime" / "general" / "manifest.json").read_text(encoding="utf-8")
    assert after == before


def test_sync_writes_sorted_local_ids_when_applied(tmp_path: Path):
    device_root = _device_tree(tmp_path)
    _package_manifest(device_root / "runtime" / "general", "aaa_first", version="0.0.1")

    result = update_runtime_local_packages(
        device_root=device_root,
        runtime_id="general",
        apply=True,
    )

    assert result.written is True
    assert result.current == ("aaa_first", "local_only")
    manifest = _read_manifest(device_root)
    assert manifest["nodePackages"]["local"] == ["aaa_first", "local_only"]
    # The global list is untouched.
    assert manifest["nodePackages"]["global"] == ["alpha", "beta"]


def test_sync_skips_folders_without_valid_manifest(tmp_path: Path):
    device_root = _device_tree(tmp_path)
    (device_root / "runtime" / "general" / "node_pkgs" / "no_manifest").mkdir()
    (device_root / "runtime" / "general" / "node_pkgs" / "README.md").write_text(
        "notes", encoding="utf-8"
    )
    _write_json(
        device_root / "runtime" / "general" / "node_pkgs" / "wrong_id" / "manifest.json",
        {"id": "other_id", "version": "1.0.0"},
    )

    result = update_runtime_local_packages(
        device_root=device_root,
        runtime_id="general",
        apply=True,
    )

    assert result.current == ("local_only",)
    assert result.skipped == ("README.md", "no_manifest", "wrong_id")
    manifest = _read_manifest(device_root)
    assert manifest["nodePackages"]["local"] == ["local_only"]


def test_sync_preserves_other_manifest_keys_and_order(tmp_path: Path):
    device_root = _device_tree(tmp_path)
    manifest_path = device_root / "runtime" / "general" / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "id": "general",
                "name": "Ünïcode runtime",
                "nodePackages": {"global": ["alpha", "beta"], "local": []},
                "filesystem": ["manifest.json", "main.py"],
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

    update_runtime_local_packages(
        device_root=device_root,
        runtime_id="general",
        apply=True,
    )

    text = manifest_path.read_text(encoding="utf-8")
    assert text.endswith("\n")
    assert "Ünïcode runtime" in text
    manifest = json.loads(text)
    assert list(manifest) == ["id", "name", "nodePackages", "filesystem"]
    assert list(manifest["nodePackages"]) == ["global", "local"]
    assert manifest["filesystem"] == ["manifest.json", "main.py"]
    assert manifest["nodePackages"]["local"] == ["local_only"]


def test_sync_noop_when_already_in_sync(tmp_path: Path):
    device_root = _device_tree(tmp_path)
    _runtime_manifest(device_root, local_ids=("local_only",))
    before = (device_root / "runtime" / "general" / "manifest.json").read_text(
        encoding="utf-8"
    )

    result = update_runtime_local_packages(
        device_root=device_root,
        runtime_id="general",
        apply=True,
    )

    assert result.written is False
    assert result.previous == result.current == ("local_only",)
    after = (device_root / "runtime" / "general" / "manifest.json").read_text(encoding="utf-8")
    assert after == before


def test_sync_never_invents_a_missing_manifest(tmp_path: Path):
    device_root = _device_tree(tmp_path)

    with pytest.raises(LocalPackageScanError) as excinfo:
        update_runtime_local_packages(device_root=device_root, runtime_id="ghost")

    assert excinfo.value.code == RUNTIME_NOT_FOUND
    assert not (device_root / "runtime" / "ghost").exists()

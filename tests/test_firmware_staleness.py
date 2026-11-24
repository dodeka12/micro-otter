import contextlib
import json
from pathlib import Path
from unittest import mock

import pytest

from micro_otter.tools.firmware_compile.local_firmware import scan_publish_root
from micro_otter.tools.firmware_compile.staleness import (
    _constituents_match,
    check_firmware_staleness,
    collect_current_constituent_versions,
)
from micro_otter.tools.firmware_compile.target_context import TargetPackageContext

LINEAGE_REL = Path("src/micro_otter/nodes/device/firmware/runtime_lineage.json")


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _make_workspace(tmp_path: Path, lineage: dict | None) -> tuple[Path, Path]:
    workspace = tmp_path / "workspace"
    device = workspace / "src" / "micro_otter" / "nodes" / "device"

    _write(
        device / "runtime" / "general" / "manifest.json",
        json.dumps({"version": "1.18.0", "nodePackages": {"global": ["core"]}}),
    )
    _write(device / "tools" / "manifest.json", json.dumps({"version": "0.2.1"}))
    _write(
        device / "node_pkgs" / "index.json",
        json.dumps({"packages": [{"id": "core", "manifest": "core/manifest.json"}]}),
    )
    _write(
        device / "node_pkgs" / "core" / "manifest.json",
        json.dumps(
            {"id": "core", "version": "1.5.0", "manifestVersion": 2, "variants": {"py": {}}}
        ),
    )

    if lineage is not None:
        _write(workspace / LINEAGE_REL, json.dumps(lineage))

    return workspace, device


def _lineage_entry(**overrides) -> dict:
    entry = {
        "micropythonVersion": "1.27.0",
        "runtimeSourceVersion": "1.18.0",
        "deviceToolsVersion": "0.2.1",
        "nodePackages": {"core": "1.5.0"},
        "createdAtUtc": "2026-10-25T00:00:00Z",
        "runtimeAssetsVersion": "1.2.2",
    }
    entry.update(overrides)
    return entry


def _publish_artifact(tmp_path: Path, board_id: str) -> Path:
    publish_root = tmp_path / "publish"
    publish_root.mkdir(parents=True, exist_ok=True)
    artifact = publish_root / f"micro-otter-1.27.0-{board_id}-general-0.4.2.bin"
    artifact.write_bytes(b"\x00")
    return publish_root


def _patch_constituents() -> contextlib.ExitStack:
    stack = contextlib.ExitStack()
    stack.enter_context(
        mock.patch(
            "micro_otter.tools.firmware_compile.staleness.resolve_micropython_version",
            return_value="1.27.0",
        )
    )
    stack.enter_context(
        mock.patch(
            "micro_otter.tools.firmware_compile.staleness._read_runtime_assets_version",
            return_value="1.2.2",
        )
    )
    return stack


def _publish_artifact_with_sidecar(tmp_path: Path, board_id: str, content_hash: str) -> Path:
    publish_root = _publish_artifact(tmp_path, board_id)
    sidecar = publish_root / f"micro-otter-1.27.0-{board_id}-general-0.4.2.manifest.json"
    sidecar.write_text(json.dumps({"contentHash": content_hash}), encoding="utf-8")
    return publish_root


def test_check_firmware_staleness_content_changed(tmp_path: Path):
    lineage = {"schemaVersion": 2, "lineage": {"esp32-general": {"0.4.2": _lineage_entry()}}}
    workspace, _ = _make_workspace(tmp_path, lineage)
    publish_root = _publish_artifact_with_sidecar(tmp_path, "esp32", "aaaaaaaaaaaa")

    with _patch_constituents(), mock.patch(
        "micro_otter.tools.firmware_compile.staleness._current_content_hash",
        return_value="bbbbbbbbbbbb",
    ):
        statuses = check_firmware_staleness(
            workspace_root=workspace,
            micropython_root=tmp_path / "micropython",
            board_ids=["esp32"],
            publish_root=publish_root,
        )

    status = statuses["esp32"]
    assert status.reason == "content-changed"
    assert status.is_stale is True
    assert status.reference_content_hash == "aaaaaaaaaaaa"
    assert status.current_content_hash == "bbbbbbbbbbbb"


def test_check_firmware_staleness_matching_hash_is_up_to_date(tmp_path: Path):
    lineage = {"schemaVersion": 2, "lineage": {"esp32-general": {"0.4.2": _lineage_entry()}}}
    workspace, _ = _make_workspace(tmp_path, lineage)
    publish_root = _publish_artifact_with_sidecar(tmp_path, "esp32", "aaaaaaaaaaaa")

    with _patch_constituents(), mock.patch(
        "micro_otter.tools.firmware_compile.staleness._current_content_hash",
        return_value="aaaaaaaaaaaa",
    ):
        statuses = check_firmware_staleness(
            workspace_root=workspace,
            micropython_root=tmp_path / "micropython",
            board_ids=["esp32"],
            publish_root=publish_root,
        )

    status = statuses["esp32"]
    assert status.reason == "up-to-date"
    assert status.is_stale is False


def test_check_firmware_staleness_no_image_in_channel(tmp_path: Path):
    lineage = {"schemaVersion": 2, "lineage": {}}
    workspace, _ = _make_workspace(tmp_path, lineage)
    publish_root = tmp_path / "publish"
    publish_root.mkdir(parents=True, exist_ok=True)
    (publish_root / "micro-otter-1.27.0-esp32-general-1.0.1-dev.7.gabc1234.bin").write_bytes(
        b"\x00"
    )

    with _patch_constituents():
        statuses = check_firmware_staleness(
            workspace_root=workspace,
            micropython_root=tmp_path / "micropython",
            board_ids=["esp32"],
            publish_root=publish_root,
            channel="release",
        )

    status = statuses["esp32"]
    assert status.reason == "no-image"
    assert status.is_stale is True
    assert status.channel == "release"


def test_check_firmware_staleness_channel_release_ignores_dev(tmp_path: Path):
    lineage = {"schemaVersion": 2, "lineage": {"esp32-general": {"0.4.2": _lineage_entry()}}}
    workspace, _ = _make_workspace(tmp_path, lineage)
    publish_root = tmp_path / "publish"
    publish_root.mkdir(parents=True, exist_ok=True)
    (publish_root / "micro-otter-1.27.0-esp32-general-1.0.0.bin").write_bytes(b"\x00")
    (publish_root / "micro-otter-1.27.0-esp32-general-1.0.1-dev.7.gabc1234.bin").write_bytes(
        b"\x00"
    )

    with _patch_constituents():
        statuses = check_firmware_staleness(
            workspace_root=workspace,
            micropython_root=tmp_path / "micropython",
            board_ids=["esp32"],
            publish_root=publish_root,
            channel="release",
        )

    status = statuses["esp32"]
    assert status.reason != "content-changed"
    lineage = {
        "schemaVersion": 2,
        "lineage": {"esp32-general": {"0.4.2": _lineage_entry()}},
    }
    workspace, _ = _make_workspace(tmp_path, lineage)

    with _patch_constituents():
        statuses = check_firmware_staleness(
            workspace_root=workspace,
            micropython_root=tmp_path / "micropython",
            board_ids=["esp32"],
            publish_root=_publish_artifact(tmp_path, "esp32"),
        )

    status = statuses["esp32"]
    assert status.latest_firmware_version == "0.4.2"
    assert status.is_stale is False
    assert status.reason == "up-to-date"


def test_check_firmware_staleness_source_changed(tmp_path: Path):
    lineage = {
        "schemaVersion": 2,
        "lineage": {
            "esp32-general": {
                "0.4.2": _lineage_entry(runtimeSourceVersion="1.17.0"),
            }
        },
    }
    workspace, _ = _make_workspace(tmp_path, lineage)

    with _patch_constituents():
        statuses = check_firmware_staleness(
            workspace_root=workspace,
            micropython_root=tmp_path / "micropython",
            board_ids=["esp32"],
            publish_root=_publish_artifact(tmp_path, "esp32"),
        )

    status = statuses["esp32"]
    assert status.latest_firmware_version == "0.4.2"
    assert status.is_stale is True
    assert status.reason == "source-changed"


def test_check_firmware_staleness_never_built(tmp_path: Path):
    lineage = {"schemaVersion": 2, "lineage": {}}
    workspace, _ = _make_workspace(tmp_path, lineage)

    with _patch_constituents():
        statuses = check_firmware_staleness(
            workspace_root=workspace,
            micropython_root=tmp_path / "micropython",
            board_ids=["esp32"],
            publish_root=tmp_path / "publish",
        )

    status = statuses["esp32"]
    assert status.latest_firmware_version is None
    assert status.is_stale is True
    assert status.reason == "never-built"


def test_check_firmware_staleness_unavailable(tmp_path: Path):
    workspace, _ = _make_workspace(tmp_path, None)

    with (
        mock.patch(
            "micro_otter.tools.firmware_compile.staleness.resolve_micropython_version",
            side_effect=ValueError("no micropython"),
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.staleness._read_runtime_assets_version",
            return_value="1.2.2",
        ),
    ):
        statuses = check_firmware_staleness(
            workspace_root=workspace,
            micropython_root=tmp_path / "micropython",
            board_ids=["esp32"],
            publish_root=tmp_path / "publish",
        )

    status = statuses["esp32"]
    assert status.is_stale is False
    assert status.reason == "unavailable"


def test_check_firmware_staleness_normalizes_board_id(tmp_path: Path):
    lineage = {
        "schemaVersion": 2,
        "lineage": {"esp32_generic_s3-general": {"0.4.2": _lineage_entry()}},
    }
    workspace, _ = _make_workspace(tmp_path, lineage)

    with _patch_constituents():
        statuses = check_firmware_staleness(
            workspace_root=workspace,
            micropython_root=tmp_path / "micropython",
            board_ids=["ESP32_GENERIC_S3"],
            publish_root=_publish_artifact(tmp_path, "esp32_generic_s3"),
        )

    assert "esp32_generic_s3" in statuses
    assert statuses["esp32_generic_s3"].reason == "up-to-date"


def test_check_firmware_staleness_missing_artifact(tmp_path: Path):
    lineage = {
        "schemaVersion": 2,
        "lineage": {"esp32-general": {"0.4.2": _lineage_entry()}},
    }
    workspace, _ = _make_workspace(tmp_path, lineage)

    with _patch_constituents():
        statuses = check_firmware_staleness(
            workspace_root=workspace,
            micropython_root=tmp_path / "micropython",
            board_ids=["esp32"],
            publish_root=tmp_path / "publish",
        )

    status = statuses["esp32"]
    assert status.latest_firmware_version == "0.4.2"
    assert status.is_stale is True
    assert status.reason == "artifact-missing"


def test_scan_publish_root_without_argument_uses_resolver(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    publish_root = tmp_path / "firmware"
    publish_root.mkdir()
    (publish_root / "micro-otter-1.27.0-esp32-general-0.4.2.bin").touch()
    monkeypatch.setenv("MICRO_OTTER_FIRMWARE_DIR", str(publish_root))

    assert scan_publish_root() == {"esp32": ["0.4.2"]}


def test_scan_publish_root_none_uses_resolver(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    publish_root = tmp_path / "firmware"
    publish_root.mkdir()
    (publish_root / "micro-otter-1.27.0-esp32_generic_s3-general-0.5.0.bin").touch()
    monkeypatch.setenv("MICRO_OTTER_FIRMWARE_DIR", str(publish_root))

    assert scan_publish_root(None) == {"esp32_generic_s3": ["0.5.0"]}


def _viper_context(*, supported: bool) -> TargetPackageContext:
    """Return a context that supports ``viper`` only when asked."""

    def is_general(capability: str) -> bool:
        """Treat ``viper`` as the only general capability."""

        return capability == "viper"

    def has_general_capability(capability: str) -> bool:
        """Report ``viper`` according to *supported*."""

        return supported if capability == "viper" else False

    def has_pin_capability(_capability: str) -> bool:
        """Report no pin capabilities; these tests gate on ``viper``."""

        return False

    return TargetPackageContext(
        target_id="test-target",
        is_general=is_general,
        has_general_capability=has_general_capability,
        has_pin_capability=has_pin_capability,
    )


def _add_two_variant_package(device: Path, package_id: str = "pulse") -> None:
    """Add a selected package that ships a default and a ``viper`` manifest."""

    runtime_path = device / "runtime" / "general" / "manifest.json"
    runtime = json.loads(runtime_path.read_text(encoding="utf-8"))
    runtime.setdefault("nodePackages", {}).setdefault("global", []).append(package_id)
    _write(runtime_path, json.dumps(runtime))

    index_path = device / "node_pkgs" / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8"))
    index["packages"] += [
        {"id": package_id, "manifest": f"{package_id}/manifest.json"},
    ]
    _write(index_path, json.dumps(index))
    _write(
        device / "node_pkgs" / package_id / "manifest.json",
        json.dumps(
            {
                "id": package_id,
                "version": "1.0.0",
                "manifestVersion": 2,
                "variants": {
                    "py": {"precedence": 0, "requiredCapabilities": []},
                    "viper": {"precedence": 10, "requiredCapabilities": ["viper"]},
                },
            }
        ),
    )


def _install_addon(
    addons_root: Path, package_id: str = "hello", version: str = "0.2.0"
) -> None:
    """Install one add-on package by writing its base manifest."""

    _write(
        addons_root / package_id / "manifest.json",
        json.dumps(
            {
                "id": package_id,
                "name": package_id,
                "version": version,
                "manifestVersion": 2,
                "variants": {"py": {"mpAssets": {"*": [f"moa_{package_id}/__init__.py"]}}},
            }
        ),
    )


def _write_board_targets(device: Path) -> None:
    """Map two boards to a viper-capable and a plain compile target."""

    _write(
        device / "targets" / "compile_target_mappings.json",
        json.dumps(
            {
                "schemaVersion": 1,
                "rules": [
                    {
                        "id": "viper-board",
                        "webTargetId": "esp32_wroom",
                        "runtimeIdInclude": ["*"],
                        "runtimeIdExclude": [],
                        "compile": {
                            "board": "esp32",
                            "backend": "esp-idf",
                            "params": {"port": "esp32"},
                        },
                        "priority": 100,
                    },
                    {
                        "id": "plain-board",
                        "webTargetId": "generic_micropython",
                        "runtimeIdInclude": ["*"],
                        "runtimeIdExclude": [],
                        "compile": {
                            "board": "esp32_generic_s3",
                            "backend": "esp-idf",
                            "params": {"port": "esp32"},
                        },
                        "priority": 100,
                    },
                ],
            }
        ),
    )
    _write(
        device / "capabilities" / "index.json",
        json.dumps({"version": 1, "files": ["general.json"]}),
    )
    _write(
        device / "capabilities" / "general.json",
        json.dumps({"capabilities": [{"id": "viper", "domain": "general"}]}),
    )
    _write(
        device / "targets" / "esp32_wroom.json",
        json.dumps({"generalCapabilities": {"viper": {"supported": True}}}),
    )
    _write(
        device / "targets" / "generic_micropython.json",
        json.dumps({"generalCapabilities": {"viper": {"supported": False}}}),
    )


def _publish_v3_artifact(
    tmp_path: Path,
    board_id: str,
    *,
    package_variants: dict[str, str],
    embedded_packages: dict[str, str] | None = None,
    addon_packages: dict[str, str] | None = None,
    content_hash: str = "aaaaaaaaaaaa",
) -> Path:
    """Publish one image whose sidecar is a ``schemaVersion: 3`` record."""

    publish_root = _publish_artifact(tmp_path, board_id)
    sidecar = publish_root / f"micro-otter-1.27.0-{board_id}-general-0.4.2.manifest.json"
    sidecar.write_text(
        json.dumps(
            {
                "schemaVersion": 3,
                "slug": board_id,
                "backend": "esp-idf",
                "platformVersion": "1.27.0",
                "runtime": {"id": "general"},
                "constituents": {
                    "runtime-source": "1.18.0",
                    "device-tools": "0.2.1",
                    "runtime-assets": "1.2.2",
                },
                "embeddedPackages": (
                    embedded_packages if embedded_packages is not None else {"core": "1.5.0"}
                ),
                "addonPackages": addon_packages or {},
                "packageVariants": package_variants,
                "contentHash": content_hash,
            }
        ),
        encoding="utf-8",
    )
    return publish_root


def test_two_variant_package_needs_an_explicit_choice(tmp_path: Path):
    """Staleness collects a multi-variant package for the requested variant."""

    workspace, device = _make_workspace(tmp_path, None)
    _add_two_variant_package(device)

    with _patch_constituents():
        default = collect_current_constituent_versions(
            device_root=device,
            runtime_id="general",
            micropython_root=tmp_path / "micropython",
            requested_variants={"pulse": "py"},
        )
        capable = collect_current_constituent_versions(
            device_root=device,
            runtime_id="general",
            micropython_root=tmp_path / "micropython",
            context=_viper_context(supported=True),
            requested_variants={"pulse": "viper"},
        )

    assert default is not None
    assert capable is not None
    assert default["nodePackages"] == {"core": "1.5.0", "pulse": "1.0.0"}
    assert default["packageVariants"] == {"core": "py", "pulse": "py"}
    assert capable["packageVariants"]["pulse"] == "viper"


def test_installed_addon_appears_in_addon_packages(tmp_path: Path):
    """An installed add-on is part of the current constituents."""

    workspace, device = _make_workspace(tmp_path, None)
    addons_root = tmp_path / "addons"
    _install_addon(addons_root)

    with _patch_constituents():
        current = collect_current_constituent_versions(
            device_root=device,
            runtime_id="general",
            micropython_root=tmp_path / "micropython",
            addons_root=addons_root,
        )

    assert current is not None
    assert current["addonPackages"] == {"hello": "0.2.0"}
    assert "hello" not in current["nodePackages"]
    assert current["packageVariants"] == {"core": "py", "hello": "py"}


def test_v3_sidecar_variant_change_is_content_changed(tmp_path: Path):
    """A v3 image that froze a different variant is reported as changed."""

    workspace, device = _make_workspace(tmp_path, None)
    _add_two_variant_package(device)
    publish_root = _publish_v3_artifact(
        tmp_path,
        "esp32",
        package_variants={"core": "py", "pulse": "viper"},
        embedded_packages={"core": "1.5.0", "pulse": "1.0.0"},
    )

    with _patch_constituents():
        statuses = check_firmware_staleness(
            workspace_root=workspace,
            micropython_root=tmp_path / "micropython",
            device_root=device,
            board_ids=["esp32"],
            publish_root=publish_root,
            package_variants={"pulse": "py"},
        )

    assert statuses["esp32"].reason == "content-changed"
    assert statuses["esp32"].is_stale is True


def test_v3_sidecar_ignores_the_hash_shortcut(tmp_path: Path):
    """Identical v3 identity fields win even when the recorded hash differs."""

    workspace, device = _make_workspace(tmp_path, None)
    _add_two_variant_package(device)
    publish_root = _publish_v3_artifact(
        tmp_path,
        "esp32",
        package_variants={"core": "py", "pulse": "py"},
        embedded_packages={"core": "1.5.0", "pulse": "1.0.0"},
        content_hash="aaaaaaaaaaaa",
    )

    with _patch_constituents(), mock.patch(
        "micro_otter.tools.firmware_compile.staleness._current_content_hash",
        return_value="bbbbbbbbbbbb",
    ):
        statuses = check_firmware_staleness(
            workspace_root=workspace,
            micropython_root=tmp_path / "micropython",
            device_root=device,
            board_ids=["esp32"],
            publish_root=publish_root,
            package_variants={"pulse": "py"},
        )

    assert statuses["esp32"].reason == "up-to-date"
    assert statuses["esp32"].is_stale is False


def test_v2_sidecar_keeps_hash_first_semantics(tmp_path: Path):
    """A v2 image still compares by hash, exactly as before."""

    workspace, _ = _make_workspace(tmp_path, None)
    publish_root = _publish_artifact_with_sidecar(tmp_path, "esp32", "aaaaaaaaaaaa")

    with _patch_constituents(), mock.patch(
        "micro_otter.tools.firmware_compile.staleness._current_content_hash",
        return_value="aaaaaaaaaaaa",
    ):
        statuses = check_firmware_staleness(
            workspace_root=workspace,
            micropython_root=tmp_path / "micropython",
            board_ids=["esp32"],
            publish_root=publish_root,
        )

    assert statuses["esp32"].reason == "up-to-date"


def test_lineage_entry_without_the_new_keys_still_matches():
    """A pre-M4u lineage entry is not read as a mismatch on absent keys."""

    current = {
        "micropythonVersion": "1.27.0",
        "runtimeSourceVersion": "1.18.0",
        "deviceToolsVersion": "0.2.1",
        "nodePackages": {"core": "1.5.0"},
        "runtimeAssetsVersion": "1.2.2",
        "addonPackages": {"hello": "0.2.0"},
        "packageVariants": {"core": "py"},
    }
    entry = {
        key: value
        for key, value in current.items()
        if key not in {"addonPackages", "packageVariants"}
    }

    assert _constituents_match(entry, current) is True

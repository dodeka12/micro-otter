"""The regression that motivated M4j: one request, one version everywhere."""

from __future__ import annotations

import json
from contextlib import ExitStack
from pathlib import Path
from unittest import mock

from micro_otter.tools.firmware_compile.build_identity import resolve_build_identity
from micro_otter.tools.firmware_compile.compile_command import (
    _resolve_pre_build_publish_target,
)
from micro_otter.tools.firmware_compile.content_identity import build_firmware_manifest


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _request(tmp_path: Path, addons_root: Path | None) -> mock.Mock:
    request = mock.Mock(
        board="esp32",
        slug="esp32",
        runtime_id="general",
        device_root=tmp_path / "device",
        addons_root=addons_root,
        workspace_root=tmp_path,
        package_ids=None,
        package_variants=None,
    )
    request.target = mock.Mock(build_backend="esp-idf")
    request.build_profile = mock.Mock(
        packaging_mode=mock.Mock(value="source-py"),
        optimization_level=None,
    )
    return request


def _setup(tmp_path: Path, addons_root: Path | None) -> mock.Mock:
    device_root = tmp_path / "device"
    _write_json(device_root / "runtime" / "general" / "manifest.json", {"version": "1.11.0"})
    _write_json(device_root / "tools" / "manifest.json", {"version": "0.2.1"})
    _write_json(device_root / "node_pkgs" / "index.json", {"packages": []})
    return _request(tmp_path, addons_root)


def _patches():
    return (
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.resolve_micropython_version",
            return_value="1.27.0",
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.version_identity.resolve_firmware_version",
            return_value=mock.Mock(
                version="1.0.0",
                base_version="1.0.0",
                channel="release",
                source=mock.Mock(value="git-release-tag"),
                commit=None,
                distance=0,
                branch=None,
                tag="firmware-v1.0.0",
                released_at_utc=None,
                shallow=False,
            ),
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.build_identity.get_repo_name",
            return_value="my-repo",
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.build_identity.read_packaged_runtime_assets_version",
            return_value="1.2.2",
        ),
    )


def test_guard_identity_and_manifest_agree_without_addons(tmp_path: Path) -> None:
    request = _setup(tmp_path, None)
    publish_root = tmp_path / "firmware"

    with ExitStack() as stack:
        for patch in _patches():
            stack.enter_context(patch)
        stack.enter_context(
            mock.patch(
                "micro_otter.tools.firmware_compile.compile_command.SYSTEM_FIRMWARE_PUBLISH_ROOT",
                publish_root,
            )
        )
        identity = resolve_build_identity(
            request=request,
            runtime_payload={"version": "1.11.0"},
            micropython_version="1.27.0",
        )
        full_version, publish_path = _resolve_pre_build_publish_target(request)

    manifest = build_firmware_manifest(
        backend="esp-idf",
        board="esp32",
        slug="esp32",
        platform_version="1.27.0",
        runtime_id="general",
        runtime_version="1.11.0",
        runtime_firmware_version=identity.runtime_firmware_version,
        content_hash=identity.content_hash,
        constituents=identity.constituents,
        embedded_packages=identity.packages.builtin,
        addon_packages=identity.packages.addons,
        selection=identity.selection,
        package_variants=identity.package_variants,
        base_version=identity.base_version,
        channel=identity.channel,
        version_source=identity.version_source,
    )

    assert identity.full_version == full_version
    assert publish_path.name == identity.filename
    assert identity.runtime_firmware_version in full_version
    assert manifest["runtimeFirmwareVersion"] == identity.runtime_firmware_version
    assert manifest["contentHash"] == identity.content_hash


def test_guard_identity_and_manifest_agree_with_addons(tmp_path: Path) -> None:
    addons_root = tmp_path / "addons"
    _write_json(
        addons_root / "hello" / "manifest.json",
        {
            "id": "hello",
            "name": "hello",
            "version": "0.2.0",
            "manifestVersion": 2,
            "variants": {"py": {"mpAssets": {"*": ["moa_hello/__init__.py"]}}},
        },
    )
    request = _setup(tmp_path, addons_root)
    publish_root = tmp_path / "firmware"

    with ExitStack() as stack:
        for patch in _patches():
            stack.enter_context(patch)
        stack.enter_context(
            mock.patch(
                "micro_otter.tools.firmware_compile.compile_command.SYSTEM_FIRMWARE_PUBLISH_ROOT",
                publish_root,
            )
        )
        identity = resolve_build_identity(
            request=request,
            runtime_payload={"version": "1.11.0"},
            micropython_version="1.27.0",
        )
        full_version, publish_path = _resolve_pre_build_publish_target(request)

    assert identity.full_version == full_version
    assert publish_path.name == identity.filename
    assert "hello" in identity.packages.addons
    assert "hello" in identity.packages.merged()

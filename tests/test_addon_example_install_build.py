"""End-to-end proof that the example add-ons install and resolve variants exclusively.

The examples are installed through the real :func:`micro_otter.tools.addon_archive.install_addon`
path and their assets are resolved through :func:`_resolve_package_assets` against the shipped
capability registry and target payloads — no ``mpy-cross`` is required.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from unittest import mock

import pytest

from micro_otter.tools.addon_archive import install_addon, validate_addon_source
from micro_otter.tools.firmware_compile.build_identity import resolve_build_identity
from micro_otter.tools.firmware_compile.package_resolver import (
    VariantCapabilitiesUnsatisfiedError,
)
from micro_otter.tools.firmware_compile.staging_resolver import _resolve_package_assets
from micro_otter.tools.firmware_compile.target_context import resolve_target_package_context
from micro_otter.tools.firmware_compile.target_mapping import CompileTargetResolution

REPO_ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = REPO_ROOT / "examples" / "addons" / "node_pkgs"
DEVICE = REPO_ROOT / "src" / "micro_otter" / "nodes" / "device"
BUILTIN_IDS = ("core",)


def _write_json(path: Path, payload: object) -> None:
    """Write *payload* as JSON to *path*, creating parents."""

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _device_root(tmp_path: Path) -> Path:
    """Create a device root with an empty index plus the real capabilities and targets."""

    device_root = tmp_path / "device"
    _write_json(device_root / "node_pkgs" / "index.json", {"version": 1, "packages": []})
    shutil.copytree(DEVICE / "capabilities", device_root / "capabilities")
    shutil.copytree(DEVICE / "targets", device_root / "targets")
    return device_root


def _install_examples(addons_root: Path) -> None:
    """Install the hello and pulse example add-ons from their source directories."""

    install_addon(EXAMPLES / "hello", addons_root=addons_root, builtin_ids=BUILTIN_IDS)
    install_addon(EXAMPLES / "pulse", addons_root=addons_root, builtin_ids=BUILTIN_IDS)


def _staged_roots(device_root: Path, addons_root: Path, target_id: str, **kwargs) -> set[str]:
    """Return the top-level module roots staged for *target_id*."""

    context = resolve_target_package_context(
        device_root=device_root,
        resolution=CompileTargetResolution(
            web_target_id=target_id,
            allowed_web_target_ids=(target_id,),
            compile_board=target_id,
            compile_port=target_id,
            mapping_rule_id="test-rule",
            mapping_source="test",
            mapping_confidence="exact",
        ),
    )
    assets = _resolve_package_assets(
        device_root,
        ["hello", "pulse"],
        context,
        addons_root=addons_root,
        **kwargs,
    )
    return {asset.target_rel_path.split("/", 1)[0] for asset in assets}


def test_example_addons_validate() -> None:
    """Both examples pass the install validation; pulse reports its viper variant."""

    hello = validate_addon_source(EXAMPLES / "hello", builtin_ids=BUILTIN_IDS)
    assert hello.id == "hello"
    assert [variant.id for variant in hello.variants] == ["py"]

    pulse = validate_addon_source(EXAMPLES / "pulse", builtin_ids=BUILTIN_IDS)
    assert pulse.id == "pulse"
    assert [variant.id for variant in pulse.variants] == ["py", "viper"]


def test_pulse_variant_is_exclusive_per_target(tmp_path: Path) -> None:
    """The viper variant stages on a viper target; the base stages elsewhere."""

    device_root = _device_root(tmp_path)
    addons_root = tmp_path / "addons"
    _install_examples(addons_root)

    viper_roots = _staged_roots(
        device_root, addons_root, "esp32_wroom", package_variants={"pulse": "viper"}
    )
    assert "moa_pulse_viper" in viper_roots
    assert "moa_pulse" not in viper_roots
    assert "moa_hello" in viper_roots

    base_roots = _staged_roots(
        device_root, addons_root, "generic_micropython", package_variants={"pulse": "py"}
    )
    assert "moa_pulse" in base_roots
    assert "moa_pulse_viper" not in base_roots


def test_explicit_variant_override_is_validated(tmp_path: Path) -> None:
    """An explicit viper override resolves on a viper target and is rejected elsewhere."""

    device_root = _device_root(tmp_path)
    addons_root = tmp_path / "addons"
    _install_examples(addons_root)

    forced = _staged_roots(
        device_root, addons_root, "esp32_wroom", package_variants={"pulse": "viper"}
    )
    assert "moa_pulse_viper" in forced
    assert "moa_pulse" not in forced

    with pytest.raises(VariantCapabilitiesUnsatisfiedError):
        _staged_roots(
            device_root,
            addons_root,
            "generic_micropython",
            package_variants={"pulse": "viper"},
        )


def _build_identity_request(
    device_root: Path, addons_root: Path, target_id: str, package_variants=None
) -> mock.Mock:
    """Return the normalized-request stand-in ``resolve_build_identity`` consumes."""

    return mock.Mock(
        board="generic_micropython",
        slug="generic_micropython",
        runtime_id="general",
        device_root=device_root,
        addons_root=addons_root,
        workspace_root=REPO_ROOT,
        package_ids=None,
        package_variants=package_variants,
        target=mock.Mock(build_backend="esp-idf"),
        build_profile=mock.Mock(
            packaging_mode=mock.Mock(value="source-py"),
            optimization_level=None,
        ),
        target_resolution=CompileTargetResolution(
            web_target_id=target_id,
            allowed_web_target_ids=(target_id,),
            compile_board="generic_micropython",
            compile_port="generic_micropython",
            mapping_rule_id="test-rule",
            mapping_source="test",
            mapping_confidence="exact",
        ),
    )


def _fake_version_identity() -> mock.Mock:
    """Return a resolved firmware version identity stand-in."""

    return mock.Mock(
        version="0.1.0",
        base_version="0.1.0",
        channel="release",
        source=mock.Mock(value="git-release-tag"),
        commit=None,
        distance=None,
        branch=None,
        tag=None,
        released_at_utc=None,
        shallow=False,
    )


def test_build_identity_records_the_frozen_addon_variant(tmp_path: Path) -> None:
    """The identity names the add-on implementation the image would freeze."""

    device_root = _device_root(tmp_path)
    runtime_payload = {"version": "1.11.0", "nodePackages": {"global": [], "local": []}}
    _write_json(device_root / "runtime" / "general" / "manifest.json", runtime_payload)
    _write_json(device_root / "tools" / "manifest.json", {"version": "0.2.1"})
    addons_root = tmp_path / "addons"
    _install_examples(addons_root)

    with (
        mock.patch(
            "micro_otter.tools.firmware_compile.build_identity.read_packaged_runtime_assets_version",
            return_value="1.2.2",
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.version_identity.resolve_firmware_version",
            return_value=_fake_version_identity(),
        ),
    ):
        identity = resolve_build_identity(
            request=_build_identity_request(
                device_root, addons_root, "generic_micropython",
                package_variants={"pulse": "py"},
            ),
            runtime_payload=runtime_payload,
            micropython_version="1.27.0",
        )

    assert identity.packages.variants == {"hello": "py", "pulse": "py"}
    assert identity.packages.addons == {"hello": "1.0.0", "pulse": "1.0.0"}

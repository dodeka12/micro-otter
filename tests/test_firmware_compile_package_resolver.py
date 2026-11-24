import json
from pathlib import Path

import pytest

from micro_otter.tools.addon_store import DEFAULT_VARIANT_ID
from micro_otter.tools.firmware_compile.compile_command import _collect_constituent_versions
from micro_otter.tools.firmware_compile.package_resolver import (
    VariantCapabilitiesUnsatisfiedError,
    VariantNotSelectedError,
    VariantUnknownError,
    group_entries_by_id,
    load_package_entries,
    select_variant,
)
from micro_otter.tools.firmware_compile.package_versions import collect_package_versions
from micro_otter.tools.firmware_compile.target_context import TargetPackageContext


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _setup_device_root(tmp_path: Path) -> Path:
    """A v2 device root: one manifest per package, variants as a dict."""
    device_root = tmp_path / "device"
    _write_json(
        device_root / "node_pkgs" / "index.json",
        {
            "version": 2,
            "packages": [
                {"id": "core", "manifest": "core/manifest.json"},
                {"id": "audio", "manifest": "audio/manifest.json"},
            ],
        },
    )
    _write_json(
        device_root / "node_pkgs" / "core" / "manifest.json",
        {"id": "core", "version": "1.5.0", "manifestVersion": 2, "variants": {"py": {}}},
    )
    _write_json(
        device_root / "node_pkgs" / "audio" / "manifest.json",
        {
            "id": "audio",
            "version": "0.36.0",
            "manifestVersion": 2,
            "variants": {
                "viper": {"requiredCapabilities": ["viper"], "precedence": 100},
                "py": {"requiredCapabilities": [], "precedence": 50},
            },
        },
    )
    return device_root


def _context(viper_supported: bool):
    return {
        "is_general": lambda capability: capability == "viper",
        "has_general_capability": lambda capability: capability == "viper" and viper_supported,
        "has_pin_capability": lambda capability: False,
    }


def test_group_entries_by_id_is_one_entry_per_package(tmp_path: Path):
    device_root = _setup_device_root(tmp_path)

    grouped = group_entries_by_id(load_package_entries(device_root))

    assert [entry.manifest for entry in grouped["audio"]] == ["audio/manifest.json"]


def test_select_variant_requires_an_explicit_choice(tmp_path: Path):
    device_root = _setup_device_root(tmp_path)
    entries = load_package_entries(device_root)

    with pytest.raises(VariantNotSelectedError) as error:
        select_variant(entries, "audio", device_root=device_root, **_context(True))

    assert error.value.package_id == "audio"
    assert "viper" in error.value.known
    assert "py" in error.value.known


def test_select_variant_explicit_pure_python(tmp_path: Path):
    device_root = _setup_device_root(tmp_path)
    entries = load_package_entries(device_root)

    variant = select_variant(
        entries, "audio", device_root=device_root, requested_variant="py", **_context(False)
    )

    assert variant is not None
    assert variant.variant_id == "py"


def test_select_variant_raises_for_unknown_id(tmp_path: Path):
    device_root = _setup_device_root(tmp_path)
    entries = load_package_entries(device_root)

    with pytest.raises(ValueError, match="Unknown node package id"):
        select_variant(entries, "missing", device_root=device_root, **_context(True))


def _setup_variant_device_root(tmp_path: Path) -> Path:
    device_root = tmp_path / "device"
    _write_json(
        device_root / "node_pkgs" / "index.json",
        {"version": 2, "packages": [{"id": "pulse", "manifest": "pulse/manifest.json"}]},
    )
    _write_json(
        device_root / "node_pkgs" / "pulse" / "manifest.json",
        {
            "id": "pulse",
            "version": "1.0.0",
            "manifestVersion": 2,
            "variants": {
                "py": {"requiredCapabilities": [], "precedence": 0},
                "viper": {"requiredCapabilities": ["viper"], "precedence": 10},
            },
        },
    )
    return device_root


def test_requested_default_variant_selects_the_default_implementation(tmp_path: Path):
    device_root = _setup_variant_device_root(tmp_path)
    entries = load_package_entries(device_root)

    variant = select_variant(
        entries,
        "pulse",
        device_root=device_root,
        requested_variant=DEFAULT_VARIANT_ID,
        **_context(True),
    )

    assert variant is not None
    assert variant.variant_id == "py"
    assert variant.precedence == 0


def test_explicit_variant_pick_resolves_the_named_variant(tmp_path: Path):
    device_root = _setup_variant_device_root(tmp_path)
    entries = load_package_entries(device_root)

    variant = select_variant(
        entries,
        "pulse",
        device_root=device_root,
        requested_variant="viper",
        **_context(True),
    )

    assert variant is not None
    assert variant.variant_id == "viper"


def test_explicit_unsatisfiable_variant_raises_with_the_missing_group(tmp_path: Path):
    device_root = _setup_variant_device_root(tmp_path)
    entries = load_package_entries(device_root)

    with pytest.raises(VariantCapabilitiesUnsatisfiedError) as error:
        select_variant(
            entries,
            "pulse",
            device_root=device_root,
            requested_variant="viper",
            **_context(False),
        )

    assert error.value.package_id == "pulse"
    assert error.value.variant == "viper"
    assert error.value.missing == (("viper",),)


def test_explicit_unknown_variant_raises(tmp_path: Path):
    device_root = _setup_variant_device_root(tmp_path)
    entries = load_package_entries(device_root)

    with pytest.raises(VariantUnknownError) as error:
        select_variant(
            entries,
            "pulse",
            device_root=device_root,
            requested_variant="cobra",
            **_context(True),
        )

    assert error.value.package_id == "pulse"
    assert error.value.requested == "cobra"
    assert "viper" in error.value.known


def test_unknown_variant_reports_default_in_known(tmp_path: Path):
    device_root = _setup_variant_device_root(tmp_path)
    entries = load_package_entries(device_root)

    with pytest.raises(VariantUnknownError) as error:
        select_variant(
            entries,
            "pulse",
            device_root=device_root,
            requested_variant="nope",
            **_context(True),
        )

    assert DEFAULT_VARIANT_ID in error.value.known
    assert "viper" in error.value.known
    assert DEFAULT_VARIANT_ID in error.value.hint
    assert "viper" in error.value.hint


def test_requested_default_variant_without_default_variant_is_unknown(tmp_path: Path):
    device_root = tmp_path / "device"
    _write_json(
        device_root / "node_pkgs" / "index.json",
        {"version": 2, "packages": [{"id": "pulse", "manifest": "pulse/manifest.json"}]},
    )
    _write_json(
        device_root / "node_pkgs" / "pulse" / "manifest.json",
        {
            "id": "pulse",
            "version": "1.0.0",
            "manifestVersion": 2,
            "variants": {"viper": {"requiredCapabilities": ["viper"], "precedence": 10}},
        },
    )
    entries = load_package_entries(device_root)

    with pytest.raises(VariantUnknownError) as error:
        select_variant(
            entries,
            "pulse",
            device_root=device_root,
            requested_variant=DEFAULT_VARIANT_ID,
            **_context(True),
        )

    assert error.value.requested == DEFAULT_VARIANT_ID
    assert error.value.known == ("viper",)


def _setup_single_audio_device_root(tmp_path: Path) -> Path:
    device_root = tmp_path / "device"
    _write_json(
        device_root / "node_pkgs" / "index.json",
        {
            "version": 2,
            "packages": [
                {"id": "core", "manifest": "core/manifest.json"},
                {"id": "audio", "manifest": "audio/manifest.json"},
            ],
        },
    )
    _write_json(
        device_root / "node_pkgs" / "core" / "manifest.json",
        {"id": "core", "version": "1.5.0", "manifestVersion": 2, "variants": {"py": {}}},
    )
    _write_json(
        device_root / "node_pkgs" / "audio" / "manifest.json",
        {"id": "audio", "version": "0.36.0", "manifestVersion": 2, "variants": {"viper": {}}},
    )
    _write_json(device_root / "tools" / "manifest.json", {"files": [], "version": "0.2.1"})
    return device_root


def test_collect_constituent_versions_resolves_audio_id_to_folder(tmp_path: Path):
    device_root = _setup_single_audio_device_root(tmp_path)

    _, node_packages = _collect_constituent_versions(
        device_root=device_root,
        runtime_payload={"nodePackages": {"global": ["audio", "core"], "local": []}},
    )

    assert node_packages.merged()["audio"] == "0.36.0"
    assert node_packages.merged()["core"] == "1.5.0"


def test_collect_node_packages_resolves_audio_id_to_folder(tmp_path: Path):
    device_root = _setup_single_audio_device_root(tmp_path)

    inventory = collect_package_versions(
        device_root=device_root,
        runtime_payload={"nodePackages": {"global": ["audio"], "local": []}},
        context=TargetPackageContext.none(),
    )

    assert inventory.merged()["audio"] == "0.36.0"

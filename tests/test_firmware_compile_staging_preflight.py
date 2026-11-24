from pathlib import Path

from micro_otter.tools.firmware_compile.staging_models import RuntimePackageAsset, RuntimePayload
from micro_otter.tools.firmware_compile.staging_preflight import build_staging_preflight


def _sample_payload(runtime_root: Path) -> RuntimePayload:
    assets = (
        RuntimePackageAsset(
            package_id="core",
            package_version="1.0.1",
            source_path=runtime_root / "pkg" / "core.py",
            target_rel_path="otter_core/core.py",
        ),
        RuntimePackageAsset(
            package_id="webview",
            package_version="1.0.0",
            source_path=runtime_root / "pkg" / "utils.py",
            target_rel_path="otter_webview/utils.py",
        ),
    )

    return RuntimePayload(
        runtime_id="general",
        runtime_version="1.11.0",
        runtime_root=runtime_root,
        runtime_files=("main.py",),
        tools_files=("wifi_manager.py",),
        package_assets=assets,
    )


def test_build_staging_preflight_normalizes_package_targets(tmp_path: Path):
    runtime_root = tmp_path / "runtime"
    payload = _sample_payload(runtime_root)

    result = build_staging_preflight(payload=payload, device_root=tmp_path / "device")

    targets = [entry.target_rel_path for entry in result.entries if entry.origin == "package"]
    assert "otter_core/core.py" in targets
    assert "otter_webview/utils.py" in targets


def test_build_staging_preflight_keeps_variant_module_namespace(tmp_path: Path):
    runtime_root = tmp_path / "runtime"
    payload = RuntimePayload(
        runtime_id="general",
        runtime_version="1.11.0",
        runtime_root=runtime_root,
        runtime_files=(),
        tools_files=(),
        package_assets=(
            RuntimePackageAsset(
                package_id="audio",
                package_version="0.36.0",
                source_path=runtime_root / "pkg" / "__init__.py",
                target_rel_path="otter_audio_viper/__init__.py",
            ),
        ),
    )

    result = build_staging_preflight(payload=payload, device_root=tmp_path / "device")

    targets = [entry.target_rel_path for entry in result.entries if entry.origin == "package"]
    assert targets == ["otter_audio_viper/__init__.py"]


def test_build_staging_preflight_keeps_addon_module_namespace(tmp_path: Path):
    runtime_root = tmp_path / "runtime"
    payload = RuntimePayload(
        runtime_id="general",
        runtime_version="1.11.0",
        runtime_root=runtime_root,
        runtime_files=(),
        tools_files=(),
        package_assets=(
            RuntimePackageAsset(
                package_id="pulse",
                package_version="1.0.0",
                source_path=runtime_root / "pkg" / "__init__.py",
                target_rel_path="moa_pulse_viper/__init__.py",
            ),
        ),
    )

    result = build_staging_preflight(payload=payload, device_root=tmp_path / "device")

    targets = [entry.target_rel_path for entry in result.entries if entry.origin == "package"]
    assert targets == ["moa_pulse_viper/__init__.py"]


def test_build_staging_preflight_prefixes_tools_folder(tmp_path: Path):
    runtime_root = tmp_path / "runtime"
    payload = _sample_payload(runtime_root)

    result = build_staging_preflight(payload=payload, device_root=tmp_path / "device")

    targets = [entry.target_rel_path for entry in result.entries if entry.origin == "tools"]
    assert targets == ["tools/wifi_manager.py"]


def test_build_staging_preflight_detects_duplicate_targets(tmp_path: Path):
    runtime_root = tmp_path / "runtime"
    payload = RuntimePayload(
        runtime_id="general",
        runtime_version="1.11.0",
        runtime_root=runtime_root,
        runtime_files=("otter_core/system.py",),
        tools_files=(),
        package_assets=(
            RuntimePackageAsset(
                package_id="core",
                package_version="1.0.1",
                source_path=runtime_root / "pkg" / "system.py",
                target_rel_path="otter_core/system.py",
            ),
        ),
    )

    result = build_staging_preflight(payload=payload, device_root=tmp_path / "device")

    assert len(result.conflicts) == 1
    assert result.conflicts[0].target_rel_path == "otter_core/system.py"

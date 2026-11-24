from __future__ import annotations

import importlib
import sys
from pathlib import Path

from tests.helpers.generated_runtime_fixture import create_generated_runtime_modules_root


def _load_templates_module(runtime_root: Path):
    inserted = False
    if str(runtime_root) not in sys.path:
        sys.path.insert(0, str(runtime_root))
        inserted = True

    try:
        module = importlib.import_module("otter_runtime.bootstrap_setup_templates")
        return importlib.reload(module)
    finally:
        if inserted:
            sys.path.remove(str(runtime_root))


def test_bootstrap_setup_templates_freeze_required_paths_and_policy_matrix(tmp_path: Path):
    module = _load_templates_module(create_generated_runtime_modules_root(tmp_path))

    assert module.TEMPLATE_SCHEMA_VERSION == 1
    assert module.TEMPLATE_PATHS == (
        "/manifest.json",
        "/device.json",
        "/app/main_loop.py",
    )
    assert module.DEVICE_JSON_PRESERVED_FIELDS == ("targetUserDescription",)
    assert module.FORCE_REQUIRED_OVERWRITE_PATHS == ("/app/main_loop.py",)


def test_bootstrap_setup_templates_build_runtime_owned_templates(tmp_path: Path):
    module = _load_templates_module(create_generated_runtime_modules_root(tmp_path))

    manifest = module.build_manifest_template()
    assert manifest["id"] == "general"
    assert manifest["name"] == "Micro-Otter"
    assert "version" in manifest
    assert manifest["customView"] == "custom_view.json"

    device = module.build_device_template()
    assert device["runtime"] == "general"
    assert device["targetConfigPath"] == "/device/targets/active_target.json"


def test_bootstrap_setup_templates_take_target_id_from_runtime_identity(tmp_path: Path):
    module = _load_templates_module(create_generated_runtime_modules_root(tmp_path))

    original_summary = dict(module.RUNTIME_IDENTITY_MODE_SUMMARY)
    module.RUNTIME_IDENTITY_MODE_SUMMARY["target"] = {"id": "esp32_generic"}

    try:
        device = module.build_device_template()
    finally:
        module.RUNTIME_IDENTITY_MODE_SUMMARY.clear()
        module.RUNTIME_IDENTITY_MODE_SUMMARY.update(original_summary)

    assert device["targetId"] == "esp32_generic"
    assert device["targetDisplayName"] == ""
    assert device["targetDescription"] == ""
    assert device["targetConfigPath"] == "/device/targets/active_target.json"


def test_bootstrap_setup_templates_leave_specific_target_unset_by_default(tmp_path: Path):
    module = _load_templates_module(create_generated_runtime_modules_root(tmp_path))

    device = module.build_device_template()
    assert device["targetId"] is None
    assert device["targetDisplayName"] == ""
    assert device["targetDescription"] == ""

    assert not hasattr(module, "build_active_target_template")
    assert not hasattr(module, "TARGET_TEMPLATE_DEFAULT")


def test_bootstrap_setup_templates_manifest_preserves_additive_target_metadata(tmp_path: Path):
    module = _load_templates_module(create_generated_runtime_modules_root(tmp_path))

    original_target = module.RUNTIME_IDENTITY_MODE_SUMMARY.get("target")
    module.RUNTIME_IDENTITY_MODE_SUMMARY["target"] = {
        "id": "esp32_wroom",
        "compile": {"board": "esp32", "port": "esp32"},
        "mappingRuleId": "esp32-default",
        "mappingSource": "compile_target_mappings.json",
    }

    try:
        manifest = module.build_manifest_template()
    finally:
        if original_target is None:
            module.RUNTIME_IDENTITY_MODE_SUMMARY.pop("target", None)
        else:
            module.RUNTIME_IDENTITY_MODE_SUMMARY["target"] = original_target

    assert manifest["target"]["id"] == "esp32_wroom"
    assert manifest["target"]["compile"]["board"] == "esp32"
    assert manifest["target"]["mappingRuleId"] == "esp32-default"


def test_bootstrap_setup_templates_expose_deterministic_builder_and_summary_contracts(
    tmp_path: Path,
):
    module = _load_templates_module(create_generated_runtime_modules_root(tmp_path))

    builders = module.get_template_builders()
    assert sorted(builders.keys()) == sorted(module.TEMPLATE_PATHS)

    summary = module.get_template_source_summary()
    assert summary["schemaVersion"] == 1
    assert summary["paths"] == list(module.TEMPLATE_PATHS)
    assert summary["deviceJsonPreservedFields"] == ["targetUserDescription"]
    assert summary["forceRequiredOverwritePaths"] == ["/app/main_loop.py"]


def test_bootstrap_setup_templates_default_main_loop_has_elapsed_seconds_heartbeat(tmp_path: Path):
    module = _load_templates_module(create_generated_runtime_modules_root(tmp_path))

    main_loop = module.build_main_loop_fallback_template()

    assert "Nothing to do for {} seconds" in main_loop
    assert "elapsed_seconds" in main_loop
    assert "await asyncio.sleep_ms(1000)" in main_loop

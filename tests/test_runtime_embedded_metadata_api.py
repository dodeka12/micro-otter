from __future__ import annotations

import importlib
import sys
from pathlib import Path

from tests.helpers.generated_runtime_fixture import create_generated_runtime_modules_root


def _load_runtime_api_module(runtime_root: Path):
    inserted = False
    if str(runtime_root) not in sys.path:
        sys.path.insert(0, str(runtime_root))
        inserted = True

    try:
        module = importlib.import_module("otter_runtime.embedded_metadata_api")
        return importlib.reload(module)
    finally:
        if inserted:
            sys.path.remove(str(runtime_root))


def test_embedded_metadata_api_returns_expected_payload_shapes(tmp_path: Path):
    runtime_root = create_generated_runtime_modules_root(tmp_path)
    module = _load_runtime_api_module(runtime_root)

    runtime = module.get_runtime_identity_mode_summary()
    packages = module.get_embedded_packages_summary()
    inventory = module.get_embedded_inventory_hash_payload()
    bundle = module.get_embedded_metadata_bundle()

    assert runtime["mode"] == "embedded"
    assert runtime["id"] == "general"
    assert "version" in runtime

    assert packages["totalPackages"] == 0
    assert packages["totalFiles"] == 0
    assert isinstance(packages["packages"], list)

    assert inventory["schemaVersion"] == 1
    assert isinstance(inventory["files"], list)

    assert bundle["runtime"]["id"] == "general"
    assert "packagesSummary" in bundle
    assert "inventory" in bundle


def test_embedded_metadata_api_returns_same_constant_reference_each_call(tmp_path: Path):
    runtime_root = create_generated_runtime_modules_root(tmp_path)
    module = _load_runtime_api_module(runtime_root)

    # Getters now return the frozen module-level constants directly (no clone).
    # Two successive calls must return the exact same object.
    first_runtime = module.get_runtime_identity_mode_summary()
    second_runtime = module.get_runtime_identity_mode_summary()
    assert first_runtime is second_runtime
    assert first_runtime["id"] == "general"

    first_packages = module.get_embedded_packages_summary()
    second_packages = module.get_embedded_packages_summary()
    assert first_packages is second_packages
    assert first_packages["packages"] == []


def test_serialize_json_payload_produces_compact_output(tmp_path: Path):
    import json

    runtime_root = create_generated_runtime_modules_root(tmp_path)
    module = _load_runtime_api_module(runtime_root)

    payload = {"a": 1, "b": [1, 2]}
    result = module._serialize_json_payload(payload)

    # Output must be valid JSON
    parsed = json.loads(result)
    assert parsed == payload
    # Compact: no newlines, no leading indentation whitespace on any line
    assert "\n" not in result

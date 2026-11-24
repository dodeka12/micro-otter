from __future__ import annotations

import importlib
import sys
from pathlib import Path

from tests.helpers.generated_runtime_fixture import create_generated_runtime_modules_root


def _load_contract_module(runtime_root: Path):
    inserted = False
    if str(runtime_root) not in sys.path:
        sys.path.insert(0, str(runtime_root))
        inserted = True

    try:
        module = importlib.import_module("otter_runtime.bootstrap_setup_contract")
        return importlib.reload(module)
    finally:
        if inserted:
            sys.path.remove(str(runtime_root))


def test_bootstrap_setup_contract_freezes_required_paths_and_vocabularies(tmp_path: Path):
    module = _load_contract_module(create_generated_runtime_modules_root(tmp_path))

    assert module.SCHEMA_VERSION == 1
    assert module.REQUIRED_WRITABLE_PATHS == (
        "/manifest.json",
        "/device.json",
        "/app/main_loop.py",
    )
    assert "/device/targets/active_target.json" not in module.REQUIRED_WRITABLE_PATHS
    assert module.FILE_ACTION_RESULTS == ("created", "updated", "unchanged", "error")
    assert module.ERROR_CATEGORIES == (
        "validation",
        "filesystem",
        "runtime",
        "unsupported",
        "internal",
    )


def test_bootstrap_setup_contract_builds_and_validates_status_payload_shape(tmp_path: Path):
    module = _load_contract_module(create_generated_runtime_modules_root(tmp_path))

    files = [
        module.make_status_file_row("/manifest.json", exists=True, valid=True),
        module.make_status_file_row(
            "/device.json",
            exists=False,
            valid=False,
            reason="missing",
        ),
    ]
    errors = [module.make_error_row("validation", "device schema invalid", path="/device.json")]

    payload = module.make_status_response(files, errors)

    assert payload["schemaVersion"] == 1
    assert payload["ready"] is False
    assert payload["missingOrInvalid"] == [{"path": "/device.json", "reason": "missing"}]
    assert module.validate_status_response_shape(payload) is True


def test_bootstrap_setup_contract_builds_and_validates_setup_payload_shape(tmp_path: Path):
    module = _load_contract_module(create_generated_runtime_modules_root(tmp_path))

    results = [
        module.make_setup_result_row("/manifest.json", "created"),
        module.make_setup_result_row("/device.json", "unchanged"),
    ]
    payload = module.make_setup_response(results)

    assert payload["schemaVersion"] == 1
    assert payload["ok"] is True
    assert module.validate_setup_response_shape(payload) is True

    failed = module.make_setup_response(
        [module.make_setup_result_row("/device/targets/active_target.json", "error")],
        [module.make_error_row("filesystem", "write failed")],
    )

    assert failed["ok"] is False
    assert module.validate_setup_response_shape(failed) is True

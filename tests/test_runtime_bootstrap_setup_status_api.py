from __future__ import annotations

import importlib
import json
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


def test_bootstrap_setup_status_reports_ready_when_required_files_are_valid(tmp_path: Path):
    module = _load_runtime_api_module(create_generated_runtime_modules_root(tmp_path))

    payloads = {
        "/manifest.json": json.dumps(
            {
                "id": "general",
                "name": "Micro-Otter",
                "version": "1.11.0",
            }
        ),
        "/device.json": json.dumps(
            {
                "runtime": "general",
                "version": "1.11.0",
                "targetId": "esp32_generic",
                "targetConfigPath": "/device/targets/active_target.json",
            }
        ),
        "/app/main_loop.py": "import uasyncio as asyncio\n",
        "/custom_view.json": json.dumps(
            {
                "$schema": "https://micro-otter.dev/schemas/custom-view-v1.json",
                "version": "1.0.0",
                "sections": [],
            }
        ),
    }

    status = module.get_bootstrap_setup_status(payloads.__getitem__)

    assert status["schemaVersion"] == 1
    assert status["ready"] is True
    assert status["missingOrInvalid"] == []
    assert status["errors"] == []
    assert {row["path"] for row in status["files"]} == {
        "/manifest.json",
        "/device.json",
        "/app/main_loop.py",
        "/custom_view.json",
    }
    assert "/device/targets/active_target.json" not in {row["path"] for row in status["files"]}


def test_bootstrap_setup_status_reports_missing_and_invalid_files(tmp_path: Path):
    module = _load_runtime_api_module(create_generated_runtime_modules_root(tmp_path))

    payloads = {
        "/manifest.json": "not-json",
        "/device.json": json.dumps(
            {
                "runtime": "general",
                "version": "1.11.0",
                "targetId": "",
                "targetConfigPath": "/device/targets/active_target.json",
            }
        ),
        "/app/main_loop.py": "   \n",
    }

    def reader(path):
        if path == "/device.json":
            return payloads[path]
        if path == "/manifest.json":
            return payloads[path]
        if path == "/app/main_loop.py":
            return payloads[path]
        raise OSError("missing")

    status = module.get_bootstrap_setup_status(reader)

    assert status["ready"] is False
    reasons_by_path = {entry["path"]: entry["reason"] for entry in status["files"]}

    assert reasons_by_path["/manifest.json"] == "invalid-json"
    assert reasons_by_path["/device.json"] == "missing-required-device-field"
    assert reasons_by_path["/app/main_loop.py"] == "empty-main-loop"
    assert reasons_by_path["/custom_view.json"] == "missing"
    assert "/device/targets/active_target.json" not in reasons_by_path

    assert len(status["missingOrInvalid"]) == 4

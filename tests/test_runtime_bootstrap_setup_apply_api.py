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


def _make_memory_fs(initial=None):
    files = dict(initial or {})

    def reader(path):
        if path not in files:
            raise OSError("missing")
        return files[path]

    def writer(path, content):
        files[path] = content

    return files, reader, writer


def test_apply_bootstrap_setup_creates_files_and_is_idempotent_on_repeat(tmp_path: Path):
    module = _load_runtime_api_module(create_generated_runtime_modules_root(tmp_path))
    files, reader, writer = _make_memory_fs()

    first = module.apply_bootstrap_setup(file_reader=reader, file_writer=writer)
    second = module.apply_bootstrap_setup(file_reader=reader, file_writer=writer)

    assert first["schemaVersion"] == 1
    assert first["ok"] is True
    assert [entry["action"] for entry in first["results"]] == [
        "created",
        "created",
        "created",
        "created",
    ]

    assert second["ok"] is True
    assert [entry["action"] for entry in second["results"]] == [
        "unchanged",
        "unchanged",
        "unchanged",
        "unchanged",
    ]

    assert "/manifest.json" in files
    assert "/device.json" in files
    assert "/app/main_loop.py" in files
    assert "/custom_view.json" in files
    assert "/device/targets/active_target.json" not in files
    assert [entry["path"] for entry in first["results"]] == [
        "/manifest.json",
        "/device.json",
        "/app/main_loop.py",
        "/custom_view.json",
    ]


def test_apply_bootstrap_setup_preserves_allowed_device_fields(tmp_path: Path):
    module = _load_runtime_api_module(create_generated_runtime_modules_root(tmp_path))
    existing_device = {
        "runtime": "legacy",
        "version": "0.0.1",
        "targetId": "legacy_target",
        "targetConfigPath": "/device/targets/active_target.json",
        "targetUserDescription": "My bench setup",
    }

    files, reader, writer = _make_memory_fs(
        {
            "/device.json": json.dumps(existing_device),
            "/manifest.json": json.dumps({"id": "old", "name": "Old", "version": "1"}),
            "/app/main_loop.py": "import uasyncio as asyncio\n\nwhile True:\n    pass\n",
        }
    )

    result = module.apply_bootstrap_setup(file_reader=reader, file_writer=writer)

    assert result["ok"] is True
    parsed_device = json.loads(files["/device.json"])
    assert parsed_device["targetUserDescription"] == "My bench setup"
    assert "/custom_view.json" in files


def test_apply_bootstrap_setup_preserves_existing_main_loop_even_with_force_option(tmp_path: Path):
    module = _load_runtime_api_module(create_generated_runtime_modules_root(tmp_path))
    files, reader, writer = _make_memory_fs(
        {
            "/manifest.json": json.dumps(
                {"id": "general", "name": "Micro-Otter", "version": "1.11.0"}
            ),
            "/device.json": json.dumps(
                {
                    "runtime": "general",
                    "version": "1.11.0",
                    "targetId": "generic_micropython",
                    "targetConfigPath": "/device/targets/active_target.json",
                }
            ),
            "/app/main_loop.py": "print('custom')\n",
        }
    )

    without_force = module.apply_bootstrap_setup(file_reader=reader, file_writer=writer)
    main_loop_result = [
        entry for entry in without_force["results"] if entry["path"] == "/app/main_loop.py"
    ][0]
    assert main_loop_result["action"] == "unchanged"
    assert main_loop_result["reason"] == "preserved-existing"
    assert files["/app/main_loop.py"] == "print('custom')\n"

    with_force = module.apply_bootstrap_setup(
        options={"force": True},
        file_reader=reader,
        file_writer=writer,
    )
    forced_main_loop_result = [
        entry for entry in with_force["results"] if entry["path"] == "/app/main_loop.py"
    ][0]
    assert forced_main_loop_result["action"] == "unchanged"
    assert forced_main_loop_result["reason"] == "preserved-existing"
    assert files["/app/main_loop.py"] == "print('custom')\n"


def test_apply_bootstrap_setup_falls_back_when_json_kwargs_are_unsupported(tmp_path: Path):
    module = _load_runtime_api_module(create_generated_runtime_modules_root(tmp_path))
    files, reader, writer = _make_memory_fs()

    original_dumps = module.json.dumps

    def _micropython_like_dumps(payload, *args, **kwargs):
        if "sort_keys" in kwargs or "indent" in kwargs:
            raise TypeError("extra keyword arguments given")
        return original_dumps(payload, *args, **kwargs)

    module.json.dumps = _micropython_like_dumps
    try:
        result = module.apply_bootstrap_setup(file_reader=reader, file_writer=writer)
    finally:
        module.json.dumps = original_dumps

    assert result["ok"] is True
    assert [entry["action"] for entry in result["results"]] == [
        "created",
        "created",
        "created",
        "created",
    ]
    assert json.loads(files["/manifest.json"])["id"]
    assert json.loads(files["/custom_view.json"])["version"] == "1.0.0"


def test_apply_bootstrap_setup_ignores_target_metadata_option(tmp_path: Path):
    module = _load_runtime_api_module(create_generated_runtime_modules_root(tmp_path))
    files, reader, writer = _make_memory_fs()

    result = module.apply_bootstrap_setup(
        options={
            "targetMetadata": {
                "targetId": "esp32_wroom",
                "displayName": "ESP32-WROOM",
                "description": "Mapped compile target",
                "compile": {"board": "esp32", "port": "esp32"},
                "mappingRuleId": "esp32-default",
                "mappingSource": "compile_target_mappings.json",
                "mappingConfidence": "exact",
            }
        },
        file_reader=reader,
        file_writer=writer,
    )

    assert result["ok"] is True
    assert [entry["path"] for entry in result["results"]] == [
        "/manifest.json",
        "/device.json",
        "/app/main_loop.py",
        "/custom_view.json",
    ]

    # Target content is host-owned: the unknown option must not leak into any template.
    manifest = json.loads(files["/manifest.json"])
    assert "target" not in manifest or "displayName" not in manifest.get("target", {})
    device_info = json.loads(files["/device.json"])
    assert device_info["targetId"] != "esp32_wroom"
    assert device_info["targetDisplayName"] == ""
    assert "/device/targets/active_target.json" not in files
    assert json.loads(files["/custom_view.json"])["version"] == "1.0.0"


def test_default_text_writer_creates_parent_directories(tmp_path: Path):
    module = _load_runtime_api_module(create_generated_runtime_modules_root(tmp_path))
    nested_file = tmp_path / "app" / "nested" / "main_loop.py"

    module._default_text_writer(str(nested_file), "{}")

    assert nested_file.exists()
    assert nested_file.read_text(encoding="utf-8") == "{}"

from __future__ import annotations

import importlib
import sys
from pathlib import Path

from tests.helpers.generated_runtime_fixture import create_generated_runtime_modules_root


def _load_startup_module(runtime_root: Path):
    inserted = False
    if str(runtime_root) not in sys.path:
        sys.path.insert(0, str(runtime_root))
        inserted = True

    try:
        module = importlib.import_module("otter_runtime.bootstrap_setup_startup")
        return importlib.reload(module)
    finally:
        if inserted:
            sys.path.remove(str(runtime_root))


def test_bootstrap_setup_startup_freezes_adapter_contract(tmp_path: Path):
    module = _load_startup_module(create_generated_runtime_modules_root(tmp_path))

    assert module.STARTUP_TRIGGER_SCHEMA_VERSION == 1
    assert module.SUPPORTED_STARTUP_ADAPTERS == (
        module.STARTUP_ADAPTER_BOOT_PY,
        module.STARTUP_ADAPTER_TARGET_ENTRYPOINT,
    )

    context = module.make_startup_context(module.STARTUP_ADAPTER_BOOT_PY, reason="power-on")
    assert context == {
        "schemaVersion": 1,
        "adapter": "boot.py",
        "reason": "power-on",
    }


def test_bootstrap_setup_startup_runs_once_and_returns_skip_after_first_call(tmp_path: Path):
    module = _load_startup_module(create_generated_runtime_modules_root(tmp_path))
    module.reset_startup_setup_latch_for_tests()

    calls = []

    def setup_runner(context):
        calls.append(context)
        return {"ok": True}

    first = module.ensure_bootstrap_setup_once(
        setup_runner,
        module.make_startup_context(module.STARTUP_ADAPTER_BOOT_PY),
    )
    second = module.ensure_bootstrap_setup_once(
        setup_runner,
        module.make_startup_context(module.STARTUP_ADAPTER_BOOT_PY),
    )

    assert first["executed"] is True
    assert first["reason"] == "invoked"
    assert first["result"] == {"ok": True}
    assert second == {
        "schemaVersion": 1,
        "executed": False,
        "reason": "already-executed",
    }
    assert len(calls) == 1


def test_bootstrap_setup_startup_rejects_unsupported_adapter_context(tmp_path: Path):
    module = _load_startup_module(create_generated_runtime_modules_root(tmp_path))
    module.reset_startup_setup_latch_for_tests()

    def setup_runner(_context):
        return {"ok": True}

    try:
        module.ensure_bootstrap_setup_once(setup_runner, {"adapter": "unknown"})
    except ValueError as exc:
        assert "Unsupported startup adapter" in str(exc)
    else:
        raise AssertionError("Expected ValueError for unsupported startup adapter")


def test_run_bootstrap_setup_from_startup_uses_shared_idempotent_trigger(tmp_path: Path):
    runtime_root = create_generated_runtime_modules_root(tmp_path)
    module = _load_startup_module(runtime_root)
    module.reset_startup_setup_latch_for_tests()

    api_module = importlib.import_module("otter_runtime.embedded_metadata_api")
    original_apply = api_module.apply_bootstrap_setup
    calls = []

    def _fake_apply():
        calls.append(True)
        return {"ok": True}

    api_module.apply_bootstrap_setup = _fake_apply
    try:
        first = module.run_bootstrap_setup_from_startup()
        second = module.run_bootstrap_setup_from_startup()
    finally:
        api_module.apply_bootstrap_setup = original_apply

    assert first["executed"] is True
    assert first["result"] == {"ok": True}
    assert second["executed"] is False
    assert second["reason"] == "already-executed"
    assert len(calls) == 1

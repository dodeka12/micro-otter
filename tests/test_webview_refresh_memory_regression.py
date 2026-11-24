import asyncio
import gc
import importlib.util
import sys
import tracemalloc
import types
from pathlib import Path

REFRESH_HOOK_PATH = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "micro_otter"
    / "nodes"
    / "device"
    / "node_pkgs"
    / "webview"
    / "otter_webview"
    / "refresh_hook.py"
)


def _load_refresh_hook_module():
    original_micropython = sys.modules.get("micropython")
    micropython_module = types.ModuleType("micropython")
    micropython_module.const = lambda value: value
    sys.modules["micropython"] = micropython_module
    try:
        spec = importlib.util.spec_from_file_location(
            "refresh_hook_memory_under_test", REFRESH_HOOK_PATH
        )
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module
    finally:
        if original_micropython is None:
            del sys.modules["micropython"]
        else:
            sys.modules["micropython"] = original_micropython


class _FakeRequest:
    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


class _StableWebInterface:
    def __init__(self, template_snapshot):
        self._template_snapshot = dict(template_snapshot)

    def consume_webview_values_snapshot(self, clear_after_read=True):
        del clear_after_read
        # Return a fresh copy to mimic realistic response shaping work.
        return dict(self._template_snapshot)

    def remove_webview_value_keys(self, keys):
        del keys
        return 0

    def publish_webview_values(self, values):
        del values
        return 0


async def _run_refresh_iterations(module, iterations, request, context, refresh_bindings):
    for _ in range(iterations):
        response = await module.handle_post_webview_refresh(
            request=request,
            context=context,
            refresh_bindings=refresh_bindings,
            post_refresh_route="/api/webview/refresh",
        )
        assert response["success"] is True
        assert len(response["updates"]) == len(refresh_bindings)


def test_refresh_hook_repeated_calls_have_stable_memory_envelope():
    module = _load_refresh_hook_module()

    refresh_bindings = {
        f"k_{index}": {
            "element_id": f"el-{index}",
            "kind": "content",
        }
        for index in range(12)
    }
    snapshot = {key: {"value": idx} for idx, key in enumerate(refresh_bindings.keys())}

    request = _FakeRequest({"clearAfterRead": False})
    context = {"web_interface": _StableWebInterface(snapshot)}

    gc.collect()
    tracemalloc.start()
    start_current, _ = tracemalloc.get_traced_memory()

    asyncio.run(
        _run_refresh_iterations(
            module,
            iterations=400,
            request=request,
            context=context,
            refresh_bindings=refresh_bindings,
        )
    )

    gc.collect()
    end_current, end_peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    # Guardrail check: repeated refresh handling should not show runaway retained allocations.
    assert end_current - start_current < 300_000
    assert end_peak < 2_500_000

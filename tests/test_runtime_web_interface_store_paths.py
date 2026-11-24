import importlib.util
import sys
import tempfile
import types
from pathlib import Path

WEB_INTERFACE_PATH = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "micro_otter"
    / "nodes"
    / "device"
    / "runtime"
    / "general"
    / "otter_runtime"
    / "web_interface.py"
)


def _load_web_interface_module():
    uasyncio_module = types.ModuleType("uasyncio")
    uasyncio_module.create_task = lambda coro: coro

    async def sleep_ms(_ms):
        return None

    uasyncio_module.sleep_ms = sleep_ms

    otter_runtime_module = types.ModuleType("otter_runtime")
    http_request_module = types.ModuleType("otter_runtime.http_request")
    web_server_module = types.ModuleType("otter_runtime.web_server")
    tools_module = types.ModuleType("tools")
    runtime_log_module = types.ModuleType("tools.runtime_log")
    micropython_module = types.ModuleType("micropython")

    class _HttpMethod:
        GET = "GET"
        POST = "POST"

    class _HttpReturnType:
        TEXT = "text/plain"
        HTML = "text/html"
        JSON = "application/json"

    class _FileResponse:
        def __init__(self, file_path, content_type, is_binary=False, headers=None):
            self.file_path = file_path
            self.content_type = content_type
            self.is_binary = is_binary
            self.headers = headers

    class _WebServer:
        def __init__(self, *args, **kwargs):
            del args, kwargs
            self.server = None

        def set_endpoint(self, *args, **kwargs):
            del args, kwargs

    http_request_module.HttpMethod = _HttpMethod
    http_request_module.HttpReturnType = _HttpReturnType
    web_server_module.FileResponse = _FileResponse
    web_server_module.WebServer = _WebServer
    runtime_log_module.log_event = lambda *args, **kwargs: None
    micropython_module.const = lambda value: value

    original_modules = {
        "uasyncio": sys.modules.get("uasyncio"),
        "otter_runtime": sys.modules.get("otter_runtime"),
        "otter_runtime.http_request": sys.modules.get("otter_runtime.http_request"),
        "otter_runtime.web_server": sys.modules.get("otter_runtime.web_server"),
        "tools": sys.modules.get("tools"),
        "tools.runtime_log": sys.modules.get("tools.runtime_log"),
        "micropython": sys.modules.get("micropython"),
    }

    sys.modules["uasyncio"] = uasyncio_module
    sys.modules["otter_runtime"] = otter_runtime_module
    sys.modules["otter_runtime.http_request"] = http_request_module
    sys.modules["otter_runtime.web_server"] = web_server_module
    sys.modules["tools"] = tools_module
    sys.modules["tools.runtime_log"] = runtime_log_module
    sys.modules["micropython"] = micropython_module

    try:
        spec = importlib.util.spec_from_file_location(
            "runtime_web_interface_under_test", WEB_INTERFACE_PATH
        )
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module
    finally:
        for name, original in original_modules.items():
            if original is None:
                del sys.modules[name]
            else:
                sys.modules[name] = original


class _PopGetOnlyStore:
    def __init__(self, values):
        self._values = dict(values)
        self.snapshot_calls = 0

    def pop_value(self, key, default=None):
        return self._values.pop(key, default)

    def get_value(self, key, default=None):
        return self._values.get(key, default)

    def snapshot(self):
        self.snapshot_calls += 1
        return dict(self._values)


def test_consume_keys_uses_pop_value_without_snapshot_when_clearing():
    module = _load_web_interface_module()
    web_interface = module.WebInterface(host_ip="127.0.0.1", enable_server=False)
    store = _PopGetOnlyStore({"k1": {"v": 1}, "k2": {"v": 2}})
    web_interface._web_data_store = store

    consumed = web_interface.consume_webview_values_keys(["k1"], clear_after_read=True)

    assert consumed == {"k1": {"v": 1}}
    assert store.snapshot_calls == 0
    assert store._values == {"k2": {"v": 2}}


def test_consume_keys_uses_get_value_without_snapshot_when_not_clearing():
    module = _load_web_interface_module()
    web_interface = module.WebInterface(host_ip="127.0.0.1", enable_server=False)
    store = _PopGetOnlyStore({"k1": {"v": 1}})
    web_interface._web_data_store = store

    consumed = web_interface.consume_webview_values_keys(["k1"], clear_after_read=False)

    assert consumed == {"k1": {"v": 1}}
    assert store.snapshot_calls == 0
    assert store._values == {"k1": {"v": 1}}


def test_get_hook_context_returns_same_dict_object_every_call():
    module = _load_web_interface_module()
    web_interface = module.WebInterface(host_ip="127.0.0.1", enable_server=False)

    first_ctx = web_interface._get_hook_context()
    second_ctx = web_interface._get_hook_context()

    assert first_ctx is second_ctx


def test_get_hook_context_updates_web_server_field_in_place():
    module = _load_web_interface_module()
    web_interface = module.WebInterface(host_ip="127.0.0.1", enable_server=False)

    ctx = web_interface._get_hook_context()
    assert ctx["web_server"] is None

    sentinel = object()
    web_interface.web_server = sentinel
    ctx2 = web_interface._get_hook_context()

    assert ctx2["web_server"] is sentinel
    assert ctx2 is ctx


def test_is_gzip_accepted_returns_true_for_common_header_values():
    module = _load_web_interface_module()
    web_interface = module.WebInterface(host_ip="127.0.0.1", enable_server=False)

    assert web_interface._is_gzip_accepted({"accept-encoding": "gzip"}) is True
    assert web_interface._is_gzip_accepted({"accept-encoding": "gzip, deflate"}) is True
    assert web_interface._is_gzip_accepted({"accept-encoding": "deflate, gzip;q=1.0"}) is True
    assert web_interface._is_gzip_accepted({"accept-encoding": "GZIP"}) is True


def test_is_gzip_accepted_returns_false_when_gzip_absent():
    module = _load_web_interface_module()
    web_interface = module.WebInterface(host_ip="127.0.0.1", enable_server=False)

    assert web_interface._is_gzip_accepted({"accept-encoding": "deflate"}) is False
    assert web_interface._is_gzip_accepted({"accept-encoding": ""}) is False
    assert web_interface._is_gzip_accepted({}) is False
    assert web_interface._is_gzip_accepted(None) is False


def test_load_webview_runtime_flags_reads_flags_from_temp_file():
    import json

    module = _load_web_interface_module()
    expected = {"needsWebDataStore": True, "postRefreshRoute": "/api/refresh"}

    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False
    ) as tmp:
        json.dump(expected, tmp)
        tmp_path = tmp.name

    original_path = module._WEBVIEW_RUNTIME_FLAGS_PATH
    try:
        module._WEBVIEW_RUNTIME_FLAGS_PATH = tmp_path
        web_interface = module.WebInterface(host_ip="127.0.0.1", enable_server=False)
        flags = web_interface._webview_runtime_flags
    finally:
        module._WEBVIEW_RUNTIME_FLAGS_PATH = original_path

    assert flags == expected


def test_load_webview_runtime_flags_returns_empty_dict_when_file_missing():
    module = _load_web_interface_module()
    module_path_backup = module._WEBVIEW_RUNTIME_FLAGS_PATH
    try:
        module._WEBVIEW_RUNTIME_FLAGS_PATH = "/nonexistent/path/does_not_exist.json"
        web_interface = module.WebInterface(host_ip="127.0.0.1", enable_server=False)
        flags = web_interface._webview_runtime_flags
    finally:
        module._WEBVIEW_RUNTIME_FLAGS_PATH = module_path_backup

    assert flags == {}


def test_static_route_request_counts_dict_removed_from_module():
    module = _load_web_interface_module()
    assert not hasattr(module, "_STATIC_ROUTE_REQUEST_COUNTS")


def test_webview_sync_epoch_starts_at_zero_and_increments():
    module = _load_web_interface_module()
    web_interface = module.WebInterface(host_ip="127.0.0.1", enable_server=False)

    assert web_interface.get_webview_sync_epoch() == 0
    assert web_interface.request_webview_sync() == 1
    assert web_interface.get_webview_sync_epoch() == 1
    assert web_interface.request_webview_sync() == 2
    assert web_interface.get_webview_sync_epoch() == 2

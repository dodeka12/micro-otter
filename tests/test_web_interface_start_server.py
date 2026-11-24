import importlib.util
import sys
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
    created_servers = []
    created_tasks = []

    uasyncio_module = types.ModuleType("uasyncio")

    def _create_task(coro):
        created_tasks.append(coro)
        close = getattr(coro, "close", None)
        if callable(close):
            close()
        return coro

    async def sleep_ms(_ms):
        return None

    uasyncio_module.create_task = _create_task
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
        def __init__(self, host=None, port=None):
            self.host = host
            self.port = port
            self.endpoints = []
            self.start_calls = 0
            created_servers.append(self)

        async def start(self):
            self.start_calls += 1

        def set_endpoint(self, *args, **kwargs):
            self.endpoints.append((args, kwargs))

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
            "runtime_web_interface_start_server_under_test", WEB_INTERFACE_PATH
        )
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
    finally:
        for name, original in original_modules.items():
            if original is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = original

    return module, created_servers, created_tasks


def test_boot_with_disabled_server_creates_no_server_or_task():
    module, created_servers, created_tasks = _load_web_interface_module()

    web_interface = module.WebInterface(host_ip="1.2.3.4", enable_server=False)

    assert web_interface.web_server is None
    assert created_servers == []
    assert created_tasks == []


def test_start_server_after_boot_creates_one_server_with_endpoints():
    module, created_servers, created_tasks = _load_web_interface_module()
    web_interface = module.WebInterface(host_ip="1.2.3.4", enable_server=False)

    started = web_interface.start_server()

    assert started is True
    assert len(created_servers) == 1
    assert web_interface.web_server is created_servers[0]
    assert web_interface.web_server.host == module._WEB_SERVER_BIND_HOST
    assert web_interface.web_server.port == module._WEB_SERVER_PORT
    assert web_interface.web_server.endpoints
    assert len(created_tasks) == 1


def test_start_server_is_idempotent():
    module, created_servers, created_tasks = _load_web_interface_module()
    web_interface = module.WebInterface(host_ip="1.2.3.4", enable_server=False)

    assert web_interface.start_server() is True
    assert web_interface.start_server() is False

    assert len(created_servers) == 1
    assert len(created_tasks) == 1


def test_start_server_with_external_server_is_not_owned():
    module, created_servers, created_tasks = _load_web_interface_module()
    web_interface = module.WebInterface(host_ip="1.2.3.4", enable_server=False)
    external_server = types.SimpleNamespace(
        endpoints=[], set_endpoint=lambda *args, **kwargs: None
    )

    assert web_interface.start_server(external_server) is True

    assert created_servers == []
    assert created_tasks == []
    assert web_interface.web_server is external_server


def test_set_host_ip_updates_published_address():
    module, _created_servers, _created_tasks = _load_web_interface_module()
    web_interface = module.WebInterface(host_ip="1.2.3.4", enable_server=False)

    web_interface.set_host_ip("5.6.7.8")

    assert web_interface.host_ip == "5.6.7.8"


def test_start_server_uses_custom_port():
    module, created_servers, created_tasks = _load_web_interface_module()
    web_interface = module.WebInterface(host_ip="1.2.3.4", enable_server=False, port=8080)

    web_interface.start_server()

    assert web_interface.web_server.port == 8080
    assert len(created_servers) == 1


def test_start_server_uses_default_port():
    module, created_servers, created_tasks = _load_web_interface_module()
    web_interface = module.WebInterface(host_ip="1.2.3.4", enable_server=False)

    web_interface.start_server()

    assert web_interface.web_server.port == module._WEB_SERVER_PORT

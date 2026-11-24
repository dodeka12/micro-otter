import importlib.util
import sys
import types
from pathlib import Path
from unittest.mock import patch

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

    def _create_task(coro):
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
        def __init__(
            self,
            file_path,
            content_type,
            is_binary=False,
            headers=None,
            content_length=None,
        ):
            self.file_path = file_path
            self.content_type = content_type
            self.is_binary = is_binary
            self.headers = headers
            self.content_length = content_length

    class _WebServer:
        def __init__(self, host=None, port=None):
            pass

        async def start(self):
            pass

        def set_endpoint(self, *args, **kwargs):
            pass

    http_request_module.HttpMethod = _HttpMethod
    http_request_module.HttpReturnType = _HttpReturnType
    web_server_module.FileResponse = _FileResponse
    web_server_module.WebServer = _WebServer
    runtime_log_module.log_event = lambda *args, **kwargs: None
    micropython_module.const = lambda value: value

    originals = {
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
            "web_interface_static_assets_under_test", WEB_INTERFACE_PATH
        )
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module
    finally:
        for name, original in originals.items():
            if original is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = original


def _req(headers):
    return types.SimpleNamespace(headers=headers)


def _fake_stat(sizes_by_path, mtimes_by_path=None):
    def stat(path):
        if path in sizes_by_path:
            return (
                0,
                0,
                0,
                0,
                0,
                0,
                sizes_by_path[path],
                0,
                (mtimes_by_path or {}).get(path, 0),
                0,
            )
        raise OSError("missing")

    return stat


def _resolve(module, headers, compressed, fallback, force_compressed_only=False):
    interface = module.WebInterface(host_ip="x", enable_server=False)
    return interface._resolve_static_asset_response(
        _req(headers),
        route="/app.js",
        content_type="application/javascript",
        compressed_path=compressed,
        fallback_path=fallback,
        force_compressed_only=force_compressed_only,
        is_binary_fallback=False,
    )

def test_gzip_client_gets_compressed_asset():
    module = _load_web_interface_module()
    sizes = {"/c.gz": 100}
    with patch.object(module._os, "stat", side_effect=_fake_stat(sizes)):
        resp = _resolve(module, {"accept-encoding": "gzip"}, "/c.gz", "/c.js")

    assert isinstance(resp, module.FileResponse)
    assert resp.file_path == "/c.gz"
    assert ("Content-Encoding", "gzip") in resp.headers


def test_non_gzip_client_gets_fallback():
    module = _load_web_interface_module()
    sizes = {"/c.gz": 100, "/c.js": 50}
    with patch.object(module._os, "stat", side_effect=_fake_stat(sizes)):
        resp = _resolve(module, {}, "/c.gz", "/c.js")

    assert isinstance(resp, module.FileResponse)
    assert resp.file_path == "/c.js"
    assert all(header[0] != "Content-Encoding" for header in resp.headers)


def test_compressed_only_with_non_gzip_client_returns_406():
    module = _load_web_interface_module()
    sizes = {"/c.gz": 100}
    with patch.object(module._os, "stat", side_effect=_fake_stat(sizes)):
        resp = _resolve(module, {}, "/c.gz", None, force_compressed_only=True)

    assert isinstance(resp, str)
    assert resp.startswith("HTTP/1.1 406")


def test_gzip_q0_is_treated_as_rejection():
    module = _load_web_interface_module()
    sizes = {"/c.gz": 100, "/c.js": 50}
    with patch.object(module._os, "stat", side_effect=_fake_stat(sizes)):
        resp = _resolve(module, {"accept-encoding": "gzip;q=0"}, "/c.gz", "/c.js")

    assert isinstance(resp, module.FileResponse)
    assert resp.file_path == "/c.js"


def test_missing_asset_returns_404():
    module = _load_web_interface_module()
    with patch.object(module._os, "stat", side_effect=_fake_stat({})):
        resp = _resolve(module, {"accept-encoding": "gzip"}, "/c.gz", None)

    assert isinstance(resp, str)
    assert resp.startswith("HTTP/1.1 404")


def test_single_stat_and_etag_headers_on_common_path():
    module = _load_web_interface_module()
    interface = module.WebInterface(host_ip="x", enable_server=False)

    sizes = {"/c.gz": 100}
    stat_calls = []

    def stat(path):
        stat_calls.append(path)
        if path in sizes:
            return (0, 0, 0, 0, 0, 0, sizes[path], 0, 0, 0)
        raise OSError("missing")

    with patch.object(module._os, "stat", side_effect=stat):
        resp = interface._resolve_static_asset_response(
            _req({"accept-encoding": "gzip"}),
            route="/app.js",
            content_type="application/javascript",
            compressed_path="/c.gz",
            fallback_path=None,
        )

    assert stat_calls == ["/c.gz"]
    assert isinstance(resp, module.FileResponse)
    assert resp.content_length == 100
    assert ("Cache-Control", "no-cache") in resp.headers
    assert ("Vary", "Accept-Encoding") in resp.headers
    assert any(header[0] == "ETag" for header in resp.headers)


def test_asset_without_mtime_uses_size_only_etag():
    module = _load_web_interface_module()
    sizes = {"/c.js": 50}
    with patch.object(module._os, "stat", side_effect=_fake_stat(sizes, {"/c.js": 0})):
        resp = _resolve(module, {}, "/c.gz", "/c.js")

    assert isinstance(resp, module.FileResponse)
    etag = dict(resp.headers)["ETag"]
    assert etag == '"32"'


def test_matching_if_none_match_returns_304():
    module = _load_web_interface_module()
    sizes = {"/c.js": 50}
    with patch.object(module._os, "stat", side_effect=_fake_stat(sizes, {"/c.js": 0})):
        resp = _resolve(module, {"if-none-match": '"32"'}, "/c.gz", "/c.js")

    assert isinstance(resp, str)
    assert resp.startswith("HTTP/1.1 304")
    assert "Content-Length: 0" in resp


def test_non_matching_if_none_match_returns_200():
    module = _load_web_interface_module()
    sizes = {"/c.js": 50}
    with patch.object(module._os, "stat", side_effect=_fake_stat(sizes, {"/c.js": 0})):
        resp = _resolve(module, {"if-none-match": '"99"'}, "/c.gz", "/c.js")

    assert isinstance(resp, module.FileResponse)


def test_if_none_match_wildcard_returns_304():
    module = _load_web_interface_module()
    sizes = {"/c.js": 50}
    with patch.object(module._os, "stat", side_effect=_fake_stat(sizes, {"/c.js": 0})):
        resp = _resolve(module, {"if-none-match": "*"}, "/c.gz", "/c.js")

    assert isinstance(resp, str)
    assert resp.startswith("HTTP/1.1 304")


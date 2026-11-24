import asyncio
import importlib.util
import json
import sys
import types
from pathlib import Path

SRC = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "micro_otter"
    / "nodes"
    / "device"
    / "runtime"
    / "general"
    / "otter_runtime"
)
HTTP_REQUEST_PATH = SRC / "http_request.py"
WEB_SERVER_PATH = SRC / "web_server.py"


def _load_web_server_module():
    ujson_orig = sys.modules.get("ujson")
    sys.modules["ujson"] = json
    http_spec = importlib.util.spec_from_file_location(
        "otter_runtime.http_request", HTTP_REQUEST_PATH
    )
    http_module = importlib.util.module_from_spec(http_spec)
    assert http_spec.loader is not None
    http_spec.loader.exec_module(http_module)

    uasyncio_module = types.ModuleType("uasyncio")

    async def _sleep_ms(_ms):
        return None

    uasyncio_module.sleep_ms = _sleep_ms
    uasyncio_module.wait_for = asyncio.wait_for
    uasyncio_module.TimeoutError = asyncio.TimeoutError

    micropython_module = types.ModuleType("micropython")
    micropython_module.const = lambda value: value

    otter_runtime_module = types.ModuleType("otter_runtime")
    otter_runtime_module.http_request = http_module

    originals = {
        "ujson": sys.modules.get("ujson"),
        "uasyncio": sys.modules.get("uasyncio"),
        "otter_runtime": sys.modules.get("otter_runtime"),
        "otter_runtime.http_request": sys.modules.get("otter_runtime.http_request"),
        "micropython": sys.modules.get("micropython"),
    }
    sys.modules["ujson"] = json
    sys.modules["uasyncio"] = uasyncio_module
    sys.modules["otter_runtime"] = otter_runtime_module
    sys.modules["otter_runtime.http_request"] = http_module
    sys.modules["micropython"] = micropython_module
    try:
        spec = importlib.util.spec_from_file_location("web_server_under_test", WEB_SERVER_PATH)
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
        if ujson_orig is None:
            sys.modules.pop("ujson", None)
        else:
            sys.modules["ujson"] = ujson_orig


class _ScriptedReader:
    def __init__(self, chunks):
        self._chunks = [chunk if isinstance(chunk, bytes) else chunk.encode() for chunk in chunks]

    async def read(self, _n):
        if not self._chunks:
            return b""
        return self._chunks.pop(0)


class _RecordingWriter:
    def __init__(self):
        self.writes = []
        self.closed = False

    async def awrite(self, data):
        self.writes.append(bytes(data))

    def close(self):
        self.closed = True

    async def wait_closed(self):
        return None


async def _text_handler(_request):
    return "ok"


def _register(server, path):
    server.get_handler_map[path] = _text_handler

def test_keep_alive_serves_two_requests_on_one_connection():
    module = _load_web_server_module()
    server = module.WebServer()
    _register(server, "/one")
    _register(server, "/two")

    req1 = "GET /one HTTP/1.1\r\nHost: x\r\n\r\n"
    req2 = "GET /two HTTP/1.1\r\nHost: x\r\n\r\n"
    reader = _ScriptedReader([req1, req2])
    writer = _RecordingWriter()

    asyncio.run(server.handle_client(reader, writer))

    joined = b"".join(writer.writes)
    assert joined.count(b"HTTP/1.1 200 OK") == 2
    assert b"Connection: keep-alive" in joined
    assert writer.closed is True
    assert server._active_clients == 0


def test_connection_close_request_serves_once():
    module = _load_web_server_module()
    server = module.WebServer()
    _register(server, "/one")

    req = "GET /one HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"
    reader = _ScriptedReader([req])
    writer = _RecordingWriter()

    asyncio.run(server.handle_client(reader, writer))

    joined = b"".join(writer.writes)
    assert joined.count(b"HTTP/1.1 200 OK") == 1
    assert b"Connection: close" in joined
    assert writer.closed is True


def test_http10_without_keep_alive_serves_once():
    module = _load_web_server_module()
    server = module.WebServer()
    _register(server, "/one")

    req = "GET /one HTTP/1.0\r\nHost: x\r\n\r\n"
    reader = _ScriptedReader([req])
    writer = _RecordingWriter()

    asyncio.run(server.handle_client(reader, writer))

    joined = b"".join(writer.writes)
    assert joined.count(b"HTTP/1.1 200 OK") == 1
    assert b"Connection: close" in joined


def test_idle_timeout_closes_after_keep_alive_response():
    module = _load_web_server_module()
    module._KEEP_ALIVE_IDLE_TIMEOUT_S = 0.01
    server = module.WebServer()
    _register(server, "/one")

    class _HangAfterFirst:
        def __init__(self):
            self._n = 0

        async def read(self, _n):
            self._n += 1
            if self._n == 1:
                return b"GET /one HTTP/1.1\r\nHost: x\r\n\r\n"
            await asyncio.sleep(3600)
            return b""

    writer = _RecordingWriter()
    asyncio.run(server.handle_client(_HangAfterFirst(), writer))

    joined = b"".join(writer.writes)
    assert joined.count(b"HTTP/1.1 200 OK") == 1
    assert writer.closed is True
    assert server._active_clients == 0


def test_max_requests_per_connection_closes():
    module = _load_web_server_module()
    module._MAX_REQUESTS_PER_CONNECTION = 2
    server = module.WebServer()
    _register(server, "/one")

    req = "GET /one HTTP/1.1\r\nHost: x\r\n\r\n"
    reader = _ScriptedReader([req, req, req])
    writer = _RecordingWriter()

    asyncio.run(server.handle_client(reader, writer))

    joined = b"".join(writer.writes)
    assert joined.count(b"HTTP/1.1 200 OK") == 2
    assert writer.closed is True

    first, second = joined.split(b"HTTP/1.1 200 OK")[1:]
    assert b"Connection: keep-alive" in first
    # The response that fills the cap is the last one on this socket, so it must announce the
    # close itself instead of promising a reuse the server has already ruled out.
    assert b"Connection: close" in second
    assert b"Keep-Alive:" not in second


def test_requests_are_not_logged_per_request(capsys):
    module = _load_web_server_module()
    server = module.WebServer()
    _register(server, "/one")

    req = "GET /one HTTP/1.1\r\nHost: x\r\n\r\n"
    writer = _RecordingWriter()
    asyncio.run(server.handle_client(_ScriptedReader([req, req]), writer))

    out = capsys.readouterr().out
    # A ~10 Hz webview poll made the per-request info line drown the console, so the
    # method/path pair must not appear in the log unless request tracing is enabled.
    assert "GET /one" not in out
    assert "[info] ws: GET" not in out


def test_request_tracing_reports_method_and_path_when_enabled(capsys):
    module = _load_web_server_module()
    server = module.WebServer(log_requests=True)
    _register(server, "/one")

    req = "GET /one HTTP/1.1\r\nHost: x\r\n\r\n"
    writer = _RecordingWriter()
    asyncio.run(server.handle_client(_ScriptedReader([req]), writer))

    out = capsys.readouterr().out
    # Removing the always-on line keeps debugging available: the sampled trace still
    # names the request without a print per poll.
    assert "ws-trace: request-received" in out
    assert "'path': '/one'" in out


def test_pipelined_requests_served_via_pending():
    module = _load_web_server_module()
    server = module.WebServer()
    _register(server, "/one")
    _register(server, "/two")

    pipelined = "GET /one HTTP/1.1\r\nHost: x\r\n\r\nGET /two HTTP/1.1\r\nHost: x\r\n\r\n"
    reader = _ScriptedReader([pipelined])
    writer = _RecordingWriter()

    asyncio.run(server.handle_client(reader, writer))

    joined = b"".join(writer.writes)
    assert joined.count(b"HTTP/1.1 200 OK") == 2
    assert writer.closed is True


def test_404_keeps_alive_and_500_closes():
    module = _load_web_server_module()
    server = module.WebServer()
    _register(server, "/ok")

    async def _boom(_request):
        raise ValueError("boom")

    server.get_handler_map["/boom"] = _boom

    req_ok = "GET /ok HTTP/1.1\r\nHost: x\r\n\r\n"
    req_missing = "GET /missing HTTP/1.1\r\nHost: x\r\n\r\n"
    req_boom = "GET /boom HTTP/1.1\r\nHost: x\r\n\r\n"
    reader = _ScriptedReader([req_ok, req_missing, req_boom])
    writer = _RecordingWriter()

    asyncio.run(server.handle_client(reader, writer))

    joined = b"".join(writer.writes)
    assert b"HTTP/1.1 200 OK" in joined
    assert b"HTTP/1.1 404 Not Found" in joined
    assert b"HTTP/1.1 500 Internal Server Error" in joined
    assert writer.closed is True
    assert server._active_clients == 0


import asyncio
import importlib.util
import json
import sys
import types
from pathlib import Path
from unittest.mock import patch

WEB_SERVER_PATH = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "micro_otter"
    / "nodes"
    / "device"
    / "runtime"
    / "general"
    / "otter_runtime"
    / "web_server.py"
)


def _load_web_server_module():
    uasyncio_module = types.ModuleType("uasyncio")

    async def _sleep_ms(_ms):
        return None

    uasyncio_module.sleep_ms = _sleep_ms
    uasyncio_module.wait_for = asyncio.wait_for
    uasyncio_module.TimeoutError = asyncio.TimeoutError

    otter_runtime_module = types.ModuleType("otter_runtime")
    http_request_module = types.ModuleType("otter_runtime.http_request")

    class _HttpMethod:
        GET = "GET"
        POST = "POST"

    class _HttpReturnType:
        TEXT = "text/plain"
        HTML = "text/html"
        JSON = "application/json"

    class _HttpRequest:
        pass

    http_request_module.HttpMethod = _HttpMethod
    http_request_module.HttpReturnType = _HttpReturnType
    http_request_module.HttpRequest = _HttpRequest

    micropython_module = types.ModuleType("micropython")
    micropython_module.const = lambda value: value

    original_modules = {
        "uasyncio": sys.modules.get("uasyncio"),
        "otter_runtime": sys.modules.get("otter_runtime"),
        "otter_runtime.http_request": sys.modules.get("otter_runtime.http_request"),
        "micropython": sys.modules.get("micropython"),
    }

    sys.modules["uasyncio"] = uasyncio_module
    sys.modules["otter_runtime"] = otter_runtime_module
    sys.modules["otter_runtime.http_request"] = http_request_module
    sys.modules["micropython"] = micropython_module

    try:
        spec = importlib.util.spec_from_file_location("web_server_under_test", WEB_SERVER_PATH)
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


class _Request:
    method = "GET"
    path = "/api/test"
    query_params = {}


class _Reader:
    def __init__(self):
        self._reads = 0

    async def read(self, _n):
        self._reads += 1
        return b"x" if self._reads == 1 else b""


class _Writer:
    def __init__(self):
        self.buffer = bytearray()
        self.closed = False

    async def awrite(self, data):
        self.buffer.extend(data)

    def close(self):
        self.closed = True

    async def wait_closed(self):
        return None


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


def test_json_endpoint_produces_preencoded_segment_and_content_length():
    module = _load_web_server_module()
    server = module.WebServer()

    async def handler(_request):
        return {"ok": True, "count": 2}

    server.set_endpoint(
        "/api/test",
        handler,
        header=module.HttpMethod.GET,
        return_type=module.HttpReturnType.JSON,
    )

    wrapped = server.get_handler_map["/api/test"]
    response = asyncio.run(wrapped(_Request()))

    assert isinstance(response, module.SegmentedResponse)
    assert len(response.segments) == 1
    assert isinstance(response.segments[0], bytes)
    expected_body = json.dumps({"ok": True, "count": 2}).encode()
    assert response.segments[0] == expected_body
    assert response.content_length == len(expected_body)


def test_segmented_response_can_use_provided_content_length_without_recount():
    module = _load_web_server_module()
    payload = b'{"ok":true}'
    response = module.SegmentedResponse(
        [payload],
        content_type="application/json",
        content_length=len(payload),
    )

    assert response.content_length == len(payload)
    assert response.segments == [payload]


def test_request_tracing_is_default_off_for_high_frequency_paths():
    module = _load_web_server_module()
    server = module.WebServer()

    assert server._should_trace_request("/api/webview/refresh", 1) is False
    assert server._should_trace_request("/", 20) is False


def test_request_tracing_sampling_is_opt_in_via_log_requests():
    module = _load_web_server_module()
    server = module.WebServer(log_requests=True)

    assert server._should_trace_request("/api/webview/refresh", 1) is True
    assert server._should_trace_request("/api/webview/refresh", 2) is False
    assert server._should_trace_request("/api/webview/refresh", 20) is True


def test_trace_request_emits_no_output_when_disabled():
    module = _load_web_server_module()
    server = module.WebServer()

    with patch("builtins.print") as print_mock:
        server._trace_request("request-received", path="/api/webview/refresh")

    print_mock.assert_not_called()


def test_segmented_response_without_content_length_encodes_string_segment_once():
    module = _load_web_server_module()

    class _CountingSegment(str):
        encode_calls = 0

        def encode(self, *args, **kwargs):
            _CountingSegment.encode_calls += 1
            return super().encode(*args, **kwargs)

    class _FixedRequest:
        def __init__(self):
            self.method = "GET"
            self.path = "/segments"
            self.query_params = {}

        async def parse_from_stream(self, _reader, pending=None):
            chunk = await _reader.read(1024)
            if not chunk:
                self.method = ""
            return b""

    module.HttpRequest = _FixedRequest
    server = module.WebServer()

    async def handler(_request):
        return module.SegmentedResponse([_CountingSegment("alpha"), b"beta"])

    server.set_endpoint(
        "/segments",
        handler,
        header=module.HttpMethod.GET,
        return_type=module.HttpReturnType.TEXT,
    )

    writer = _Writer()
    asyncio.run(server.handle_client(_Reader(), writer))

    assert _CountingSegment.encode_calls == 1
    assert writer.closed is True


def test_file_response_streams_text_file_in_binary_mode():
    module = _load_web_server_module()

    class _FixedRequest:
        def __init__(self):
            self.method = "GET"
            self.path = "/file"
            self.query_params = {}

        async def parse_from_stream(self, _reader, pending=None):
            chunk = await _reader.read(1024)
            if not chunk:
                self.method = ""
            return b""

    class _BinaryFile:
        def __init__(self, data):
            self._data = data
            self._cursor = 0

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            del exc_type, exc, tb
            return False

        def read(self, size=-1):
            if self._cursor >= len(self._data):
                return b""
            if size is None or size < 0:
                chunk = self._data[self._cursor:]
            else:
                chunk = self._data[self._cursor:self._cursor + size]
            self._cursor += len(chunk)
            return chunk

    module.HttpRequest = _FixedRequest
    server = module.WebServer()

    async def handler(_request):
        return module.FileResponse("/tmp/test.txt", "text/plain", is_binary=False)

    server.set_endpoint(
        "/file",
        handler,
        header=module.HttpMethod.GET,
        return_type=module.HttpReturnType.TEXT,
    )

    payload = b"hello-text-file"
    writer = _Writer()

    with patch("builtins.open", return_value=_BinaryFile(payload)) as open_mock:
        with patch.object(module._os, "stat", return_value=(0, 0, 0, 0, 0, 0, len(payload))):
            asyncio.run(server.handle_client(_Reader(), writer))

    open_mock.assert_called_once_with("/tmp/test.txt", "rb")
    assert payload in bytes(writer.buffer)


def test_small_file_response_is_served_in_a_single_write():
    module = _load_web_server_module()

    class _FixedRequest:
        def __init__(self):
            self.method = "GET"
            self.path = "/file"
            self.query_params = {}

        async def parse_from_stream(self, _reader, pending=None):
            chunk = await _reader.read(1024)
            if not chunk:
                self.method = ""
            return b""

    payload = b"s" * 2048

    class _BinaryFile:
        def __init__(self, data):
            self._data = data
            self._cursor = 0

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self, size=-1):
            if self._cursor >= len(self._data):
                return b""
            if size is None or size < 0:
                chunk = self._data[self._cursor :]
            else:
                chunk = self._data[self._cursor : self._cursor + size]
            self._cursor += len(chunk)
            return chunk

    module.HttpRequest = _FixedRequest
    server = module.WebServer()

    async def handler(_request):
        return module.FileResponse("/tmp/small.txt", "text/plain", content_length=len(payload))

    server.set_endpoint(
        "/file",
        handler,
        header=module.HttpMethod.GET,
        return_type=module.HttpReturnType.TEXT,
    )

    writer = _RecordingWriter()
    with patch("builtins.open", return_value=_BinaryFile(payload)):
        asyncio.run(server.handle_client(_Reader(), writer))

    assert len(writer.writes) == 1
    assert b"HTTP/1.1 200 OK" in writer.writes[0]
    assert b"Content-Length: " + str(len(payload)).encode() in writer.writes[0]
    assert payload in writer.writes[0]


def test_handle_client_returns_400_when_parsing_fails():
    module = _load_web_server_module()

    class _RaisingRequest:
        def __init__(self):
            self.method = ""
            self.path = ""
            self.query_params = {}
            self.headers = {}

        async def parse_from_stream(self, _reader, pending=None):
            raise RuntimeError("garbage input")

    module.HttpRequest = _RaisingRequest
    server = module.WebServer()

    writer = _Writer()
    asyncio.run(server.handle_client(_Reader(), writer))

    assert writer.closed is True
    assert b"400 Bad Request" in bytes(writer.buffer)


def test_parse_timeout_is_traced_and_closes_connection():
    module = _load_web_server_module()
    module._REQUEST_TIMEOUT_S = 0.01

    class _NeverReader:
        async def read(self, _n):
            await asyncio.sleep(3600)
            return b""

    class _HangingRequest:
        def __init__(self):
            self.method = ""
            self.path = ""
            self.query_params = {}
            self.headers = {}

        async def parse_from_stream(self, reader, pending=None):
            while True:
                chunk = await reader.read(1024)
                if not chunk:
                    break

    module.HttpRequest = _HangingRequest
    server = module.WebServer(log_requests=True)

    writer = _Writer()
    with patch("builtins.print") as print_mock:
        asyncio.run(server.handle_client(_NeverReader(), writer))

    assert writer.closed is True
    assert b"400 Bad Request" in bytes(writer.buffer)

    parse_failed_calls = [
        call
        for call in print_mock.call_args_list
        if call.args and call.args[0] == "[data] ws-trace:" and call.args[1] == "parse-failed"
    ]
    assert parse_failed_calls
    assert parse_failed_calls[0].args[2].get("timeout") is True


def test_response_timeout_closes_connection():
    module = _load_web_server_module()
    module._RESPONSE_TIMEOUT_S = 0.01

    class _OkRequest:
        def __init__(self):
            self.method = "GET"
            self.path = "/api/test"
            self.query_params = {}
            self.headers = {}

        async def parse_from_stream(self, _reader, pending=None):
            chunk = await _reader.read(1024)
            if not chunk:
                self.method = ""
            return b""

    async def _hanging_handler(_request):
        await asyncio.sleep(3600)

    module.HttpRequest = _OkRequest
    server = module.WebServer(log_requests=True)
    server.get_handler_map["/api/test"] = _hanging_handler

    writer = _Writer()
    with patch("builtins.print") as print_mock:
        asyncio.run(server.handle_client(_Reader(), writer))

    assert writer.closed is True

    response_timeout_calls = [
        call
        for call in print_mock.call_args_list
        if call.args and call.args[0] == "[data] ws-trace:" and call.args[1] == "response-timeout"
    ]
    assert response_timeout_calls


def test_maybe_yield_yields_every_call_without_clock():
    module = _load_web_server_module()
    server = module.WebServer()

    calls = []

    async def _recording_sleep_ms(ms):
        calls.append(ms)

    module.asyncio.sleep_ms = _recording_sleep_ms

    assert server._ticks_ms() is None
    assert asyncio.run(server._maybe_yield(0)) is None
    assert calls == [0]


def test_maybe_yield_uses_time_budget():
    module = _load_web_server_module()
    server = module.WebServer()

    now = [1000]
    server._ticks_ms = lambda: now[0]
    server._ticks_diff = lambda current, previous: current - previous

    calls = []

    async def _recording_sleep_ms(ms):
        calls.append(ms)

    module.asyncio.sleep_ms = _recording_sleep_ms

    now[0] = 1001
    assert asyncio.run(server._maybe_yield(1000)) == 1000
    assert calls == []

    now[0] = 1005
    assert asyncio.run(server._maybe_yield(1000)) == 1005
    assert calls == [0]


def test_multi_chunk_file_response_preserves_bytes():
    module = _load_web_server_module()

    class _FixedRequest:
        def __init__(self):
            self.method = "GET"
            self.path = "/file"
            self.query_params = {}

        async def parse_from_stream(self, _reader, pending=None):
            chunk = await _reader.read(1024)
            if not chunk:
                self.method = ""
            return b""

    payload = b"y" * (module._SMALL_FILE_INLINE_MAX + module._FILE_STREAM_CHUNK_SIZE * 3 + 7)

    class _BinaryFile:
        def __init__(self, data):
            self._data = data
            self._cursor = 0

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self, size=-1):
            if self._cursor >= len(self._data):
                return b""
            if size is None or size < 0:
                chunk = self._data[self._cursor :]
            else:
                chunk = self._data[self._cursor : self._cursor + size]
            self._cursor += len(chunk)
            return chunk

    module.HttpRequest = _FixedRequest
    server = module.WebServer()

    async def handler(_request):
        return module.FileResponse("/tmp/large.txt", "text/plain", is_binary=False)

    server.set_endpoint(
        "/file",
        handler,
        header=module.HttpMethod.GET,
        return_type=module.HttpReturnType.TEXT,
    )

    writer = _Writer()
    with patch("builtins.open", return_value=_BinaryFile(payload)):
        with patch.object(module._os, "stat", return_value=(0, 0, 0, 0, 0, 0, len(payload))):
            asyncio.run(server.handle_client(_Reader(), writer))

    assert payload in bytes(writer.buffer)


def test_concurrency_cap_rejects_excess_clients_without_reading():
    module = _load_web_server_module()
    module._MAX_CONCURRENT_CLIENTS = 2
    server = module.WebServer()
    server._active_clients = 2

    class _ExplodingReader:
        def __init__(self):
            self.read_called = False

        async def read(self, _n):
            self.read_called = True
            return b""

    reader = _ExplodingReader()
    writer = _Writer()
    asyncio.run(server.handle_client(reader, writer))

    assert reader.read_called is False
    assert writer.closed is True
    assert b"503 Service Unavailable" in bytes(writer.buffer)
    assert server._active_clients == 2


def test_active_clients_returns_to_zero_after_request():
    module = _load_web_server_module()
    server = module.WebServer()

    class _OkRequest:
        def __init__(self):
            self.method = "GET"
            self.path = "/api/test"
            self.query_params = {}

        async def parse_from_stream(self, _reader, pending=None):
            chunk = await _reader.read(1024)
            if not chunk:
                self.method = ""
            return b""

    async def _text_handler(_request):
        return "ok"

    module.HttpRequest = _OkRequest
    server.get_handler_map["/api/test"] = _text_handler

    writer = _Writer()
    asyncio.run(server.handle_client(_Reader(), writer))

    assert server._active_clients == 0
    assert b"ok" in bytes(writer.buffer)


def test_active_clients_returns_to_zero_when_serve_request_raises():
    module = _load_web_server_module()
    server = module.WebServer()

    class _OkRequest:
        def __init__(self):
            self.method = "GET"
            self.path = "/api/test"
            self.query_params = {}

        async def parse_from_stream(self, _reader, pending=None):
            chunk = await _reader.read(1024)
            if not chunk:
                self.method = ""
            return b""

    class _BadStr:
        def __str__(self):
            raise ValueError("boom")

    async def _handler(_request):
        return _BadStr()

    module.HttpRequest = _OkRequest
    server.get_handler_map["/api/test"] = _handler

    writer = _Writer()
    try:
        asyncio.run(server.handle_client(_Reader(), writer))
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError to propagate")

    assert server._active_clients == 0
    assert writer.closed is True


def test_file_response_uses_provided_content_length_without_stat():
    module = _load_web_server_module()

    class _FixedRequest:
        def __init__(self):
            self.method = "GET"
            self.path = "/file"
            self.query_params = {}

        async def parse_from_stream(self, _reader, pending=None):
            chunk = await _reader.read(1024)
            if not chunk:
                self.method = ""
            return b""

    payload = b"hello"

    class _BinaryFile:
        def __init__(self, data):
            self._data = data
            self._cursor = 0

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self, size=-1):
            if self._cursor >= len(self._data):
                return b""
            if size is None or size < 0:
                chunk = self._data[self._cursor :]
            else:
                chunk = self._data[self._cursor : self._cursor + size]
            self._cursor += len(chunk)
            return chunk

    module.HttpRequest = _FixedRequest
    server = module.WebServer()

    async def handler(_request):
        return module.FileResponse("/tmp/x.txt", "text/plain", content_length=len(payload))

    server.set_endpoint(
        "/file",
        handler,
        header=module.HttpMethod.GET,
        return_type=module.HttpReturnType.TEXT,
    )

    writer = _Writer()
    with patch("builtins.open", return_value=_BinaryFile(payload)):
        with patch.object(module._os, "stat", side_effect=AssertionError("stat must not run")):
            asyncio.run(server.handle_client(_Reader(), writer))

    assert b"Content-Length: 5" in bytes(writer.buffer)
    assert payload in bytes(writer.buffer)


def test_file_response_falls_back_to_stat_when_content_length_missing():
    module = _load_web_server_module()

    class _FixedRequest:
        def __init__(self):
            self.method = "GET"
            self.path = "/file"
            self.query_params = {}

        async def parse_from_stream(self, _reader, pending=None):
            chunk = await _reader.read(1024)
            if not chunk:
                self.method = ""
            return b""

    payload = b"hello"

    class _BinaryFile:
        def __init__(self, data):
            self._data = data
            self._cursor = 0

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self, size=-1):
            if self._cursor >= len(self._data):
                return b""
            if size is None or size < 0:
                chunk = self._data[self._cursor :]
            else:
                chunk = self._data[self._cursor : self._cursor + size]
            self._cursor += len(chunk)
            return chunk

    module.HttpRequest = _FixedRequest
    server = module.WebServer()

    async def handler(_request):
        return module.FileResponse("/tmp/x.txt", "text/plain")

    server.set_endpoint(
        "/file",
        handler,
        header=module.HttpMethod.GET,
        return_type=module.HttpReturnType.TEXT,
    )

    stat_calls = []

    def _stat(path):
        stat_calls.append(path)
        return (0, 0, 0, 0, 0, 0, len(payload))

    writer = _Writer()
    with patch("builtins.open", return_value=_BinaryFile(payload)):
        with patch.object(module._os, "stat", side_effect=_stat):
            asyncio.run(server.handle_client(_Reader(), writer))

    assert stat_calls == ["/tmp/x.txt"]
    assert b"Content-Length: 5" in bytes(writer.buffer)


def test_empty_segmented_response_writes_header_once():
    module = _load_web_server_module()

    class _FixedRequest:
        def __init__(self):
            self.method = "GET"
            self.path = "/segments"
            self.query_params = {}

        async def parse_from_stream(self, _reader, pending=None):
            chunk = await _reader.read(1024)
            if not chunk:
                self.method = ""
            return b""

    module.HttpRequest = _FixedRequest
    server = module.WebServer()

    async def handler(_request):
        return module.SegmentedResponse([], content_type="text/plain", content_length=0)

    server.set_endpoint(
        "/segments",
        handler,
        header=module.HttpMethod.GET,
        return_type=module.HttpReturnType.TEXT,
    )

    writer = _RecordingWriter()
    asyncio.run(server.handle_client(_Reader(), writer))

    assert writer.closed is True
    assert len(writer.writes) == 1
    assert b"Content-Length: 0" in writer.writes[0]


def test_file_response_streams_large_file_in_large_blocks():
    module = _load_web_server_module()

    class _FixedRequest:
        def __init__(self):
            self.method = "GET"
            self.path = "/file"
            self.query_params = {}

        async def parse_from_stream(self, _reader, pending=None):
            chunk = await _reader.read(1024)
            if not chunk:
                self.method = ""
            return b""

    payload = b"z" * (module._SMALL_FILE_INLINE_MAX + module._FILE_STREAM_CHUNK_SIZE * 5)

    class _BinaryFile:
        def __init__(self, data):
            self._data = data
            self._cursor = 0

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self, size=-1):
            if self._cursor >= len(self._data):
                return b""
            if size is None or size < 0:
                chunk = self._data[self._cursor :]
            else:
                chunk = self._data[self._cursor : self._cursor + size]
            self._cursor += len(chunk)
            return chunk

    module.HttpRequest = _FixedRequest
    server = module.WebServer()

    async def handler(_request):
        return module.FileResponse("/tmp/big.txt", "text/plain", content_length=len(payload))

    server.set_endpoint(
        "/file",
        handler,
        header=module.HttpMethod.GET,
        return_type=module.HttpReturnType.TEXT,
    )

    writer = _RecordingWriter()
    with patch("builtins.open", return_value=_BinaryFile(payload)):
        asyncio.run(server.handle_client(_Reader(), writer))

    assert writer.writes
    assert b"HTTP/1.1 200 OK" in writer.writes[0]
    assert b"Content-Type: text/plain" in writer.writes[0]
    # Header is its own write; the body follows in <= chunk-size blocks so a
    # large file no longer pays one drain() round-trip per 1024 bytes.
    body_writes = writer.writes[1:]
    assert body_writes
    assert all(len(write) <= module._FILE_STREAM_CHUNK_SIZE for write in body_writes)
    assert b"".join(writer.writes).count(b"HTTP/1.1 200 OK") == 1
    assert payload in b"".join(writer.writes)


def test_segmented_response_sends_body_in_a_single_write():
    module = _load_web_server_module()

    class _FixedRequest:
        def __init__(self):
            self.method = "GET"
            self.path = "/segments"
            self.query_params = {}

        async def parse_from_stream(self, _reader, pending=None):
            chunk = await _reader.read(1024)
            if not chunk:
                self.method = ""
            return b""

    module.HttpRequest = _FixedRequest
    server = module.WebServer()

    payload = b"a" * 3000

    async def handler(_request):
        return module.SegmentedResponse(
            [payload],
            content_type="application/octet-stream",
            content_length=len(payload),
        )

    server.set_endpoint(
        "/segments",
        handler,
        header=module.HttpMethod.GET,
        return_type=module.HttpReturnType.TEXT,
    )

    writer = _RecordingWriter()
    asyncio.run(server.handle_client(_Reader(), writer))

    assert len(writer.writes) == 1
    assert b"Content-Length: %d" % len(payload) in writer.writes[0]
    assert b"".join(writer.writes).count(b"HTTP/1.1 200 OK") == 1
    assert payload in writer.writes[0]


def test_segmented_response_computes_length_for_str_segments():
    module = _load_web_server_module()

    class _FixedRequest:
        def __init__(self):
            self.method = "GET"
            self.path = "/segments"
            self.query_params = {}

        async def parse_from_stream(self, _reader, pending=None):
            chunk = await _reader.read(1024)
            if not chunk:
                self.method = ""
            return b""

    module.HttpRequest = _FixedRequest
    server = module.WebServer()

    async def handler(_request):
        return module.SegmentedResponse(["h\u00e9llo"], content_type="text/plain")

    server.set_endpoint(
        "/segments",
        handler,
        header=module.HttpMethod.GET,
        return_type=module.HttpReturnType.TEXT,
    )

    writer = _Writer()
    asyncio.run(server.handle_client(_Reader(), writer))

    assert b"Content-Length: 6" in bytes(writer.buffer)
    assert "h\u00e9llo".encode() in bytes(writer.buffer)


def test_enable_no_delay_sets_socket_option():
    module = _load_web_server_module()
    server = module.WebServer()

    calls = []

    class _FakeSock:
        def setsockopt(self, level, opt, value):
            calls.append((level, opt, value))

    class _FakeWriter:
        def __init__(self):
            self.s = _FakeSock()

    server._enable_no_delay(_FakeWriter())

    assert calls == [(module._socket.IPPROTO_TCP, module._socket.TCP_NODELAY, 1)]


def test_enable_no_delay_no_op_without_socket():
    module = _load_web_server_module()
    server = module.WebServer()

    class _NoSockWriter:
        pass

    # Must not raise and must not do anything.
    server._enable_no_delay(_NoSockWriter())


def test_enable_no_delay_skipped_when_disabled():
    module = _load_web_server_module()
    module._ENABLE_TCP_NODELAY = 0
    server = module.WebServer()

    calls = []

    class _FakeSock:
        def setsockopt(self, level, opt, value):
            calls.append((level, opt, value))

    class _FakeWriter:
        def __init__(self):
            self.s = _FakeSock()

    server._enable_no_delay(_FakeWriter())

    assert calls == []


def test_prepare_raw_response_adds_content_length_and_keep_alive():
    module = _load_web_server_module()
    server = module.WebServer()

    raw = "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\n\r\nnope"
    prepared, can_reuse = server._prepare_raw_response(raw, keep_alive=True, status=404)

    assert "Content-Length: 4" in prepared
    assert "Connection: keep-alive" in prepared
    assert can_reuse is True


def test_prepare_raw_response_forces_close_for_chunked():
    module = _load_web_server_module()
    server = module.WebServer()

    raw = "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"
    prepared, can_reuse = server._prepare_raw_response(raw, keep_alive=True, status=200)

    assert "Connection: close" in prepared
    assert can_reuse is False


def test_prepare_raw_response_uses_encoded_byte_length():
    module = _load_web_server_module()
    server = module.WebServer()

    raw = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nh\u00e9llo"
    prepared, _ = server._prepare_raw_response(raw, keep_alive=True, status=200)

    assert "Content-Length: 6" in prepared


def test_prepare_raw_response_passes_correct_response_through():
    module = _load_web_server_module()
    server = module.WebServer()

    raw = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"
    prepared, can_reuse = server._prepare_raw_response(raw, keep_alive=True, status=200)

    assert prepared == raw
    assert can_reuse is False

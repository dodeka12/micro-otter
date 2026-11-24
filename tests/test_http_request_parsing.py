import asyncio
import importlib.util
import json
import sys
from pathlib import Path
from unittest.mock import patch

HTTP_REQUEST_PATH = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "micro_otter"
    / "nodes"
    / "device"
    / "runtime"
    / "general"
    / "otter_runtime"
    / "http_request.py"
)


class _ChunkedReader:
    def __init__(self, chunks):
        self._chunks = [chunk if isinstance(chunk, bytes) else chunk.encode() for chunk in chunks]

    async def read(self, _n):
        if not self._chunks:
            return b""
        return self._chunks.pop(0)


def _load_http_request_module():
    original_ujson = sys.modules.get("ujson")
    sys.modules["ujson"] = json
    try:
        spec = importlib.util.spec_from_file_location("http_request_under_test", HTTP_REQUEST_PATH)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module
    finally:
        if original_ujson is None:
            del sys.modules["ujson"]
        else:
            sys.modules["ujson"] = original_ujson


def test_parse_from_stream_handles_fragmented_post_request():
    module = _load_http_request_module()
    request = module.HttpRequest()

    body = '{"route":"/","initial":true}'
    request_text = (
        "POST /refresh HTTP/1.1\r\n"
        "Host: device.local\r\n"
        "Content-Type: application/json\r\n"
        f"Content-Length: {len(body)}\r\n"
        "\r\n"
        f"{body}"
    )

    reader = _ChunkedReader(
        [
            request_text[:22],
            request_text[22:57],
            request_text[57:81],
            request_text[81:],
        ]
    )

    asyncio.run(request.parse_from_stream(reader))

    assert request.method == "POST"
    assert request.path == "/refresh"
    assert request.headers.get("content-type") == "application/json"
    assert request.body_bytes == body.encode()
    assert request.body == body
    assert request.json() == {"route": "/", "initial": True}


def test_parse_from_stream_handles_query_parameters_without_body():
    module = _load_http_request_module()
    request = module.HttpRequest()

    request_text = (
        "GET /refresh?route=%2F&initial=1 HTTP/1.1\r\n"
        "Host: device.local\r\n"
        "\r\n"
    )

    reader = _ChunkedReader([request_text])

    asyncio.run(request.parse_from_stream(reader))

    assert request.method == "GET"
    assert request.path == "/refresh"
    assert request.query_params.get("route") == "%2F"
    assert request.query_params.get("initial") == "1"
    assert request.body_bytes == b""
    assert request.body == ""
    assert request.json() is None


def test_parse_from_stream_json_returns_none_for_invalid_json_body():
    module = _load_http_request_module()
    request = module.HttpRequest()

    body = "not-json"
    request_text = (
        "POST /api/heartbeat HTTP/1.1\r\n"
        "Host: device.local\r\n"
        "Content-Type: text/plain\r\n"
        f"Content-Length: {len(body)}\r\n"
        "\r\n"
        f"{body}"
    )

    reader = _ChunkedReader([request_text])

    asyncio.run(request.parse_from_stream(reader))

    assert request.method == "POST"
    assert request.path == "/api/heartbeat"
    assert request.body_bytes == body.encode()
    assert request.json() is None


def test_parse_from_stream_rejects_whitespace_request_line():
    module = _load_http_request_module()
    request = module.HttpRequest()

    request_text = (
        "   HTTP/1.1\r\n"
        "Host: device.local\r\n"
        "\r\n"
    )

    reader = _ChunkedReader([request_text])

    try:
        asyncio.run(request.parse_from_stream(reader))
    except RuntimeError as exc:
        assert "Invalid request line format" in str(exc)
    else:
        raise AssertionError("Expected RuntimeError for malformed request line")


def test_parse_from_stream_rejects_oversized_request_buffer():
    module = _load_http_request_module()
    request = module.HttpRequest()

    oversized_header_prefix = b"GET /" + (b"a" * (module._MAX_REQUEST_BYTES + 1))
    reader = _ChunkedReader([oversized_header_prefix])

    try:
        asyncio.run(request.parse_from_stream(reader))
    except RuntimeError as exc:
        assert "Request exceeds maximum size" in str(exc)
    else:
        raise AssertionError("Expected RuntimeError for oversized request")


def test_parse_from_stream_body_property_decodes_once_and_caches():
    module = _load_http_request_module()
    request = module.HttpRequest()

    body = "cache-me"
    request_text = (
        "POST /cache HTTP/1.1\r\n"
        "Host: device.local\r\n"
        f"Content-Length: {len(body)}\r\n"
        "\r\n"
        f"{body}"
    )

    reader = _ChunkedReader([request_text])
    asyncio.run(request.parse_from_stream(reader))

    first_body = request.body
    second_body = request.body
    assert first_body == body
    assert second_body == body
    assert first_body is second_body


def test_parse_from_stream_json_is_parsed_once_and_cached():
    module = _load_http_request_module()
    request = module.HttpRequest()

    body = '{"count":2}'
    request_text = (
        "POST /cache-json HTTP/1.1\r\n"
        "Host: device.local\r\n"
        f"Content-Length: {len(body)}\r\n"
        "\r\n"
        f"{body}"
    )

    reader = _ChunkedReader([request_text])
    asyncio.run(request.parse_from_stream(reader))

    with patch.object(module.json, "loads", wraps=module.json.loads) as loads_mock:
        first_value = request.json()
        second_value = request.json()

    assert first_value == {"count": 2}
    assert second_value is first_value
    assert loads_mock.call_count == 1


def test_parse_from_stream_stores_http_version():
    module = _load_http_request_module()
    request = module.HttpRequest()

    reader = _ChunkedReader(["GET / HTTP/1.0\r\nHost: x\r\n\r\n"])
    asyncio.run(request.parse_from_stream(reader))

    assert request.version == "HTTP/1.0"


def test_parse_from_stream_defaults_version_to_http_11():
    module = _load_http_request_module()
    request = module.HttpRequest()

    reader = _ChunkedReader(["GET /simple\r\nHost: x\r\n\r\n"])
    asyncio.run(request.parse_from_stream(reader))

    assert request.version == "HTTP/1.1"


def test_parse_from_stream_returns_pipelined_bytes_and_truncates_pending():
    module = _load_http_request_module()

    first = "GET /one HTTP/1.1\r\nHost: x\r\n\r\n"
    second = "GET /two HTTP/1.1\r\nHost: x\r\n\r\n"
    reader = _ChunkedReader([first + second])

    pending = bytearray()
    pending_id = id(pending)
    leftover = asyncio.run(module.HttpRequest().parse_from_stream(reader, pending))

    assert leftover == second.encode()
    assert id(pending) == pending_id
    assert pending == second.encode()

    request2 = module.HttpRequest()
    asyncio.run(request2.parse_from_stream(reader, pending))
    assert request2.path == "/two"
    assert pending == b""


def test_parse_from_stream_returns_trailing_bytes_after_body():
    module = _load_http_request_module()
    request = module.HttpRequest()

    body = "abc"
    request_text = (
        "POST /x HTTP/1.1\r\n"
        "Host: x\r\n"
        f"Content-Length: {len(body)}\r\n"
        "\r\n"
        f"{body}EXTRA"
    )
    reader = _ChunkedReader([request_text])

    leftover = asyncio.run(request.parse_from_stream(reader))

    assert request.body_bytes == body.encode()
    assert leftover == b"EXTRA"


def test_parse_from_stream_rejects_transfer_encoding():
    module = _load_http_request_module()
    request = module.HttpRequest()

    request_text = (
        "POST /x HTTP/1.1\r\n"
        "Host: x\r\n"
        "Transfer-Encoding: chunked\r\n"
        "\r\n"
    )
    reader = _ChunkedReader([request_text])

    try:
        asyncio.run(request.parse_from_stream(reader))
    except RuntimeError as exc:
        assert "Transfer-Encoding not supported" in str(exc)
    else:
        raise AssertionError("Expected RuntimeError for Transfer-Encoding")


def test_parse_from_stream_empty_read_returns_empty_bytes():
    module = _load_http_request_module()
    request = module.HttpRequest()

    reader = _ChunkedReader([])
    leftover = asyncio.run(request.parse_from_stream(reader))

    assert request.method == ""
    assert leftover == b""

import asyncio
import importlib.util
import json
import sys
from pathlib import Path

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
        spec = importlib.util.spec_from_file_location(
            "runtime_http_request_under_test", HTTP_REQUEST_PATH
        )
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

# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

try:
    import ujson as json
except ImportError:  # pragma: no cover - fallback for host tooling
    import json

try:
    from micropython import const
except ImportError:  # pragma: no cover - host fallback
    const = lambda value: value


_MAX_REQUEST_BYTES = const(16 * 1024)
_BODY_TEXT_CACHE_UNSET = object()
_JSON_CACHE_UNSET = object()


class HttpMethod:
    GET = "GET"
    POST = "POST"


class HttpReturnType:
    TEXT = "text/plain"
    HTML = "text/html"
    JSON = "application/json"


class HttpRequest:
    def __init__(self):
        self.method = ""
        self.path = ""
        self.request_line = ""
        self.version = ""
        self.query_params = {}
        self.headers = {}
        self.body_bytes = b""
        self._body_text_cache = _BODY_TEXT_CACHE_UNSET
        self._json_cache = _JSON_CACHE_UNSET

    async def parse_from_stream(self, reader, pending=None):
        self.method = ""
        self.path = ""
        self.request_line = ""
        self.version = ""
        self.query_params.clear()
        self.headers.clear()
        self.body_bytes = b""
        self._body_text_cache = _BODY_TEXT_CACHE_UNSET
        self._json_cache = _JSON_CACHE_UNSET

        header_terminator = b"\r\n\r\n"
        if pending is not None:
            request_buffer = pending
        else:
            request_buffer = bytearray()

        scan_from = 0
        while True:
            idx = request_buffer.find(header_terminator, scan_from)
            if idx >= 0:
                break
            scan_from = max(0, len(request_buffer) - 3)
            chunk = await reader.read(1024)
            if not chunk:
                break
            request_buffer.extend(chunk)
            if len(request_buffer) > _MAX_REQUEST_BYTES:
                raise RuntimeError("Request exceeds maximum size")

        if not request_buffer:
            return b""

        headers_end_bytes = request_buffer.find(header_terminator)
        if headers_end_bytes < 0:
            raise RuntimeError("Failed to parse headers")

        headers_bytes = bytes(request_buffer[:headers_end_bytes])
        buffered_body_bytes = bytearray(
            request_buffer[headers_end_bytes + len(header_terminator):]
        )

        try:
            headers_text = headers_bytes.decode()
        except UnicodeDecodeError as e:
            raise RuntimeError("Failed to parse headers") from e

        # Parse first line
        try:
            header_lines = headers_text.split("\r\n")
            self.request_line = header_lines[0] if header_lines else ""
            first_line_parts = self.request_line.strip().split()
            if len(first_line_parts) < 2:
                raise ValueError("Invalid request line format")
            self.method = first_line_parts[0].strip().upper()
        except (ValueError, IndexError) as e:
            raise RuntimeError(f"Failed to parse HTTP request: {e!s}: {headers_text}") from e

        self.version = first_line_parts[2].upper() if len(first_line_parts) > 2 else "HTTP/1.1"

        # Parse path and query parameters
        path_with_query = first_line_parts[1].strip()
        if not path_with_query:
            raise RuntimeError("Failed to parse HTTP request: empty path")
        path_parts = path_with_query.split("?")
        self.path = path_parts[0]
        self.query_params.clear()

        if len(path_parts) > 1:
            try:
                for pair in path_parts[1].split("&"):
                    if not pair:
                        continue
                    key_value = pair.split("=")
                    if len(key_value) == 2:
                        self.query_params[key_value[0]] = key_value[1]
                    elif len(key_value) == 1:
                        self.query_params[key_value[0]] = ""
            except (ValueError, IndexError) as e:
                raise RuntimeError("Failed to parse query parameters") from e

        # Parse headers
        try:
            for line in header_lines[1:]:
                if ":" not in line:
                    continue
                key, value = line.split(":", 1)
                self.headers[key.strip().lower()] = value.strip()
        except ValueError as e:
            raise RuntimeError("Failed to parse headers") from e

        if self.headers.get("transfer-encoding"):
            raise RuntimeError("Transfer-Encoding not supported")

        # Read body based on content-length
        try:
            content_length = int(self.headers.get("content-length", 0))
            if content_length < 0:
                raise RuntimeError("Failed to parse request body")
            if headers_end_bytes + len(header_terminator) + content_length > _MAX_REQUEST_BYTES:
                raise RuntimeError("Request exceeds maximum size")
            while len(buffered_body_bytes) < content_length:
                remaining = content_length - len(buffered_body_bytes)
                chunk = await reader.read(remaining)
                if not chunk:
                    break
                buffered_body_bytes.extend(chunk)
                if (
                    headers_end_bytes
                    + len(header_terminator)
                    + len(buffered_body_bytes)
                    > _MAX_REQUEST_BYTES
                ):
                    raise RuntimeError("Request exceeds maximum size")

            self.body_bytes = bytes(buffered_body_bytes[:content_length])
            self._body_text_cache = _BODY_TEXT_CACHE_UNSET
            self._json_cache = _JSON_CACHE_UNSET
        except ValueError as e:
            raise RuntimeError("Failed to parse request body") from e

        leftover = buffered_body_bytes[content_length:]
        if pending is not None:
            pending[:] = leftover
        return bytes(leftover)

    @property
    def body(self):
        if self._body_text_cache is _BODY_TEXT_CACHE_UNSET:
            self._body_text_cache = self.body_bytes.decode()
        return self._body_text_cache

    def json(self):
        if self._json_cache is not _JSON_CACHE_UNSET:
            return self._json_cache

        try:
            body_text = self.body
        except UnicodeDecodeError:
            self._json_cache = None
            return self._json_cache

        if not body_text:
            self._json_cache = None
            return self._json_cache

        try:
            self._json_cache = json.loads(body_text)
        except ValueError:
            self._json_cache = None
        return self._json_cache

    def body_as_json(self):
        parsed_body = self.json()
        if parsed_body is None:
            raise ValueError("Failed to parse request body as JSON")
        return parsed_body

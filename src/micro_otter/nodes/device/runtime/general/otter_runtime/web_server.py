# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

import json

from micropython import const

try:
    import utime as _time_source
except ImportError:
    _time_source = None

try:
    import uos as _os
except ImportError:
    import os as _os

import uasyncio as asyncio

try:
    import socket as _socket
except ImportError:  # pragma: no cover - MicroPython always provides socket
    _socket = None

from otter_runtime.http_request import HttpMethod, HttpRequest, HttpReturnType

_HTTP_STATUS_OK = const(200)
_HTTP_STATUS_BAD_REQUEST = const(400)
_HTTP_STATUS_NOT_FOUND = const(404)
_HTTP_STATUS_METHOD_NOT_ALLOWED = const(405)
_HTTP_STATUS_INTERNAL_SERVER_ERROR = const(500)
_HTTP_STATUS_SERVICE_UNAVAILABLE = const(503)
_TRACE_SAMPLE_INTERVAL = const(20)
_FILE_STREAM_CHUNK_SIZE = const(16384)
_SMALL_FILE_INLINE_MAX = const(16384)
_TRANSIENT_EIO_ERRNO = const(5)
_TRANSIENT_STARTUP_RETRY_MS = const(200)
_REQUEST_TIMEOUT_S = const(10)
_RESPONSE_TIMEOUT_S = const(30)
_WRITE_YIELD_INTERVAL_MS = const(4)
_MAX_CONCURRENT_CLIENTS = const(8)
_COALESCE_PREFIX_MAX = const(2048)
_ENABLE_TCP_NODELAY = const(1)
_MAX_REQUESTS_PER_CONNECTION = const(24)
_KEEP_ALIVE_IDLE_TIMEOUT_S = const(5)
_KEEP_ALIVE_STATUSES = (200, 304, 404)

# MicroPython's uasyncio exposes TimeoutError on some builds but not others; guard
# so the isinstance checks below stay valid on both host and firmware.
_timeout_type = getattr(asyncio, "TimeoutError", None)


def _info(message):
    """Emit an always-on diagnostic line so hangs can be located from the serial console."""
    print("[info]", message)


def _error(message):
    """Emit an always-on error line for unexpected conditions."""
    print("[error]", message)


class FileResponse:
    """Marker class to indicate a file should be streamed."""

    def __init__(self, file_path, content_type, is_binary=False, headers=None, content_length=None):
        self.file_path = file_path
        self.content_type = content_type
        self.is_binary = is_binary
        self.headers = headers
        self.content_length = content_length


class SegmentedResponse:
    """Marker class to indicate a response should be streamed from text segments."""

    def __init__(
        self,
        segments,
        content_type="text/html; charset=utf-8",
        headers=None,
        content_length=None,
    ):
        self.segments = segments
        self.content_type = content_type
        self.headers = headers
        self.content_length = content_length


class WebServer:
    def __init__(
        self,
        host="0.0.0.0",
        port=80,
        log_requests=False,
        log_frequent_messages=False,
    ):
        self.host = host
        self.port = port
        self.log_requests = bool(log_requests)
        self.log_frequent_messages = bool(log_frequent_messages)
        self.server = None
        self.get_handler_map = {}
        self.post_handler_map = {}
        self._request_counter = 0
        self._active_clients = 0
        self._no_delay_logged = False

    def set_frequent_logging_enabled(self, enabled):
        self.log_frequent_messages = bool(enabled)
        return self.log_frequent_messages

    def get_frequent_logging_enabled(self):
        return bool(self.log_frequent_messages)

    def _ticks_ms(self):
        if _time_source is not None and hasattr(_time_source, "ticks_ms"):
            return _time_source.ticks_ms()
        return None

    def _ticks_diff(self, current, previous):
        if current is None or previous is None:
            return None
        if _time_source is not None and hasattr(_time_source, "ticks_diff"):
            return _time_source.ticks_diff(current, previous)
        return current - previous

    def _should_trace_request(self, path, request_id):
        if not (self.log_requests or self.log_frequent_messages):
            return False
        if self.log_frequent_messages:
            return True
        return request_id == 1 or (request_id % _TRACE_SAMPLE_INTERVAL) == 0

    def _trace_request(self, message, **fields):
        if not (self.log_requests or self.log_frequent_messages):
            return
        if not fields:
            print("[data] ws-trace:", message)
            return
        print("[data] ws-trace:", message, fields)

    async def _write_all(self, writer, data):
        awrite = getattr(writer, "awrite", None)
        if callable(awrite):
            await awrite(data)
            return

        writer.write(data)
        drain = getattr(writer, "drain", None)
        if callable(drain):
            await drain()

    async def _maybe_yield(self, last_yield_ms):
        """Hand the scheduler back at most every ``_WRITE_YIELD_INTERVAL_MS``.

        Without a time source (host tests) this yields on every call, which is
        correct and only costs one scheduler tick per chunk.
        """
        now = self._ticks_ms()
        if now is None:
            await asyncio.sleep_ms(0)
            return None
        if last_yield_ms is None or self._ticks_diff(now, last_yield_ms) >= _WRITE_YIELD_INTERVAL_MS:
            await asyncio.sleep_ms(0)
            return now
        return last_yield_ms

    async def _close_writer(self, writer):
        try:
            writer.close()
            wait_closed = getattr(writer, "wait_closed", None)
            if callable(wait_closed):
                await wait_closed()
        except Exception:
            pass

    def _enable_no_delay(self, writer):
        if not _ENABLE_TCP_NODELAY or _socket is None:
            return
        sock = getattr(writer, "s", None)
        if sock is None:
            transport = getattr(writer, "transport", None)
            if transport is not None and hasattr(transport, "get_extra_info"):
                sock = transport.get_extra_info("socket")
        if sock is None:
            return
        tcp_nodelay = getattr(_socket, "TCP_NODELAY", None)
        ipproto_tcp = getattr(_socket, "IPPROTO_TCP", None)
        if tcp_nodelay is None or ipproto_tcp is None:
            if not self._no_delay_logged:
                _info(
                    "ws: TCP_NODELAY unavailable (TCP_NODELAY={} IPPROTO_TCP={})".format(
                        tcp_nodelay, ipproto_tcp
                    )
                )
                self._no_delay_logged = True
            return
        try:
            sock.setsockopt(ipproto_tcp, tcp_nodelay, 1)
            if not self._no_delay_logged:
                _info("ws: TCP_NODELAY enabled")
                self._no_delay_logged = True
        except Exception as exc:
            if not self._no_delay_logged:
                _error("ws: TCP_NODELAY set failed ({})".format(exc))
                self._no_delay_logged = True

    def _request_allows_keep_alive(self, request):
        headers = getattr(request, "headers", {}) or {}
        connection = (headers.get("connection", "") or "").lower()
        version = getattr(request, "version", "") or ""
        if version.startswith("HTTP/1.0"):
            version_ok = "keep-alive" in connection
        else:
            # HTTP/1.1 (or an unspecified version) defaults to persistent.
            version_ok = True
        return (
            version_ok
            and "close" not in connection
            and not headers.get("transfer-encoding")
        )

    @staticmethod
    def _connection_header(keep_alive, status):
        return "keep-alive" if (keep_alive and status in _KEEP_ALIVE_STATUSES) else "close"

    def _prepare_raw_response(self, raw, keep_alive, status):
        """Ensure a raw ``HTTP/1.1`` string has a length and a connection header.

        Returns ``(raw, can_reuse)``. Chunked or malformed responses force close
        because their framing cannot be made safe for keep-alive.
        """
        if not raw.startswith("HTTP/1.1 "):
            return raw, False
        head, sep, body = raw.partition("\r\n\r\n")
        if not sep:
            return raw, False

        lower_head = head.lower()
        if "transfer-encoding:" in lower_head:
            if not any(line.lower().startswith("connection:") for line in head.split("\r\n")):
                head += "\r\nConnection: close"
            return head + sep + body, False

        has_length = "content-length:" in lower_head
        head_lines = head.split("\r\n")
        existing_connection = None
        for line in head_lines:
            if line.lower().startswith("connection:"):
                existing_connection = line.split(":", 1)[1].strip().lower()
                break

        if existing_connection == "keep-alive":
            connection = "keep-alive"
        elif existing_connection == "close":
            connection = "close"
        else:
            connection = self._connection_header(keep_alive, status)

        if not has_length and status not in (204, 304):
            head += "\r\nContent-Length: " + str(len(body.encode()))
            has_length = True

        can_reuse = connection == "keep-alive" and (has_length or status in (204, 304))

        if existing_connection is None:
            head += "\r\nConnection: " + connection
            if connection == "keep-alive":
                head += (
                    "\r\nKeep-Alive: timeout=" + str(_KEEP_ALIVE_IDLE_TIMEOUT_S)
                    + ", max=" + str(_MAX_REQUESTS_PER_CONNECTION)
                )

        return head + sep + body, can_reuse

    @staticmethod
    def _reason_for_status(status_code):
        if status_code == _HTTP_STATUS_OK:
            return "OK"
        if status_code == _HTTP_STATUS_BAD_REQUEST:
            return "Bad Request"
        if status_code == _HTTP_STATUS_NOT_FOUND:
            return "Not Found"
        if status_code == _HTTP_STATUS_METHOD_NOT_ALLOWED:
            return "Method Not Allowed"
        if status_code == _HTTP_STATUS_INTERNAL_SERVER_ERROR:
            return "Internal Server Error"
        if status_code == _HTTP_STATUS_SERVICE_UNAVAILABLE:
            return "Service Unavailable"
        return "OK"

    @staticmethod
    def _build_response(
        status_code,
        body,
        content_type="text/plain",
        headers=None,
        connection="close",
    ):
        reason = WebServer._reason_for_status(status_code)
        encoded_body = body.encode()
        header_lines = [
            f"HTTP/1.1 {status_code} {reason}",
            f"Content-Type: {content_type}",
            f"Content-Length: {len(encoded_body)}",
            f"Connection: {connection}",
        ]
        if connection == "keep-alive":
            header_lines.append(
                f"Keep-Alive: timeout={_KEEP_ALIVE_IDLE_TIMEOUT_S}, "
                f"max={_MAX_REQUESTS_PER_CONNECTION}"
            )

        if headers:
            if isinstance(headers, dict):
                items = headers.items()
            else:
                items = headers

            extra_lines = []
            for key, value in items:
                if not key or value is None:
                    continue
                extra_lines.append(f"{key}: {value}")

            if extra_lines:
                header_lines.extend(extra_lines)

        return "\r\n".join(header_lines) + "\r\n\r\n" + body

    @staticmethod
    def _normalize_headers(headers):
        if not headers:
            return []
        if isinstance(headers, dict):
            items = headers.items()
        else:
            items = headers
        normalized = []
        for key, value in items:
            if not key or value is None:
                continue
            normalized.append((str(key), str(value)))
        return normalized

    def set_endpoint(
        self,
        path,
        handler_coroutine,
        header=HttpMethod.GET,
        return_type=HttpReturnType.HTML,
        headers=None,
    ):
        """Sets an endpoint to the web server.

        If the response type is JSON, the handler coroutine should return a serializable object.

        Args:
           path (str): The URL path for the endpoint.
           handler_coroutine (Callable[[HTTPRequest], Awaitable[str]] | str): The coroutine function to handle the request or a file path string.
           header (HTTPMethod): The HTTP method (GET or POST).
           return_type (HTTPReturnType): The content type of the response.
           headers (dict | list | tuple | None): Optional HTTP headers to append to the response.
        """

        normalized_headers = self._normalize_headers(headers)

        def wrapper_response_str(func):
            async def wrapped_handler(request):
                #print("[otter] Handling request for path:", path)
                #print("[otter] Request:", request.path, request.method, request.query_params)
                response = await func(request)
                if isinstance(response, FileResponse):
                    if normalized_headers and not response.headers:
                        response.headers = normalized_headers
                    return response
                if isinstance(response, SegmentedResponse):
                    if normalized_headers and not response.headers:
                        response.headers = normalized_headers
                    return response

                if isinstance(response, str) and response.startswith("HTTP/1.1 "):
                    return response

                return WebServer._build_response(
                    200,
                    str(response),
                    content_type=return_type,
                    headers=normalized_headers,
                )

            return wrapped_handler

        def wrapper_response_json(func):
            async def wrapped_handler(request):
                #print(f"[otter] Handling request for path: {path}", flush=True)
                #print(f"[otter] Request: {request.path}, {request.method}, {request.query_params}", flush=True)

                response_body_obj = await func(request)

                if (
                    isinstance(response_body_obj, str)
                    and response_body_obj.startswith("HTTP/1.1 ")
                ):
                    return response_body_obj

                try:
                    response_body = json.dumps(response_body_obj)
                except Exception as exc:
                    response_body = json.dumps(
                        {
                            "success": False,
                            "error": "json-encode-failed",
                            "detail": str(exc),
                            "responseType": str(type(response_body_obj)),
                        }
                    )
                response_body_bytes = response_body.encode()
                return SegmentedResponse(
                    [response_body_bytes],
                    content_type=return_type,
                    headers=normalized_headers,
                    content_length=len(response_body_bytes),
                )

            return wrapped_handler

        if isinstance(handler_coroutine, str):
            handler_coroutine = WebServer.file_endpoint(handler_coroutine)

        if return_type == HttpReturnType.JSON:
            wrapper = wrapper_response_json
        else:
            wrapper = wrapper_response_str

        if header == HttpMethod.GET:
            self.get_handler_map[path] = wrapper(handler_coroutine)
        elif header == HttpMethod.POST:
            self.post_handler_map[path] = wrapper(handler_coroutine)
        else:
            raise NotImplementedError("Only GET and POST methods are implemented.")

    async def handle_client(self, reader, writer):
        self._active_clients += 1
        self._enable_no_delay(writer)
        _info("ws: client connected (active={})".format(self._active_clients))
        if self._active_clients > _MAX_CONCURRENT_CLIENTS:
            _info("ws: client rejected (active={}, max={})".format(self._active_clients, _MAX_CONCURRENT_CLIENTS))
            self._trace_request("client-rejected", active=self._active_clients)
            error_response = self._build_response(503, "Service Unavailable")
            await self._write_all(writer, error_response.encode())
            self._active_clients -= 1
            await self._close_writer(writer)
            return

        pending = bytearray()
        requests_served = 0
        try:
            while True:
                request = HttpRequest()
                self._request_counter += 1
                request_id = self._request_counter
                request_started_at = self._ticks_ms()
                response_status = 200
                traced = False

                parse_timeout = (
                    _REQUEST_TIMEOUT_S if requests_served == 0 else _KEEP_ALIVE_IDLE_TIMEOUT_S
                )
                try:
                    # `asyncio.wait_for` allocates one task per call, so it belongs at
                    # request/response granularity, never inside the per-chunk write loop.
                    await asyncio.wait_for(
                        request.parse_from_stream(reader, pending),
                        parse_timeout,
                    )
                except Exception as exc:
                    response_status = 400
                    timed_out = _timeout_type is not None and isinstance(exc, _timeout_type)
                    self._trace_request(
                        "parse-failed",
                        request_id=request_id,
                        timeout=bool(timed_out),
                    )
                    if timed_out and requests_served > 0:
                        # Idle timeout between keep-alive requests: just close.
                        break
                    error_response = self._build_response(400, "Bad Request")
                    await self._write_all(writer, error_response.encode())
                    break

                if not request.method:
                    self._trace_request("client-closed", request_id=request_id)
                    break

                path = request.path
                # No per-request `_info` line: a webview poll runs at ~10 Hz, so an
                # always-on line per request buries everything else on the serial
                # console. Request visibility lives in the sampled `ws-trace`
                # lines below (`log_requests` / `log_frequent_messages`).
                traced = self._should_trace_request(path, request_id)
                if traced:
                    self._trace_request(
                        "request-received",
                        request_id=request_id,
                        method=request.method,
                        path=path,
                    )

                try:
                    response_status, keep_alive = await asyncio.wait_for(
                        self._serve_request(request, writer, request_id, requests_served),
                        _RESPONSE_TIMEOUT_S,
                    )
                except Exception as exc:
                    if _timeout_type is not None and isinstance(exc, _timeout_type):
                        _error("ws: response timeout id={} path={}".format(request_id, path))
                        self._trace_request(
                            "response-timeout",
                            request_id=request_id,
                            path=path,
                        )
                        break
                    elif isinstance(exc, OSError):
                        _error("ws: connection oserror id={} path={} ({})".format(request_id, path, exc))
                        self._trace_request(
                            "connection-oserror",
                            request_id=request_id,
                        )
                        break
                    else:
                        raise

                requests_served += 1
                if traced:
                    elapsed = self._ticks_diff(self._ticks_ms(), request_started_at)
                    self._trace_request(
                        "request-complete",
                        request_id=request_id,
                        status=response_status,
                        elapsed_ms=elapsed,
                    )

                if not keep_alive or requests_served >= _MAX_REQUESTS_PER_CONNECTION:
                    break
        finally:
            await self._close_writer(writer)
            self._active_clients -= 1
            _info("ws: client disconnected (active={})".format(self._active_clients))

    async def _serve_request(self, request, writer, request_id, requests_served=0):
        """Serve one request on an open connection and report whether it stays open.

        ``requests_served`` counts the requests already answered on this socket so the
        response that fills ``_MAX_REQUESTS_PER_CONNECTION`` can announce the close in
        its own headers instead of promising a reuse that never happens.
        """
        req_type = request.method
        path = request.path
        response_status = 200
        traced = self._should_trace_request(path, request_id)
        keep_alive = self._request_allows_keep_alive(request)
        # The cap is enforced here rather than only in the accept loop: the client must be
        # told this is the last response, otherwise it reuses a socket the server closes
        # right after the write (a lost POST, not just a retried GET).
        if keep_alive and requests_served + 1 >= _MAX_REQUESTS_PER_CONNECTION:
            keep_alive = False
        had_error = False

        if not req_type or not path:
            response_status = 400
            response = self._build_response(
                400,
                "Bad Request",
                connection=self._connection_header(keep_alive, 400),
            )
            await self._write_all(writer, response.encode())
            return response_status, False

        if req_type == HttpMethod.GET:
            handler = self.get_handler_map.get(path)
        elif req_type == HttpMethod.POST:
            handler = self.post_handler_map.get(path)
        else:
            response_status = 405
            response = self._build_response(
                405,
                "Method Not Allowed",
                connection=self._connection_header(keep_alive, 405),
            )
            await self._write_all(writer, response.encode())
            return response_status, False

        if not handler:
            response_status = 404
            if traced:
                self._trace_request(
                    "handler-missing",
                    request_id=request_id,
                    method=req_type,
                    path=path,
                )
            response = self._build_response(
                404,
                "Not Found",
                connection=self._connection_header(keep_alive, 404),
            )
            await self._write_all(writer, response.encode())
            return response_status, keep_alive

        handler_started_at = self._ticks_ms()
        try:
            response = await handler(request)
        except Exception as exc:
            response_status = 500
            self._trace_request(
                "handler-error",
                request_id=request_id,
                method=req_type,
                path=path,
                error=str(exc),
            )
            response = self._build_response(500, "Internal Server Error")

        if traced:
            elapsed = self._ticks_diff(self._ticks_ms(), handler_started_at)
            self._trace_request(
                "handler-finished",
                request_id=request_id,
                method=req_type,
                path=path,
                elapsed_ms=elapsed,
                response_type=str(type(response)),
            )

        if isinstance(response, FileResponse):
            mode = "rb"
            try:
                file_started_at = self._ticks_ms()
                if traced:
                    self._trace_request(
                        "file-response-open",
                        request_id=request_id,
                        path=path,
                        file_path=response.file_path,
                        mode=mode,
                    )
                with open(response.file_path, mode) as f:
                    content_length = response.content_length
                    if content_length is None:
                        try:
                            stat_result = _os.stat(response.file_path)
                            if stat_result and len(stat_result) > 6:
                                content_length = int(stat_result[6])
                        except Exception:
                            content_length = None

                    connection = self._connection_header(keep_alive, 200)
                    header_lines = [
                        "HTTP/1.1 200 OK",
                        f"Content-Type: {response.content_type}",
                        f"Connection: {connection}",
                    ]
                    if connection == "keep-alive":
                        header_lines.append(
                            f"Keep-Alive: timeout={_KEEP_ALIVE_IDLE_TIMEOUT_S}, "
                            f"max={_MAX_REQUESTS_PER_CONNECTION}"
                        )
                    if content_length is not None and content_length >= 0:
                        header_lines.append(f"Content-Length: {content_length}")

                    if response.headers:
                        if isinstance(response.headers, dict):
                            items = response.headers.items()
                        else:
                            items = response.headers
                        for key, value in items:
                            if not key or value is None:
                                continue
                            header_lines.append(f"{key}: {value}")

                    header_bytes = ("\r\n".join(header_lines) + "\r\n\r\n").encode()

                    if content_length is not None and 0 <= content_length <= _SMALL_FILE_INLINE_MAX:
                        # Small files (all static web assets) are served in a single
                        # write so lwIP can burst the body out as a few TCP segments in
                        # one round-trip, instead of paying a drain() round-trip per
                        # 1024-byte chunk on the access point's small send buffer.
                        body = f.read()
                        response_length = len(body)
                        await self._write_all(writer, header_bytes + body)
                        await self._maybe_yield(None)
                    else:
                        # Large files are streamed in bounded blocks, but with a
                        # block size large enough that lwIP can push several TCP
                        # segments per round-trip instead of paying one drain()
                        # round-trip per 1024-byte chunk on the access point's
                        # small send buffer.
                        response_length = 0
                        last_yield_ms = None
                        await self._write_all(writer, header_bytes)
                        while True:
                            chunk = f.read(_FILE_STREAM_CHUNK_SIZE)
                            if not chunk:
                                break
                            response_length += len(chunk)
                            await self._write_all(writer, chunk)
                            last_yield_ms = await self._maybe_yield(last_yield_ms)
                    if traced:
                        elapsed = self._ticks_diff(self._ticks_ms(), file_started_at)
                        self._trace_request(
                            "file-response-complete",
                            request_id=request_id,
                            path=path,
                            file_path=response.file_path,
                            bytes_sent=response_length,
                            elapsed_ms=elapsed,
                        )
            except OSError:
                response_status = 404
                had_error = True
                self._trace_request(
                    "file-response-missing",
                    request_id=request_id,
                    path=path,
                    file_path=response.file_path,
                )
                error_response = self._build_response(404, "File not found.")
                await self._write_all(writer, error_response.encode())

        elif isinstance(response, SegmentedResponse):
            try:
                content_length = response.content_length
                encoded_segments = response.segments
                if content_length is None:
                    content_length = 0
                    preencoded = []
                    stream_originals = False
                    for segment in response.segments:
                        if segment is None:
                            continue
                        if isinstance(segment, bytes):
                            segment_bytes = segment
                        elif isinstance(segment, str):
                            segment_bytes = segment.encode()
                        else:
                            segment_bytes = str(segment).encode()
                        content_length += len(segment_bytes)
                        if not stream_originals:
                            preencoded.append(segment_bytes)
                            if content_length > _COALESCE_PREFIX_MAX:
                                # Large body: don't hold every encoded segment in
                                # memory; stream the originals (re-encoding on send).
                                stream_originals = True
                                preencoded = []
                    response.content_length = content_length
                    encoded_segments = response.segments if stream_originals else preencoded

                connection = self._connection_header(keep_alive, 200)
                header_lines = [
                    "HTTP/1.1 200 OK",
                    f"Content-Type: {response.content_type}",
                    f"Content-Length: {content_length}",
                    f"Connection: {connection}",
                ]
                if connection == "keep-alive":
                    header_lines.append(
                        f"Keep-Alive: timeout={_KEEP_ALIVE_IDLE_TIMEOUT_S}, "
                        f"max={_MAX_REQUESTS_PER_CONNECTION}"
                    )

                if response.headers:
                    items = self._normalize_headers(response.headers)
                    for key, value in items:
                        header_lines.append(f"{key}: {value}")

                header_bytes = ("\r\n".join(header_lines) + "\r\n\r\n").encode()

                # JSON/segmented bodies are small; encode the whole body and send
                # it in a single write so lwIP bursts it out in one round-trip,
                # mirroring the simple `write(); drain()` MicroPython pattern.
                body_chunks = []
                for segment in encoded_segments:
                    if segment is None:
                        continue
                    if isinstance(segment, bytes):
                        segment_bytes = segment
                    elif isinstance(segment, str):
                        segment_bytes = segment.encode()
                    else:
                        segment_bytes = str(segment).encode()
                    body_chunks.append(segment_bytes)

                body = b"".join(body_chunks)
                await self._write_all(writer, header_bytes + body)
                await self._maybe_yield(None)
                if traced:
                    self._trace_request(
                        "segmented-response-complete",
                        request_id=request_id,
                        path=path,
                        content_length=content_length,
                    )
            except Exception:
                response_status = 500
                had_error = True
                try:
                    await self._write_all(
                        writer,
                        b"HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n",
                    )
                except Exception:
                    pass
        else:
            if not isinstance(response, str):
                response = str(response)
            if response.startswith("HTTP/1.1 "):
                status_prefix = response.split("\r\n", 1)[0]
                if " " in status_prefix:
                    try:
                        response_status = int(status_prefix.split(" ")[1])
                    except Exception:
                        pass
                raw, can_reuse = self._prepare_raw_response(response, keep_alive, response_status)
                await self._write_all(writer, raw.encode())
                return response_status, can_reuse
            else:
                wrapped = self._build_response(
                    200,
                    response,
                    content_type=HttpReturnType.TEXT,
                    connection=self._connection_header(keep_alive, 200),
                )
                await self._write_all(writer, wrapped.encode())
        return response_status, keep_alive and not had_error and response_status in _KEEP_ALIVE_STATUSES

    @staticmethod
    def file_endpoint(
        file_path,
        content_type="text/html; charset=utf-8",
        is_binary=False,
    ):
        async def file_handler(request):
            try:
                del request
                return FileResponse(file_path, content_type, is_binary)
            except OSError:
                return "File not found."

        return file_handler

    async def endpoint_not_found(self, request):
        path = request.path
        params = request.query_params
        return (
            f"<!DOCTYPE html><html><head><title>404 Not Found</title></head>"
            f"<body><h1>404 Not Found</h1><p>Requested Path: {path}</p>"
            "<table><tr><th>Key</th><th>Value</th></tr>"
            + "".join(f"<tr><td>{k}</td><td>{v}</td></tr>" for k, v in params.items())
            + "</table>"
            "</body></html>"
        )

    async def start(self):
        while True:
            try:
                _info("ws: starting server on {}:{}".format(self.host, self.port))
                self.server = await asyncio.start_server(
                    self.handle_client,
                    self.host,
                    self.port,
                )
                _info("ws: server bound, accepting connections")
                async with self.server:
                    await self.server.wait_closed()
                    _info("ws: server stopped accepting connections")
                return
            except asyncio.CancelledError:
                _info("ws: server start cancelled")
                raise
            except OSError as exc:
                _error(
                    "ws: server failed to start on {}:{} ({}): {}".format(
                        self.host, self.port, getattr(exc, "errno", None), exc
                    )
                )
                # Some ESP32/MicroPython builds can surface transient socket I/O
                # faults (Errno 5 / EIO) during startup; retry instead of
                # terminating the whole runtime.
                err_no = getattr(exc, "errno", None)
                message = str(exc).lower()
                is_transient_eio = (
                    err_no == _TRANSIENT_EIO_ERRNO
                    or "[errno 5]" in message
                    or " eio" in message
                )
                if not is_transient_eio:
                    raise
                self.server = None
                await asyncio.sleep_ms(_TRANSIENT_STARTUP_RETRY_MS)

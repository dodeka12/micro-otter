# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

import sys

from micropython import const

import uasyncio as asyncio

try:  # pragma: no cover - MicroPython runtime preferred
    import ujson as json
except ImportError:  # pragma: no cover - fallback for host tooling
    import json  # type: ignore

try:  # pragma: no cover - MicroPython runtime preferred
    import uos as _os
except ImportError:  # pragma: no cover - fallback for host tooling
    import os as _os

try:  # pragma: no cover - MicroPython runtime preferred
    import utime as _time_source
except ImportError:  # pragma: no cover - fallback for host tooling
    import time as _time_source  # type: ignore

try:  # pragma: no cover - MicroPython runtime preferred
    import uasyncio as _asyncio_module
except ImportError:  # pragma: no cover - fallback for host tooling
    import asyncio as _asyncio_module  # type: ignore

from otter_runtime.http_request import HttpMethod, HttpReturnType
from otter_runtime.web_server import FileResponse, WebServer

_IS_MICROPYTHON = getattr(getattr(sys, "implementation", None), "name", "") == "micropython"

try:
    from tools.runtime_log import log_event as _runtime_log_event
except ImportError as import_exc:
    if _IS_MICROPYTHON:
        raise ImportError(
            "otter_runtime.web_interface requires 'tools.runtime_log' but import failed"
        ) from import_exc

    def _runtime_log_event(*_args, **_kwargs):
        return None


WEBSERVER_HOOK_CONTRACT_VERSION = "webserver-hooks/v1"
WEBSERVER_HOOK_MODULE = "app.webserver_hooks_generated"
WEBSERVER_HOOK_REGISTER_EXTRA_ROUTES = "register_extra_routes"
WEBSERVER_HOOK_HANDLE_INDEX = "handle_index"
WEBSERVER_HOOK_HANDLE_POST_WEBVIEW_REFRESH = "handle_post_webview_refresh"
_WEBVIEW_REFRESH_ROUTE = "/api/webview/refresh"
_WEBVIEW_RUNTIME_FLAGS_PATH = "collection/webview_runtime_flags.json"
_SHELL_LOGO_ROUTE = "/micro-otter-128px-white.svg"
_SHELL_LOGO_PATH = "html/micro-otter-128px-white.svg"
_SHELL_FAVICON_ROUTE = "/favicon.ico"
_SHELL_FAVICON_PATH = "html/micro-otter-head-64px.svg"
_WEB_SERVER_PORT = const(80)
_WAIT_READY_TIMEOUT_MS_DEFAULT = const(5000)
_WAIT_READY_POLL_MS_DEFAULT = const(200)
_REQUEST_LOG_SAMPLE_INTERVAL = const(20)
_ENABLE_HIGH_FREQUENCY_DEBUG_LOGS = False

WEB_INTERFACE = None
_WEB_SERVER_BIND_HOST = "0.0.0.0"
_ROOT_REQUEST_COUNT = 0
_REFRESH_REQUEST_COUNT = 0


def _ticks_ms() -> int:
    if hasattr(_time_source, "ticks_ms"):
        return _time_source.ticks_ms()  # type: ignore[attr-defined]
    if hasattr(_time_source, "time"):
        return int(_time_source.time() * 1000)  # type: ignore[attr-defined]
    return 0


def _ticks_diff(current: int, previous: int) -> int:
    if hasattr(_time_source, "ticks_diff"):
        return _time_source.ticks_diff(current, previous)  # type: ignore[attr-defined]
    return current - previous


def _log_web(message, **fields) -> None:
    if _runtime_log_event:
        try:
            _runtime_log_event("web", message=message, **fields)
            return
        except Exception:
            pass
    print("[info] web:", message)


def _info(message) -> None:
    """Always-on diagnostic line for locating hangs on the serial console."""
    print("[info]", message)


class WebInterface:
    """Thin runtime facade: default GET root plus optional hook-based specialization."""

    def __init__(
        self,
        host_ip: str,
        server=None,
        enable_server: bool = True,
        port: int = _WEB_SERVER_PORT,
    ) -> None:
        self.host_ip = host_ip
        self.server_port = port
        self.web_server = None
        self._server_owned = False
        self._server_task = None
        self._server_start_error = None
        self._hook_handlers = {}
        self._webview_refresh_hook_registered = False
        self._webview_runtime_flags = self._load_webview_runtime_flags()
        self._webview_refresh_route = self._resolve_webview_refresh_route(
            self._webview_runtime_flags
        )
        self._web_data_store = self._create_optional_web_data_store(
            self._webview_runtime_flags
        )
        self._webview_sync_epoch = 0
        self._hook_context = {
            "hook_contract_version": WEBSERVER_HOOK_CONTRACT_VERSION,
            "hook_module": WEBSERVER_HOOK_MODULE,
            "web_interface": self,
            "web_server": None,
            "webview_runtime_flags": self._webview_runtime_flags,
            "web_data_store": self._web_data_store,
        }

        if enable_server:
            self.start_server(server)

    def start_server(self, server=None) -> bool:
        """Create and start the web server.

        Idempotent: returns ``False`` when a server is already present, which is
        what the late station-connect path relies on. Start failures keep
        surfacing through ``wait_until_server_ready()`` /
        ``get_server_start_error()`` exactly as during boot.
        """
        if self.web_server is not None:
            return False

        self._server_start_error = None
        self.web_server = server or WebServer(
            host=_WEB_SERVER_BIND_HOST,
            port=self.server_port,
            # log_requests=True,
            # log_frequent_messages=True,
        )
        self._server_owned = server is None
        _info("wi: registering endpoints")
        self._register_endpoints()

        if self._server_owned:
            _info("wi: starting owned server task")
            self._server_task = asyncio.create_task(self.web_server.start())

        return True

    def set_host_ip(self, host_ip: str) -> None:
        """Publish the IP a client should dial after a late station connect."""
        self.host_ip = host_ip
        _log_web("host-ip-updated", host_ip=host_ip)

    @staticmethod
    def _is_awaitable(value) -> bool:
        if value is None:
            return False

        if hasattr(value, "__await__"):
            return True

        # MicroPython may expose coroutine objects as generator-like values
        # without __await__, but they still support `await`.
        return all(
            hasattr(value, attr)
            for attr in (
                "send",
                "throw",
                "close",
            )
        )

    def _path_exists(self, path: str) -> bool:
        if not path:
            return False
        try:
            _os.stat(path)
            return True
        except OSError:
            return False

    @staticmethod
    def _stat_file(path):
        """Return ``(exists, size, mtime)`` from a single ``os.stat`` call."""
        if not path:
            return (False, 0, 0)
        try:
            st = _os.stat(path)
        except OSError:
            return (False, 0, 0)
        size = int(st[6]) if len(st) > 6 else 0
        mtime = int(st[8]) if len(st) > 8 else 0
        return (True, size, mtime)

    @staticmethod
    def _etag_for(size, mtime):
        return '"%x-%x"' % (size, mtime) if mtime else '"%x"' % size

    @staticmethod
    def _etag_matches(request_headers, etag):
        if not isinstance(request_headers, dict) or not etag:
            return False
        value = str(request_headers.get("if-none-match", "")).strip()
        if not value:
            return False
        if value == "*":
            return True
        for token in value.split(","):
            candidate = token.strip()
            if candidate == etag or candidate == "W/" + etag:
                return True
        return False

    @staticmethod
    def _asset_headers(size, mtime, extra=None):
        headers = [
            ("ETag", WebInterface._etag_for(size, mtime)),
            ("Cache-Control", "no-cache"),
            ("Vary", "Accept-Encoding"),
        ]
        if extra:
            headers.extend(extra)
        return headers

    @staticmethod
    def _not_modified_response(etag):
        return (
            "HTTP/1.1 304 Not Modified\r\n"
            "ETag: " + etag + "\r\n"
            "Cache-Control: no-cache\r\n"
            "Vary: Accept-Encoding\r\n"
            "Content-Length: 0\r\n"
            "\r\n"
        )

    def _get_hook_context(self) -> dict:
        self._hook_context["web_server"] = self.web_server
        self._hook_context["webview_runtime_flags"] = self._webview_runtime_flags
        self._hook_context["web_data_store"] = self._web_data_store
        return self._hook_context

    def _load_webview_runtime_flags(self) -> dict:
        if not self._path_exists(_WEBVIEW_RUNTIME_FLAGS_PATH):
            return {}

        try:
            with open(_WEBVIEW_RUNTIME_FLAGS_PATH) as runtime_flags_file:
                loaded = json.load(runtime_flags_file)
            if isinstance(loaded, dict):
                return loaded
        except Exception as exc:
            _log_web("Runtime flags load failed; defaults active", error=str(exc))

        return {}

    def _resolve_webview_refresh_route(self, runtime_flags: dict) -> str:
        if isinstance(runtime_flags, dict):
            configured_route = runtime_flags.get("postRefreshRoute")
            if isinstance(configured_route, str):
                normalized_route = configured_route.strip()
                if normalized_route.startswith("/") and len(normalized_route) > 1:
                    return normalized_route
        return _WEBVIEW_REFRESH_ROUTE

    def _create_optional_web_data_store(self, runtime_flags: dict):
        if not isinstance(runtime_flags, dict):
            return None

        if not bool(runtime_flags.get("needsWebDataStore")):
            return None

        try:
            data_store_module = __import__(
                "otter_webview.web_data_store",
                None,
                None,
                ("WebDataStore",),
            )
            web_data_store_type = getattr(data_store_module, "WebDataStore", None)
            if callable(web_data_store_type):
                return web_data_store_type()
        except Exception as exc:
            _log_web(
                "WebDataStore import failed; trying fallback",
                module="otter_webview.web_data_store",
                error=str(exc),
            )

        return None

    def _is_gzip_accepted(self, request_headers: dict) -> bool:
        if not isinstance(request_headers, dict):
            return False

        accept_encoding = str(request_headers.get("accept-encoding", "")).lower()
        if not accept_encoding:
            return False

        # An explicit refusal (gzip;q=0, gzip;q=0.0) wins over the fast substring
        # check below.
        if "gzip;q=0" in accept_encoding:
            return False

        # Fast path: substring check covers all common browser values
        # ("gzip", "gzip, deflate", "deflate, gzip;q=1.0", etc.).
        return "gzip" in accept_encoding

    def _get_hook_callable(self, hook_name: str):
        hook_value = self._hook_handlers.get(hook_name)
        if callable(hook_value):
            return hook_value
        return None

    async def _invoke_optional_hook(self, hook_name: str, request):
        hook_callable = self._get_hook_callable(hook_name)
        if not hook_callable:
            return None
        try:
            hook_result = hook_callable(request, self._get_hook_context())
            if self._is_awaitable(hook_result):
                hook_result = await hook_result
            return hook_result
        except Exception as exc:
            _log_web("Hook call failed; falling back", hook=hook_name, error=str(exc))
            return None

    async def wait_until_server_ready(
        self,
        timeout_ms: int = _WAIT_READY_TIMEOUT_MS_DEFAULT,
        poll_ms: int = _WAIT_READY_POLL_MS_DEFAULT,
    ) -> bool:
        if not self.web_server:
            return False

        if getattr(self.web_server, "server", None) is not None:
            _info("wi: server already ready")
            return True

        start_ticks = _ticks_ms()
        while True:
            if getattr(self.web_server, "server", None) is not None:
                _info(
                    "wi: server ready (elapsed_ms={})".format(
                        _ticks_diff(_ticks_ms(), start_ticks)
                    )
                )
                return True

            if self._server_task and self._server_task.done():
                # MicroPython's uasyncio Task has no exception(): awaiting the finished
                # task returns its result or re-raises whatever stopped it.
                try:
                    await self._server_task
                except _asyncio_module.CancelledError:
                    self._server_start_error = "server-start-cancelled"
                    return False
                except Exception as exc:
                    self._server_start_error = str(exc)
                    _log_web(
                        "Server task failed before ready",
                        error=str(exc),
                        error_type=type(exc).__name__,
                    )
                    return False

                self._server_start_error = "server-task-exited-before-ready"
                _log_web("Server task exited before ready")
                return False

            if timeout_ms is not None and timeout_ms >= 0:
                elapsed = _ticks_diff(_ticks_ms(), start_ticks)
                if elapsed >= timeout_ms:
                    if self._server_start_error is None:
                        self._server_start_error = "server-ready-timeout"
                    return False

            await asyncio.sleep_ms(poll_ms)

    def get_server_start_error(self):
        return self._server_start_error

    def _register_endpoints(self) -> None:
        if not self.web_server:
            return

        # Keep shell assets available even when generated webview hooks are absent.
        self.register_static_asset_route(
            _SHELL_LOGO_ROUTE,
            content_type="image/svg+xml",
            fallback_path=_SHELL_LOGO_PATH,
            is_binary_fallback=False,
        )
        self.register_static_asset_route(
            _SHELL_FAVICON_ROUTE,
            content_type="image/svg+xml",
            fallback_path=_SHELL_FAVICON_PATH,
            is_binary_fallback=False,
        )
        self.web_server.set_endpoint("/", self._handle_root_shell)
        hooks_loaded = self._load_webserver_hooks()
        _log_web(
            "Web endpoints registered",
            hooks_loaded=bool(hooks_loaded),
            refresh_route=self._webview_refresh_route,
            has_data_store=bool(self._web_data_store),
        )

    def _register_hook_webview_refresh(self) -> None:
        if not self.web_server or self._webview_refresh_hook_registered:
            return

        if not self._get_hook_callable(WEBSERVER_HOOK_HANDLE_POST_WEBVIEW_REFRESH):
            _log_web(
                "Webview refresh hook callable unavailable",
                route=self._webview_refresh_route,
            )
            return

        self.web_server.set_endpoint(
            self._webview_refresh_route,
            self._handle_hook_post_webview_refresh,
            header=HttpMethod.POST,
            return_type=HttpReturnType.JSON,
        )
        self._webview_refresh_hook_registered = True
        _log_web("Webview refresh endpoint registered", route=self._webview_refresh_route)

    def _load_webserver_hooks(self) -> bool:
        self._hook_handlers = {}

        try:
            hook_module = __import__(WEBSERVER_HOOK_MODULE, None, None, ("*",))
        except ImportError as exc:
            _log_web(
                "Hook module import not found; default behavior active",
                module=WEBSERVER_HOOK_MODULE,
                error=str(exc),
            )
            return False
        except Exception as exc:
            _log_web("Hook module import failed; default behavior active", error=str(exc))
            return False

        self._hook_handlers[WEBSERVER_HOOK_REGISTER_EXTRA_ROUTES] = getattr(
            hook_module,
            WEBSERVER_HOOK_REGISTER_EXTRA_ROUTES,
            None,
        )
        self._hook_handlers[WEBSERVER_HOOK_HANDLE_INDEX] = getattr(
            hook_module,
            WEBSERVER_HOOK_HANDLE_INDEX,
            None,
        )
        self._hook_handlers[WEBSERVER_HOOK_HANDLE_POST_WEBVIEW_REFRESH] = getattr(
            hook_module,
            WEBSERVER_HOOK_HANDLE_POST_WEBVIEW_REFRESH,
            None,
        )

        register_routes_hook = self._get_hook_callable(WEBSERVER_HOOK_REGISTER_EXTRA_ROUTES)
        if register_routes_hook:
            try:
                register_result = register_routes_hook(self.web_server, self._get_hook_context())
                if self._is_awaitable(register_result):
                    asyncio.create_task(register_result)
            except Exception as exc:
                _log_web("Hook route registration failed; default behavior active", error=str(exc))

        _log_web(
            "Hook module loaded",
            module=WEBSERVER_HOOK_MODULE,
            has_register_routes=bool(register_routes_hook),
            has_handle_index=bool(self._get_hook_callable(WEBSERVER_HOOK_HANDLE_INDEX)),
            has_handle_refresh=bool(
                self._get_hook_callable(WEBSERVER_HOOK_HANDLE_POST_WEBVIEW_REFRESH)
            ),
        )

        self._register_hook_webview_refresh()
        return True

    async def _handle_hook_post_webview_refresh(self, request):
        global _REFRESH_REQUEST_COUNT
        _REFRESH_REQUEST_COUNT += 1
        if _ENABLE_HIGH_FREQUENCY_DEBUG_LOGS and (
            _REFRESH_REQUEST_COUNT == 1
            or (_REFRESH_REQUEST_COUNT % _REQUEST_LOG_SAMPLE_INTERVAL) == 0
        ):
            request_path = getattr(request, "path", "") if request is not None else ""
            _log_web(
                "Refresh endpoint hit",
                count=_REFRESH_REQUEST_COUNT,
                path=request_path,
            )

        hook_response = await self._invoke_optional_hook(
            WEBSERVER_HOOK_HANDLE_POST_WEBVIEW_REFRESH,
            request,
        )
        if hook_response is not None:
            if isinstance(hook_response, dict):
                return hook_response

            _log_web(
                "Webview refresh hook returned non-dict response",
                response_type=str(type(hook_response)),
            )
            return {
                "success": False,
                "error": "webview-refresh-hook-invalid-response",
                "route": self._webview_refresh_route,
                "responseType": str(type(hook_response)),
            }

        _log_web(
            "Webview refresh fallback response used",
            route=self._webview_refresh_route,
        )
        return {
            "success": False,
            "error": "webview-refresh-hook-unavailable",
            "route": self._webview_refresh_route,
        }

    async def _handle_root_shell(self, request):
        global _ROOT_REQUEST_COUNT
        _ROOT_REQUEST_COUNT += 1
        _info("wi: root shell hit (count={})".format(_ROOT_REQUEST_COUNT))
        if _ENABLE_HIGH_FREQUENCY_DEBUG_LOGS and (
            _ROOT_REQUEST_COUNT == 1
            or (_ROOT_REQUEST_COUNT % _REQUEST_LOG_SAMPLE_INTERVAL) == 0
        ):
            request_path = getattr(request, "path", "") if request is not None else ""
            _log_web(
                "Root endpoint hit",
                count=_ROOT_REQUEST_COUNT,
                path=request_path,
            )

        hook_response = await self._invoke_optional_hook(WEBSERVER_HOOK_HANDLE_INDEX, request)
        if hook_response is not None:
            _info("wi: root shell served by hook (type={})".format(type(hook_response).__name__))
            return hook_response

        del request
        _info("wi: root shell falling back to html/index.html")
        return FileResponse(
            "html/index.html",
            "text/html; charset=utf-8",
            is_binary=False,
        )

    def register_endpoint(
        self,
        path,
        handler,
        *,
        header=HttpMethod.GET,
        return_type=HttpReturnType.HTML,
        headers=None,
    ) -> bool:
        if not self.web_server:
            return False
        self.web_server.set_endpoint(
            path,
            handler,
            header=header,
            return_type=return_type,
            headers=headers,
        )
        return True

    def register_post_endpoint(self, path, handler, *, return_type=HttpReturnType.JSON, headers=None) -> bool:
        return self.register_endpoint(
            path,
            handler,
            header=HttpMethod.POST,
            return_type=return_type,
            headers=headers,
        )

    def register_post_topic(self, path, handler, *, return_type=HttpReturnType.JSON, headers=None) -> bool:
        return self.register_post_endpoint(path, handler, return_type=return_type, headers=headers)

    def request_webview_sync(self) -> int:
        self._webview_sync_epoch += 1
        return self._webview_sync_epoch

    def get_webview_sync_epoch(self) -> int:
        return self._webview_sync_epoch

    def publish_webview_values(self, values) -> int:
        web_data_store = self._web_data_store
        if web_data_store is None:
            return 0

        set_many = getattr(web_data_store, "set_many", None)
        if not callable(set_many):
            return 0

        try:
            published = set_many(values)
        except Exception as exc:
            _log_web("WebDataStore publish failed", error=str(exc))
            return 0

        if isinstance(published, int):
            return published
        return 0

    def consume_webview_values_snapshot(self, clear_after_read: bool = True) -> dict:
        web_data_store = self._web_data_store
        if web_data_store is None:
            return {}

        snapshot_fn = getattr(web_data_store, "snapshot", None)
        if not callable(snapshot_fn):
            return {}

        try:
            snapshot = snapshot_fn()
        except Exception as exc:
            _log_web("WebDataStore snapshot failed", error=str(exc))
            return {}

        if not isinstance(snapshot, dict):
            snapshot = {}

        if clear_after_read:
            clear_fn = getattr(web_data_store, "clear", None)
            if callable(clear_fn):
                try:
                    clear_fn()
                except Exception as exc:
                    _log_web("WebDataStore clear failed", error=str(exc))

        return snapshot

    def consume_webview_values_keys(self, keys, clear_after_read: bool = True) -> dict:
        web_data_store = self._web_data_store
        if web_data_store is None:
            return {}

        if not isinstance(keys, (list, tuple, set)):
            return {}

        consume_keys_fn = getattr(web_data_store, "consume_keys", None)
        if callable(consume_keys_fn):
            try:
                consumed = consume_keys_fn(keys, clear_after_read=clear_after_read)
                if isinstance(consumed, dict):
                    return consumed
                return {}
            except Exception as exc:
                _log_web("WebDataStore consume_keys failed", error=str(exc))
                return {}

        pop_value_fn = getattr(web_data_store, "pop_value", None)
        get_value_fn = getattr(web_data_store, "get_value", None)

        if clear_after_read and callable(pop_value_fn):
            marker = object()
            consumed = {}
            for key in keys:
                if not isinstance(key, str):
                    continue

                normalized_key = key.strip()
                if not normalized_key:
                    continue

                popped = pop_value_fn(normalized_key, marker)
                if popped is not marker:
                    consumed[normalized_key] = popped

            return consumed

        if not clear_after_read and callable(get_value_fn):
            marker = object()
            consumed = {}
            for key in keys:
                if not isinstance(key, str):
                    continue

                normalized_key = key.strip()
                if not normalized_key:
                    continue

                value = get_value_fn(normalized_key, marker)
                if value is not marker:
                    consumed[normalized_key] = value

            return consumed

        snapshot = self.consume_webview_values_snapshot(clear_after_read=False)
        if not isinstance(snapshot, dict):
            return {}

        consumed = {}
        consumed_keys = []
        for key in keys:
            if not isinstance(key, str):
                continue

            normalized_key = key.strip()
            if not normalized_key:
                continue

            if normalized_key not in snapshot:
                continue

            consumed[normalized_key] = snapshot.get(normalized_key)
            consumed_keys.append(normalized_key)

        if clear_after_read and consumed_keys:
            self.remove_webview_value_keys(consumed_keys)

        return consumed

    def remove_webview_value_keys(self, keys) -> int:
        web_data_store = self._web_data_store
        if web_data_store is None:
            return 0

        remove_keys_fn = getattr(web_data_store, "remove_keys", None)
        if callable(remove_keys_fn):
            try:
                removed = remove_keys_fn(keys)
                if isinstance(removed, int):
                    return removed
                return 0
            except Exception as exc:
                _log_web("WebDataStore remove_keys failed", error=str(exc))
                return 0

        if not isinstance(keys, (list, tuple, set)):
            return 0

        pop_value_fn = getattr(web_data_store, "pop_value", None)
        if not callable(pop_value_fn):
            return 0

        removed_count = 0
        for key in keys:
            if not isinstance(key, str):
                continue

            normalized_key = key.strip()
            if not normalized_key:
                continue

            marker = object()
            popped = pop_value_fn(normalized_key, marker)
            if popped is not marker:
                removed_count += 1

        return removed_count

    def register_static_asset_route(
        self,
        route: str,
        *,
        content_type: str,
        fallback_path: str = None,
        compressed_path: str = None,
        force_compressed_only: bool = False,
        is_binary_fallback: bool = False,
    ) -> bool:
        if not route:
            return False

        has_fallback = isinstance(fallback_path, str) and bool(fallback_path.strip())
        has_compressed = isinstance(compressed_path, str) and bool(compressed_path.strip())
        if not has_fallback and not has_compressed:
            return False

        async def _asset_handler(request):
            return self._resolve_static_asset_response(
                request,
                route=route,
                content_type=content_type,
                fallback_path=fallback_path,
                compressed_path=compressed_path,
                force_compressed_only=bool(force_compressed_only),
                is_binary_fallback=is_binary_fallback,
            )

        return self.register_endpoint(route, _asset_handler, header=HttpMethod.GET)

    def _resolve_static_asset_response(
        self,
        request,
        *,
        route: str = "",
        content_type: str,
        fallback_path: str = None,
        compressed_path: str = None,
        force_compressed_only: bool = False,
        is_binary_fallback: bool = False,
    ):
        request_headers = getattr(request, "headers", {}) if request else {}
        client_accepts_gzip = self._is_gzip_accepted(request_headers)
        route_key = str(route or "")
        should_trace = route_key in ("/", "/webview/webview_client.js")
        if should_trace:
            _info(
                "wi: static asset route={} gzip_accepted={}".format(
                    route_key, client_accepts_gzip
                )
            )

        if client_accepts_gzip:
            exists, size, mtime = self._stat_file(compressed_path)
            if exists:
                etag = self._etag_for(size, mtime)
                if self._etag_matches(request_headers, etag):
                    return self._not_modified_response(etag)
                if should_trace:
                    _log_web(
                        "Static asset resolved (compressed)",
                        route=route_key,
                        file_path=compressed_path,
                    )
                return FileResponse(
                    compressed_path,
                    content_type,
                    is_binary=True,
                    headers=self._asset_headers(size, mtime, [("Content-Encoding", "gzip")]),
                    content_length=size,
                )

            exists, size, mtime = self._stat_file(fallback_path)
            if exists:
                etag = self._etag_for(size, mtime)
                if self._etag_matches(request_headers, etag):
                    return self._not_modified_response(etag)
                if should_trace:
                    _log_web(
                        "Static asset resolved (fallback)",
                        route=route_key,
                        file_path=fallback_path,
                    )
                return FileResponse(
                    fallback_path,
                    content_type,
                    is_binary=is_binary_fallback,
                    headers=self._asset_headers(size, mtime),
                    content_length=size,
                )

            _log_web("Static asset missing", route=route_key)
            return "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\n\r\nFile not found."

        exists, size, mtime = self._stat_file(fallback_path)
        if exists:
            etag = self._etag_for(size, mtime)
            if self._etag_matches(request_headers, etag):
                return self._not_modified_response(etag)
            if should_trace:
                _log_web(
                    "Static asset resolved (fallback)",
                    route=route_key,
                    file_path=fallback_path,
                )
            return FileResponse(
                fallback_path,
                content_type,
                is_binary=is_binary_fallback,
                headers=self._asset_headers(size, mtime),
                content_length=size,
            )

        exists, _size, _mtime = self._stat_file(compressed_path)
        if exists:
            if should_trace:
                _log_web(
                    "Static asset compressed-only and client rejects gzip",
                    route=route_key,
                )
            return (
                "HTTP/1.1 406 Not Acceptable\r\n"
                "Content-Type: text/plain\r\n"
                "Vary: Accept-Encoding\r\n"
                "\r\n"
                "This build serves gzip-compressed assets only; "
                "enable gzip in your HTTP client."
            )

        _log_web("Static asset missing", route=route_key)
        return "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\n\r\nFile not found."

    def set_dom_mount_renderer(self, renderer):
        del renderer
        raise RuntimeError("Legacy DOM mount renderer flow is not supported")

    async def shutdown(self) -> None:
        if self._server_owned and self.web_server:
            if getattr(self.web_server, "server", None):
                self.web_server.server.close()
                await self.web_server.server.wait_closed()

            if self._server_task:
                self._server_task.cancel()
                try:
                    await self._server_task
                except asyncio.CancelledError:
                    pass
                self._server_task = None

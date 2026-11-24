# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
"""Unified Micro-Otter server: static files and WebSocket serial bridge on one port.

Serves the built web app (``dist/webapp``) or, during development, the raw source tree,
plus:

- ``GET /api/version`` — ``{"version": "..."}``
- ``GET /api/serial-ports`` — ``[{"device": ..., "label": ..., "display": ...}]``
- ``GET /api/server-capabilities`` — the capability payload built by
  :mod:`micro_otter.tools.server_capabilities`
- ``WS /serial?port=<device>&baud=<int>`` — a dumb byte pipe to a serial port

Every request passes the local-only trust check in
:mod:`micro_otter.tools.server_trust` first: a foreign ``Host`` header (DNS
rebinding) or a foreign ``Origin`` header (cross-site WebSocket hijacking) is
answered with ``403`` and a ``{"error": {...}}`` envelope.

The WebSocket protocol is described in
``docs/dev/device-communication/websocket-serial-bridge.md``: binary messages carry raw
serial bytes; a single text JSON frame ``{"type":"ready"}`` / ``{"type":"error"}`` is
sent on connect. No REPL framing is imposed; the browser's ``DeviceConnection`` owns the
MicroPython protocol.
"""

from __future__ import annotations

import asyncio
import json
import mimetypes
from http import HTTPStatus
from pathlib import Path, PurePosixPath
from urllib.parse import parse_qs, urlparse

import serial_asyncio
from websockets.asyncio.server import ServerConnection, serve
from websockets.datastructures import Headers
from websockets.exceptions import ConnectionClosed
from websockets.http11 import Response

from micro_otter.cli.state import SerialPort, detect_serial_ports
from micro_otter.config import Config, load_config
from micro_otter.tools.addon_store import (
    addon_asset_path,
    merged_index_payload,
    runtime_manifest_addons,
)

from .firmware_ws_handler import FIRMWARE_PATH, FirmwareJobRunner
from .server_capabilities import (
    build_server_capabilities,
    read_app_version,
    resolve_static_root,
)
from .server_trust import (
    LOOPBACK_HOSTS,
    LocalRequestRejected,
    allowed_hosts_for,
    ensure_local_request,
    is_allowed_origin,
)

DEFAULT_BAUD = 115200
SERIAL_PORTS_PATH = "/api/serial-ports"
SERIAL_PATH = "/serial"
API_VERSION_PATH = "/api/version"
SERVER_CAPABILITIES_PATH = "/api/server-capabilities"

NODE_PACKAGE_INDEX_PATH = "/device/node_pkgs/index.json"
"""Served node-package index; synthesized so installed add-ons appear in it."""

NODE_PKGS_URL_PREFIX = "/device/node_pkgs/"
"""URL prefix whose missing files fall back to the add-ons folder."""

_PACKAGE_DIR = Path(__file__).resolve().parent.parent
_STATIC_ROOT = resolve_static_root(_PACKAGE_DIR)
_DEVICE_DIR = _STATIC_ROOT / "device"
_PROTECTED_PREFIXES = ("/html/", "/device/")
_INDEX_PATHS = {"/", "", "/index.html"}


def serial_ports_payload(ports: list[SerialPort]) -> list[dict[str, str | None]]:
    """Map detected serial ports to the ``/api/serial-ports`` response shape.

    Each entry carries the raw ``device`` path, the raw ``label`` (the
    ``/dev/serial/by-id`` name or pyserial description), and ``display`` — the
    human-readable name :func:`~micro_otter.cli.state.format_serial_port_label`
    derives so every browser chooser shows the same name without parsing it.
    """

    return [{"device": port.device, "label": port.label, "display": port.display} for port in ports]


def _headers(*extra: tuple[str, str], allow_origin: str | None = "*") -> Headers:
    """Build response headers, adding a CORS origin unless *allow_origin* is ``None``.

    The wildcard default keeps static assets and ``/api/version`` working exactly
    as before. Firmware endpoints pass the request's own ``Origin`` instead, or
    ``None`` to send no CORS header at all; ``Access-Control-Allow-Credentials``
    is never sent.
    """

    headers = Headers(extra)
    if allow_origin is not None:
        headers["Access-Control-Allow-Origin"] = allow_origin
    return headers


def _json_response(payload: object, *, allow_origin: str | None = "*") -> Response:
    """Return *payload* as a JSON response, honouring *allow_origin*."""

    body = json.dumps(payload).encode("utf-8")
    return Response(
        HTTPStatus.OK.value,
        HTTPStatus.OK.phrase,
        _headers(
            ("Content-Type", "application/json; charset=utf-8"),
            ("Content-Length", str(len(body))),
            allow_origin=allow_origin,
        ),
        body,
    )


def _error_response(status: int, rejection: LocalRequestRejected) -> Response:
    """Return the ``{"error": {code, message, hint}}`` envelope for *rejection*."""

    body = json.dumps({"error": rejection.to_error_payload()}).encode("utf-8")
    return Response(
        status,
        HTTPStatus(status).phrase,
        _headers(
            ("Content-Type", "application/json; charset=utf-8"),
            ("Content-Length", str(len(body))),
            allow_origin=None,
        ),
        body,
    )


def _text_response(
    status: int, text: str, content_type: str = "text/html; charset=utf-8"
) -> Response:
    body = text.encode("utf-8")
    return Response(
        status,
        HTTPStatus(status).phrase,
        _headers(("Content-Type", content_type), ("Content-Length", str(len(body)))),
        body,
    )


def _resolve_static_path(request_path: str) -> Path:
    if request_path in _INDEX_PATHS:
        return _STATIC_ROOT / "index.html"
    if request_path.startswith("/device"):
        relative = request_path[len("/device") :].lstrip("/")
        parts = [part for part in PurePosixPath(relative).parts if part not in (".", "..")]
        return _DEVICE_DIR.joinpath(*parts)
    relative = request_path.lstrip("/")
    parts = [part for part in PurePosixPath(relative).parts if part not in (".", "..")]
    return _STATIC_ROOT.joinpath(*parts)


def _read_version() -> str:
    """Return the installed package version reported as the app version.

    The implementation lives in :mod:`micro_otter.tools.server_capabilities` so
    ``GET /api/version`` and the capability payload cannot disagree.
    """

    return read_app_version()


def _not_found_response() -> Response:
    """Return the plain-text ``404`` every missing static path answers with."""

    return _text_response(HTTPStatus.NOT_FOUND.value, "Not found", "text/plain; charset=utf-8")


def _static_response(request_path: str, addons_root: Path | None = None) -> Response:
    """Serve one static path, falling back to the add-ons folder for ``node_pkgs``.

    The fallback is a pure path decision (``addon_asset_path`` rejects traversal), so a
    missing ``/device/node_pkgs/<addon-id>/…`` file is answered from the user's add-ons
    folder while every other missing path keeps returning ``404``.
    """

    path = _resolve_static_path(request_path)
    if (
        not path.is_file()
        and addons_root is not None
        and request_path.startswith(NODE_PKGS_URL_PREFIX)
    ):
        relative = request_path[len(NODE_PKGS_URL_PREFIX) :]
        parts = [part for part in PurePosixPath(relative).parts if part not in (".", "..")]
        fallback = addon_asset_path(addons_root, parts)
        if fallback is None:
            return _not_found_response()
        path = fallback
    if not path.is_file():
        return _not_found_response()
    body = path.read_bytes()
    content_type, _ = mimetypes.guess_type(path.name)
    return Response(
        HTTPStatus.OK.value,
        HTTPStatus.OK.phrase,
        _headers(
            ("Content-Type", content_type or "application/octet-stream"),
            ("Content-Length", str(len(body))),
        ),
        body,
    )


def _is_direct_navigation(request) -> bool:
    headers = getattr(request, "headers", None) or {}
    return (
        headers.get("Sec-Fetch-Mode", "") == "navigate"
        and headers.get("Sec-Fetch-Dest", "") == "document"
    )


SERIAL_OPEN_ATTEMPTS = 5
"""Open attempts before a serial failure is reported to the client."""

SERIAL_OPEN_RETRY_DELAY = 0.2
"""Pause between two serial open attempts, in seconds."""


def _connection_state_name(connection: ServerConnection) -> str | None:
    """Return the protocol state name of *connection*, or ``None`` when unknown."""

    state = getattr(connection, "state", None)
    name = getattr(state, "name", None)
    return name if isinstance(name, str) else None


def _is_stale_connection(connection: ServerConnection | None) -> bool:
    """Return whether *connection* can no longer carry serial bytes.

    A client that drops without a clean close (tab killed, USB unplugged, network
    hiccup) leaves a closed protocol socket in the slot for a moment. The slot is
    taken over instead of rejecting the reconnect, which used to turn a normal
    reconnect into "serial port already in use" until the teardown had finished.
    """

    if connection is None:
        return False

    state = _connection_state_name(connection)
    if state is not None and state != "OPEN":
        return True

    return getattr(connection, "close_code", None) is not None


async def _open_serial(device: str, baud: int) -> tuple[asyncio.StreamReader, asyncio.StreamWriter]:
    """Open *device*, retrying while the OS finishes re-enumerating it.

    Closing a serial port drops DTR/RTS (``HUPCL``), which makes a native-USB
    board re-enumerate: the device node disappears for a moment and an immediate
    open fails with ``ENOENT``/``EBUSY``. ``mpremote`` solves the same race with
    ``--wait``; five attempts over one second cover a normal board and still
    report a port that is genuinely busy quickly.

    ``exclusive=True`` makes the OS refuse a second opener, so the bridge cannot
    silently shadow another tool. The ``rtscts``/``dsrdtr`` overrides keep flow
    control off: an ESP32 dev board has no RTS/CTS wiring.
    """

    last_error: Exception | None = None
    for attempt in range(1, SERIAL_OPEN_ATTEMPTS + 1):
        try:
            return await serial_asyncio.open_serial_connection(
                url=device,
                baudrate=baud,
                exclusive=True,
                rtscts=False,
                dsrdtr=False,
            )
        except Exception as exc:  # noqa: BLE001 - retried below, then re-raised
            last_error = exc
            if attempt < SERIAL_OPEN_ATTEMPTS:
                await asyncio.sleep(SERIAL_OPEN_RETRY_DELAY)

    if last_error is not None:
        raise last_error
    raise RuntimeError(f"could not open serial device {device}")


class _SerialBridge:
    """Runs the HTTP endpoints and the ``/serial`` WebSocket byte pipe."""

    def __init__(self, disable_protection: bool = False, *, config: Config | None = None) -> None:
        self._active_connection: ServerConnection | None = None
        self._disable_protection = disable_protection
        self._config = config
        self._allowed_hosts = allowed_hosts_for(config) if config is not None else LOOPBACK_HOSTS

    def _addons_root(self) -> Path | None:
        """Return the add-ons folder to serve from.

        The injected config wins; without one the resolver runs lazily per request, so
        a directly constructed bridge still works and an edited ``micro-otter.toml``
        takes effect without a restart.
        """

        if self._config is not None:
            return self._config.addons_dir
        return load_config().addons_dir

    def _capabilities(self) -> dict[str, object]:
        """Build the capability payload for the resolved configuration.

        Without an injected config the resolver runs lazily per request, so a
        test or an embedder that constructs the bridge directly still gets a real
        payload; ``mo serve`` injects the config it already resolved and never
        pays for a second read.
        """

        config = self._config if self._config is not None else load_config()
        return build_server_capabilities(config=config)

    def _reject(self, request) -> Response | None:
        """Return a ``403`` response when *request* fails the trust check.

        Only the request headers are inspected; nothing is built, flashed, or
        opened. A caller that gets ``None`` back may dispatch normally.
        """

        headers = getattr(request, "headers", None) or {}
        try:
            ensure_local_request(
                host=headers.get("Host"),
                origin=headers.get("Origin"),
                allowed_hosts=self._allowed_hosts,
            )
        except LocalRequestRejected as rejection:
            return _error_response(HTTPStatus.FORBIDDEN.value, rejection)
        return None

    async def _process_request(self, connection, request) -> Response | None:
        path = urlparse(request.path).path

        rejected = self._reject(request)
        if rejected is not None:
            return rejected

        if path == SERIAL_PATH:
            return None
        if path == FIRMWARE_PATH:
            # The trust check above already answered a foreign Host/Origin with
            # 403, so a firmware upgrade that reaches this point may proceed.
            return None
        if path == SERIAL_PORTS_PATH:
            return _json_response(serial_ports_payload(detect_serial_ports()))
        if path == API_VERSION_PATH:
            return _json_response({"version": _read_version()})
        if path == SERVER_CAPABILITIES_PATH:
            headers = getattr(request, "headers", None) or {}
            origin = headers.get("Origin")
            allow_origin = (
                origin
                if origin and is_allowed_origin(origin, allowed_hosts=self._allowed_hosts)
                else None
            )
            return _json_response(self._capabilities(), allow_origin=allow_origin)
        if (
            not self._disable_protection
            and path.startswith(_PROTECTED_PREFIXES)
            and _is_direct_navigation(request)
        ):
            return _text_response(
                HTTPStatus.FORBIDDEN.value, "Direct access to this resource is not allowed."
            )

        addons_root = self._addons_root()
        if path == NODE_PACKAGE_INDEX_PATH:
            return _json_response(merged_index_payload(_DEVICE_DIR, addons_root))
        runtime_manifest = runtime_manifest_addons(_DEVICE_DIR, path, addons_root)
        if runtime_manifest is not None:
            return _json_response(runtime_manifest)
        return _static_response(path, addons_root)

    async def _handler(self, connection: ServerConnection) -> None:
        parsed = urlparse(connection.request.path)
        if parsed.path == FIRMWARE_PATH:
            # One job per connection; the runner owns the frame loop from here.
            await FirmwareJobRunner(connection).serve()
            return
        if parsed.path != SERIAL_PATH:
            await connection.close(code=1008, reason="unsupported path")
            return

        query = parse_qs(parsed.query)
        device = query.get("port", [None])[0]
        if not device:
            await connection.send(
                json.dumps({"type": "error", "message": "missing 'port' query parameter"})
            )
            await connection.close()
            return

        baud = int(query.get("baud", [str(DEFAULT_BAUD)])[0])

        if self._active_connection is not None:
            if _is_stale_connection(self._active_connection):
                print(
                    "serial bridge: taking over a connection slot whose client is gone",
                    flush=True,
                )
                self._active_connection = None
            else:
                await connection.send(
                    json.dumps({"type": "error", "message": "serial port already in use"})
                )
                await connection.close()
                return

        self._active_connection = connection
        await connection.send(
            json.dumps({"type": "status", "message": f"Connecting to serial device {device} ..."})
        )
        writer = None
        reader_task = None
        try:
            try:
                reader, writer = await _open_serial(device, baud)
            except Exception as exc:  # report any open failure to the client
                await connection.send(json.dumps({"type": "error", "message": str(exc)}))
                await connection.close()
                return

            await connection.send(json.dumps({"type": "ready"}))

            reader_task = asyncio.create_task(self._pipe_serial_to_socket(reader, connection))

            try:
                async for message in connection:
                    if isinstance(message, bytes):
                        writer.write(message)
                        await writer.drain()
            except ConnectionClosed:
                pass
        finally:
            if reader_task is not None:
                reader_task.cancel()
            if writer is not None:
                writer.close()
                try:
                    await writer.wait_closed()
                except Exception:
                    pass
            self._active_connection = None

    async def _pipe_serial_to_socket(self, reader, connection: ServerConnection) -> None:
        """Copy serial bytes to the socket until the port or the socket closes.

        ``read(4096)`` deliberately coalesces whatever the device produced, so the
        browser side must never depend on read boundaries: the ``DeviceConnection``
        raw-REPL reader is a byte state machine for exactly that reason.
        """

        try:
            while True:
                data = await reader.read(4096)
                if not data:
                    break
                await connection.send(data)
        except asyncio.CancelledError:
            raise
        except Exception:
            pass

    async def run(self, host: str, port: int) -> None:
        async with serve(
            self._handler,
            host,
            port,
            process_request=self._process_request,
        ) as server:
            await server.serve_forever()


def run_bridge(
    host: str = "127.0.0.1",
    port: int = 8000,
    disable_protection: bool = False,
    *,
    config: Config | None = None,
) -> None:
    """Serve the app and its WebSocket serial bridge on a single port.

    The loopback default keeps a fresh checkout from exposing the compile and
    deploy endpoints to the network; the Typer ``serve`` command passes the
    configuration resolver's ``host``/``port`` and the resolved ``config`` so the
    server neither re-reads the configuration nor advertises features it cannot
    run. The WebSocket upgrade is shared by ``/`` and ``/firmware``; no frame
    carries a firmware or add-on archive any more, so the default message size
    stands.
    """
    print(f"Serving app and serial bridge on {host}:{port}", flush=True)
    asyncio.run(_SerialBridge(disable_protection, config=config).run(host, port))


__all__ = [
    "DEFAULT_BAUD",
    "FIRMWARE_PATH",
    "SERVER_CAPABILITIES_PATH",
    "SERIAL_PORTS_PATH",
    "SERIAL_PATH",
    "run_bridge",
    "serial_ports_payload",
]

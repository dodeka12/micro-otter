# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
"""Local-only trust checks for the Micro-Otter HTTP and WebSocket surfaces.

A browser on the local machine is the only intended client of ``mo serve``. This
module answers two questions about an incoming request without doing any I/O:

- Does the ``Host`` header name a host this server is allowed to answer for?
  (DNS rebinding would otherwise let a foreign page reach ``127.0.0.1``.)
- Does the ``Origin`` header name an origin allowed to script the local server?
  (Cross-site WebSocket hijacking would otherwise let a foreign page drive the
  serial bridge or a firmware flash.)

Callers pass header values in; nothing here imports ``websockets``, touches the
event loop, or reads files, so the same predicates serve the HTTP request hook and
the ``/firmware`` WebSocket upgrade. The rules are documented in
``docs/dev/device-communication/websocket-serial-bridge.md``.
"""

from __future__ import annotations

from urllib.parse import urlsplit

from micro_otter.config import Config

LOOPBACK_HOSTS: frozenset[str] = frozenset({"localhost", "127.0.0.1", "::1", "[::1]"})
"""Hostnames that always count as "this machine"."""

DEV_ORIGINS: frozenset[str] = frozenset({"http://localhost:5173", "http://127.0.0.1:5173"})
"""Vite dev-server origins (``vite.config.js`` proxies ``/api`` and ``/serial``)."""

ANY_HOST = "*"
"""Sentinel in an allowed-host set meaning "this bind address covers every name".

Only a wildcard bind (``0.0.0.0`` / ``::``) produces it: the server cannot know
which LAN name or address the browser used, and the operator already chose to
expose the port, so host checking cannot add protection there.
"""

WILDCARD_BIND_HOSTS: frozenset[str] = frozenset({"0.0.0.0", "::", "[::]", "*", ""})

_HOST_NOT_ALLOWED_HINT = (
    "Open the editor through the address printed by 'mo serve'; "
    "a foreign Host header is rejected to block DNS rebinding."
)
_ORIGIN_NOT_ALLOWED_HINT = (
    "Only the local editor (or the Vite dev server on port 5173) may call this "
    "endpoint; a foreign Origin is rejected to block cross-site WebSocket hijacking."
)

__all__ = [
    "ANY_HOST",
    "DEV_ORIGINS",
    "LOOPBACK_HOSTS",
    "WILDCARD_BIND_HOSTS",
    "LocalRequestRejected",
    "allowed_hosts_for",
    "ensure_local_request",
    "is_allowed_host",
    "is_allowed_origin",
    "split_host_header",
]


class LocalRequestRejected(RuntimeError):
    """Raised when a request fails the local-only trust check.

    ``code`` is the machine-readable reason used in the ``{"error": {...}}`` JSON
    envelope; ``hint`` is the operator-facing sentence telling them what to do.
    Phase 5 reuses the same shape for ``/firmware`` frame errors.
    """

    def __init__(self, code: str, message: str, hint: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.hint = hint

    def to_error_payload(self) -> dict[str, str]:
        """Return the ``{"code", "message", "hint"}`` error object."""

        return {"code": self.code, "message": self.message, "hint": self.hint}


def split_host_header(value: str | None) -> tuple[str, str | None]:
    """Split a ``Host`` header into ``(hostname, port_or_None)``.

    The hostname is lowercased and IPv6 brackets are preserved
    (``[::1]:8000`` → ``("[::1]", "8000")``) so it can be compared against
    :data:`LOOPBACK_HOSTS` directly. A trailing dot is dropped, because
    ``localhost.example.`` and ``localhost.example`` name the same host.
    """

    if value is None:
        return "", None
    candidate = value.strip()
    if not candidate:
        return "", None
    if candidate.startswith("["):
        closing = candidate.find("]")
        if closing == -1:
            return candidate.lower(), None
        hostname = candidate[: closing + 1]
        remainder = candidate[closing + 1 :]
        port = remainder[1:] if remainder.startswith(":") else ""
        return hostname.lower(), (port or None)
    hostname, separator, port = candidate.partition(":")
    if hostname.endswith(".") and len(hostname) > 1:
        hostname = hostname[:-1]
    return hostname.lower(), ((port or None) if separator else None)


def is_allowed_host(
    header_value: str | None, *, allowed_hosts: frozenset[str] = LOOPBACK_HOSTS
) -> bool:
    """Return whether a ``Host`` header names an allowed host.

    A missing or empty header is allowed: ``curl`` and the existing tests send no
    ``Host`` override, and DNS rebinding always carries one, so rejecting the
    absent case would break local tools without adding protection.
    """

    if ANY_HOST in allowed_hosts:
        return True
    hostname, _port = split_host_header(header_value)
    if not hostname:
        return True
    return hostname in allowed_hosts


def is_allowed_origin(
    origin: str | None, *, allowed_hosts: frozenset[str] = LOOPBACK_HOSTS
) -> bool:
    """Return whether an ``Origin`` header may script this server.

    A missing or empty header is allowed (non-browser clients, and same-origin
    requests that omit it). The opaque ``null`` origin that sandboxed frames and
    ``file://`` pages send is rejected, as is any origin whose scheme is not
    ``http``/``https`` or whose hostname is not allowed.
    """

    if origin is None:
        return True
    candidate = origin.strip()
    if not candidate:
        return True
    if candidate == "null":
        return False
    if candidate in DEV_ORIGINS:
        return True
    parts = urlsplit(candidate)
    if parts.scheme not in ("http", "https"):
        return False
    hostname = (parts.hostname or "").lower()
    if not hostname:
        return False
    if f"[{hostname}]" in allowed_hosts:
        return True
    return hostname in allowed_hosts


def ensure_local_request(
    *,
    host: str | None,
    origin: str | None,
    allowed_hosts: frozenset[str] = LOOPBACK_HOSTS,
) -> None:
    """Raise :class:`LocalRequestRejected` unless the request is local.

    The host check runs first because it is the stricter one: a request rejected
    for its ``Host`` header must never look like an allowed-origin answer.
    """

    if not is_allowed_host(host, allowed_hosts=allowed_hosts):
        hostname, _port = split_host_header(host)
        raise LocalRequestRejected(
            "host-not-allowed",
            f"Host {hostname!r} is not allowed.",
            _HOST_NOT_ALLOWED_HINT,
        )
    if not is_allowed_origin(origin, allowed_hosts=allowed_hosts):
        raise LocalRequestRejected(
            "origin-not-allowed",
            f"Origin {origin!r} is not allowed.",
            _ORIGIN_NOT_ALLOWED_HINT,
        )


def allowed_hosts_for(config: Config) -> frozenset[str]:
    """Return the allowed host set for a resolved *config*.

    It is :data:`LOOPBACK_HOSTS` plus the configured bind host, so
    ``mo serve --host 192.168.1.20`` answers that name. A wildcard bind
    (``0.0.0.0`` / ``::``) adds :data:`ANY_HOST`: the operator exposed the port on
    purpose and the server cannot enumerate the names a browser might use.
    """

    bind_host, _port = split_host_header(config.host)
    if not bind_host or bind_host in WILDCARD_BIND_HOSTS:
        return LOOPBACK_HOSTS | {ANY_HOST}
    return LOOPBACK_HOSTS | {bind_host}

"""Tests for the local-only ``Host``/``Origin`` trust helpers.

The helpers are pure predicates, so every case is expressed as plain inputs and
outputs. The two attack classes they exist for are DNS rebinding (foreign ``Host``
header reaching ``127.0.0.1``) and cross-site WebSocket hijacking (foreign page
driving the serial bridge or a flash through its own ``Origin``).
"""

from __future__ import annotations

from dataclasses import replace

import pytest

from micro_otter.config import load_config
from micro_otter.tools.server_trust import (
    DEV_ORIGINS,
    LOOPBACK_HOSTS,
    LocalRequestRejected,
    allowed_hosts_for,
    ensure_local_request,
    is_allowed_host,
    is_allowed_origin,
    split_host_header,
)


def _config(**overrides):
    """Return a resolved configuration with *overrides* applied."""

    return replace(load_config(env={}), **overrides)


def test_missing_host_and_origin_are_allowed():
    """``curl`` and first-party clients send no ``Host``/``Origin`` override."""

    assert is_allowed_host(None)
    assert is_allowed_host("")
    assert is_allowed_origin(None)
    assert is_allowed_origin("")
    ensure_local_request(host=None, origin=None)


def test_loopback_hosts_are_allowed():
    """Every loopback spelling, with or without a port, passes the host check."""

    for header in (
        "localhost",
        "localhost:8000",
        "127.0.0.1:8000",
        "LOCALHOST:8000",
        "[::1]:8000",
        "::1",
        "localhost.",
    ):
        assert is_allowed_host(header), header
    assert LOOPBACK_HOSTS == {"localhost", "127.0.0.1", "::1", "[::1]"}


def test_foreign_host_is_rejected():
    """A DNS-rebinding style hostname is rejected with the documented code."""

    assert not is_allowed_host("evil.example")
    assert not is_allowed_host("evil.example:8000")

    with pytest.raises(LocalRequestRejected) as excinfo:
        ensure_local_request(host="evil.example", origin=None)

    assert excinfo.value.code == "host-not-allowed"


def test_ipv6_host_header_is_parsed():
    """IPv6 headers keep their brackets so they compare against the allow list."""

    assert split_host_header("[::1]:8000") == ("[::1]", "8000")
    assert split_host_header("[::1]") == ("[::1]", None)
    assert split_host_header("127.0.0.1:8000") == ("127.0.0.1", "8000")
    assert split_host_header("localhost") == ("localhost", None)
    assert split_host_header(None) == ("", None)


def test_dev_origin_is_allowed():
    """The Vite dev server may call ``/api/*`` so ``npm run dev`` keeps working."""

    for origin in DEV_ORIGINS:
        assert is_allowed_origin(origin)
    assert is_allowed_origin("http://localhost:8000")
    assert is_allowed_origin("http://127.0.0.1:8000")


def test_null_and_foreign_origin_are_rejected():
    """Sandboxed frames (``null``) and foreign pages are rejected."""

    for origin in (
        "null",
        "http://evil.example",
        "https://evil.example:8000",
        "file://localhost",
        "ws://localhost:8000",
    ):
        assert not is_allowed_origin(origin), origin

    with pytest.raises(LocalRequestRejected) as excinfo:
        ensure_local_request(host="localhost:8000", origin="http://evil.example")

    assert excinfo.value.code == "origin-not-allowed"


def test_explicit_bind_address_is_added_to_allowed_hosts():
    """``mo serve --host <addr>`` answers that address; a wildcard bind allows any."""

    default_hosts = allowed_hosts_for(_config())
    assert default_hosts == LOOPBACK_HOSTS

    lan_hosts = allowed_hosts_for(_config(host="192.168.1.20"))
    assert "192.168.1.20" in lan_hosts
    assert is_allowed_host("192.168.1.20:8000", allowed_hosts=lan_hosts)
    assert not is_allowed_host("192.168.1.21:8000", allowed_hosts=lan_hosts)

    wildcard_hosts = allowed_hosts_for(_config(host="0.0.0.0"))
    assert is_allowed_host("192.168.1.20:8000", allowed_hosts=wildcard_hosts)


def test_rejection_carries_code_and_hint():
    """The rejection exposes a machine code, a message, and an operator hint."""

    with pytest.raises(LocalRequestRejected) as excinfo:
        ensure_local_request(host="evil.example", origin="http://evil.example")

    rejection = excinfo.value
    payload = rejection.to_error_payload()

    assert payload["code"] == "host-not-allowed"
    assert "evil.example" in payload["message"]
    assert "mo serve" in payload["hint"]
    assert rejection.code == "host-not-allowed"
    assert rejection.hint == payload["hint"]

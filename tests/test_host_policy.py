"""Tests for :func:`micro_otter.tools.host_policy.is_loopback_host`."""

from __future__ import annotations

import pytest

from micro_otter.tools.host_policy import is_loopback_host


@pytest.mark.parametrize(
    "host",
    [
        "localhost",
        "LOCALHOST",
        "127.0.0.1",
        "127.0.1.5",
        "::1",
        "[::1]",
    ],
)
def test_loopback_hosts(host: str) -> None:
    """Loopback hostnames, the full 127/8 range, and ``::1`` are loopback."""

    assert is_loopback_host(host) is True


@pytest.mark.parametrize(
    "host",
    [
        "0.0.0.0",
        "",
        "  ",
        "example.com",
        "192.168.1.10",
        "micro-otter.local",
    ],
)
def test_non_loopback_hosts(host: str) -> None:
    """Empty/blank hosts and routable or arbitrary names are not loopback."""

    assert is_loopback_host(host) is False

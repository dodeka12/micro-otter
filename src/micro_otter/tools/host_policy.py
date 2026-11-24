# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
"""The single answer to "does this bind address only accept loopback traffic?".

Shared by three consumers so none of them re-implements the rule:

- the CLI's bind-time safety check (``micro_otter.cli.app``),
- the capability payload (``micro_otter.tools.server_capabilities``), and
- the archive URL policy (``micro_otter.tools.archive_source``).

This module imports nothing from :mod:`micro_otter` so none of those consumers can
pull in an import cycle.
"""

from __future__ import annotations

import ipaddress

__all__ = ("is_loopback_host",)


def is_loopback_host(host: str) -> bool:
    """Return ``True`` when *host* only accepts loopback connections.

    An empty host means "all interfaces" and is therefore **not** loopback. Only
    ``localhost`` counts as a loopback hostname: any other name can resolve
    anywhere, so it is treated as non-loopback. Literal addresses are decided by
    ``ipaddress.ip_address(...).is_loopback``, which covers ``127.0.0.0/8`` and
    ``::1``.

    One extension over the CLI's original ``_is_loopback_host``: surrounding
    ``[...]`` brackets are stripped before parsing, because a URL host arrives
    bracketed (``[::1]``) and the archive URL policy must accept it.
    """

    candidate = host.strip()
    if not candidate:
        return False
    if candidate.lower() == "localhost":
        return True
    if candidate.startswith("[") and candidate.endswith("]"):
        candidate = candidate[1:-1]
    try:
        return ipaddress.ip_address(candidate).is_loopback
    except ValueError:
        return False

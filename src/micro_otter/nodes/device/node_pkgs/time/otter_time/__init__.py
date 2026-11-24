# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.
"""NTP-backed clock service and pure time conversions for the ``time`` package.

``parts`` holds the dependency-free calendar arithmetic (clock parts, date parts,
``HH:MM`` windows and a small ``strftime``-like formatter); ``service`` holds the
single module-level clock that fetches NTP time in its own background task.
"""

from . import parts, service

__all__ = ['parts', 'service']

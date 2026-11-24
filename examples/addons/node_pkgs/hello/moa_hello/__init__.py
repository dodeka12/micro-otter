# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
"""Hello example add-on runtime module.

Pure MicroPython: no CPython-only call, no ``@micropython.viper``.
"""

_GREETING = "hello from the example add-on"


def greeting() -> str:
    """Return the add-on's fixed greeting string."""

    return _GREETING

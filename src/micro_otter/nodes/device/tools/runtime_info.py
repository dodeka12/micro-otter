# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.
"""Runtime inspection helpers for WebSerial."""

import sys


def print_runtime_metadata() -> None:
    try:
        impl = sys.implementation
        try:
            impl_name = impl[0]
        except (TypeError, IndexError):
            impl_name = getattr(impl, "name", "micropython")
        try:
            impl_version = ".".join(str(part) for part in impl[1])
        except Exception:
            impl_version = sys.version.split()[0]
    except Exception:
        impl_name = "micropython"
        impl_version = sys.version.split()[0]
    platform = getattr(sys, "platform", "")
    print(impl_name)
    print(impl_version)
    print(platform)


__all__ = ["print_runtime_metadata"]

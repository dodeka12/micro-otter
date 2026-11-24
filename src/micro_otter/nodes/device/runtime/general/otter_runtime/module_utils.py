# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
"""Helpers for dynamic module management on MicroPython."""

import gc
import sys


def reload_module(module_name: str):
    """Reload *module_name* and return the imported module.

    MicroPython often ships without ``importlib``; this helper purges the module
    tree from ``sys.modules`` and uses the built-in ``__import__`` instead.
    """

    if not module_name:
        raise ValueError("module_name is required for reload_module()")

    prefix = module_name + "."
    for name in list(sys.modules.keys()):
        if name == module_name or name.startswith(prefix):
            sys.modules.pop(name)
    gc.collect()
    module = __import__(module_name)
    if "." in module_name:
        for part in module_name.split(".")[1:]:
            module = getattr(module, part)
    return module

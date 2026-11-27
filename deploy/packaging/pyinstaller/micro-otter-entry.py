# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
"""PyInstaller entry point for the Windows ``micro-otter.exe``.

A thin shim that calls the CLI's ``main()`` so the PyInstaller spec stays stable
across CLI refactors (PyInstaller analyzes this file, not the package's
``__main__``).
"""

from micro_otter.cli import main

if __name__ == "__main__":
    main()

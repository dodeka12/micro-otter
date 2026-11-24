"""CLI entrypoint for Micro-Otter.

This package exposes the Typer application used by the ``micro-otter``
console script. Subcommands live in ``app.py``.
"""

from .app import app, main

__all__ = ["app", "main"]

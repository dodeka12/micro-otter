"""Sample add-on package runtime module.

This module exists so the add-on tests have a real ``mpAssets`` file to stage,
compile, and serve; it does nothing on its own.
"""

GREETING = "hello from sample_addon"


def greeting() -> str:
    """Return the add-on's greeting string."""

    return GREETING

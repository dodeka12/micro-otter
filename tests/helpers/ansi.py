"""Strip terminal styling from captured CLI output before asserting on it.

``rich`` inserts SGR sequences inside option names as soon as it believes it writes to a terminal.
GitHub Actions sets ``GITHUB_ACTIONS``, which makes it believe exactly that, so
``"--out" in result.stdout`` passes in a plain shell and fails on CI even though the help text is
correct. Every help assertion therefore reads the plain text.
"""

from __future__ import annotations

import re

_ANSI_ESCAPE = re.compile(r"\x1b\[[0-9;]*m")


def strip_ansi(text: str) -> str:
    """Return *text* without ANSI SGR styling, so help assertions survive CI colors."""

    return _ANSI_ESCAPE.sub("", text)

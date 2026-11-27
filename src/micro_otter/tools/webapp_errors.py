"""Shared failure type for the ``micro-otter webapp`` commands.

Every failure of ``mo webapp build`` / ``mo webapp upload`` is one :class:`WebappError` carrying
a stable code, a message and an optional hint. The CLI prints ``<code>: <message>`` followed by
``hint: <hint>`` to stderr and exits ``1``, the same shape ``mo addons`` uses.

Codes are namespaced by command so a script can branch on them without parsing English:

* ``webapp-build-*`` — raised by :mod:`micro_otter.tools.webapp_build` and the build command
  (``source-missing``, ``tool-missing``, ``dependencies-missing``, ``out-dir-unsafe``,
  ``output-missing``, ``failed``, ``docs-url-invalid``, ``public-url-invalid``,
  ``manifest-invalid``).
* ``webapp-upload-*`` — raised by :mod:`micro_otter.tools.webapp_upload` and the upload command
  (``target-invalid``, ``source-invalid``, ``manifest-invalid``, ``prune-unsafe``, ``sftp-missing``,
  ``credentials-missing``, ``connect-failed``, ``put-failed``, ``verify-mismatch``,
  ``version-mismatch``, ``verify-failed``, ``interrupted``).

``exit_code`` exists for the one failure that is not an ordinary error: an interrupted transfer is
reported as ``130``, the shell's convention for "died on SIGINT", while still carrying a code, a
message and a hint.
"""

from __future__ import annotations


class WebappError(Exception):
    """A failed ``mo webapp`` operation with a stable code and an optional hint."""

    def __init__(
        self, code: str, message: str, hint: str | None = None, *, exit_code: int = 1
    ) -> None:
        super().__init__(message)
        self.code = code
        """Stable ``webapp-build-*`` / ``webapp-upload-*`` token printed before the message."""
        self.hint = hint
        """Remedy printed on a ``hint:`` line; ``None`` when there is nothing to suggest."""
        self.exit_code = exit_code
        """Process exit code the CLI uses; ``130`` for an interrupted upload, else ``1``."""


__all__ = ["WebappError"]

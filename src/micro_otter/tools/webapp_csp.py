"""The Content-Security-Policy a hosted Micro-Otter build ships.

The policy is duplicated from :file:`tools/vite-hosted-csp.mjs` on purpose: that plugin is loaded
by Vite from the repository root and this module ships inside the wheel, so neither may import the
other. ``tests/test_webapp_firmware_page.py`` asserts the two literals are identical, which turns a
silent drift into a failing test.
"""

from __future__ import annotations

HOSTED_CSP_POLICY = (
    "default-src 'self'; script-src 'self'; style-src 'self'; "
    "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; "
    "base-uri 'none'; form-action 'none'; object-src 'none'"
)
"""The policy the hosted bundle ships, verbatim — the same string as the Vite plugin's."""


__all__ = ["HOSTED_CSP_POLICY"]

"""Shared pytest fixtures.

The configuration resolver memoizes its result per process and the toolchain asset
resolver memoizes its root, so both caches are cleared around every test. Without
that, a test that changes ``MICRO_OTTER_*`` variables or ``SYSTEM_PREFIX`` would
observe the previous test's answer.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest

from micro_otter.config import clear_config_cache
from micro_otter.toolchain import clear_assets_cache


@pytest.fixture(autouse=True)
def _clear_resolver_caches() -> Iterator[None]:
    """Clear the config and toolchain asset caches around each test."""

    clear_config_cache()
    clear_assets_cache()
    yield
    clear_config_cache()
    clear_assets_cache()

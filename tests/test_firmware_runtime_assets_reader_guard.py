"""The compile-owned runtime assets version has exactly one reader.

``staging_runtime_assets.read_packaged_runtime_assets_version()`` is the single
place that opens the compile-owned ``runtime_assets/manifest.json``. Every other
consumer (``build_identity``, ``staleness``) delegates to it, so a third reader
that re-derives the path can never reappear and drift the version.
"""

from __future__ import annotations

import pathlib

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
PACKAGE = REPO_ROOT / "src" / "micro_otter" / "tools" / "firmware_compile"

ALLOWED_FILES = {"staging_runtime_assets.py"}


def test_runtime_assets_manifest_is_read_only_by_the_shared_reader() -> None:
    offenders: list[str] = []
    for path in PACKAGE.glob("*.py"):
        if path.name in ALLOWED_FILES:
            continue
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            # The compile-owned assets manifest path is built as
            # ``runtime_assets / "manifest.json"`` on one line; any other module
            # building that path is a duplicate reader.
            if "runtime_assets" in line and "manifest.json" in line:
                offenders.append(f"{path.relative_to(REPO_ROOT)}:{line_number}")

    assert offenders == [], (
        "the compile-owned runtime assets manifest must only be read by "
        "staging_runtime_assets.py; offenders: " + ", ".join(offenders)
    )

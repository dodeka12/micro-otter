#!/usr/bin/env python3
# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
"""Validate the committed release manifest against the checked-out release tag.

Run locally (``npm run check:firmware-release``) or from CI. It fails when
``release.json`` is invalid, and — when ``GITHUB_REF`` names a ``firmware-v*``
tag — when that tag is not exactly ``firmware-v<release.json.releaseVersion>``.
A tag whose tail merely *looks* like a version is still an error: the prefix is
what keeps the firmware tag space separate from the Python ``v*`` package tags.
"""

from __future__ import annotations

import os
import sys

from micro_otter.tools.firmware_compile.version_registry import (
    RELEASE_MANIFEST_DEFAULT_PATH,
    load_release_manifest,
)


def main() -> int:
    """Run the release-manifest check and return the process exit code."""

    path = RELEASE_MANIFEST_DEFAULT_PATH
    try:
        manifest = load_release_manifest(path)
    except Exception as exc:  # pragma: no cover - exercised via invalid fixtures
        print(f"check_firmware_release: invalid {path}: {exc}", file=sys.stderr)
        return 1

    github_ref = os.environ.get("GITHUB_REF", "").strip()
    if github_ref.startswith("refs/tags/firmware-v"):
        tag = github_ref[len("refs/tags/") :]
        expected = f"firmware-v{manifest.release_version}"
        if tag != expected:
            print(
                f"check_firmware_release: tag {tag!r} must be exactly {expected!r} "
                f"for release.json releaseVersion {manifest.release_version!r}",
                file=sys.stderr,
            )
            return 1

    print(
        f"check_firmware_release: ok ({manifest.release_version}, "
        f"kind={manifest.kind}, tag={manifest.tag or 'unset'})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

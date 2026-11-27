#!/usr/bin/env python3
# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
"""Installed-wheel smoke checks for Micro-Otter.

These checks prove that an installed wheel (in a throwaway venv with no
repository checkout) is a working server: the package resolves its own web app,
the bundle stamp matches the package version, the toolchain assets resolve from
inside the package, and the capability payload identifies itself correctly.

Each checker is a pure function returning human-readable failure lines (an empty
list means healthy); :func:`main` composes them for an installed interpreter or
a fetched capability payload. Exit code ``0`` means every check passed, ``2``
means one or more ``failure`` lines were printed.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from micro_otter.toolchain import (
    ToolchainAssetsNotFound,
    assets_dir,
    bootstrap_script_path,
    launcher_path,
    versions_env_path,
)
from micro_otter.tools.server_capabilities import (
    CAPABILITY_KEYS,
    SERVER_TYPE,
    detect_stale_static_root,
    resolve_static_root,
)

TITLE_MARKER = "<title>Micro-Otter Node Editor</title>"
"""Title element that identifies the built editor bundle's ``index.html``."""


def _read_bundle_version(webapp: Path) -> str | None:
    """Return the ``version`` stamp of the built bundle at *webapp*, or ``None``.

    Args:
        webapp: Directory of a built web-app bundle (contains ``html/version.json``).

    Returns:
        The stamped version string, or ``None`` when the stamp is absent or unreadable.
    """

    stamp_path = webapp / "html" / "version.json"
    try:
        payload = json.loads(stamp_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    value = payload.get("version") if isinstance(payload, dict) else None
    return value if isinstance(value, str) and value.strip() else None


def check_installed_layout(package_dir: Path, version: str) -> list[str]:
    """Return failures when the installed package layout is not self-contained.

    Checks that the web app resolves to ``<package_dir>/dist/webapp`` with an
    ``index.html``, that the bundle stamp equals *version* with no stale-build
    warning, and that the toolchain assets resolve inside *package_dir* with the
    ESP-IDF bootstrap, launcher, and pin file present.

    Args:
        package_dir: The installed ``micro_otter`` package directory.
        version: The installed package version (``micro_otter.__version__``).

    Returns:
        Human-readable failure lines; empty when the layout is healthy.
    """

    failures: list[str] = []

    webapp = package_dir / "dist" / "webapp"
    static_root = resolve_static_root(package_dir)
    if static_root != webapp or not (webapp / "index.html").is_file():
        failures.append(f"web app does not resolve to {webapp / 'index.html'}")
    else:
        stamp = _read_bundle_version(webapp)
        if stamp is None:
            failures.append("bundle version stamp is missing (html/version.json)")
        elif stamp != version:
            failures.append(
                f"bundle version stamp {stamp!r} differs from package version {version!r}"
            )
        if detect_stale_static_root(static_root, version) is not None:
            failures.append("served web app is stale relative to the installed package")

    try:
        assets = assets_dir()
    except ToolchainAssetsNotFound as error:
        failures.append(f"toolchain assets not found: {error}")
        return failures

    if package_dir not in assets.parents:
        failures.append(f"toolchain assets resolve outside the package: {assets}")

    for label, resolver in (
        ("esp-idf bootstrap", bootstrap_script_path),
        ("idf.py launcher", launcher_path),
        ("versions.env", versions_env_path),
    ):
        try:
            path = resolver()
        except ToolchainAssetsNotFound as error:
            failures.append(f"toolchain asset missing: {label} ({error})")
            continue
        if not path.is_file():
            failures.append(f"toolchain asset missing: {label} ({path})")

    return failures


def check_index_html(text: str, served_version: str) -> list[str]:
    """Return failures when a served ``index.html`` is not the built editor bundle.

    Args:
        text: The body returned by ``GET /``.
        served_version: The version the bundle was stamped with (non-empty).

    Returns:
        Human-readable failure lines; empty when the document is the built bundle.
    """

    failures: list[str] = []
    if TITLE_MARKER not in text:
        failures.append("index.html is missing the Micro-Otter Node Editor title marker")
    if not served_version:
        failures.append("served version stamp is empty")
    return failures


def check_capabilities(payload: dict, version: str) -> list[str]:
    """Return failures when a capability payload is not the installed package's.

    Args:
        payload: A parsed ``GET /api/server-capabilities`` response.
        version: The installed package version the payload must report.

    Returns:
        Human-readable failure lines; empty when the payload is healthy.
    """

    failures: list[str] = []
    if payload.get("serverType") != SERVER_TYPE:
        failures.append(f"serverType is {payload.get('serverType')!r}, expected {SERVER_TYPE!r}")
    if payload.get("version") != version:
        failures.append(f"version is {payload.get('version')!r}, expected {version!r}")
    if payload.get("webappBuildServedVersion") is not None:
        failures.append(
            "webappBuildServedVersion is "
            f"{payload.get('webappBuildServedVersion')!r}, expected None (no stale build)"
        )
    for key in CAPABILITY_KEYS:
        if key not in payload:
            failures.append(f"missing capability key: {key}")
    return failures


def _run_installed() -> list[str]:
    """Run the layout and index checks against the imported ``micro_otter`` package.

    Returns:
        The combined failure lines from the installed-package checks.
    """

    import micro_otter

    package_dir = Path(micro_otter.__file__).resolve().parent
    version = micro_otter.__version__
    failures = check_installed_layout(package_dir, version)
    index_html = package_dir / "dist" / "webapp" / "index.html"
    if index_html.is_file():
        failures.extend(check_index_html(index_html.read_text(encoding="utf-8"), version))
    return failures


def main(argv: list[str]) -> int:
    """Run one smoke-check mode named by *argv* and return its status.

    Args:
        argv: Command-line arguments after the program name; ``--installed`` or
            ``--capabilities <json-file>``.

    Returns:
        ``0`` when every check passed, ``2`` when any failed or the arguments
        were unusable.
    """

    if argv and argv[0] == "--installed":
        failures = _run_installed()
    elif len(argv) == 2 and argv[0] == "--capabilities":
        try:
            payload = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            print(f"cannot read capabilities payload: {error}", file=sys.stderr)
            return 2
        if not isinstance(payload, dict):
            print("capabilities payload is not a JSON object", file=sys.stderr)
            return 2
        import micro_otter

        failures = check_capabilities(payload, micro_otter.__version__)
    else:
        print("usage: wheel_smoke.py --installed | --capabilities <json-file>", file=sys.stderr)
        return 2

    for failure in failures:
        print(f"failure: {failure}", file=sys.stderr)
    if failures:
        return 2
    print("wheel smoke checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

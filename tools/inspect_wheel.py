#!/usr/bin/env python3
# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
"""Wheel-content contract checker for the Micro-Otter install artifact.

The wheel is the only supported install artifact. This stdlib-only checker states
that contract as data: which files a correct wheel must contain and which paths
must never appear in one. ``deploy/packaging/build-wheel.sh`` runs it against the
wheel it just built, and ``tests/test_inspect_wheel.py`` pins the same contract.

The process exit code follows the publication tool's convention: ``0`` means the
wheel is valid, ``2`` means one or more ``violation`` lines were printed.
"""

from __future__ import annotations

import sys
import zipfile
from pathlib import Path

REQUIRED_FILES: tuple[str, ...] = (
    "micro_otter/dist/webapp/index.html",
    "micro_otter/dist/webapp/html/version.json",
    "micro_otter/dist/webapp/device/firmware/boards.json",
    "micro_otter/dist/webapp/device/node_pkgs/index.json",
    "micro_otter/nodes/device/node_pkgs/led/manifest.json",
    "micro_otter/nodes/device/node_pkgs/led/otter_led/__init__.py",
    "micro_otter/toolchain/assets/versions.env",
    "micro_otter/toolchain/assets/bootstrap.sh",
    "micro_otter/toolchain/assets/doctor.sh",
    "micro_otter/toolchain/assets/esp-idf/idf.py",
    "micro_otter/toolchain/assets/esp-idf/bootstrap.sh",
)
"""Files a correct wheel must contain; one violation is reported per missing path."""

FORBIDDEN_PREFIXES: tuple[str, ...] = (
    "tools/",
    "tests/",
    "ldev/",
    "dev/",
    "node_modules/",
)
"""Entry prefixes that must never ship in an install wheel."""


def collect_entries(wheel: Path) -> list[str]:
    """Return the member names of the zip archive at *wheel*.

    Args:
        wheel: Path of a wheel file (a zip archive).

    Returns:
        The archive's ``namelist`` in zipfile order.
    """

    with zipfile.ZipFile(wheel) as archive:
        return archive.namelist()


def _is_forbidden(entry: str) -> bool:
    """Return whether *entry* may never ship in an install wheel.

    An entry is forbidden when it sits under a forbidden prefix, when it is a
    compiled bytecode file (``.pyc``), or when a ``__pycache__`` component
    appears anywhere in its path.

    Args:
        entry: One wheel member name.

    Returns:
        ``True`` when the entry must not ship in the wheel.
    """

    if entry.endswith(".pyc") or "__pycache__" in entry:
        return True
    return any(entry.startswith(prefix) for prefix in FORBIDDEN_PREFIXES)


def find_violations(entries: list[str]) -> list[str]:
    """Return one message per missing required file and per forbidden entry.

    Args:
        entries: Wheel member names from :func:`collect_entries`.

    Returns:
        Human-readable ``violation`` messages; an empty list means the wheel
        satisfies the contract.
    """

    violations: list[str] = []
    present = set(entries)
    for required in REQUIRED_FILES:
        if required not in present:
            violations.append(f"missing required file: {required}")
    for entry in entries:
        if _is_forbidden(entry):
            violations.append(f"forbidden entry: {entry}")
    return violations


def main(argv: list[str]) -> int:
    """Inspect the wheel named by the single argument and return its status.

    Args:
        argv: Command-line arguments after the program name; exactly one wheel
            path is required.

    Returns:
        ``0`` when the wheel satisfies the contract (printing ``<n> entries
        checked`` to stdout), ``2`` when it does not (printing one ``violation``
        line per problem to stderr) or when the arguments are unusable.
    """

    if len(argv) != 1:
        print("usage: inspect_wheel.py <wheel>", file=sys.stderr)
        return 2

    wheel = Path(argv[0])
    entries = collect_entries(wheel)
    violations = find_violations(entries)
    if violations:
        for violation in violations:
            print(f"violation: {violation}", file=sys.stderr)
        return 2

    print(f"{len(entries)} entries checked")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

#!/usr/bin/env python3
# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
"""One-shot migration of the committed firmware registries to channel-aware schemas.

Rewrites ``latest_versions.json`` to schema v2 and ``runtime_lineage.json`` to
schema v3, reconciling the two files that currently disagree (``latest`` says
``esp32-general`` is ``0.22.0`` while ``runtime_lineage`` stops at ``0.9.0``).
Run once and commit the result; ``--check`` exits ``1`` when a file still needs
migration (used by the phase-8 gate and M6 CI).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from micro_otter.tools.firmware_compile.version_semver import version_sort_key

LATEST_VERSIONS_PATH = Path("src/micro_otter/nodes/device/firmware/latest_versions.json")
RUNTIME_LINEAGE_PATH = Path("src/micro_otter/nodes/device/firmware/runtime_lineage.json")

LEGACY_SOURCE = "legacy-lineage"


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _compose_full_version(
    entry: dict[str, Any], board_id: str, runtime_id: str, version: str
) -> str:
    base = f"{entry.get('micropythonVersion')}-{board_id}-{runtime_id}-{version}"
    content_hash = entry.get("contentHash")
    return f"{base}-{content_hash}" if isinstance(content_hash, str) else base


def _newest_lineage_entry(
    lineage: dict[str, Any], target_id: str
) -> tuple[str, dict[str, Any]] | None:
    versions = lineage.get("lineage", {}).get(target_id, {})
    if not isinstance(versions, dict) or not versions:
        return None
    newest = max(versions, key=version_sort_key)
    return newest, versions[newest]


def migrate_latest_versions(payload: dict[str, Any], lineage: dict[str, Any]) -> dict[str, Any]:
    """Return the v2 latest-versions payload for a v1 payload plus the lineage."""

    targets: dict[str, Any] = {}
    for target_id, entry in payload.get("targets", {}).items():
        if not isinstance(entry, dict):
            continue
        board_id = entry.get("boardId")
        runtime_id = entry.get("runtimeId")
        channels: dict[str, Any] = {
            "release": {
                "version": entry.get("runtimeFirmwareVersion"),
                "fullVersion": entry.get("fullVersion"),
                "contentHash": entry.get("contentHash"),
                "micropythonVersion": entry.get("micropythonVersion"),
                "versionSource": LEGACY_SOURCE,
                "updatedAtUtc": entry.get("updatedAtUtc"),
            }
        }
        newest = _newest_lineage_entry(lineage, target_id)
        if newest is not None:
            version, lineage_entry = newest
            channels["dev"] = {
                "version": version,
                "fullVersion": _compose_full_version(lineage_entry, board_id, runtime_id, version),
                "contentHash": lineage_entry.get("contentHash"),
                "micropythonVersion": lineage_entry.get("micropythonVersion"),
                "versionSource": LEGACY_SOURCE,
                "updatedAtUtc": lineage_entry.get("createdAtUtc"),
            }
        targets[target_id] = {
            "boardId": board_id,
            "runtimeId": runtime_id,
            "channels": channels,
        }
    return {"schemaVersion": 2, "targets": targets}


def migrate_runtime_lineage(payload: dict[str, Any]) -> dict[str, Any]:
    """Return the v3 runtime-lineage payload for a v2 payload."""

    lineage: dict[str, Any] = {}
    for target_id, versions in payload.get("lineage", {}).items():
        migrated_versions: dict[str, Any] = {}
        for version, entry in versions.items():
            if not isinstance(entry, dict):
                continue
            new_entry = dict(entry)
            new_entry["channel"] = "dev"
            new_entry.setdefault("contentHash", None)
            new_entry["versionSource"] = LEGACY_SOURCE
            new_entry.setdefault("addonPackages", {})
            git_source = new_entry.get("gitSource")
            if isinstance(git_source, dict):
                new_entry["gitSource"] = {
                    key: value for key, value in git_source.items() if key != "originUrl"
                }
                new_entry["gitSource"].setdefault("shallow", False)
            migrated_versions[version] = new_entry
        lineage[target_id] = migrated_versions
    return {"schemaVersion": 3, "lineage": lineage}


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    """Run the migration (or ``--check``) and return the process exit code."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="exit 1 if migration is needed")
    args = parser.parse_args(argv)

    latest = _read_json(LATEST_VERSIONS_PATH)
    lineage = _read_json(RUNTIME_LINEAGE_PATH)

    migrated_latest = (
        migrate_latest_versions(latest, lineage)
        if latest.get("schemaVersion") == 1
        else latest
    )
    migrated_lineage = (
        migrate_runtime_lineage(lineage) if lineage.get("schemaVersion") == 2 else lineage
    )

    outputs = {
        LATEST_VERSIONS_PATH: migrated_latest,
        RUNTIME_LINEAGE_PATH: migrated_lineage,
    }

    changed = False
    for path, payload in outputs.items():
        rendered = json.dumps(payload, indent=2, sort_keys=True) + "\n"
        if not path.exists() or path.read_text(encoding="utf-8") != rendered:
            changed = True
            if not args.check:
                _write_json(path, payload)
                print(f"migrated {path}")
            else:
                print(f"{path} needs migration", file=sys.stderr)

    if args.check:
        return 1 if changed else 0
    if not changed:
        print("no migration needed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

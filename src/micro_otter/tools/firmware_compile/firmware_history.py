"""Append-only firmware build history in the publish root.

A build appends one record per published image instead of rewriting the
committed registries. ``latest_versions.json`` and ``runtime_lineage.json`` stay
baselines only release tooling writes; the device and client read a composed
view of the committed baselines plus this history.
"""

from __future__ import annotations

import json
import os
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Any

__all__ = [
    "append_firmware_history",
    "firmware_history_path",
    "load_firmware_history",
]


def firmware_history_path(publish_root: Path) -> Path:
    """Return the history file path inside *publish_root*."""

    return publish_root / "firmware_history.json"


def load_firmware_history(publish_root: Path) -> dict[str, Any]:
    """Return the history payload, tolerating a missing or corrupt file.

    A corrupt file starts a fresh list and reports a warning so one bad write can
    never wedge the next build.
    """

    path = firmware_history_path(publish_root)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"schemaVersion": 1, "builds": []}
    except (json.JSONDecodeError, OSError):
        print(
            f"warning: firmware history {path} is corrupt; starting a new list",
            file=sys.stderr,
        )
        return {"schemaVersion": 1, "builds": []}

    if not isinstance(payload, dict) or not isinstance(payload.get("builds"), list):
        print(
            f"warning: firmware history {path} has an unexpected shape; starting a new list",
            file=sys.stderr,
        )
        return {"schemaVersion": 1, "builds": []}
    return payload


def append_firmware_history(publish_root: Path, record: Mapping[str, Any]) -> Path:
    """Append *record* to the history, replacing any record for the same image.

    The write is atomic (temp file + ``os.replace``) and idempotent by ``image``:
    rebuilding the same name replaces its record instead of appending a duplicate.
    """

    path = firmware_history_path(publish_root)
    payload = load_firmware_history(publish_root)
    image = record.get("image")
    builds = [
        build
        for build in payload.get("builds", [])
        if not (isinstance(build, dict) and build.get("image") == image)
    ]
    builds.append(dict(record))
    payload["schemaVersion"] = 1
    payload["builds"] = builds

    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(".json.tmp")
    tmp_path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    os.replace(tmp_path, path)
    return path

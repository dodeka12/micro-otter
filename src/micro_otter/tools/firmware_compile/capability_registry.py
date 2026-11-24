"""Data-driven capability descriptor registry shared with the web app.

Descriptors are authored as JSON under ``device/capabilities/`` and read by both this
loader and the TypeScript ``CapabilityRegistry`` so there is a single source of truth
for what a capability *is* and which ``domain`` (``pin`` | ``general``) it belongs to.
"""

from __future__ import annotations

import json
from pathlib import Path


class CapabilityRegistry:
    """Minimal capability descriptor lookup mirroring the web app's registry."""

    def __init__(self, capabilities_root: Path) -> None:
        self._descriptors: dict[str, dict] = {}
        index_path = capabilities_root / "index.json"
        index = json.loads(index_path.read_text(encoding="utf-8"))
        for rel_path in index.get("files", []):
            file_path = capabilities_root / rel_path
            payload = json.loads(file_path.read_text(encoding="utf-8"))
            for descriptor in payload.get("capabilities", []):
                capability_id = descriptor.get("id")
                if isinstance(capability_id, str) and capability_id:
                    self._descriptors[capability_id] = descriptor

    def get(self, capability_id: str) -> dict | None:
        return self._descriptors.get(capability_id)

    def has(self, capability_id: str) -> bool:
        return capability_id in self._descriptors

    def get_domain(self, capability_id: str) -> str:
        descriptor = self._descriptors.get(capability_id)
        if descriptor and descriptor.get("domain") == "general":
            return "general"
        return "pin"

    def get_all(self) -> list[dict]:
        return list(self._descriptors.values())

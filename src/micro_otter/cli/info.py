from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from rich import box
from rich.console import Console
from rich.table import Table

DEVICES_INDEX = Path(__file__).parent.parent / "nodes" / "device" / "devices.json"
TARGETS_INDEX = Path(__file__).parent.parent / "nodes" / "device" / "targets" / "targets.json"


@dataclass
class DeviceDescriptor:
    key: str
    device_file: str
    name: str | None = None
    description: str | None = None


@dataclass
class TargetDescriptor:
    target_id: str
    file: str
    display_name: str | None = None
    description: str | None = None


def load_devices(index_path: Path | None = None) -> list[DeviceDescriptor]:
    target_path = index_path or DEVICES_INDEX
    if not target_path.exists():
        raise FileNotFoundError(f"Device manifest not found: {target_path}")
    data = json.loads(target_path.read_text(encoding="utf-8"))
    devices = []
    raw_devices = data.get("devices", {}) if isinstance(data, dict) else {}
    for key, payload in raw_devices.items():
        device_file = (payload or {}).get("deviceFile")
        if not device_file:
            continue
        devices.append(
            DeviceDescriptor(
                key=key,
                device_file=device_file,
                name=payload.get("name"),
                description=payload.get("description"),
            )
        )
    return devices


def load_targets(index_path: Path | None = None) -> list[TargetDescriptor]:
    target_path = index_path or TARGETS_INDEX
    if not target_path.exists():
        raise FileNotFoundError(f"Target manifest not found: {target_path}")

    data = json.loads(target_path.read_text(encoding="utf-8"))
    entries = data.get("targets", []) if isinstance(data, dict) else []
    targets: list[TargetDescriptor] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        target_id = entry.get("id")
        file = entry.get("file")
        if not target_id or not file:
            continue
        targets.append(
            TargetDescriptor(
                target_id=target_id,
                file=file,
                display_name=entry.get("displayName"),
                description=entry.get("description"),
            )
        )
    return targets


def format_device(descriptor: DeviceDescriptor) -> str:
    parts = [descriptor.key]
    if descriptor.name and descriptor.name.strip():
        parts.append(f"- {descriptor.name.strip()}")
    parts.append(f"(file: {descriptor.device_file})")
    if descriptor.description:
        parts.append(f":: {descriptor.description}")
    return " ".join(parts)


def _render_table(table: Table) -> str:
    console = Console(force_terminal=True, color_system="standard", width=120, record=True)
    with console.capture() as capture:
        console.print(table)
    return capture.get()


def render_devices_table(descriptors: Iterable[DeviceDescriptor]) -> str:
    table = Table(
        title="Available devices",
        box=box.SIMPLE_HEAVY,
        show_lines=True,
        header_style="bold cyan",
    )
    table.add_column("Key", style="bold yellow")
    table.add_column("Name", style="bold green")
    table.add_column("Description", style="white")
    table.add_column("Device file", style="magenta")

    added = False
    for desc in descriptors:
        added = True
        table.add_row(
            desc.key,
            desc.name or "",
            desc.description or "",
            desc.device_file,
        )

    if not added:
        table.add_row("—", "(none)", "", "")

    return _render_table(table)


def render_targets_table(targets: Iterable[TargetDescriptor]) -> str:
    table = Table(
        title="Available targets",
        box=box.SIMPLE_HEAVY,
        show_lines=True,
        header_style="bold cyan",
    )
    table.add_column("Name", style="bold green")
    table.add_column("Description", style="white")

    added = False
    for target in targets:
        added = True
        display = target.display_name or target.target_id
        table.add_row(display, target.description or "")

    if not added:
        table.add_row("(none)", "")

    return _render_table(table)

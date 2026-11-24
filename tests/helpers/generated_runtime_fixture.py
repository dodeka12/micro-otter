from __future__ import annotations

import json
import shutil
from pathlib import Path

from micro_otter.tools.firmware_compile.staging_runner import run_staging


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def create_generated_runtime_modules_root(tmp_path: Path) -> Path:
    """Create a minimal workspace and return generated modules root path."""

    workspace = tmp_path / "workspace"
    device_root = workspace / "src" / "micro_otter" / "nodes" / "device"
    modules_root = workspace / "src" / "micropython" / "ports" / "esp32" / "modules"
    modules_root.mkdir(parents=True, exist_ok=True)
    runtime_src_root = (
        Path(__file__).resolve().parents[2]
        / "src"
        / "micro_otter"
        / "nodes"
        / "device"
        / "runtime"
        / "general"
    )

    _write_json(
        device_root / "targets" / "compile_target_mappings.json",
        {
            "schemaVersion": 1,
            "rules": [
                {
                    "id": "esp32-default",
                    "webTargetId": "esp32_wroom",
                    "runtimeIdInclude": ["general"],
                    "runtimeIdExclude": [],
                    "compile": {"board": "esp32", "port": "esp32"},
                    "priority": 100,
                }
            ],
        },
    )

    _write_json(device_root / "runtime" / "manifest.json", {"runtimes": {"general": "general"}})
    _write_json(
        device_root / "runtime" / "general" / "manifest.json",
        {
            "id": "general",
            "name": "Micro-Otter",
            "description": "Generated runtime fixture",
            "version": "1.11.0",
            "customView": "custom_view.json",
            "filesystem": [
                "app/main_loop.py",
                "otter_main.py",
                "otter_runtime/__init__.py",
                "custom_view.json",
            ],
            "nodePackages": {"global": [], "local": []},
            "deviceTargets": {"include": [], "exclude": []},
        },
    )

    _write_json(device_root / "tools" / "manifest.json", {"files": []})
    _write_json(device_root / "node_pkgs" / "index.json", {"packages": []})

    capabilities_src = (
        Path(__file__).resolve().parent.parent.parent
        / "src"
        / "micro_otter"
        / "nodes"
        / "device"
        / "capabilities"
    )
    shutil.copytree(capabilities_src, device_root / "capabilities")

    rel_files = [
        "app/main_loop.py",
        "otter_main.py",
        "otter_runtime/__init__.py",
        "custom_view.json",
    ]
    for rel in rel_files:
        src = runtime_src_root / rel
        dst = device_root / "runtime" / "general" / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)

    report = run_staging(
        workspace_root=workspace,
        runtime_id="general",
        target="esp32",
        dry_run=False,
    )
    return report.modules_path.resolve()

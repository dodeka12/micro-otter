#!/usr/bin/env python3
"""Enforce runtime manifest version bumps for device runtime commits."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from collections.abc import Iterable, Sequence
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from micro_otter.tools.firmware_compile.version_identity import decide_runtime_firmware_bump  # noqa: E402
DEVICE_ROOT = ROOT / "src" / "micro_otter" / "nodes" / "device"
DEVICE_ROOT_REL = DEVICE_ROOT.relative_to(ROOT)
RUNTIME_ROOT = DEVICE_ROOT / "runtime"
RUNTIME_ROOT_REL = RUNTIME_ROOT.relative_to(ROOT)
RUNTIME_ASSETS_ROOT = ROOT / "src" / "micro_otter" / "tools" / "firmware_compile" / "runtime_assets"
RUNTIME_ASSETS_ROOT_REL = RUNTIME_ASSETS_ROOT.relative_to(ROOT)
VERSION_PATTERN = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


class DeviceVersionError(Exception):
    pass


def main() -> int:
    commit_msg_path = Path(sys.argv[1])
    commit_message = commit_msg_path.read_text(encoding="utf-8")
    staged_paths = get_staged_paths()

    runtime_manifest_paths = find_runtime_manifests_requiring_bump(staged_paths)
    node_pkg_manifest_paths = find_node_package_manifests_requiring_bump(staged_paths)
    tools_manifest_path = find_tools_manifest_requiring_bump(staged_paths)
    runtime_assets_manifest_path = find_runtime_assets_manifest_requiring_bump(staged_paths)

    all_manifest_paths = (
        runtime_manifest_paths
        | node_pkg_manifest_paths
        | ({tools_manifest_path} if tools_manifest_path else set())
        | ({runtime_assets_manifest_path} if runtime_assets_manifest_path else set())
    )
    if not all_manifest_paths:
        return 0

    bump_type = resolve_bump_type(commit_message, staged_paths)
    updates = apply_bumps(all_manifest_paths, bump_type)
    if not updates:
        return 0

    for rel_path, new_version in updates:
        print(f"[device-version] {rel_path} -> {new_version} ({bump_type})")
    raise DeviceVersionError(
        "Device manifest versions were bumped and staged. "
        "Re-run your git commit command so the updated files are included."
    )


def get_staged_paths() -> list[Path]:
    result = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return [Path(line.strip()) for line in result.stdout.splitlines() if line.strip()]


def find_runtime_manifests_requiring_bump(paths: Iterable[Path]) -> set[Path]:
    runtime_manifests: set[Path] = set()
    for rel_path in paths:
        try:
            rel_to_runtime = rel_path.relative_to(RUNTIME_ROOT_REL)
        except ValueError:
            continue
        if len(rel_to_runtime.parts) < 2:
            continue
        runtime_id = rel_to_runtime.parts[0]
        runtime_manifest = RUNTIME_ROOT / runtime_id / "manifest.json"
        if not runtime_manifest.exists():
            continue
        rel_runtime_manifest = RUNTIME_ROOT_REL / runtime_id / "manifest.json"
        if rel_path == rel_runtime_manifest:
            continue
        runtime_manifests.add(runtime_manifest)
    return runtime_manifests


def find_node_package_manifests_requiring_bump(paths: Iterable[Path]) -> set[Path]:
    """Return node-package manifest.json paths for packages with staged non-manifest changes."""
    manifests: set[Path] = set()
    node_pkgs_root = DEVICE_ROOT_REL / "node_pkgs"
    for rel_path in paths:
        try:
            rel_to_pkgs = rel_path.relative_to(node_pkgs_root)
        except ValueError:
            continue
        if len(rel_to_pkgs.parts) < 2:
            continue
        pkg_id = rel_to_pkgs.parts[0]
        manifest = DEVICE_ROOT / "node_pkgs" / pkg_id / "manifest.json"
        rel_manifest = node_pkgs_root / pkg_id / "manifest.json"
        if rel_path == rel_manifest:
            continue
        if manifest.exists():
            manifests.add(manifest)
    return manifests


def find_tools_manifest_requiring_bump(paths: Iterable[Path]) -> Path | None:
    """Return tools manifest path if any staged non-manifest tools file changed."""
    tools_root = DEVICE_ROOT_REL / "tools"
    tools_manifest_rel = tools_root / "manifest.json"
    manifest = DEVICE_ROOT / "tools" / "manifest.json"
    for rel_path in paths:
        try:
            rel_path.relative_to(tools_root)
        except ValueError:
            continue
        if rel_path == tools_manifest_rel:
            continue
        if manifest.exists():
            return manifest
    return None


def find_runtime_assets_manifest_requiring_bump(paths: Iterable[Path]) -> Path | None:
    """Return runtime_assets manifest path if any staged non-manifest file in runtime_assets changed."""
    runtime_assets_manifest_rel = RUNTIME_ASSETS_ROOT_REL / "manifest.json"
    manifest = RUNTIME_ASSETS_ROOT / "manifest.json"
    for rel_path in paths:
        try:
            rel_path.relative_to(RUNTIME_ASSETS_ROOT_REL)
        except ValueError:
            continue
        if rel_path == runtime_assets_manifest_rel:
            continue
        if manifest.exists():
            return manifest
    return None


def resolve_bump_type(message: str, staged_paths: Iterable[Path]) -> str:
    decision = decide_runtime_firmware_bump(
        commit_message=message,
        changed_paths=[path.as_posix() for path in staged_paths],
    )
    if decision.bump_type is None:
        raise DeviceVersionError(
            "Device files changed but no runtime bump class was detected from staged paths"
        )
    return decision.bump_type


def apply_bumps(runtime_manifest_paths: Iterable[Path], bump_type: str) -> list[tuple[str, str]]:
    updates: list[tuple[str, str]] = []
    for runtime_manifest in sorted(runtime_manifest_paths):
        new_version = bump_manifest_version(runtime_manifest, bump_type)
        if new_version:
            rel = runtime_manifest.relative_to(ROOT).as_posix()
            updates.append((rel, new_version))
    return updates


def bump_manifest_version(manifest_path: Path, bump_type: str) -> str | None:
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    current_version = parse_version(data.get("version"))
    head_version = read_version_from_head(manifest_path)
    if head_version is None:
        # Manifest is new (not yet in HEAD). Accept whatever version the author set.
        return None
    bumped = apply_version_bump(head_version[:], bump_type)
    new_version = format_version(bumped)
    if data.get("version") == new_version:
        return None
    data["version"] = new_version
    manifest_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    stage_file(manifest_path)
    return new_version


def read_version_from_head(manifest_path: Path) -> list[int] | None:
    rel = manifest_path.relative_to(ROOT).as_posix()
    result = subprocess.run(
        ["git", "show", f"HEAD:{rel}"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return None
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise DeviceVersionError(f"Failed to parse {rel} from HEAD: {exc}") from exc
    return parse_version(data.get("version"))


def parse_version(value: str | None) -> list[int]:
    if value is None:
        raise DeviceVersionError("runtime manifest is missing a version field")
    match = VERSION_PATTERN.match(value.strip())
    if not match:
        raise DeviceVersionError(f"Invalid semantic version: {value}")
    return [int(match.group(1)), int(match.group(2)), int(match.group(3))]


def apply_version_bump(parts: list[int], bump_type: str) -> list[int]:
    if bump_type == "major":
        parts[0] += 1
        parts[1] = 0
        parts[2] = 0
    elif bump_type == "minor":
        parts[1] += 1
        parts[2] = 0
    elif bump_type == "patch":
        parts[2] += 1
    else:
        raise DeviceVersionError(f"Unknown bump type: {bump_type}")
    return parts


def format_version(parts: Sequence[int]) -> str:
    return f"{parts[0]}.{parts[1]}.{parts[2]}"


def stage_file(path: Path) -> None:
    rel = path.relative_to(ROOT).as_posix()
    subprocess.run(["git", "add", rel], cwd=ROOT, check=True)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except DeviceVersionError as exc:
        print(f"device version hook: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
    except Exception as exc:  # pragma: no cover
        print(f"device version hook failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc

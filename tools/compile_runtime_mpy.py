#!/usr/bin/env python3
"""Compile runtime and node package Python files to .mpy next to sources.

The source selection is manifest-driven:

1. All runtimes listed in nodes/device/runtime/manifest.json are processed.
2. Runtime Python files are selected from each runtime manifest's filesystem list.
3. Node package Python files are selected from each package manifest's mpAssets map
   for both global and runtime-local packages referenced by each runtime manifest.
4. Compiled files are placed into sibling __mpycache__/<hash>/ folders next to
   each source file.
5. Each runtime manifest is updated with a hash -> compile-parameter mapping.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DEVICE_ROOT = REPO_ROOT / "src" / "micro_otter" / "nodes" / "device"
MPYCACHE_DIRNAME = "__mpycache__"
MANIFEST_PROFILE_KEY = "mpyCompileProfiles"
MANIFEST_SOURCE_EXCLUDES_KEY = "mpySourceExcludes"


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def save_json(path: Path, payload: dict[str, Any]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")


def find_mpy_cross(explicit_path: str | None) -> Path:
    if explicit_path:
        path = Path(explicit_path).expanduser().resolve()
        if not path.is_file():
            raise FileNotFoundError(f"mpy-cross not found: {path}")
        return path

    from_path = shutil.which("mpy-cross")
    if from_path:
        return Path(from_path).resolve()

    local_build = REPO_ROOT / "src" / "micropython" / "mpy-cross" / "build" / "mpy-cross"
    if local_build.is_file():
        return local_build

    raise FileNotFoundError(
        "Could not locate mpy-cross. Use --mpy-cross or build it at "
        "src/micropython/mpy-cross/build/mpy-cross."
    )


def resolve_runtime_dirs(runtime_root: Path) -> list[tuple[str, Path]]:
    runtime_index_path = runtime_root / "manifest.json"
    if not runtime_index_path.is_file():
        raise FileNotFoundError(f"Runtime index manifest not found: {runtime_index_path}")

    runtime_index = load_json(runtime_index_path)
    runtimes = runtime_index.get("runtimes")
    if not isinstance(runtimes, dict):
        raise ValueError(f"Invalid runtimes map in: {runtime_index_path}")

    resolved: list[tuple[str, Path]] = []
    for runtime_id, runtime_rel in runtimes.items():
        if not isinstance(runtime_id, str) or not isinstance(runtime_rel, str):
            continue
        runtime_dir = (runtime_root / runtime_rel).resolve()
        resolved.append((runtime_id, runtime_dir))

    return resolved


def collect_runtime_python_files(runtime_manifest: dict[str, Any], runtime_dir: Path) -> set[Path]:
    files: set[Path] = set()
    filesystem = runtime_manifest.get("filesystem")
    if not isinstance(filesystem, list):
        return files

    raw_excludes = runtime_manifest.get(MANIFEST_SOURCE_EXCLUDES_KEY)
    excluded_paths: set[str] = set()
    if isinstance(raw_excludes, list):
        for entry in raw_excludes:
            if not isinstance(entry, str):
                continue
            normalized = entry.strip().replace("\\", "/")
            normalized = normalized.lstrip("/")
            if normalized.startswith("./"):
                normalized = normalized[2:]
            if normalized:
                excluded_paths.add(normalized)

    for rel in filesystem:
        if not isinstance(rel, str) or not rel.endswith(".py"):
            continue
        normalized_rel = rel.strip().replace("\\", "/")
        normalized_rel = normalized_rel.lstrip("/")
        if normalized_rel.startswith("./"):
            normalized_rel = normalized_rel[2:]

        if normalized_rel in excluded_paths:
            continue

        source_path = (runtime_dir / rel).resolve()
        if source_path.is_file():
            files.add(source_path)

    return files


def collect_python_files_from_list(
    manifest_payload: dict[str, Any],
    base_dir: Path,
    list_key: str,
) -> set[Path]:
    files: set[Path] = set()
    raw_list = manifest_payload.get(list_key)
    if not isinstance(raw_list, list):
        return files

    for rel in raw_list:
        if not isinstance(rel, str) or not rel.endswith(".py"):
            continue
        source_path = (base_dir / rel).resolve()
        if source_path.is_file():
            files.add(source_path)

    return files


def iter_mp_assets_python_paths(pkg_manifest: dict[str, Any], package_dir: Path) -> set[Path]:
    files: set[Path] = set()
    mp_assets = pkg_manifest.get("mpAssets")
    if not isinstance(mp_assets, dict):
        return files

    for _asset_key, asset_list in mp_assets.items():
        if not isinstance(asset_list, list):
            continue
        for asset_rel in asset_list:
            if not isinstance(asset_rel, str) or not asset_rel.endswith(".py"):
                continue
            asset_path = (package_dir / asset_rel).resolve()
            if asset_path.is_file():
                files.add(asset_path)

    return files


def resolve_package_dir(
    package_id: str,
    *,
    runtime_dir: Path,
    global_node_pkgs_root: Path,
    prefer_local: bool,
) -> Path | None:
    candidates: list[Path] = []

    local_candidate = (runtime_dir / "node_pkgs" / package_id).resolve()
    global_candidate = (global_node_pkgs_root / package_id).resolve()

    if prefer_local:
        candidates.extend([local_candidate, global_candidate])
    else:
        candidates.extend([global_candidate, local_candidate])

    for candidate in candidates:
        if (candidate / "manifest.json").is_file():
            return candidate

    return None


def gather_sources_from_manifests(
    device_root: Path,
) -> tuple[
    set[Path],
    dict[str, tuple[Path, dict[str, Any]]],
    dict[str, tuple[Path, dict[str, Any]]],
    dict[str, tuple[Path, dict[str, Any]]],
    list[str],
]:
    runtime_root = device_root / "runtime"
    node_pkgs_root = device_root / "node_pkgs"
    tools_root = device_root / "tools"

    runtime_dirs = resolve_runtime_dirs(runtime_root)

    all_sources: set[Path] = set()
    runtime_manifest_map: dict[str, tuple[Path, dict[str, Any]]] = {}
    package_manifest_map: dict[str, tuple[Path, dict[str, Any]]] = {}
    tools_manifest_map: dict[str, tuple[Path, dict[str, Any]]] = {}
    warnings: list[str] = []

    def remember_package_manifest(package_id: str, package_dir: Path) -> dict[str, Any]:
        manifest_path = package_dir / "manifest.json"
        key = f"{package_id}:{manifest_path}"
        existing = package_manifest_map.get(key)
        if existing is not None:
            return existing[1]
        payload = load_json(manifest_path)
        package_manifest_map[key] = (manifest_path, payload)
        return payload

    for runtime_id, runtime_dir in runtime_dirs:
        runtime_manifest_path = runtime_dir / "manifest.json"
        if not runtime_manifest_path.is_file():
            warnings.append(
                f"Skipping runtime '{runtime_id}', missing manifest: {runtime_manifest_path}"
            )
            continue

        runtime_manifest = load_json(runtime_manifest_path)
        runtime_manifest_map[runtime_id] = (runtime_manifest_path, runtime_manifest)

        # Runtime files from filesystem entries.
        all_sources.update(collect_runtime_python_files(runtime_manifest, runtime_dir))

        node_packages = runtime_manifest.get("nodePackages")
        if not isinstance(node_packages, dict):
            continue

        global_packages = (
            node_packages.get("global") if isinstance(node_packages.get("global"), list) else []
        )
        local_packages = (
            node_packages.get("local") if isinstance(node_packages.get("local"), list) else []
        )

        for package_id in global_packages:
            if not isinstance(package_id, str):
                continue
            package_dir = resolve_package_dir(
                package_id,
                runtime_dir=runtime_dir,
                global_node_pkgs_root=node_pkgs_root,
                prefer_local=False,
            )
            if package_dir is None:
                warnings.append(
                    f"Runtime '{runtime_id}': global package '{package_id}' not found in node_pkgs"
                )
                continue
            pkg_manifest = remember_package_manifest(package_id, package_dir)
            all_sources.update(iter_mp_assets_python_paths(pkg_manifest, package_dir))

        for package_id in local_packages:
            if not isinstance(package_id, str):
                continue
            package_dir = resolve_package_dir(
                package_id,
                runtime_dir=runtime_dir,
                global_node_pkgs_root=node_pkgs_root,
                prefer_local=True,
            )
            if package_dir is None:
                warnings.append(
                    f"Runtime '{runtime_id}': local package '{package_id}' not found in "
                    "runtime/node_pkgs or global node_pkgs"
                )
                continue
            pkg_manifest = remember_package_manifest(package_id, package_dir)
            all_sources.update(iter_mp_assets_python_paths(pkg_manifest, package_dir))

    tools_manifest_path = tools_root / "manifest.json"
    if tools_manifest_path.is_file():
        tools_manifest = load_json(tools_manifest_path)
        tools_manifest_map["device-tools"] = (tools_manifest_path, tools_manifest)
        all_sources.update(collect_python_files_from_list(tools_manifest, tools_root, "files"))
    else:
        warnings.append(f"Device tools manifest not found: {tools_manifest_path}")

    return all_sources, runtime_manifest_map, package_manifest_map, tools_manifest_map, warnings


def compiler_version_string(mpy_cross: Path) -> str:
    result = subprocess.run(
        [str(mpy_cross), "--version"],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode == 0 and result.stdout.strip():
        return result.stdout.strip()
    if result.stderr.strip():
        return result.stderr.strip()
    return "unknown"


def build_compile_params(
    *,
    mpy_cross: Path,
    emit: str,
    small_int_bits: int | None,
    march: str | None,
    march_flags: str | None,
) -> dict[str, Any]:
    return {
        "mpyCrossVersion": compiler_version_string(mpy_cross),
        "emit": emit,
        "smallIntBits": small_int_bits,
        "march": march,
        "marchFlags": march_flags,
    }


def build_profile_hash(compile_params: dict[str, Any], length: int = 12) -> str:
    serialized = json.dumps(compile_params, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
    return digest[:length]


def clean_mpycache_dirs(device_root: Path) -> None:
    runtime_root = device_root / "runtime"
    node_pkgs_root = device_root / "node_pkgs"
    tools_root = device_root / "tools"

    for root in (runtime_root, node_pkgs_root, tools_root):
        if not root.is_dir():
            continue
        for cache_dir in root.rglob(MPYCACHE_DIRNAME):
            if cache_dir.is_dir():
                shutil.rmtree(cache_dir)


def compile_sources(
    *,
    source_files: list[Path],
    mpy_cross: Path,
    profile_hash: str,
    mpy_cross_args: list[str],
) -> int:
    compiled_count = 0

    for source in source_files:
        out_dir = source.parent / MPYCACHE_DIRNAME / profile_hash
        out_dir.mkdir(parents=True, exist_ok=True)
        out_file = out_dir / f"{source.stem}.mpy"

        command = [str(mpy_cross), *mpy_cross_args, "-o", str(out_file), str(source)]
        subprocess.run(command, check=True)
        compiled_count += 1

    return compiled_count


def update_manifests_with_profile(
    manifest_map: dict[str, tuple[Path, dict[str, Any]]],
    profile_hash: str,
    compile_params: dict[str, Any],
) -> int:
    updated = 0
    for _manifest_id, (manifest_path, manifest_payload) in manifest_map.items():
        profiles = manifest_payload.get(MANIFEST_PROFILE_KEY)
        if not isinstance(profiles, dict):
            profiles = {}
            manifest_payload[MANIFEST_PROFILE_KEY] = profiles

        current = profiles.get(profile_hash)
        if current == compile_params:
            continue

        profiles[profile_hash] = compile_params
        save_json(manifest_path, manifest_payload)
        updated += 1

    return updated


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Compile manifest-defined runtime and node package Python files into "
            "sibling __mpycache__/<hash> folders."
        )
    )
    parser.add_argument(
        "--device-root",
        default=str(DEFAULT_DEVICE_ROOT),
        help="Path to nodes/device root (default: project nodes/device).",
    )
    parser.add_argument(
        "--mpy-cross",
        default=None,
        help="Path to mpy-cross executable (default: PATH or src/micropython build).",
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help=(
            "Delete all __mpycache__ folders under runtime, node_pkgs, and tools "
            "before compiling."
        ),
    )
    parser.add_argument(
        "--small-int-bits",
        type=int,
        default=None,
        help="Pass -msmall-int-bits to mpy-cross (affects compatibility).",
    )
    parser.add_argument(
        "--march",
        default=None,
        help="Pass -march to mpy-cross (mainly relevant for native/viper emitters).",
    )
    parser.add_argument(
        "--march-flags",
        default=None,
        help="Pass -march-flags to mpy-cross.",
    )
    parser.add_argument(
        "--emit",
        choices=("bytecode", "native", "viper"),
        default="bytecode",
        help="Pass -X emit=<mode> to mpy-cross (default: bytecode).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    device_root = Path(args.device_root).expanduser().resolve()

    if not device_root.is_dir():
        print(f"Device root not found: {device_root}", file=sys.stderr)
        return 1

    try:
        mpy_cross = find_mpy_cross(args.mpy_cross)
    except FileNotFoundError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    compile_params = build_compile_params(
        mpy_cross=mpy_cross,
        emit=args.emit,
        small_int_bits=args.small_int_bits,
        march=args.march,
        march_flags=args.march_flags,
    )
    profile_hash = build_profile_hash(compile_params)

    mpy_cross_args: list[str] = ["-X", f"emit={args.emit}"]
    if args.small_int_bits is not None:
        mpy_cross_args.append(f"-msmall-int-bits={args.small_int_bits}")
    if args.march:
        mpy_cross_args.append(f"-march={args.march}")
    if args.march_flags:
        mpy_cross_args.append(f"-march-flags={args.march_flags}")
    if args.march is None:
        print(
            "note: no -march specified; @micropython.native/@micropython.viper decorators "
            "require -march to compile to native code.",
            file=sys.stderr,
        )

    (
        source_files,
        runtime_manifest_map,
        package_manifest_map,
        tools_manifest_map,
        warnings,
    ) = gather_sources_from_manifests(device_root)
    if warnings:
        for warning in warnings:
            print(f"warning: {warning}", file=sys.stderr)

    if args.clean:
        clean_mpycache_dirs(device_root)

    sorted_sources = sorted(source_files)
    if not sorted_sources:
        print(f"No Python files selected from manifests under: {device_root}")
        return 0

    try:
        compiled_count = compile_sources(
            source_files=sorted_sources,
            mpy_cross=mpy_cross,
            profile_hash=profile_hash,
            mpy_cross_args=mpy_cross_args,
        )
    except subprocess.CalledProcessError as exc:
        print(
            f"Failed compiling with mpy-cross (exit {exc.returncode}): {exc.cmd}",
            file=sys.stderr,
        )
        return exc.returncode

    updated_runtime_manifest_count = update_manifests_with_profile(
        manifest_map=runtime_manifest_map,
        profile_hash=profile_hash,
        compile_params=compile_params,
    )
    updated_package_manifest_count = update_manifests_with_profile(
        manifest_map=package_manifest_map,
        profile_hash=profile_hash,
        compile_params=compile_params,
    )
    updated_tools_manifest_count = update_manifests_with_profile(
        manifest_map=tools_manifest_map,
        profile_hash=profile_hash,
        compile_params=compile_params,
    )

    print(f"Compiled {compiled_count} files")
    print(f"profile hash: {profile_hash}")
    print(f"mpy-cross: {mpy_cross}")
    print(f"mpy-cross args: {' '.join(mpy_cross_args)}")
    print(f"runtime manifests updated: {updated_runtime_manifest_count}")
    print(f"node package manifests updated: {updated_package_manifest_count}")
    print(f"device tools manifests updated: {updated_tools_manifest_count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Manifest-driven .mpy precompile utilities used by firmware compile workflows."""

from __future__ import annotations

import copy
import hashlib
import json
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from micro_otter.tools.addon_store import (
    ADDON_MANIFEST_NAME,
    installed_addons,
    iter_addon_package_dirs,
)

from .package_resolver import (
    NodePackageRoot,
    load_package_entries,
    package_roots,
    resolve_variant_entries,
)

MPYCACHE_DIRNAME = "__mpycache__"
MANIFEST_PROFILE_KEY = "mpyCompileProfiles"
MANIFEST_SOURCE_EXCLUDES_KEY = "mpySourceExcludes"


@dataclass(frozen=True)
class MpyManifestPrecompileRequest:
    """Request for manifest-driven .mpy precompile execution."""

    device_root: Path
    micropython_root: Path | None = None
    mpy_cross: Path | None = None
    clean: bool = False
    emit: str = "bytecode"
    small_int_bits: int | None = None
    march: str | None = None
    march_flags: str | None = None
    addons_root: Path | None = None
    """Add-ons folder to cover as well; ``None`` compiles the shipped tree only."""

    dry_run: bool = False
    """Collect and report sources without compiling, cleaning, or rewriting a manifest."""


@dataclass(frozen=True)
class MpyManifestPrecompileResult:
    """Result of manifest-driven .mpy precompile execution."""

    compiled_count: int
    profile_hash: str
    compiler_path: Path
    compiler_args: tuple[str, ...]
    runtime_manifests_updated: int
    node_package_manifests_updated: int
    tools_manifests_updated: int
    warnings: tuple[str, ...]
    addon_manifests_updated: int = 0
    """How many installed add-on manifests received this profile record."""

    addons_skipped: bool = False
    """Whether the add-ons folder was out of scope for this run (``--skip-addons``)."""


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def save_json(path: Path, payload: dict[str, Any]) -> None:
    """Write *payload* to *path* atomically.

    The payload is written to a sibling temp file, flushed, fsynced, and renamed over
    *path*, so a crash leaves either the previous manifest or the complete new one —
    never a truncated file. The temp file sits next to the target because
    :func:`os.replace` is only atomic within one filesystem, and this writes into user
    data (an installed add-on), never into build output.
    """

    temp_path = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    try:
        with temp_path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    except BaseException:
        temp_path.unlink(missing_ok=True)
        raise


def _serialized_json(payload: dict[str, Any]) -> str:
    """Return *payload* in exactly the form :func:`save_json` writes."""

    return json.dumps(payload, indent=2) + "\n"


def _existing_text(path: Path) -> str | None:
    """Return the current content of *path*, or ``None`` when it cannot be read."""

    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return None


def resolve_mpy_cross_executable(
    explicit_path: Path | str | None,
    *,
    micropython_root: Path | None,
) -> Path:
    """Resolve mpy-cross executable from explicit value, PATH, or local MicroPython build."""

    if explicit_path:
        explicit = Path(explicit_path).expanduser().resolve()
        if not explicit.is_file():
            raise FileNotFoundError(f"mpy-cross not found: {explicit}")
        return explicit

    from_path = shutil.which("mpy-cross")
    if from_path:
        return Path(from_path).resolve()

    if micropython_root is not None:
        local_build = micropython_root.resolve() / "mpy-cross" / "build" / "mpy-cross"
        if local_build.is_file():
            return local_build

    raise FileNotFoundError(
        "Could not locate mpy-cross. Provide --mpy-cross, add it to PATH, or build it under "
        "<micropython-root>/mpy-cross/build/mpy-cross."
    )


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


def build_mpy_cross_args(
    *,
    emit: str,
    small_int_bits: int | None,
    march: str | None,
    march_flags: str | None,
) -> tuple[str, ...]:
    args: list[str] = ["-X", f"emit={emit}"]
    if small_int_bits is not None:
        args.append(f"-msmall-int-bits={small_int_bits}")
    if march:
        args.append(f"-march={march}")
    if march_flags:
        args.append(f"-march-flags={march_flags}")
    return tuple(args)


def clean_mpycache_dirs(device_root: Path, *, addons_root: Path | None = None) -> None:
    """Delete ``__mpycache__`` folders under the device tree and installed add-ons.

    The add-ons side iterates the store's installed packages instead of walking the
    addons root, so ``.staging/`` and ``.trash/`` are never touched: a partially
    extracted archive must not be deleted from under an install.
    """

    runtime_root = device_root / "runtime"
    node_pkgs_root = device_root / "node_pkgs"
    tools_root = device_root / "tools"

    for root in (runtime_root, node_pkgs_root, tools_root):
        if not root.is_dir():
            continue
        for cache_dir in root.rglob(MPYCACHE_DIRNAME):
            if cache_dir.is_dir():
                shutil.rmtree(cache_dir)

    for _package_id, package_dir in iter_addon_package_dirs(addons_root):
        cache_dir = package_dir / MPYCACHE_DIRNAME
        if cache_dir.is_dir():
            shutil.rmtree(cache_dir)


def compile_sources_to_cache(
    *,
    source_files: list[Path],
    mpy_cross: Path,
    profile_hash: str,
    mpy_cross_args: tuple[str, ...],
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


def compile_sources_to_sibling_mpy(
    *,
    source_files: list[Path],
    mpy_cross: Path,
    mpy_cross_args: tuple[str, ...],
    source_root: Path,
) -> int:
    """Compile Python sources into sibling .mpy files next to each source path.

    Each ``.mpy`` embeds its source name via ``mpy-cross -s <relative posix path>`` so
    the firmware freezer names the module after its staged relative module path
    instead of the absolute host path. ``mpy-cross`` records the ``-s`` value in the
    ``.mpy`` header (qstr 0); ``tools/mpy-tool.py freeze`` then emits it as the frozen
    module name, so without ``-s`` a staged ``.mpy`` freezes as an absolute path that
    no ``import`` statement can resolve.
    """

    resolved_root = source_root.resolve()
    compiled_count = 0
    for source in source_files:
        resolved_source = source.resolve()
        try:
            relative_name = resolved_source.relative_to(resolved_root).as_posix()
        except ValueError:
            raise ValueError(f"Source {source} is outside source root {source_root}") from None
        out_file = source.with_suffix(".mpy")
        command = [
            str(mpy_cross),
            *mpy_cross_args,
            "-s",
            relative_name,
            "-o",
            str(out_file),
            str(source),
        ]
        subprocess.run(command, check=True)
        compiled_count += 1
    return compiled_count


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


def normalize_mpy_source_excludes(runtime_manifest: dict[str, Any]) -> tuple[str, ...]:
    """Return normalized ``mpySourceExcludes`` entries from a runtime manifest.

    Entries are normalized to forward-slash relative paths without a leading ``/``
    or ``./`` so they can be compared against ``Path.relative_to(...).as_posix()``
    values from more than one caller.
    """

    raw_excludes = runtime_manifest.get(MANIFEST_SOURCE_EXCLUDES_KEY)
    if not isinstance(raw_excludes, list):
        return ()

    normalized: list[str] = []
    for entry in raw_excludes:
        if not isinstance(entry, str):
            continue
        candidate = entry.strip().replace("\\", "/").lstrip("/")
        if candidate.startswith("./"):
            candidate = candidate[2:]
        if candidate and candidate not in normalized:
            normalized.append(candidate)
    return tuple(normalized)


def normalize_manifest_path(value: str) -> str:
    """Return a manifest-relative path in the same normalized form as excludes."""

    normalized = value.strip().replace("\\", "/").lstrip("/")
    if normalized.startswith("./"):
        normalized = normalized[2:]
    return normalized


def collect_runtime_python_files(runtime_manifest: dict[str, Any], runtime_dir: Path) -> set[Path]:
    files: set[Path] = set()
    filesystem = runtime_manifest.get("filesystem")
    if not isinstance(filesystem, list):
        return files

    excluded_paths = set(normalize_mpy_source_excludes(runtime_manifest))

    for rel in filesystem:
        if not isinstance(rel, str) or not rel.endswith(".py"):
            continue
        normalized_rel = normalize_manifest_path(rel)

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
    """Return every ``.py`` file any variant declares under ``mpAssets``.

    The v2 manifest keeps ``mpAssets`` inside each ``variants`` entry; a pre-v2
    manifest (top-level ``mpAssets``) is still read so this helper stays tolerant.
    """

    files: set[Path] = set()
    variants = pkg_manifest.get("variants")
    variant_manifests: list[Any] = (
        list(variants.values()) if isinstance(variants, dict) else [pkg_manifest]
    )
    for variant in variant_manifests:
        mp_assets = variant.get("mpAssets") if isinstance(variant, dict) else None
        if not isinstance(mp_assets, dict):
            continue
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
    addons_root: Path | None = None,
) -> Path | None:
    """Return the directory holding *package_id*, preferring built-in over add-on.

    Candidate order is global → add-ons → runtime-local, so a shipped package always
    wins and an installed add-on still beats a runtime-local shadow. ``prefer_local``
    keeps its old meaning for runtime-declared local packages and moves the local
    candidate to the front.
    """

    candidates: list[Path] = []

    local_candidate = (runtime_dir / "node_pkgs" / package_id).resolve()
    global_candidate = (global_node_pkgs_root / package_id).resolve()
    addon_candidate = (
        (addons_root / package_id).resolve() if addons_root is not None else None
    )

    if prefer_local:
        candidates.append(local_candidate)
    candidates.append(global_candidate)
    if addon_candidate is not None:
        candidates.append(addon_candidate)
    if not prefer_local:
        candidates.append(local_candidate)

    for candidate in candidates:
        if (candidate / "manifest.json").is_file():
            return candidate

    return None


def gather_sources_from_manifests(
    device_root: Path,
    *,
    addons_root: Path | None = None,
) -> tuple[
    set[Path],
    dict[str, tuple[Path, dict[str, Any]]],
    dict[str, tuple[Path, dict[str, Any]]],
    dict[str, tuple[Path, dict[str, Any]]],
    list[str],
]:
    """Collect every Python source the device and the installed add-ons declare.

    Returns ``(sources, runtime_manifests, package_manifests, tools_manifests,
    warnings)``. Manifest map keys are ``{package_id}:{manifest_path}``, so two
    packages with the same id in two roots stay distinguishable. Add-ons are collected
    for every installed package, whether or not a runtime manifest lists them, because
    ``mpyCompileProfiles`` drives the deploy classification for them too.
    """

    runtime_root = device_root / "runtime"
    node_pkgs_root = device_root / "node_pkgs"
    tools_root = device_root / "tools"
    entries = load_package_entries(device_root, addons_root=addons_root)
    roots = package_roots(device_root, addons_root)

    runtime_dirs = resolve_runtime_dirs(runtime_root)

    all_sources: set[Path] = set()
    runtime_manifest_map: dict[str, tuple[Path, dict[str, Any]]] = {}
    package_manifest_map: dict[str, tuple[Path, dict[str, Any]]] = {}
    tools_manifest_map: dict[str, tuple[Path, dict[str, Any]]] = {}
    warnings: list[str] = []

    def remember_package_manifest(
        package_id: str,
        package_dir: Path,
        manifest_name: str = ADDON_MANIFEST_NAME,
    ) -> dict[str, Any]:
        manifest_path = package_dir / manifest_name
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
            try:
                variant_entries = resolve_variant_entries(entries, package_id)
            except ValueError:
                warnings.append(
                    f"Runtime '{runtime_id}': global package '{package_id}' not found in node_pkgs"
                )
                continue
            for entry in variant_entries:
                package_dir = roots.package_dir(entry).resolve()
                manifest_name = entry.manifest.rsplit("/", 1)[-1]
                pkg_manifest = remember_package_manifest(package_id, package_dir, manifest_name)
                all_sources.update(iter_mp_assets_python_paths(pkg_manifest, package_dir))

        for package_id in local_packages:
            if not isinstance(package_id, str):
                continue
            package_dir = resolve_package_dir(
                package_id,
                runtime_dir=runtime_dir,
                global_node_pkgs_root=node_pkgs_root,
                prefer_local=True,
                addons_root=addons_root,
            )
            if package_dir is None:
                warnings.append(
                    f"Runtime '{runtime_id}': local package '{package_id}' not found in "
                    "runtime/node_pkgs or global node_pkgs"
                )
                continue
            pkg_manifest = remember_package_manifest(package_id, package_dir)
            all_sources.update(iter_mp_assets_python_paths(pkg_manifest, package_dir))

    for entry in entries:
        if entry.root is not NodePackageRoot.ADDONS:
            continue
        package_dir = roots.package_dir(entry).resolve()
        manifest_name = entry.manifest.rsplit("/", 1)[-1]
        if not (package_dir / manifest_name).is_file():
            warnings.append(f"Add-on package '{entry.id}' has no manifest: {package_dir}")
            continue
        pkg_manifest = remember_package_manifest(entry.id, package_dir, manifest_name)
        all_sources.update(iter_mp_assets_python_paths(pkg_manifest, package_dir))

    tools_manifest_path = tools_root / "manifest.json"
    if tools_manifest_path.is_file():
        tools_manifest = load_json(tools_manifest_path)
        tools_manifest_map["device-tools"] = (tools_manifest_path, tools_manifest)
        all_sources.update(collect_python_files_from_list(tools_manifest, tools_root, "files"))
    else:
        warnings.append(f"Device tools manifest not found: {tools_manifest_path}")

    return all_sources, runtime_manifest_map, package_manifest_map, tools_manifest_map, warnings


def update_manifests_with_profile(
    manifest_map: dict[str, tuple[Path, dict[str, Any]]],
    profile_hash: str,
    compile_params: dict[str, Any],
) -> int:
    """Add ``mpyCompileProfiles[profile_hash]`` to every manifest that needs it.

    Only the key this tool owns is touched: each payload is a copy of the manifest that
    was read, with the single profile record set, so ``mpAssets``,
    ``requiredCapabilities``, unknown keys, and key order survive verbatim. A manifest
    whose serialized content would not change is never rewritten, which makes repeated
    runs free and leaves the file's mtime alone.
    """

    updated = 0
    for _manifest_id, (manifest_path, manifest_payload) in manifest_map.items():
        payload = copy.deepcopy(manifest_payload)
        profiles = payload.get(MANIFEST_PROFILE_KEY)
        if not isinstance(profiles, dict):
            profiles = {}
            payload[MANIFEST_PROFILE_KEY] = profiles
        if profiles.get(profile_hash) == compile_params:
            continue

        profiles[profile_hash] = compile_params
        if _serialized_json(payload) == _existing_text(manifest_path):
            continue

        save_json(manifest_path, payload)
        updated += 1

    return updated


def run_manifest_mpy_precompile(
    request: MpyManifestPrecompileRequest,
) -> MpyManifestPrecompileResult:
    """Run manifest-driven precompile flow and update manifest profile metadata."""

    device_root = request.device_root.resolve()
    if not device_root.is_dir():
        raise FileNotFoundError(f"Device root not found: {device_root}")

    compiler = resolve_mpy_cross_executable(
        request.mpy_cross, micropython_root=request.micropython_root
    )
    compile_params = build_compile_params(
        mpy_cross=compiler,
        emit=request.emit,
        small_int_bits=request.small_int_bits,
        march=request.march,
        march_flags=request.march_flags,
    )
    profile_hash = build_profile_hash(compile_params)
    compiler_args = build_mpy_cross_args(
        emit=request.emit,
        small_int_bits=request.small_int_bits,
        march=request.march,
        march_flags=request.march_flags,
    )

    (
        source_files,
        runtime_manifest_map,
        package_manifest_map,
        tools_manifest_map,
        warnings,
    ) = gather_sources_from_manifests(device_root, addons_root=request.addons_root)

    if request.clean and not request.dry_run:
        clean_mpycache_dirs(device_root, addons_root=request.addons_root)

    sorted_sources = sorted(source_files)
    if request.dry_run:
        return MpyManifestPrecompileResult(
            compiled_count=len(sorted_sources),
            profile_hash=profile_hash,
            compiler_path=compiler,
            compiler_args=compiler_args,
            runtime_manifests_updated=0,
            node_package_manifests_updated=0,
            tools_manifests_updated=0,
            warnings=tuple(warnings),
            addon_manifests_updated=0,
            addons_skipped=request.addons_root is None,
        )

    if sorted_sources:
        compile_sources_to_cache(
            source_files=sorted_sources,
            mpy_cross=compiler,
            profile_hash=profile_hash,
            mpy_cross_args=compiler_args,
        )

    addon_ids = {record.id for record in installed_addons(request.addons_root)}
    addon_map = {
        key: value
        for key, value in package_manifest_map.items()
        if key.split(":", 1)[0] in addon_ids
    }
    builtin_package_map = {
        key: value for key, value in package_manifest_map.items() if key not in addon_map
    }

    runtime_updated = update_manifests_with_profile(
        manifest_map=runtime_manifest_map,
        profile_hash=profile_hash,
        compile_params=compile_params,
    )
    package_updated = update_manifests_with_profile(
        manifest_map=builtin_package_map,
        profile_hash=profile_hash,
        compile_params=compile_params,
    )
    addon_updated = update_manifests_with_profile(
        manifest_map=addon_map,
        profile_hash=profile_hash,
        compile_params=compile_params,
    )
    tools_updated = update_manifests_with_profile(
        manifest_map=tools_manifest_map,
        profile_hash=profile_hash,
        compile_params=compile_params,
    )

    return MpyManifestPrecompileResult(
        compiled_count=len(sorted_sources),
        profile_hash=profile_hash,
        compiler_path=compiler,
        compiler_args=compiler_args,
        runtime_manifests_updated=runtime_updated,
        node_package_manifests_updated=package_updated + addon_updated,
        tools_manifests_updated=tools_updated,
        warnings=tuple(warnings),
        addon_manifests_updated=addon_updated,
        addons_skipped=request.addons_root is None,
    )

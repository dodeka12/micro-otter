"""Staging orchestrator for firmware compile phase-2 workflow."""

from __future__ import annotations

import zlib
from collections.abc import Callable, Mapping
from dataclasses import replace
from pathlib import Path

from .build_precompile import PrecompileResult
from .staging_clean import clean_managed_subtree
from .staging_copy import execute_staging_copy
from .staging_metadata import (
    build_embedded_hash_records,
    write_embedded_metadata,
    write_runtime_bootstrap_setup_templates_module,
    write_runtime_embedded_metadata_payload_module,
    write_runtime_embedded_static_assets_module,
)
from .staging_models import ConstituentVersions, StagingExecutionReport, StagingFileEntry
from .staging_paths import resolve_staging_paths
from .staging_preflight import build_staging_preflight
from .staging_resolver import resolve_runtime_payload
from .staging_runtime_assets import stage_runtime_agnostic_assets
from .staging_startup import stage_startup_files

PrecompileHook = Callable[[Path, tuple[str, ...], tuple[str, ...]], PrecompileResult]
"""Signature for the optional mpy precompile step run inside staging.

Arguments are the resolved modules tree, the runtime manifest's
``mpySourceExcludes`` tuple, and the sorted tuple of staged relative paths (posix,
with suffixes) that staging itself wrote — preflight entries plus runtime assets
plus startup files. The result carries the compile/removal counts so the report
can surface them without staging knowing how compilation works.
"""


def _reconcile_entries_after_precompile(
    entries: list[StagingFileEntry],
    modules_root: Path,
) -> list[StagingFileEntry]:
    """Swap staged entries to their ``.mpy`` sibling after mpy-only compilation.

    An entry whose staged target disappeared because precompile replaced it with a
    ``.mpy`` sibling keeps its metadata but points at the sibling path, so the
    embedded hash table describes the tree that actually ships. Entries whose file
    still exists pass through unchanged.
    """

    reconciled: list[StagingFileEntry] = []
    for entry in entries:
        target = modules_root / entry.target_rel_path
        if target.exists() or target.suffix.lower() != ".py":
            reconciled.append(entry)
            continue

        mpy_target = target.with_suffix(".mpy")
        if not mpy_target.is_file():
            reconciled.append(entry)
            continue

        reconciled.append(
            replace(
                entry,
                target_rel_path=mpy_target.relative_to(modules_root).as_posix(),
            )
        )
    return reconciled


def run_staging(
    workspace_root: Path,
    runtime_id: str,
    target: str,
    board: str | None = None,
    micropython_root: Path | None = None,
    modules_path: Path | None = None,
    device_root: Path | None = None,
    embedded_inventory_output: Path | None = None,
    dry_run: bool = False,
    constituent_versions: ConstituentVersions | None = None,
    package_ids: tuple[str, ...] | None = None,
    mpy_precompile_hook: PrecompileHook | None = None,
    *,
    addons_root: Path | None = None,
    package_variants: Mapping[str, str] | None = None,
) -> StagingExecutionReport:
    """Execute phase-2 staging workflow with dry-run support.

    ``package_ids`` narrows the staged node packages to an explicit selection.
    ``mpy_precompile_hook`` runs after startup files are staged and before the
    embedded hash records are built, so the hash table describes the final module
    tree; it is skipped for dry runs and conflicting preflights. ``addons_root`` is
    forwarded to package resolution only: the preflight consumes already-resolved
    source paths, so it has no root of its own to pick.
    """

    paths = resolve_staging_paths(
        workspace_root=workspace_root,
        target=target,
        micropython_root=micropython_root,
        modules_path=modules_path,
    )
    payload = resolve_runtime_payload(
        workspace_root=paths.workspace_root,
        runtime_id=runtime_id,
        target=paths.target,
        device_root=device_root,
        board=board,
        package_ids=package_ids,
        addons_root=addons_root,
        package_variants=package_variants,
    )
    preflight = build_staging_preflight(
        payload=payload,
        device_root=(workspace_root / "src" / "micro_otter" / "nodes" / "device")
        if device_root is None
        else device_root,
    )

    report = StagingExecutionReport(
        dry_run=dry_run,
        runtime_id=payload.runtime_id,
        runtime_version=payload.runtime_version,
        target=paths.target,
        modules_path=paths.modules_path,
        files_discovered=len(preflight.entries),
        conflicts=list(preflight.conflicts),
        runtime_assets_version=payload.runtime_assets_version,
        git_source=payload.git_source.to_dict() if payload.git_source else None,
    )

    if preflight.conflicts:
        return report

    clean_managed_subtree(paths=paths, dry_run=dry_run)
    copy_result = execute_staging_copy(paths=paths, preflight=preflight, dry_run=dry_run)
    runtime_asset_entries = stage_runtime_agnostic_assets(paths=paths, dry_run=dry_run)
    startup_result = stage_startup_files(paths=paths, payload=payload, dry_run=dry_run)

    report.files_copied = copy_result.files_copied + len(runtime_asset_entries)
    report.files_startup_written = startup_result.files_written

    resolved_modules_path = paths.modules_path.resolve()

    startup_entries = [
        StagingFileEntry(
            source_path=(payload.runtime_root / "otter_main.py"),
            target_rel_path="otter_main.py",
            origin="runtime",
        ),
        StagingFileEntry(
            source_path=(paths.modules_path / "main.py"),
            target_rel_path="main.py",
            origin="runtime",
        ),
    ]

    staged_entries = list(preflight.entries) + runtime_asset_entries + startup_entries
    staged_paths = tuple(sorted({entry.target_rel_path for entry in staged_entries}))

    if mpy_precompile_hook is not None and not dry_run:
        report.precompile = mpy_precompile_hook(
            resolved_modules_path,
            payload.mpy_source_excludes,
            staged_paths,
        )

    metadata_entries = staged_entries
    if report.precompile is not None:
        metadata_entries = _reconcile_entries_after_precompile(
            metadata_entries,
            resolved_modules_path,
        )
    records = []
    if not dry_run:
        records = build_embedded_hash_records(paths=paths, entries=metadata_entries)

    manifest_path, hashes_path = write_embedded_metadata(
        paths=paths,
        payload=payload,
        records=records,
        embedded_manifest_output=embedded_inventory_output,
        dry_run=dry_run,
    )
    write_runtime_embedded_metadata_payload_module(
        paths=paths,
        payload=payload,
        records=records,
        dry_run=dry_run,
    )
    write_runtime_bootstrap_setup_templates_module(
        paths=paths,
        payload=payload,
        dry_run=dry_run,
        constituent_versions=constituent_versions,
    )

    static_asset_entries: list[tuple[str, bytes]] = []
    for rel_path in payload.runtime_files:
        if not rel_path.endswith(".py") and not rel_path.endswith(".mpy"):
            source_file = payload.runtime_root / rel_path
            raw_bytes = source_file.read_bytes()
            static_asset_entries.append((rel_path, raw_bytes))

    write_runtime_embedded_static_assets_module(
        paths=paths,
        asset_entries=static_asset_entries,
        dry_run=dry_run,
    )

    report.static_asset_files_embedded = len(static_asset_entries)
    report.static_asset_raw_bytes = sum(len(b) for _, b in static_asset_entries)
    report.static_asset_compressed_bytes = sum(
        len(zlib.compress(b, level=9)) for _, b in static_asset_entries
    )

    report.embedded_manifest_path = manifest_path
    report.embedded_hashes_path = hashes_path

    return report

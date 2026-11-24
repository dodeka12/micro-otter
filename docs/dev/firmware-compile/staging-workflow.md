# Firmware Staging Workflow (Phase 2)

This document describes the implemented phase-2 staging workflow for firmware-embedded runtime builds.

## Module Location

Python implementation lives under:

- `src/micro_otter/tools/firmware_compile/`

Core modules:

- `staging_paths.py` - target-aware path resolution and validation
- `target_context.py` - `TargetPackageContext`: the one authority for "which package variant may this target stage"
- `package_resolver.py` - node-package index entries, variant selection, and the two package roots (`PackageRoots`)
- `package_versions.py` - the one collector of the versions and frozen variants an image contains
- `staging_resolver.py` - runtime/tools/package manifest resolution
- `staging_preflight.py` - canonical mapping + duplicate-target preflight
- `staging_clean.py` - managed subtree cleanup with safety guard rails
- `staging_copy.py` - deterministic copy pipeline
- `staging_startup.py` - `otter_main.py` + generated `main.py` shim staging
- `staging_metadata.py` - deterministic `otter/embedded_manifest.json` + `otter/embedded_hashes.json` + generated Python constants modules
- `staging_runner.py` - dry-run/full-run orchestration and reporting

## Which variant is staged

`select_variant()` needs three capability predicates. They are built **only** in
`target_context.py`: `build_package_gating_context(target_payload, registry)` derives them from a
target payload and the capability registry, and `load_target_payload(device_root, target_id)` reads
that payload (both public, both tolerant of a missing file). `TargetPackageContext` freezes the
result, and two resolvers construct it:

- `resolve_target_package_context(device_root=…, resolution=…)` — from the
  `CompileTargetResolution` a build already holds, using `allowed_web_target_ids[0]` (the id staging
  reads) and `<device_root>/capabilities`;
- `resolve_target_package_context_for_board(workspace_root=…, device_root=…, runtime_id=…, board=…)`
  — for callers that only hold a board id (staleness). It translates a catalog slug through
  `board_registry.find_board_by_slug()` and degrades to `TargetPackageContext.none()` on an unmapped
  board instead of raising.

`TargetPackageContext.none()` is the unresolved-target context: no `general` capability is
supported, so only variants with no `requiredCapabilities` remain selectable — the historical
`target_payload=None` behaviour. `staging_resolver.resolve_runtime_payload()` builds the context once
and hands it to `_resolve_package_assets()`, which contains no capability logic of its own; the same
context is what `package_versions.collect_package_versions()` uses for the identity, so staging and
identity cannot select different implementations.

## Execution Order

1. Resolve/validate paths (`resolve_staging_paths`)
2. Resolve payload manifests (`resolve_runtime_payload`, including the optional `package_ids` subset)
3. Build canonical staging preflight (`build_staging_preflight`)
4. Abort on conflicts
5. Clean managed subtree (`clean_managed_subtree`)
6. Copy staged files (`execute_staging_copy`)
7. Stage startup contract files (`stage_startup_files`)
8. Run the optional mpy precompile hook (`mpy_precompile_hook`) — skipped on dry-run and on
   conflicts. The hook receives the resolved modules tree, the runtime manifest's `mpySourceExcludes`,
   and the sorted tuple of staged relative paths (preflight entries + runtime assets + startup files),
   so it compiles exactly what staging wrote and never discovers files on its own.
9. Reconcile staged entries after precompile (`_reconcile_entries_after_precompile`)
10. Generate embedded metadata (`build_embedded_hash_records`, `write_embedded_metadata`)
11. Generate Python constants modules (`write_runtime_embedded_metadata_payload_module`, `write_runtime_bootstrap_setup_templates_module`, `write_runtime_embedded_static_assets_module`)

`run_staging` in `staging_runner.py` executes this sequence and supports dry-run mode.

Ordering contract: **staged entries → mpy precompile (staged entries) → embedded hash records →
build**. The precompile hook runs inside staging (before the hash table is written) and is handed the
staged entry list, so `otter/embedded_hashes.json` describes the final module tree and the compile set
never includes MicroPython's own modules in `ports/<port>/modules`. In `compiled-mpy` mode the hook
compiles the staged `.py` modules and deletes their sources, and the reconciliation step swaps those
entries to their `.mpy` siblings — so the hash table lists `otter_stdmo/motor.mpy`, never the deleted
`otter_stdmo/motor.py`. Entries for `mpySourceExcludes` paths (for example `main.py`) keep their `.py`
name because those sources are never compiled or removed.

## Package roots

A package id resolves against **two** roots, in this order:

1. `<device_root>/node_pkgs` — the packages shipped with the application;
2. `<addons_root>/<id>` — node packages the user installed with `mo addons install`
   (`addons_root` is `Config.addons_dir`, default `<home>/addons`).

`PackageRoots` (`package_resolver.py`) is the only module that turns a package entry into a path, so
`staging_resolver` never joins `node_pkgs` itself. Both roots use the same `node_pkgs`-relative
manifest value (`"<id>/manifest.json"`), which is what lets one index entry describe a package in
either root. A built-in id always wins: the add-on index entries whose id a built-in already declares
are dropped, and `mo addons install` rejects a built-in id outright.

`addons_root=None` (the default of every resolver parameter) means "built-in packages only" and
reproduces the pre-add-on staging output byte for byte. Staging never mutates either root: it copies
declared assets into the modules tree and nothing else.

## Inspecting the inventory

`mo node-packages` (alias `mo np`) shows the inventory the resolver walks:
`local_package_scan.py` loads the same `index.json` entries, evaluates the same CNF capability
requirements through `evaluate_requirements`, and reports per package whether this runtime stages it
(`staged`), whether it is listed but gated out (`gatedOut` + `missingCapabilities`), and which
manifest it read. `--sync-local` rewrites only `nodePackages.local` in the runtime manifest, and
`--json-output` emits `build_package_scan_payload` verbatim. The scan is read-only and advisory:
`staged: false` is a firmware-content fact, never a "skip source upload" signal for the collection
deploy path — see [package-selection.md](package-selection.md#what-this-does-not-mean).

## Defaults

- Default MicroPython root: `src/micropython/`
- Target is selectable (for example `esp32`, `rp2`)
- Default modules destination: `ports/<target>/modules/`
- Managed cleanup scope: `tools/`, `libs/`, `otter_runtime/`, `otter_core/`, `otter_webview/`, `otter_stdmo/`, `otter_audio_viper/`, `otter_power/`, `otter_mqtt/`, `otter_vars/`, `otter_led/`, legacy module roots (`otter_audio/`, `otter_otter_audio_viper/`), `app/`, `otter/`, and `main.py` under modules root

## Startup Contract

- Startup module staged at: `otter_main.py`
- Generated deterministic shim at: `main.py`
- Shim content:

```python
try:
    import otter_runtime.bootstrap_setup_startup as _bootstrap_setup_startup
    import otter_main as _micro_otter_main
except Exception as _boot_import_error:
    print("[error] boot: runtime import failed ({})".format(str(_boot_import_error)))
else:
    try:
        _bootstrap_setup_startup.run_bootstrap_setup_from_startup(
            _bootstrap_setup_startup.STARTUP_ADAPTER_TARGET_ENTRYPOINT
        )
    except Exception as _bootstrap_setup_error:
        print("[error] boot: bootstrap setup trigger failed ({})".format(str(_bootstrap_setup_error)))

    _micro_otter_main.run()
```

## Baked device identity

`write_runtime_bootstrap_setup_templates_module()` bakes `CONSTITUENT_VERSIONS` into
`otter_runtime/bootstrap_setup_templates.py`, which the device turns into `device.json` at startup.
When the build recorded the implementations it froze, `constituentVersions.packageVariants` is
included — omitted when empty, exactly like `addonPackages` and `runtimeAssetsVersion` — so a device
can answer "which implementation am I running?" from its own metadata.

## Static Asset Embedding

Non-Python runtime files (e.g. `html/index.html`, `locales/en.json`) cannot be frozen into the MicroPython firmware image as modules. The staging pipeline generates `otter_runtime/embedded_static_assets.py` — a Python constants module containing each asset's bytes zlib-compressed at compile time and decompressed at import time:

```python
EMBEDDED_STATIC_ASSETS: dict = {
    "html/index.html": _zlib.decompress(b"..."),
    "locales/en.json": _zlib.decompress(b"..."),
}
```

At device startup, `apply_bootstrap_setup()` in `embedded_metadata_api.py` imports this module and writes any missing files to the VFS. Files already present on the VFS (e.g. from a dynamic deployment) are skipped.

## Test Coverage

Phase-2 staging coverage is in:

- `tests/test_firmware_compile_staging_models.py`
- `tests/test_firmware_compile_staging_paths.py`
- `tests/test_firmware_compile_staging_resolver.py`
- `tests/test_firmware_compile_staging_preflight.py`
- `tests/test_firmware_compile_staging_clean.py`
- `tests/test_firmware_compile_staging_copy.py`
- `tests/test_firmware_compile_staging_startup.py`
- `tests/test_firmware_compile_staging_metadata.py`
- `tests/test_firmware_compile_staging_runner.py`

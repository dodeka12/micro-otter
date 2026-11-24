# Node Package Selection

Which node packages are frozen into a firmware image, in which order, and how a caller narrows the
set. The code lives in `staging_resolver._select_package_ids` and
`package_resolver` (`PackageRoots`, `load_package_entries`, `select_variant`).

## The three package sources

| Source | Location | Stageable |
|--------|----------|-----------|
| Runtime-declared globals | `nodePackages.global` in `device/runtime/<id>/manifest.json` | yes |
| Installed add-ons | `<addons_dir>/<id>` (see [node-package-addons.md](../nodes/node-package-addons.md)) | yes |
| Runtime-local packages | `device/runtime/<id>/node_pkgs/<id>` | **no** (always `package-not-staged`) |

A package *id* resolves against `device/node_pkgs` first and the add-ons folder second
(`PackageRoots` is the only path join). Duplicate ids are dropped from the add-on side, so a built-in
package can never be shadowed.

## Default selection

`package_ids = None` (no `--package-ids` given) freezes:

```text
global_ids + addon_ids + local_ids
```

- `global_ids` keep their runtime-manifest order.
- `addon_ids` follow in id order (the store's deterministic order).
- `local_ids` keep their declared order at the tail; they are resolved for manifest compilation but
  are **not** stage-eligible, so staging drops them the way it always has.

With no add-ons installed this is exactly `global_ids + local_ids`, i.e. the pre-add-on behaviour.

## Explicit selection

`--package-ids a,b,c` (`CompileRuntimeRequest.package_ids`) narrows the set:

- unknown ids raise `unknown-package-id`, and the hint lists every valid id for the runtime,
  including installed add-on ids;
- a stageable id (`global` or installed add-on) is kept in the caller's order;
- a runtime-local id raises `package-not-staged` with the documented hint.

Selection also feeds the version lineage: `metadata.packageIds`, `metadata.nodePackages` and the
runtime-lineage entry only describe what was frozen. Because the lineage is part of the image
identity, changing the selection produces a new firmware version.

## Capability gating

Selection is not a capability check. Each selected id still goes through
`capability_requirements.evaluate_requirements` against the target payload, and a package whose
`requiredCapabilities` are unsatisfied is excluded with a warning on `staging_report.warnings`.
Add-ons are gated by exactly the same CNF check; there is no exemption and no add-on-specific
capability path.

Variants behave as before: several index entries may declare the same id, the satisfiable one with
the highest manifest `precedence` wins, and a tie raises instead of guessing.

## One authority for the variant decision

The three capability predicates that answer "may this target stage this variant?" come from
`target_context.resolve_target_package_context()` — a `TargetPackageContext` built from the
`CompileTargetResolution` the build already holds, so staging and version collection ask the same
question with the same answer. `TargetPackageContext.none()` is the unresolved-target context (no
general capability is supported), and `resolve_target_package_context_for_board()` is the
slug-to-context entry point staleness uses; it degrades to `.none()` instead of raising on an
unmapped board.

`package_versions.collect_package_versions()` uses that context to record the frozen implementation
of every package: `select_variant()` returning `None` means the image does not contain the package,
so the package is **excluded from the recorded versions and variants without an error**. Staging has
already emitted the `Excluding node package '<id>': missing required capabilities` warning; identity
collection is not a second report, and an image must never claim a package it does not carry.

An explicit `--package-variants pulse=viper` that is unknown or unsatisfiable still raises
(`variant-unknown` / `variant-capabilities-unsatisfied`, exit code `2`): a request that cannot be
honoured must not be silently replaced by the default implementation.

## Packaging mode

`modulePackagingMode` decides whether the staged module tree ships sources or `.mpy` caches. The mode
is a per-build choice (`mo cr --module-packaging-mode`, `CompileRuntimeRequest.module_packaging_mode`,
`compile.start`'s `modulePackagingMode`), and it never changes *which* packages are selected.

| Mode | Behaviour |
|------|-----------|
| `source-py` (default) | Nothing is compiled and no source is removed. |
| `compiled-mpy` | Every staged `.py` is compiled to a sibling `.mpy`; the `.py` is unlinked only after the sibling exists and is non-empty. |

The `compiled-mpy` sequence inside staging is:

1. **Exclude.** The runtime manifest's `mpySourceExcludes` (normalized by
   `mpy_precompile.normalize_mpy_source_excludes`, the same helper `mo compile-mpy` uses) are never
   compiled and never removed. The canonical set keeps the boot path importable by name: `main.py` and
   `app/main_loop.py` stay `.py`, because the boot path imports them by name and the
   collection-preserving deploy path rewrites `app/main_loop.py`.
2. **Compile.** Every other staged `.py` module is compiled to a sibling `.mpy`.
3. **Verify, then remove.** A source is deleted only once its `.mpy` sibling exists and is non-empty; a
   missing or zero-byte sibling raises rather than deleting the only copy.
   `PrecompileResult.sources_removed` is reported as `metadata.mpySourcesRemoved`.
4. **Reconcile.** `staging_runner._reconcile_entries_after_precompile` rewrites staged entries whose
   `.py` target disappeared to their `.mpy` sibling before `build_embedded_hash_records` runs, so
   `embedded_hashes.json` lists `otter_stdmo/motor.mpy` rather than a deleted `.py`.
5. **Hash, then build.** Hash records are written from the tree that actually ships, then the build runs.

So the staging order is **staging → precompile → hash records → build**, and a dry run skips the hook
entirely. The recorded hashes are hashes of the shipped files, which is what lets the deploy classifier
match them. Details: [mpy-precompilation/workflow.md](../mpy-precompilation/workflow.md#mpy-only-firmware-packaging).

## What this does not mean

> **A package that is absent from an image is a firmware-content fact, nothing more.**
>
> `staged: false` in a scan payload, an id missing from `packageIds`, a package gated out by
> `requiredCapabilities`, `--package-ids`, `enable_compile`, `enable_deploy`, `modulePackagingMode`, and
> `source: local` firmware are all statements about *what an image contains*. None of them suppresses
> the node-package **source upload** the web app performs for `missing` and `override-required`
> packages.
>
> That upload is decided and executed by `runtime-deployment.ts` from
> `(node graph, firmware inventory, firmware package versions)` alone. Nothing on this page is an input
> to it. See [deployment-system-architecture.md](../deployment/deployment-system-architecture.md) and
> the authoritative JS gate in `tests/deployment/collection-deployment-*.test.js`.

The practical rule: a deploy can always install source for a package the image does not carry, which is
why a firmware build is never a prerequisite for running a graph. `mo node-packages` reports the same
distinction (`staged: false` = "not in this image").

## Payload keys

| Key | Meaning |
|-----|---------|
| `metadata.packageIds` | The explicit selection, or `null` for "everything stageable". |
| `metadata.packageVariants` | The **effective** `packageId → variantId` map for the frozen packages. |
| `metadata.requestedPackageVariants` | The caller's override map, present only when the request named a variant. |
| `metadata.packageProvenance` | `{"<id>": "builtin" \| "addon"}` for every resolvable id. Cosmetic; never a deploy input. |
| `paths.addonsRoot` | The add-ons folder this run resolved against, or `null`. |
| `staging.conflicts` | Duplicate target paths, naming both sources (an add-on colliding with a built-in module fails the build here). |

## What the web UI sends

The Firmware tab always sends an explicit `packageIds` list: the set of checked, selectable packages.
Local ids (`nodePackages.local`) are never sent because they are not stage-eligible; an empty
selection is refused client-side (the server stages nothing, so the client does not send it). Add-on
ids are sent exactly like built-ins — provenance is cosmetic and is never part of the request.
Capability-unsatisfied packages are disabled in the checklist and therefore never reach `packageIds`.
`nodePackages.optional` only changes the default checkbox state; it does not appear in the request.

See [firmware-build-view-architecture.md](../view-system/firmware-build-view-architecture.md) for the
tab that consumes this selection.

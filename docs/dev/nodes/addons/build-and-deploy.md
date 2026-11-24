# Build & Deploy

Once installed, an add-on participates in the firmware build and the collection deploy exactly like a
built-in package — there is no add-on-specific compile or deploy path.

## Staging

- Selection defaults to `global ∪ addons`; `--package-ids` narrows it, and a runtime-local id still
  fails with `package-not-staged`.
- Staging resolves each id against `device/node_pkgs` first and `<addons_dir>/<id>` second
  (`PackageRoots` is the only path join), then copies the declared `mpAssets` into
  `moa_<id>/…` / `moa_<id>_<variant>/…`. Two sources mapping to the same target path are reported as
  a staging conflict.
- **One variant per id** — `select_variant` stages a single variant's assets, so two variants of the
  same package are never compiled together.
- Stale `moa_*` module roots are cleaned between builds so a base↔variant switch cannot leak files.

## Variant override

`--package-variants "pulse=viper"` (or the `packageVariants` frame field) overrides the
auto-selected variant per id. `--package-variants "pulse=py"` forces the plain MicroPython
implementation instead. The server validates it and rejects an unknown, unsatisfiable, or
unselected override:

- `variant-unknown` — the package has no such variant.
- `variant-capabilities-unsatisfied` — the target cannot satisfy the variant.
- `variant-package-not-selected` — the override names a package not in the selection.

## Device-side `.mpy`

`mo compile-mpy` covers installed add-ons and writes `mpyCompileProfiles` into **every** manifest
(base and variants) atomically; `--skip-addons` reproduces the pre-add-on behaviour exactly.

## Collection deploy

The deploy path is unchanged and never learns about add-on provenance: it classifies a library path
by **module namespace** (`otter_*` / `moa_*` via `js/data/module-namespace.ts`) and, when the image
cannot serve a library, uploads its source with the existing `missing` / `override-required`
fallback. `moa_*` device modules therefore deploy through the normal library path.

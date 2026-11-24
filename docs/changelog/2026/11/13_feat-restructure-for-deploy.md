# Changes since version 1.25.0

## New Features

- **A firmware image's identity names the implementation it froze, not only the versions** — a
  package that ships more than one implementation (`manifest.json` plus `manifest.viper.json`) now
  records the variant the target actually staged, so a `pulse` build that froze `viper` is a
  different image from one that fell back to `py`. The variant map (`packageVariants`) feeds the
  content hash and therefore `fullVersion` and the published filename, travels in the sidecar as
  `schemaVersion: 3` (`metadata.packageVariants` for the outcome, `metadata.requestedPackageVariants`
  for the caller's request), reaches the `firmware.list` payload, is baked into the device's own
  `device.json` (`constituentVersions.packageVariants`), is shown in the Firmware tab as a new
  **Variant** column in the packages table and a `(<variant>)` suffix on the add-ons and tooltip
  lines, and a successful build logs one `info: Packages: id@variant` line. Staleness compares it
  field by field, so switching a variant flips a published image to `contents changed`. The version
  string and the artifact filename never name the variant. The collection `missing` /
  `override-required` source-upload path is untouched.
- **Derived user targets replace the Custom target** — a user target is now a shipped base plus
  sparse overrides (`baseTargetId` + `targetData`) resolved by `resolveUserTargetPayload()`, and it
  builds and validates through the base's mapping rule. The Custom target (`custom.json`, its index
  entry, and the capability-validation bypass) is gone; `generic_micropython` is the "board unknown"
  answer instead.
- **Onboarding is filtered by what the connected board can build** — staging writes
  `target.allowedWebTargetIds` into the device metadata, the host parses it on connect, and the
  Firmware tab, collection settings, and the onboarding dialog offer only those targets. An
  incompatible collection target is refused before upload with `target-not-compatible`, and the
  device-side onboarding predicate enforces the same list.

## Breaking Changes

- **One manifest per package, with a `variants` dict** — the `manifest.<variant>.json` sidecar file
  is removed. `id`, `version`, `nodeDefs`, `generators` and the other header fields are declared once
  in `manifest.json`; each implementation becomes a `variants.<key>` block (`title`/`description`/
  `hardware`/`mpAssets`/`requiredCapabilities`/`precedence`). An add-on archive that still ships
  `manifest.<variant>.json` is rejected at install with `addon-layout-legacy-variant-manifest`.
  Migration: rename `manifest.<v>.json` to a `variants.<v>` block and keep `id`/`version`/`nodeDefs`/
  `generators` at the top level.
- **Variant selection is explicit** — a build of a package that ships more than one variant now
  requires an explicit choice (`--package-variant id=name`, the `packageVariants` frame field, or the
  picker); without one it fails with `variant-not-selected`. The `(auto)` picker option is gone, and
  `precedence` orders the picker rather than auto-selecting.
- **The Custom target is removed** — `custom.json` and its `targets/index.json` entry are deleted,
  and the `custom` branch in `isCustomTargetSelection()` and the device-deployment compatibility
  checks are dropped. An imported payload carrying `metadata.isCustomTarget` is rejected
  (`ERR_TARGET_CUSTOM_DEPRECATED`). User targets now declare `baseTargetId` (a shipped target, no
  chains, no `custom`) plus sparse overrides.

## Refactor

- **One target-package context and one package-version collector** — staging, identity collection
  and the firmware menu now share `TargetPackageContext` (`firmware_compile/target_context.py`) and
  `collect_package_versions()` (`firmware_compile/package_versions.py`), so a package with two
  variants no longer fails a build after ESP-IDF ran or breaks the menu's status column. A `null`
  variant set still produces a byte-identical v2 payload, so existing images keep their names and
  their sidecars keep verifying.
- **The image records the add-ons it froze** — `device.json` now carries
  `constituentVersions.frozenAddons` (`{ id: { variant, version } }`), and the deploy plan trusts it,
  so a frozen add-on (`pulse`, `hello`) is no longer reported as "not bundled in firmware" and its
  source is not re-uploaded. The collection `missing` / `override-required` source-upload path is
  untouched.

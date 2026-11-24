# Changes since version 1.25.0

## New Features

- **Named node-package variants.** Every node package row in the Firmware tab now shows a variant
  name — `Py` for the default implementation, `Viper` for the audio package's only implementation, or
  an author-declared `variantTitle` — with its description as a tooltip. A single-implementation
  package renders a static badge instead of an empty label, and a multi-variant package keeps the
  `(auto)` dropdown.

## Bug Fixes

- **The default implementation is selectable.** `packageVariants: {pulse: "py"}` (or
  `--package-variants "pulse=py"`) now forces the plain MicroPython implementation on a
  `viper`-capable target, and a multi-variant package's default row is no longer blank.

## Improvements

- **Add-ons name their default implementation.** A base `manifest.json` may declare
  `variantTitle`/`variantDescription`; `variant` stays forbidden there, and the reserved id `py` is
  refused and warned about. The shared `DropdownControl` gained per-option and per-value tooltips.
- **Audio is honestly labelled.** The audio package's manifest is now `manifest.viper.json`,
  matching the only implementation it actually ships.
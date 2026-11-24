# Changes since version 1.25.0

## New Features

- **Shipped targets may derive from a base, resolved by one chain walker** — a shipped target file
  can now declare `baseTargetId` plus a delta-only `targetData`, the same shape M4w gave user
  targets. One `TargetResolver` (`js/data/target-resolver.ts`, mirrored by
  `firmware_compile/target_resolution.py`) walks the chain (shipped and user hops) to an effective
  payload plus a terminal **build base id**, with guards for unknown bases, cycles, chain depth, and
  duplicate `openPins`; `metadata.notes` concatenates base-first so a derived file never repeats its
  base's notes. `esp32_s3.json` is now the chip-level base and `esp32_s3_mini.json` is a delta over
  it — the 45-pin S3 map exists exactly once.
- **A firmware image records its single build base id** — `target.buildBaseTargetId` replaces an
  enumerated `allowedWebTargetIds` list as the compatibility key. The host resolves a collection or
  device target through its chain and compares base ids (`target-compatibility.ts`); pre-M4x images
  are covered by expanding their legacy `allowedWebTargetIds` through the resolver, then by board
  comparison, then "allow". `allowedWebTargetIds` is still emitted for one release but is no longer
  the authority.
- **Derived configs need no mapping rule** — `compile_target_mappings.json` keeps one rule per
  **base** id, and `resolve_web_target()` falls back to chain resolution so `esp32_s3_mini` still
  resolves to `ESP32_GENERIC_S3` without its own rule.
- **The device receives the effective payload** — `_uploadTargetConfiguration` writes the resolved
  plain payload (with a real `pinCapabilities` map, no `capabilityRegistry` internals) to
  `active_target.json`, and package-variant gating now reads the build base's effective payload.

## Breaking Changes

- `getUserTargetBaseTargetId` is renamed `getTargetBuildBaseId` and returns the terminal build base
  id; callers updated.
- `esp32_s3_mini.json` no longer contains a pin map (it derives from `esp32_s3.json`); the
  `compile_target_mappings.json` rule id changed from `esp32-s3-mini-default` to `esp32-s3-default`
  with `webTargetId: "esp32_s3"`.

## Notes

- The collection `missing` / `override-required` source-upload path and the `tests/deployment/`
  suite are unchanged.

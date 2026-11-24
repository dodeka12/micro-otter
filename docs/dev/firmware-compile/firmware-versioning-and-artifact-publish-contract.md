# Firmware Versioning and Artifact Publish Contract

**Status:** Active
**Last Updated:** 2026-11-10
**Scope:** Publish-side contract for the tag-derived version scheme introduced by M4j.
The identity rules live in [firmware-identity.md](firmware-identity.md); this page documents
what a publish writes and where.

## Purpose

Define the shipped publish behavior for:

1. Resolving one build identity (version, channel, content hash) per compile.
2. Publishing an artifact and its v2 sidecar manifest.
3. Appending one build-history record (never rewriting the committed registries).
4. Deriving the device/client visibility from the composed registry.

## Canonical files

- Identity: `src/micro_otter/tools/firmware_compile/version_identity.py`,
  `version_semver.py`, `build_identity.py`, `content_identity.py`
- History: `src/micro_otter/tools/firmware_compile/firmware_history.py`
- Registries: `src/micro_otter/nodes/device/firmware/latest_versions.json` (v2),
  `src/micro_otter/nodes/device/firmware/runtime_lineage.json` (v3)
- Release manifest: `src/micro_otter/nodes/device/firmware/release.json`
- Publish integration: `src/micro_otter/tools/firmware_compile/compile_command.py`

## One identity, three consumers

`resolve_build_identity()` computes the identity tuple once and hands it to the pre-build
publish guard, the `device.json` constituent bake, and the final publish step, so a build can
never reserve one file name and publish another. The publish filename is derived inside the
resolver (`<repo>-<fullVersion>.bin`); publishers use `identity.filename`, never re-derive it.

## Artifact publish

After a successful compile and artifact verification:

1. Publish to the resolved firmware publish root (`MICRO_OTTER_FIRMWARE_DIR` /
   `micro-otter.toml` → documented system fallback), prepared through
   `local_firmware.ensure_publish_root()`.
2. Filename: `<repo>-<micropython>-<board>-<runtime>-<version>[-<contentHash>].bin`.
3. Collision behaviour: same hash is idempotent (`already-present`); a different hash fails
   the verification path.
4. Publish the `<stem>.manifest.json` sidecar (v2 or v3, see
   [backend-compile-interface-contract.md](backend-compile-interface-contract.md) and
   [firmware-identity.md](firmware-identity.md)).

Both import paths prepare the root through `local_firmware.ensure_publish_root()`, while
`resolve_publish_root()` only *resolves* it: `ensure_publish_root` resolves, creates a missing folder
with `mkdir(parents=True, exist_ok=True)`, and proves it writable with `os.access`, raising
`OSError` (path in the message, original error chained) for the caller to map into its own error
family — `firmware-import-denied` for both imports, which is why a missing or read-only publish root
now has exactly one behaviour and one message there. The compile publish path keeps its own
create-before-copy step.

The **variant never appears in the version string or the filename**. It lives in the top-level
`packageVariants` map of the content hash and of the v3 sidecar, so existing artifact names,
the publish deduplication (identical hash ⇒ `already-present`) and every filename parser keep
working unchanged; a variant change simply produces a different hash and therefore a
different name through the existing scheme.

Compile payload updates:

- `paths.firmwarePublishedArtifact`
- `paths.firmwareHistory` (replaces the former `paths.latestVersionsRegistry`)
- `metadata.runtimeFirmwareVersion`, `metadata.fullVersion`, `metadata.contentHash`
- `metadata.versionSource`, `metadata.gitSource`
- `metadata.packageVariants` (the effective map) and `metadata.requestedPackageVariants`
  (only when the request named a variant)
- `metadata.firmwarePublishStatus`

## Build history

`append_firmware_history()` writes one record per published image to
`<publish_root>/firmware_history.json` (schema v1). Rebuilding the same image replaces its
record instead of appending a duplicate; writes are atomic. A build never writes to
`latest_versions.json` or `runtime_lineage.json` — those are baselines only release tooling
writes, and the device app reads `compose_latest_versions(committed, history)`.

## Device and UI visibility

- `DeviceConnection` stays the canonical metadata reader; the catalog fallback prefers
  `channels.release`, then `channels.dev`, then the v1 flat entry.
- The Firmware tab labels an image `dev`/`release`, marks the newest image of each channel,
  and warns when the selection does not match the newest published image of the channel.

## Validation references

- `tests/test_firmware_version_semver.py`
- `tests/test_firmware_version_identity.py`
- `tests/test_firmware_version_agreement.py`
- `tests/test_firmware_build_identity.py`
- `tests/test_firmware_content_identity.py`
- `tests/test_firmware_registry_migration.py`
- `tests/test_firmware_history.py`
- `tests/test_firmware_compile_command.py`


# Firmware Identity

Canonical reference for what a firmware version means, how it is derived, and what
`contentHash` names. Every other page links here rather than restating the rules.

- **Grammar:** `src/micro_otter/tools/firmware_compile/version_semver.py`
- **Derivation:** `src/micro_otter/tools/firmware_compile/version_identity.py`
- **Composition:** `src/micro_otter/tools/firmware_compile/content_identity.py`

## Grammar

A firmware version is a plain `X.Y.Z` base plus an optional pre-release and an optional
build-metadata tail (`version_semver.VERSION_RE`):

```text
<major>.<minor>.<patch>[-<prerelease>][+<build>]
```

- `major`/`minor`/`patch` are non-negative integers with no leading zeroes.
- `prerelease` and `build` are dot-separated identifiers of `[0-9A-Za-z-]`, non-empty.
- Legacy 4-segment names (`0.22.0.3`) parse but are not produced anymore.

## Derivation table (locked decision 2)

| Situation | Version | `versionSource` |
|-----------|---------|-----------------|
| `HEAD` is a `firmware-v<base>` tag | `<base>` | `git-release-tag` |
| `n` commits past the newest reachable tag | `<base>-dev.<n>.g<sha7>` | `git-dev` |
| Git reachable but no `firmware-v*` tag | `<release.json base>-dev.0.g<sha7>` | `no-tag-dev` |
| No git at all, `release.json` present | `<release.json base>` | `no-git-release-file` |
| `MICRO_OTTER_FIRMWARE_VERSION` set and valid | the override | `override-env` |

A tag whose base disagrees with `release.json.releaseVersion` raises
`ReleaseManifestBaseMismatchError`; a build with no git and no `release.json` raises
`FirmwareVersionUnresolvedError`.

`legacy-lineage` is a **registry-only** sentinel used when the pre-M4j lineage data is
migrated into the v2/v3 registries. It never describes a live build.

## Channels

The channel is always derived from the version string by `channel_of()`: a pre-release is
`dev`, anything else is `release`. `release.json` carries `kind` (`stable`/`prerelease`) as
release metadata only — it is never the source of the channel, so the two cannot disagree.

**Only the version string changes per channel — never the hash.** The content hash names
composition and must be identical for a release and a dev build of the same sources.

## Content hash

`firmware_content_hash()` hashes exactly (schema v2):

- `slug`, `backend`, `platformVersion`, `runtimeId`
- `constituents` (runtime-source / device-tools / runtime-assets)
- `embeddedPackages`, `addonPackages`
- `selection` (`packageIds` sorted, `packageVariants` sorted, `modulePackagingMode`,
  `optimizationLevel`)

A producer that knows which implementation of each package was frozen passes
`package_variants=` — the **effective** `packageId → variantId` map. The payload then
becomes schema v3 and gains one top-level key:

```json
"packageVariants": { "pulse": "viper" }
```

- `selection.packageVariants` is the **request** (what the caller asked for);
  the top-level `packageVariants` is the **outcome** (what staging froze). Only the
  latter may describe an image, so a request the target could not honour never reads
  as an outcome.
- `package_variants=None` keeps the v2 payload **byte-for-byte** identical — no key is
  added — so every existing `contentHash` still verifies and keeps its name. An
  empty-but-not-`None` map is a deliberate v3 record (`"packageVariants": {}`).
- The map is sorted before hashing, so key order is irrelevant.

The identity tuple of an image is therefore `boardId`, `runtimeId`,
`micropythonVersion`, `packageVersions` (built-ins + add-ons) and `packageVariants`:
**a variant is part of who you are, so it is part of the identity.** A `pulse` build
that froze `viper` and one that fell back to `py` differ in `contentHash`,
`fullVersion` and therefore in the published filename.

**Never hashed:** `runtimeFirmwareVersion`, `versionSource`, `gitSource`, `finishedAt`,
`fileHashes`, and any filesystem path. Same composition at a different commit keeps the
same name; changing an add-on (or its version) changes it.

Digest: SHA-256 of the JSON (`sort_keys=True`, `separators=(",", ":")`) truncated to 12 hex
characters.

## Imported images

A stock MicroPython `.bin` is not built by Micro Otter, yet it still needs a published identity to be
listed, deployed, and flashed. `firmware_compile/imported_firmware.py::import_firmware_binary()`
synthesizes one rather than inventing a second naming scheme:

- **Grammar:** the normal full name with the imported runtime id and a placeholder runtime firmware
  version — `<micropython>-<board>-imported-0.0.0-<contentHash>.bin` — composed by
  `format_full_firmware_version()`, so every existing parser, the inventory, and deploy resolve it
  unchanged.
- **Runtime id `imported`** keeps imported images in their own `(boardId, runtimeId)` group. They
  never compete with a built image for `isLatest` and never become the deploy default.
- **Placeholder version `0.0.0`** carries no meaning. **The content-hash segment is the
  discriminator:** it is the first 12 hex characters of the image's SHA-256, so identical bytes
  re-import idempotently as `already-present`, while two different stock images of one board coexist
  as two names.
- **`micropythonVersion`** is the first semver-shaped triple in the source filename
  (`esp32-20240602-v1.23.0.bin` → `1.23.0`), falling back to `0.0.0`. It is a hint, never a
  contract, and it never raises.
- **Sidecar:** a synthesized `<stem>.manifest.json` carrying `slug`, `runtime.id`,
  `runtimeFirmwareVersion`, `micropythonVersion`, `originalFilename`, `targetId`,
  `source: "imported-binary"`, `sha256`, `importedAt`, plus empty `embeddedPackages` and
  `notEmbedded`. It deliberately omits `schemaVersion` **and** `contentHash`: nothing is known about
  the image's composition, so the inventory reports `identity_complete: false` ("details
  unavailable") instead of describing contents that were never recorded, and the package verifier is
  never armed with a composition hash that describes nothing. `slug`, `runtime.id` and
  `runtimeFirmwareVersion` still agree with the filename, so an exported-then-re-imported package
  passes the package verifier unchanged.

**Never hashed and never inferred:** the platform. `targetId` decides the flash path, so it is
recorded as provenance only; the Micro Otter runtime and the device-target configuration are
installed later, on the connected device.

## Sidecar schema versions

- **v2** — the pre-M4u record; no `packageVariants` key anywhere.
- **v3** — `schemaVersion: 3` with a top-level `packageVariants` map, written by a build
  that recorded its frozen variants. `metadata.packageVariants` carries the same map and
  `metadata.requestedPackageVariants` carries the request, so both facts are visible in
  the compile payload.
- `mo firmware package` re-hashes **both** versions: a v3 sidecar is verified against its
  recorded map, so editing `packageVariants` is rejected with
  `firmware-package-identity-mismatch`.
- Older sidecars are never rewritten or invalidated; they keep verifying and simply
  report an empty variant map to the inventory.

## History record

A published build's `firmware_history.json` record carries `packageVariants` next to
`addonPackages`, plus `selection` (which repeats the request). The baked `device.json`
carries the same map as `constituentVersions.packageVariants`, omitted when empty, so the
device can answer "which implementation am I running?" from its own metadata.

## `release.json`

Committed at `src/micro_otter/nodes/device/firmware/release.json`:

- `schemaVersion: 1`
- `releaseVersion` — plain `X.Y.Z` (no pre-release/build); this is the base.
- `kind` — `stable` or `prerelease` (metadata only).
- `releasedAtUtc` — ISO-8601 with a `Z` suffix, or `null` (filled by the follow-up commit).
- `tag` — exactly `firmware-v<releaseVersion>`.

## Registries and history

- `latest_versions.json` (schema v2): per-target `channels.release` / `channels.dev`.
- `runtime_lineage.json` (schema v3): channel / hash / version-source / add-ons per entry.
- `firmware_history.json` (publish root, schema v1): append-only build records; the device
  app reads `compose_latest_versions(committed, history)`.

## What not to do

- Never move or delete a `firmware-v*` tag — the tag *is* the release.
- Never invent a `-0` suffix or a fake commit hash.
- Never add the commit, version, or timestamp to the content hash.
- Never hand-edit a published `firmware-manifest.json`.
- Never write to the committed registries from a build — only release tooling does.

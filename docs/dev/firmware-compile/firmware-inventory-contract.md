# Firmware Inventory Contract

The server-side authority for "which firmware images exist locally and which one is the newest per
target". It backs the `firmware.list` / `firmware.delete` frames of `WS /firmware`; the web app
renders this payload and never picks a newest file or orders images itself.

- **Module:** `src/micro_otter/tools/firmware_compile/firmware_inventory.py`
- **Implementation:** `src/micro_otter/tools/firmware_compile/firmware_ws_handler.py`
- **Tests:** `tests/test_firmware_inventory.py`, `tests/test_firmware_ws_handler.py`

## Scope and boundaries

- **Read-mostly, filesystem-only.** `list` reads the publish root; `delete` is the single write and
  only ever removes an image (`.bin`) and its sidecar inside the publish root.
- **Never touches node-package source upload.** Inventory and delete carry an image path only; the
  collection-deploy `missing` / `override-required` source-upload path and `tests/deployment/`
  coverage are independent of this module.
- **No caching.** Each list is a handful of directory reads; a cache would go stale the moment a
  build publishes a new image.

## Publish root

Resolved through `local_firmware.resolve_publish_root` (`MICRO_OTTER_FIRMWARE_DIR` /
`micro-otter.toml` → documented system fallback), so the inventory always reads the same folder as
image lookup and deploy.

## Listing

`list_firmware_inventory(publish_root=None) -> list[FirmwareInventoryEntry]`

- Iterates the publish root, skips anything that is not a `*.bin` file, and parses each name with
  `local_firmware.parse_firmware_filename` (both the legacy four-segment and the five-segment
  content-hash forms parse; unparsable names are skipped).
- Reads the `<stem>.manifest.json` sidecar tolerantly: a missing, unreadable, invalid-JSON, or
  non-object sidecar yields `has_manifest=False` and empty `embeddedPackages`/`notEmbedded`.
- Sorts deterministically: `(boardId, runtimeId)` ascending, then runtime firmware version
  descending via `firmware_version_sort_key`.

## `isLatest`

`latest_firmware_ids(entries)` returns `(boardId, runtimeId) -> path` using
`firmware_version_sort_key`, the same key `resolve_latest_firmware_for_board` uses, so image lookup
and the inventory can never disagree. The list payload's `isLatest` is therefore always the server's
answer; a client never computes it.

## Payload schema (`firmware.list` result, v2)

```json
{
  "schemaVersion": 2,
  "publishRoot": "/opt/micro_otter/firmware",
  "entries": [
    {
      "path": "/opt/micro_otter/firmware/micro-otter-1.27.0-esp32-general-1.0.1-dev.7.gabc1234-0123456789ab.bin",
      "filename": "micro-otter-1.27.0-esp32-general-1.0.1-dev.7.gabc1234-0123456789ab.bin",
      "boardId": "esp32",
      "runtimeId": "general",
      "micropythonVersion": "1.27.0",
      "runtimeFirmwareVersion": "1.0.1-dev.7.gabc1234",
      "contentHash": "0123456789ab",
      "sizeBytes": 1048576,
      "modifiedAt": "2026-11-10T09:30:00+00:00",
      "hasManifest": true,
      "embeddedPackages": {"core": "1.0.0"},
      "notEmbedded": [],
      "addonPackages": {"hello": "0.2.0"},
      "packageVariants": {"pulse": "viper"},
      "selection": {"packageIds": ["core"]},
      "channel": "dev",
      "versionSource": "git-dev",
      "isPrerelease": true,
      "isLatest": true,
      "source": "imported-binary",
      "targetId": "esp32",
      "originalFilename": "esp32-20240602-v1.23.0.bin"
    }
  ],
  "latestByChannel": {
    "esp32:general": {
      "release": "/opt/micro_otter/firmware/micro-otter-1.27.0-esp32-general-1.0.0-0123456789ab.bin",
      "dev": "/opt/micro_otter/firmware/micro-otter-1.27.0-esp32-general-1.0.1-dev.7.gabc1234-0123456789ab.bin"
    }
  }
}
```

- `channel` / `versionSource` / `isPrerelease` are additive and populated from the parsed
  filename and, when a v2 or v3 sidecar exists, its `version` object; a v1 payload omits them and
  the client decodes `channel: ""`, `versionSource: null`, `isPrerelease: false`.
- `addonPackages` is populated from a v2 or v3 sidecar; a v1 sidecar yields `{}`.
- `packageVariants` is a `packageId → variantId` string map, **absent/empty for a v2 sidecar** (an
  image that never recorded its variants is never described as if it had). It is `{}` for an image
  with no frozen variants, never `null`. `identity_complete` accepts a v3 sidecar exactly like a v2
  one, so the view does not fall back to "details unavailable" for a new build.
- `selection` mirrors the v2 sidecar's `selection` (notably `packageIds`); a v1 sidecar yields
  `{}`. A non-empty `selection.packageIds` alone is **not** a subset signal: the web UI always
  sends an explicit list, so a full build records every package too, and staging may drop ids from
  it. The `complete` / `partial` badges are decided client-side by
  `firmwarePackageCoverage()` from what the image *froze* — `embeddedPackages` plus
  `addonPackages` — compared against the *built-in* packages the current target can embed
  (`FirmwarePackagesPanel.availablePackageIds()`): `complete` when the contents cover every one of
  them, `partial` when at least one is missing. An embedded add-on is extra content, never a gap —
  the row reports add-ons with their own badge. No badge is shown while that catalog is unknown or
  the sidecar lists no packages.
- `latestByChannel` is keyed by `<boardId>:<runtimeId>` and maps each channel to the newest
  image path in that channel. `isLatest` stays the newest-across-channels answer.
- `source` / `targetId` / `originalFilename` are **additive import provenance**:

  | Field | Imported binary | Build image |
  |-------|-----------------|-------------|
  | `source` | `"imported-binary"` | `""` |
  | `targetId` | the platform the import was requested for | `null` |
  | `originalFilename` | the name the file arrived under | `null` |

  They come from the sidecar and are never inferred from the filename, so a sidecar that is missing,
  records no such key, or stores a non-string or empty value yields the build-image values instead of
  an error. The payload `schemaVersion` stays `2` — the keys are additive and the client tolerates
  their absence.

## Staleness comparison (`mo firmware menu`)

`staleness.check_firmware_staleness()` compares the current sources with the newest published
image per board and renders the status column of the firmware menu:

- The **current constituents** come from `collect_current_constituent_versions()`, which uses the
  same `collect_package_versions()` the build uses. `nodePackages` stays built-ins only, add-ons
  are reported in `addonPackages`, and the frozen implementations in `packageVariants`, so
  installing, upgrading or removing an add-on — or changing which variant a target selects —
  changes the comparison.
- The context is resolved **per board** through
  `resolve_target_package_context_for_board()`, because two boards with different capabilities can
  freeze different variants of the same package; results are memoized per normalized board id.
- A `schemaVersion: 3` sidecar is compared **field by field** (`constituents`,
  `embeddedPackages`, `addonPackages`, `packageVariants`) and never through its `contentHash`: a
  hash written by an older variant-blind build cannot prove variant equality.
- A v2 sidecar keeps the hash-first behaviour, and a lineage entry that does not record the new
  keys is treated as "not recorded" rather than a mismatch, so older images report the statuses
  they always did. `artifact-missing` still overrides `up-to-date`.

## How the Firmware tab reads the payload

`firmware-inventory-panel.ts` renders one row per same-target image and marks only two
compatibility states with a glyph: `compatible` (the image supplies everything the *active
collection* needs — drawn as a tick) and `unknown` (no sidecar, so the contents cannot be checked,
drawn as a question mark). The tick reads the contents the same way every other badge does, as the
union of `embeddedPackages` (built-ins) and `addonPackages` (add-ons): a needed add-on is in the
image, but a v2 sidecar never lists it under `embeddedPackages`, so reading only that map would
withhold the tick from a freshly built image. The sidecar's `selection.packageIds` is the *request*,
not the result, and is not consulted for the tick either.

What an image is judged *against* is the collection, not the build checklist. The build selection and
the collection's needs are two different sets, and the payload contract keeps them apart:

| Question | Input | Type | Answer |
|---|---|---|---|
| Can this image run my collection? (row tick, Deploy banner) | packages the active collection needs, resolved from its node types | `FirmwareCompatibilityContext.requiredPackageIds` | `classifyFirmwareCompatibility()` |
| Is there already an image for the next build? (Build Firmware line) | ticked checklist entries | `FirmwareSelection.packageIds` | `findFirmwareSelectionMatch()` |

Comparing images with the checkboxes made a `Minimal` build unusable: that build embeds only what the
collection uses, while the checklist keeps every installed add-on ticked, so no image could ever earn
a tick again. Both the tick and the **Minimal** button resolve the requirement through one function,
`FirmwarePackagesPanel.collectionPackageIds()`, so the button and the tick cannot drift apart. A
collection that needs no package draws no marker at all — every image would qualify, so a tick on all
of them would carry no information. A third state, `incomplete`, exists in
`classifyFirmwareCompatibility` for the Deploy group's "this image does not embed: …" banner but
renders no marker in the list, so the traffic-light confusion of three similar glyphs is gone.

The inventory rows are re-judged when the collection changes: the view subscribes to the active
collection's `node-added` / `node-removed` graph events, because those are the only edits that can
change which packages are needed.

Independently of the tick, each row states its package coverage as a moon-phase pair: the filled
circle marks a `complete` image (it freezes every package the target can embed) and the half circle
marks a `partial` one (a subset build). The two badges are mutually exclusive by construction.

The Build Firmware group answers the complementary question — "does a firmware for this selection
already exist?" — through `findFirmwareSelectionMatch()`: the image whose manifest embeds every
ticked id (built-in in `embeddedPackages`, add-ons in `addonPackages`), preferring an exact
package-set match, then `isLatest`. That line is hidden until a `firmware.list` result has been
read, so an unknown inventory never claims "no firmware exists".

## Delete

`delete_firmware_entry(path, publish_root=None) -> {"removed": [...], "absent": [...]}`

- Resolves the target path and requires it to live inside the resolved publish root. A path outside
  the root raises `FirmwareInventoryError` with code `firmware-path-invalid` (a traversal attempt).
  The same rule is `resolve_inventory_image`, which `firmware.export` reuses, so delete and export
  can never disagree about which paths are inside the publish root.
- Removes the `.bin` and its `<stem>.manifest.json` sidecar (a missing sidecar is ignored).
- A missing image is reported through `absent` rather than raised, so a double-delete is not an
  error. `firmware-not-found` is reserved in the error table for forward compatibility and is not
  emitted by delete today.

## Packages

A published image can be moved between publish roots as a `.firmware.zip` package (image + sidecar +
descriptor). See [firmware-packages.md](firmware-packages.md). Importing lands a verified image in
the publish root — exactly the files `list` already reads — so an imported image appears in the next
`firmware.list` with no extra metadata. `boardKnown` in the import result is `False` when the
image's board slug is not in the board catalog; the import still succeeds.

## Error codes

| Code | Meaning |
|------|---------|
| `firmware-path-invalid` | Delete/export path escapes the publish root. |
| `firmware-not-found` | Reserved; delete reports a missing image via `absent`. |
| `firmware-package-invalid` | The imported archive is not a valid `.firmware.zip`. |
| `firmware-package-identity-mismatch` | The package filename and sidecar disagree, or the sidecar `contentHash` no longer recomputes. |
| `firmware-package-checksum-mismatch` | The image SHA-256 does not match the descriptor. |
| `firmware-package-too-large` | The archive exceeds the 4 MiB cap. |
| `firmware-import-exists` | An import would overwrite a different image with the same name. |
| `firmware-import-invalid` | A binary import source is not an acceptable `.bin` (wrong suffix, empty, above the size cap). |
| `firmware-import-denied` | The publish root cannot be created or written. |

The `firmware.delete` and `firmware.import` frames are gated on the `firmware-compile` capability
and answer `compile-disabled` when it is absent (the producer owns the publish root).

## Imported images in the client

`js/firmware/firmware-inventory.ts` mirrors the imported identity with two constants —
`IMPORTED_RUNTIME_ID = 'imported'` and `IMPORTED_SOURCE = 'imported-binary'` — and one predicate,
`isImportedFirmware(entry)`, which is true when either the runtime id or the `source` marker matches.
That predicate drives three rules: an imported image is listed **by board only** (its `imported`
runtime never matches a build runtime, so the section filter accepts it for the matching board),
`classifyFirmwareCompatibility` reports `unknown` for an imported image on the matching board
(never `otherTarget`), and `firmwareChannelBadge` returns `null` so the `0.0.0` placeholder version
is never drawn as a `release`. The three provenance keys decode tolerantly — `source` falls back to
`''` and `targetId` / `originalFilename` to `null` — so a payload from an older server decodes
without throwing.


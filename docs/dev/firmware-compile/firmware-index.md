# Release Asset Index

`tools/make_release_index.py` turns a directory of exported firmware artifacts into the two
descriptions a GitHub Release needs: `index.json` (one machine-readable entry per board, with
absolute asset URLs, SHA-256 and size measured from the bytes on disk) and `release-notes.md` (the
release body, built from the same in-memory document).

Both files are **build output of the maintainer's machine**. Nothing under `src/micro_otter/` reads
them, no CI job runs the script, and no server route serves them: importing an image keeps using the
paths that already exist — the Firmware tab's **Import** / **Import from URL…** dialogs and
`mo fw import --url`. The script exists so the release body, the checksum list and (later) a hosted
page all come from one description of the same bytes, instead of three hand-maintained copies.

## Command

```bash
uv run python tools/make_release_index.py \
  --release-dir dist/release-1.0.0 \
  --base-url https://github.com/<owner>/micro-otter/releases/download/firmware-v1.0.0
```

| Option | Default | Meaning |
|--------|---------|---------|
| `--release-dir` | *(required)* | Directory holding the exported assets, e.g. `dist/release-1.0.0` |
| `--base-url` | *(required)* | Absolute `https://` prefix every asset URL is built from; no host is defaulted |
| `--out` | `<release-dir>/index.json` | Written document |
| `--notes-out` | `<release-dir>/release-notes.md` | Written release body |
| `--release-json` | the in-tree `release.json` | Source of `release.version` / `tag` / `kind` |
| `--channel` | `release` | Required channel of every entry |
| `--check` | off | Regenerate in memory and compare both files; exit `1` on drift, never write |

The directory must hold, per board, a published `<stem>.bin`, its `<stem>.manifest.json` sidecar and
the exported `<stem>.firmware.zip`. The runbook
([docs/workflow/release.md](../../workflow/release.md)) is the procedure that produces them; this page
is the contract of what the script accepts and writes.

## The document

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-26T00:00:00Z",
  "generatedBy": { "name": "micro-otter", "version": "1.43.0" },
  "release": { "version": "1.0.0", "tag": "firmware-v1.0.0", "kind": "stable" },
  "firmware": [
    {
      "board": "esp32",
      "boardName": "ESP32 (WROOM / generic)",
      "chip": "esp32",
      "flashOffset": "0x1000",
      "runtime": "general",
      "version": "1.0.0",
      "channel": "release",
      "micropythonVersion": "1.26.0",
      "sha256": "<64 hex>",
      "size": 1468928,
      "url": "https://example.invalid/firmware-v1.0.0/<stem>.bin",
      "package": {
        "sha256": "<64 hex>",
        "size": 1503221,
        "url": "https://example.invalid/firmware-v1.0.0/<stem>.firmware.zip"
      },
      "includedPackages": { "core": "1.29.0" }
    }
  ]
}
```

Root fields:

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `schemaVersion` | integer | yes | Always `1` for this shape |
| `generatedAt` | string | yes | ISO-8601 UTC instant with a `Z` suffix |
| `generatedBy` | object | yes | `name` and the `micro-otter` version that wrote the file |
| `release` | object | yes | `version`, `tag` and `kind` copied from `release.json` |
| `firmware` | array | yes | One entry per board, ordered by `(board, version, sha256)` |

Entry fields:

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `board` | string | yes | Board slug from the image filename (`esp32`, `esp32_generic_s3`, `esp32_generic_s2`) |
| `boardName` | string | yes | `displayName` from `boards.json` |
| `chip` | string | yes | `chip` from `boards.json` (`""` when the catalog omits it) |
| `flashOffset` | string | yes | `flash.offset` from `boards.json`, as the catalog spells it (`"0x1000"`, `"0"`) |
| `runtime` | string | yes | Runtime id from the image filename (`general` today) |
| `version` | string | yes | Runtime firmware version; must equal `release.json` → `releaseVersion` |
| `channel` | string | yes | `release` or `dev`; must equal `--channel` |
| `micropythonVersion` | string | yes | MicroPython version from the image filename |
| `sha256` | string | yes | SHA-256 of the `.bin` bytes, computed from the file |
| `size` | integer | yes | Size of the `.bin` in bytes |
| `url` | string | yes | Absolute URL of the `.bin` |
| `package` | object | yes | `sha256`, `size` and `url` of the `.firmware.zip`, hashed from the file |
| `includedPackages` | object | yes | Embedded plus add-on packages, keyed by package id |

The writer validates both key sets (`_DOCUMENT_KEYS`, `_ENTRY_KEYS`, `_PACKAGE_KEYS`) and refuses a
document that differs, so the generator cannot drift from the tables above without an edit here.


## Why absolute URLs and a required `--base-url`

The generator cannot guess where the assets will live, so the flag is mandatory and never defaulted.
Making it optional would be the one change that lets an `index.json` full of bare file names through:
such a document parses, lists the right boards, and resolves to nothing for every reader. Only an
absolute `https://` prefix is accepted — the release page serves assets over TLS — and trailing
slashes are normalized away before `f"{base}/{filename}"` is built.

## Why both artifacts

`mo fw export` writes a package whose sidecar preserves `fullVersion`, the embedded package
inventory and the shadow gate; a bare `.bin` imports as the placeholder `imported` runtime with
`identity_complete=False` and an empty package list. The release therefore offers both and recommends
the package:

| Artifact | Import route | What survives the import |
|----------|--------------|--------------------------|
| `<stem>.firmware.zip` | `firmware.import`, `mo fw import <file>` / `--url` | Version, package inventory, verified SHA-256 |
| `<stem>.bin` | `firmware.import-binary` | The image only; identity is incomplete |

An unpaired artifact — a `.bin` without its `.firmware.zip`, or a package without its image — fails
the run (`release-index-orphan`) instead of being skipped: a release that silently ships one of the
two is worse than no index.

## Determinism and `--check`

`generatedAt` comes from `SOURCE_DATE_EPOCH` when it is set and parses as an integer, else from the
current UTC time. The document is serialized with `indent=2, sort_keys=True` and a trailing newline,
entries are ordered by `(board, version sort key, sha256)`, and the release body carries no timestamp
of its own beyond `generatedAt`. Two runs over the same bytes therefore produce byte-identical files.

`--check` regenerates both in memory, compares them with what is on disk (a missing file counts as
drift) and exits `1` without writing anything. Run it after any hand edit of `index.json` or
`release-notes.md`; the two files are generated, not edited.

## Failure codes

Every failure prints `<code>: <message>`, a `hint`, and a JSON `details` object to stderr, and exits
`2` (`1` only for `--check` drift).

| Code | Cause |
|------|-------|
| `release-index-empty` | `--release-dir` is missing, is not a directory, or holds no published images |
| `release-index-base-url-invalid` | `--base-url` is not an absolute `https://` URL |
| `release-index-artifact-invalid` | An image has no v2/v3 sidecar or no content hash, its filename is not a published firmware name, or `release.json` is invalid |
| `release-index-channel-mismatch` | An image's channel is not `--channel` (typically a `-dev.<n>.g<sha>` build) |
| `release-index-version-mismatch` | An image's version is not `release.json` → `releaseVersion` |
| `release-index-orphan` | A `.bin` without its `.firmware.zip`, or a package without its image |
| `release-index-board-unknown` | The image's board slug is not in `boards.json`, or the catalog cannot be read |
| `release-index-drift` | `--check` found a file that differs from a fresh generation, or is missing |

## Related

- [../../workflow/release.md](../../workflow/release.md) — the manual release procedure that runs this
  script, tags the release and uploads the assets.
- [../guides/build-and-deployment.md](../guides/build-and-deployment.md) — what CI does and does not
  build, so the runbook is the only path that produces a release.
- [firmware-build-websocket-protocol.md](firmware-build-websocket-protocol.md) — the `WS /firmware`
  frames an import actually uses.
- [archive-source-contract.md](archive-source-contract.md) — the path/URL policy the import dialogs
  and `mo fw import --url` share.

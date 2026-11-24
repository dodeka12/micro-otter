# Firmware Packages

A **firmware package** is a self-contained `.firmware.zip` that pairs one published image with
its sidecar manifest and a descriptor recording the image's SHA-256. It exists so a firmware can
be moved between publish roots — exported from one server and imported on another — without
`esp-idf`, a build backend, or the backend adapters. Importing only lands a verified image in the
publish root; it never builds or flashes, and deploy keeps resolving images by filename identity
unchanged.

- **Module:** `src/micro_otter/tools/firmware_compile/firmware_package.py`
- **Transport:** `firmware.import` on `WS /firmware`, `GET /api/firmware/package` on the server
- **CLI:** `mo firmware package` / `export` / `import` / `list`
- **Tests:** `tests/test_firmware_package.py`, `tests/test_cli_firmware_packages.py`,
  `tests/test_firmware_ws_handler.py`, `tests/test_serial_bridge_firmware_route.py`

## Package layout

```
<image-stem>.bin               the published firmware image (filename IS the identity)
<image-stem>.manifest.json     the sidecar manifest (may be absent)
firmware-package.json          the package descriptor
```

`package_firmware_image` writes exactly these members (flat, no directories). The filename encodes
board, runtime, version, and content hash via `local_firmware.parse_firmware_filename`, so an
imported image slots into the inventory and `resolve_firmware_image` with no extra metadata.

## Descriptor (`firmware-package.json`, schemaVersion 1)

```json
{
  "schemaVersion": 1,
  "createdAt": "2026-11-11T00:00:00+00:00",
  "image": { "filename": "1.27.0-esp32-general-1.0.1-0123456789ab.bin",
             "sizeBytes": 1723456,
             "sha256": "…" },
  "sidecar": "1.27.0-esp32-general-1.0.1-0123456789ab.manifest.json",
  "tool": { "name": "micro-otter", "version": "1.25.1" }
}
```

The `sha256` is of the raw image bytes, so a consumer detects a truncated or swapped image that the
sidecar's composition hash cannot. `sidecar` is `null` for an image published without a manifest.

## Import validation

`import_firmware_package` refuses, in order:

1. an archive above `MAX_PACKAGE_BYTES` (4 MiB) — `firmware-package-too-large`;
2. unsafe members (nested path, backslash, absolute/traversing name, symlink, duplicate, or more
   than `MAX_ENTRIES` files) — `firmware-package-invalid`;
3. a missing/unsupported descriptor, or any member beyond the descriptor/image/sidecar —
   `firmware-package-invalid`;
4. a SHA-256 mismatch — `firmware-package-checksum-mismatch`;
5. a filename that does not parse as a published name, or a filename/sidecar disagreement on
   board/slug, runtime id, runtime firmware version, or content hash — and, for a v2 sidecar with
   every composition field, a `contentHash` that no longer recomputes —
   `firmware-package-identity-mismatch`.

The archive is extracted into `<publish-root>/.staging/<uuid>/` and moved into place with
`os.replace`, so a failed import never leaves a half-installed image. An identical re-import (same
name and SHA-256) answers `already-present` without writing; an import that would overwrite a
*different* image requires `force`. A non-writable publish root answers `firmware-import-denied`.

The result carries `status` (`installed` | `already-present`), `filename`, `imagePath`,
`sidecarPath`, `sha256`, and `boardKnown` — `boardKnown` is `False` when the image's board slug is
not in the server's board catalog (the import still succeeds; deploy will still need the catalog).

## Binary import

`imported_firmware.import_firmware_binary()` installs one user-supplied stock MicroPython `.bin`
under the imported identity described in [firmware-identity.md](firmware-identity.md#imported-images).
Use it when the user already has a stock image (for example one downloaded from the MicroPython
downloads page); use a `.firmware.zip` package when the image was produced by Micro Otter and needs
its manifest contents verified. The result of a binary import is a normal published image — the same
files `list` already reads — so deploy picks it up unchanged. The caller supplies the source path
plus the resolved board slug (`target_id` is recorded as provenance), and the function shares every
guarantee the package path gives:

- the bytes are copied into `<publish-root>/.staging/<uuid>/`, re-hashed, and moved into place with
  `os.replace`, so a failed import never leaves a half-installed image or a staging folder behind;
- an identical re-import (same name, same digest) answers `already-present` without writing;
- an import that would overwrite a *different* image under the same name answers
  `firmware-import-exists` until the caller confirms with `force`;
- a publish root that cannot be created or written answers `firmware-import-denied`;
- a missing file, a non-`.bin` suffix (`.uf2` included), an empty file, or one above
  `MAX_IMPORTED_BINARY_BYTES` answers `firmware-import-invalid`.

It **never builds and never flashes**: like the package import it only lands an image that the
existing deploy path can pick up. The CLI has no `firmware import-binary` command — the flow is
web-only for now, so the asymmetry (package import has a CLI verb, binary import does not) is
deliberate.

## Wire surfaces

- **`firmware.import`** (`WS /firmware`): `{type, path | url, force?}` — exactly one of `path`
  (an absolute `.firmware.zip` on the server's machine) or `url` (an `https://` URL, or loopback
  `http://`). The client never sends package bytes; the server resolves the source under
  [archive-source-contract.md](archive-source-contract.md). The result is the refreshed
  `firmware.list` inventory payload plus an `imported` record. Gated on `firmware-compile` (import
  writes the producer-owned publish root), like `firmware.delete`.
- **`firmware.export`** (`WS /firmware`): `{type, firmwarePath, destinationDir, force?}`. The job
  re-checks the image against the publish root (shared with `firmware.delete`), validates the
  destination directory, and writes `<image-stem>.firmware.zip` — the server names the file, so the
  browser never invents a path. Gated on `firmware-compile` and `local-file-access`.

## Exporting a package to a folder

`export_firmware_package_to_directory(image_path, destination_dir=..., force=...)` writes exactly
`<image-stem>.firmware.zip` into a directory the caller picked through `fs.list`. The derived name is
the rule: an existing package is refused with `firmware-export-exists` until the caller confirms and
re-sends with `force: true`, so the bytes always come from the single
`export_firmware_package` writer. The CLI mirrors both flags — `mo firmware export <version>
--output-dir <dir> [--force]` writes the same derived name, while `--output <path>` keeps its
existing meaning (the two are mutually exclusive). No browser download route exists any more — a
user who wants the file on their own machine picks a local folder (the server usually runs on that
machine) or runs `mo firmware export`. `mo firmware import --url <url>` fetches the package from a
URL under the archive-source policy (https, or loopback `http`); a bare path argument still imports a
local `.firmware.zip`.

## Boundary

Importing is a filesystem operation on the publish root only. It does not build, flash, or select
anything for deploy, and it never touches node-package source upload: the collection-deploy
`missing` / `override-required` fallback stays independent.

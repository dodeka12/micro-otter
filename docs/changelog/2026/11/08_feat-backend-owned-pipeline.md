# Changes since version 1.25.0

## New Features

- **Backend-owned firmware pipeline** — `BuildBackend.build()` now owns the staging destination, the
  optional `.mpy` precompile, the toolchain command, and artifact discovery. The shared
  `run_build_orchestration()` only resolves the backend-typed board target and the content inventory
  (`ResolvedContents`), selects the backend, and delegates; it no longer imports any MicroPython
  pipeline module. Adding a new toolchain is now adding an adapter, not re-threading the pipeline.
- **Backend-typed board identity** — `BoardTarget` carries the canonical `name`, `slug`,
  `build_backend`/`flash_backend` discriminators, and backend-owned `build`/`flash` parameter maps.
  `resolve_board_target()` is the single lookup: a catalog `name` first, then the backend's own
  `resolve_name()` fallback for off-catalog boards. `slug()` derives the filename/registry form.
- **Board catalog schema v2** — `boards.json` now has one canonical `name` + `slug` per board with
  per-backend `build`/`flash` objects; `id`/`aliases`/`compileBoard`/`resolve_board_key` are gone.
  The web app reader and the CLI both follow the same schema.
- **ESP32-S3 builds fixed** — the canonical board name is `ESP32_GENERIC_S3`, so
  `mo cr --board ESP32_GENERIC_S3` emits `make BOARD=ESP32_GENERIC_S3` (previously the `esp32s3`
  alias failed with `Unknown MicroPython target/board`). Server-published S3 images are now named
  `esp32_generic_s3-*`, matching the CLI.
- **Embedding is a capability** — `BuildBackend.embedding()` reports `mpy-freeze` or `none`, and
  `ResolvedContents` records `not_embedded_packages` so a backend that cannot freeze a package routes
  it through the source-upload path.
- **CLI deploy uses the flash backend** — `mo dr` now flashes through `flash_firmware`/`FlashBackend`
  everywhere; the inline `esptool`/`idf.py flash` path is gone and chip/offset come from the board
  recipe.
- **Single server-side target resolution** — the Firmware tab sends its UI `targetId` (never a
  client-resolved board) and the server resolves it to the build board via `resolve_web_target`, built
  on the mapping rules with a backend-typed `compile` section (`board` + `backend` + `params`).
  `compile.start`/`deploy.start` accept `targetId` as the board selector (`board` becomes optional when
  `targetId` is present), and a wildcard (`custom`, `generic_micropython`) or unknown target answers a
  stable `target-unknown` error. The client's `getCompileTarget` read is demoted to the display-only
  info row.
- **Canonical firmware identity** — every firmware now has a five-segment name
  `<platformVersion>-<slug>-<runtime>-<semver>-<contentHash>`, where `contentHash` is
  `firmware_content_hash(...)`, a 12-hex hash over the *logical* contents (slug, backend, platform
  version, per-backend constituents, embedded packages) rather than the raw binary, so "same contents
  ⇒ same name" survives non-reproducible builds. A sidecar `firmware-manifest.json` is published next
  to each `.bin` recording the hash, constituents, and the `embeddedPackages`/`notEmbedded` split, and
  `latest_versions.json`/`runtime_lineage.json` entries carry the `contentHash`; image lookup filters
  by slug + runtime + hash.

## Improvements

- **Canonical slug in identity and registry keys** — the compile payload reports `target.slug`, and
  version strings / registry keys derive from the slug, so a server and CLI build of the same board
  agree on the published filename.

## Limitations

- New toolchain adapters (Arduino/avrdude, RP2/uf2, …) are additions on this seam, planned after
  `esp-idf` proves it; content hash + sidecar manifest identity is a later milestone.

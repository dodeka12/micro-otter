# Board Catalog Contract

**Status:** Implemented Contract
**Scope:** Canonical board-level parameters for firmware compile and deploy, consumed by the CLI and firmware tooling.

## Purpose

Define the single source of truth for board-level firmware parameters so board configuration is
data-driven rather than hardcoded in the CLI layer.

## Canonical Catalog Artifact

- Path: `src/micro_otter/nodes/device/firmware/boards.json`

Schema requirements:

1. `schemaVersion` integer (currently `2`).
2. `boards` array where each entry defines:

   | JSON field | `BoardSpec` attribute | Meaning |
   | --- | --- | --- |
   | `name` | `name` | Canonical toolchain board name (`esp32`, `ESP32_GENERIC_S3`, `arduino:avr:uno`). Case-sensitive; `make BOARD=` is. |
   | `slug` | `slug` | Filename/registry form of `name`, derived by `slug(name)` and validated to match. |
   | `displayName` | `display_name` | Human-readable name (display only). |
   | `buildBackend` | `build_backend` | Build backend discriminator (`esp-idf` today). |
   | `flashBackend` | `flash_backend` | Flash backend discriminator (`esptool` today). |
   | `chip` | `chip` | Flash chip identifier (`esptool --chip` value); optional. |
   | `build` | `build_params` | Backend-owned build parameters (object of strings). |
   | `flash` | `flash_params` | Backend-owned flash parameters (object of strings). |

### Per-backend parameters

`build` and `flash` are **backend-owned**: only the backend named by `buildBackend`/`flashBackend`
interprets them. The shared layer treats them as opaque string maps.

| Backend | `build` params | `flash` params |
| --- | --- | --- |
| `esp-idf` | `port` (MicroPython port dir), `board` (`make BOARD=`), `buildDirName` | — |
| `esptool` | — | `offset` (`write-flash` offset, string) |

Rules:

- `slug` must equal `slug(name)`. The loader rejects a mismatched slug, so the catalog can never
  carry two different spellings of one board's identity.
- `build`/`flash` are stored as read-only mappings (`MappingProxyType`) so a frozen `BoardSpec`
  cannot hide a mutable dictionary.
- `buildBackend`/`flashBackend` feed backend selection as a soft `board_default` preference — an
  explicit request or a concrete `MICRO_OTTER_BUILD_BACKEND` / `MICRO_OTTER_FLASH_BACKEND` value
  wins, and an unavailable or unsupported catalog default falls through to `auto`. See
  [build-backend-contract.md](build-backend-contract.md) and
  [flash-backend-contract.md](flash-backend-contract.md).
- Validation errors raise `BoardCatalogError` (a `ValueError` subclass) and name the offending field
  and entry index.

## Resolution Semantics

1. `find_board(name, catalog)` matches a board's `name` exactly after stripping. There is no case or
   separator folding, and there are no aliases: one canonical name per board.
2. `resolve_board_target(*, name, …)` looks the name up in the catalog and returns a backend-typed
   `BoardTarget`; a name not in the catalog is offered to the **build backend** via
   `BuildBackend.resolve_name` (the backend-owned off-catalog fallback, e.g. the MicroPython `ports/`
   probe). A name nothing resolves raises `Unknown MicroPython target/board: …`.
3. `load_board_catalog(path)` validates `schemaVersion` (`2`), required fields, non-empty strings,
   slug consistency, string-valued `build`/`flash` params, and duplicate names; invalid or missing
   catalogs raise `BoardCatalogError`.
4. `find_board_by_slug(catalog, board_slug)` is the reverse lookup: it matches a row's `slug`
   case-insensitively and returns `None` for an unknown or empty slug. `mo firmware menu` holds slugs
   while compile-target mapping rules speak board names, so
   `resolve_target_package_context_for_board()` uses it to translate the slug before asking the
   mapping — the resolved variants are then what both staging and version collection use.

## Current Boards

| name | slug | displayName | chip | buildBackend | flashBackend | build | flash |
|---|---|---|---|---|---|---|---|
| esp32 | esp32 | ESP32 (WROOM / generic) | esp32 | esp-idf | esptool | `{port: esp32, board: esp32, buildDirName: build-ESP32_GENERIC}` | `{offset: 0x1000}` |
| ESP32_GENERIC_S3 | esp32_generic_s3 | ESP32-S3 (generic) | esp32s3 | esp-idf | esptool | `{port: esp32, board: ESP32_GENERIC_S3, buildDirName: build-ESP32_GENERIC_S3}` | `{offset: 0}` |
| ESP32_GENERIC_S2 | esp32_generic_s2 | ESP32-S2 (generic) | esp32s2 | esp-idf | esptool | `{port: esp32, board: ESP32_GENERIC_S2, buildDirName: build-ESP32_GENERIC_S2}` | `{offset: 0x1000}` |

The S3 entry uses the generic `ESP32_GENERIC_S3` build, which auto-detects quad PSRAM and works
for both WROOM and Mini S3 modules; it is named by chip family, not a specific board layout. The
`ESP32_GENERIC_S2` entry is the S2 counterpart: a generic build with no PSRAM variant, whose flash
offset (`0x1000`) follows MicroPython's `ESP32_GENERIC_S2` board definition rather than the S3
value.

## Local Firmware Inventory

Interactive tooling discovers locally available firmware from two sources:

1. **Publish root scan** — `/opt/micro_otter/firmware`. Published files are named
   `<repo>-<micropython>-<board>-<runtime>-<runtimeFirmware>[-<hash>].bin`; because `<repo>` may
   contain hyphens, the version tuple is parsed with an end-anchored pattern
   `-(\d+\.\d+\.\d+)-([a-z0-9_]+)-([a-z0-9_]+)-(\d+\.\d+\.\d+)(?:-([0-9a-f]{12}))?\.bin$`. The
   `<board>` segment is the canonical `slug`; the optional final segment is the 12-hex `contentHash`
   from the sidecar manifest. Board ids are normalized to lowercase and grouped into a sorted list of
   runtime firmware versions. Each `.bin` has a matching `<name>.manifest.json` sidecar.
2. **Latest registry** — `latest_versions.json` maps `<boardSlug>-<runtimeId>` to the latest
   `fullVersion` (and its `contentHash`). Reads degrade gracefully to an empty result when the file
   is missing or invalid.

## Client-side reading (web app)

The web app reads the catalog through `js/firmware/board-catalog.ts` for the target info row only.
It matches the canonical `name`/`slug` (no aliases); `flash.offset` is shown, never used to flash. A
missing, malformed, or non-2 `schemaVersion` catalog yields an empty list, which disables the info
row — never the tab.

See [firmware-build-view-architecture.md](../view-system/firmware-build-view-architecture.md) for the
tab that reads this catalog.

# Backend Compile Interface Contract

**Status:** Active  
**Last Updated:** 2026-04-18  
**Scope:** Backend firmware compile interface for CLI and package invocation

## Purpose

This document defines the stable backend compile interface used by developer CLI flows,
automation, and future server-side wrappers.

The interface is package-first, with a CLI command delegating into the same Python package
entrypoint so behavior remains consistent across invocation modes.

## Entrypoints

1. CLI command
  - `mo cr <args>`

2. Direct module invocation
   - `uv run python -m micro_otter.tools.firmware_compile <args>`
   - `python -m micro_otter.tools.firmware_compile <args>`

3. Python package integration point
   - `src/micro_otter/tools/firmware_compile/`

## Supported Arguments

## Required

- `--runtime-id <id>`
- `--board <board>`

## Optional

- `--micropython-root <path>`
- `--modules-path <path>`
- `--device-root <path>`
- `--build-dir <path>`
- `--clean-staging`
- `--clean-build`
- `--module-packaging-mode <mode>` (`source-py` or `compiled-mpy`)
- `--package-ids <csv>` (comma-separated package ids to freeze into the image)
- `--package-variants <csv>` (comma-separated `package=variant` pairs, e.g. `pulse=viper`; `pulse=py`
  selects the default implementation)
- `--json-output`
- `--embedded-inventory-output <path>`
- `--verbose`
- `--dry-run`

## Optional Compatibility Pass-Through

- `--request-id <id>`
- `--timeout-seconds <int>`

## Output Contract

- Default mode:
  - Human-readable status to stdout
  - Failure details to stderr
- `--json-output` mode:
  - Final stdout line is a compact single JSON result payload

## JSON Result Shape

The result payload uses `schemaVersion: 1` and includes these top-level fields:

- `schemaVersion`
- `status`
- `requestId`
- `runtime`
- `target`
- `paths`
- `staging`
- `build`
- `metadata`
- `warnings`
- `errors`

Additional metadata fields currently emitted include:

- `metadata.buildProfile`
- `metadata.modulePackagingMode`
- `metadata.precompiledFiles`
- `metadata.packageIds` (the selected package ids, or `null`)
- `metadata.packageVariants` (the resolved `packageId → variantId` map, or `null`; the default
  implementation's id is `py` and `variant-unknown` lists every known id)
- `metadata.mpyCrossPath` (when compiled mode resolves compiler)
- `metadata.firmwareArtifactSizeBytes` (when artifact discovered)
- `metadata.firmwareArtifactHash` (when artifact discovered)

## Exit Code Categories

- `0` success
- `2` input validation (including `package-selection` failures: `unknown-package-id`,
  `package-not-staged`, `variant-unknown`, `variant-capabilities-unsatisfied`,
  `variant-package-not-selected`)
- `3` runtime/manifest resolution
- `4` staging conflict
- `5` MicroPython path/configuration
- `6` toolchain invocation
- `7` build command failure
- `8` artifact verification/post-build metadata
- `9` unexpected internal error

## Safety Guarantees

- Workspace and tool-root path boundary checks are enforced during request normalization.
- Invalid/out-of-root path values fail fast with structured validation errors.
- Command assembly is designed around argument arrays (no shell-string dependency contract).

## Embedded Inventory Behavior

- Embedded inventory metadata is produced for non-dry-run execution paths.
- `--embedded-inventory-output` controls manifest output location.
- Inventory hash values are emitted as deterministic `sha256:<hex>` when available.

## Sidecar manifest (v2)

The publish step writes a `<stem>.manifest.json` sidecar with `schemaVersion: 2` that records,
in addition to the v1 fields (`contentHash`, `embeddedPackages`, `notEmbedded`,
`constituents`, `build.gitSource`):

- `addonPackages` — the add-on packages and versions frozen into the image.
- `selection` — `packageIds`, `packageVariants`, `modulePackagingMode`, `optimizationLevel`.
- `version` — `{version, baseVersion, channel, versionSource}`.
- `build.gitSource` gains `commit`, `distance`, `branch`, `tag`, `shallow`.

The `contentHash` is the hash of the same inputs passed to `firmware_content_hash()`; a
mismatch raises `ValueError`. See [firmware-identity.md](firmware-identity.md) for the hash
payload and exclusions.

## Artifact Discovery And Verification

- Artifact discovery uses deterministic candidate paths under `ports/<target>/build*/firmware.bin`.
- Verification checks include existence, non-empty size, and sha256 hash enrichment.
- Verification failures map to artifact verification error category and exit code `8`.
- After a successful build, `verify_frozen_module_names()` reads `<artifact parent>/frozen_content.c`
  and refuses any frozen module whose name is absolute (leading `/`, drive prefix, or backslash), so an
  image whose modules cannot be imported is never published — same exit `8` /
  `artifact-verification` category. See the
  [Firmware Runtime Payload Contract](firmware-runtime-payload-contract.md).

## Build Preflight

`run_build_preflight()` / `run_build_preflight_with_mode()` validate the prerequisites before the
toolchain runs. In addition to the root/`ports`/`make` checks, passing `port=<port>` enables a
stock-module integrity check: a tracked `ports/<port>/modules` file missing from the checkout (for
example a stock module compiled to `.mpy` and deleted) fails the preflight with a
`git -C <root> checkout -- ports/<port>/modules` hint, regardless of `strict`. A missing `git` or a
non-git checkout downgrades the check to a warning, never a failure.


## Examples

## Success payload (abbreviated)

```json
{
  "schemaVersion": 1,
  "status": "success",
  "requestId": "req-123",
  "runtime": { "id": "general", "version": "1.11.0" },
  "target": { "board": "esp32" },
  "paths": {
    "micropythonRoot": "/workspaces/micro-otter/src/micropython",
    "modulesPath": "/workspaces/micro-otter/src/micropython/ports/esp32/modules",
    "firmwareArtifact": null
  },
  "staging": {
    "filesDiscovered": 42,
    "filesCopied": 42,
    "embeddedInventoryPath": "/workspaces/micro-otter/src/micropython/ports/esp32/modules/otter/embedded_manifest.json",
    "embeddedInventoryHash": "sha256:...",
    "conflicts": []
  },
  "build": {
    "startedAt": "2026-04-18T10:00:00Z",
    "finishedAt": "2026-04-18T10:00:01Z",
    "durationMs": 1000,
    "command": "staging-only",
    "exitCode": 0
  },
  "errors": []
}
```

## Validation failure (abbreviated)

```json
{
  "schemaVersion": 1,
  "status": "failed",
  "errors": [
    {
      "code": "VALIDATION_ERROR",
      "category": "input-validation",
      "message": "timeout-seconds must be a positive integer"
    }
  ],
  "build": {
    "exitCode": 2
  }
}
```

## Staging conflict failure (abbreviated)

```json
{
  "schemaVersion": 1,
  "status": "failed",
  "staging": {
    "conflicts": [
      {
        "targetRelPath": "libs/core/system.py",
        "firstSource": "...",
        "secondSource": "...",
        "reason": "duplicate-target-path"
      }
    ]
  },
  "errors": [
    {
      "code": "STAGING_CONFLICT",
      "category": "staging-conflict",
      "message": "Conflicting staged target paths detected"
    }
  ],
  "build": {
    "exitCode": 4
  }
}
```

## Internal Seam

The CLI contract above stays caller-facing. Inside the package, the work is performed by a
toolchain-specific build backend behind the `BuildBackend` protocol. The protocol, registry,
selection precedence, and the ESP-IDF adapter are documented in
[build-backend-contract.md](build-backend-contract.md). That document is the internal seam; it does
not replace or relax any guarantee on this page.

The write side has the same shape: firmware images are flashed through a `FlashBackend`, documented
in [flash-backend-contract.md](flash-backend-contract.md). Neither seam owns collection package
source upload, which stays in the web-app deployment path.

## Out Of Scope

1. End-to-end build pipeline orchestration policy details (profiles/retries/platform wrappers)
2. Final firmware artifact signing/release packaging policy
3. Server queue/auth/streaming lifecycle concerns
4. Frontend/UI behavior and transport contracts
5. Performance tuning and parallelization strategy

## Implementation References

- `src/micro_otter/cli/app.py`
- `src/micro_otter/tools/firmware_compile/compile_command.py`
- `src/micro_otter/tools/firmware_compile/__main__.py`
- `src/micro_otter/tools/firmware_compile/staging_metadata.py`
- `tests/test_cli_compile_runtime.py`
- `tests/test_firmware_compile_command.py`
- `tests/test_firmware_compile_module_cli.py`
- `tests/test_firmware_compile_staging_metadata.py`

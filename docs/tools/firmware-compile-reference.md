# Firmware Compile Tools Reference

This reference documents the implemented firmware compile tooling introduced by the firmware-embedded runtime initiative.

Scope of this document:

1. Command surfaces you can call today
2. Supported arguments
3. Output and exit-code contracts
4. Produced artifacts and metadata
5. How this tooling interacts with device deployment behavior

For architecture details, see:

1. ../dev/firmware-compile/runtime-packaging-contract.md
2. ../dev/firmware-compile/staging-workflow.md
3. ../dev/firmware-compile/backend-compile-interface-contract.md
4. ../dev/firmware-compile/build-pipeline-integration.md

## Implemented Tool Surfaces

The compile/deploy feature is exposed through package-owned backend flows and CLI invocation forms.

1. CLI command
   1. mo cr
   2. mo deploy-runtime
   3. mo dr
   4. mo node-packages
   5. mo np
2. Direct module invocation
   1. uv run python -m micro_otter.tools.firmware_compile
   2. python -m micro_otter.tools.firmware_compile
3. Python package entry
   1. src/micro_otter/tools/firmware_compile/compile_command.py
4. Add-on node package command group
   1. mo addons list
   2. mo addons install `<archive-or-directory>` `[--force]` `[--as <id>]`
   3. mo addons uninstall `<id>`
   4. mo addons validate `<archive-or-directory>` `[--as <id>]`

Compile invocation forms delegate to the same package orchestration contract.

## Add-on commands

`mo addons` installs third-party node packages into `addons_dir`; the compile flow then stages and
compiles them like a shipped package (see
[node-package-addons.md](../../docs/dev/nodes/node-package-addons.md)).

Exit codes:

1. `0` success (including `validate` on a valid archive, which writes nothing).
2. `1` a failed add-on operation. The stable code is printed as `<code>: <message>` with a `hint:`
   line, e.g. `addon-already-installed`, `addon-id-conflicts-builtin`,
   `addon-archive-unsafe-path`, `addon-not-installed`.
3. `2` configuration error (`ConfigError`), printed by the shared config-error path.

`--json-output` emits the payload instead of text: `list` returns
`{"addons": [...], "conflicts": [...], "warnings": [...]}`, `install` returns
`{"id", "version", "packageDir", "replaced", "archiveSha256"}`, `uninstall` returns
`{"id", "version", "removed": true}`, and `validate` returns
`{"id", "version", "name", "assets", "valid": true}`.

`mo compile-mpy` additionally accepts:

1. `--skip-addons` — compile the shipped device tree only; the add-ons tree stays byte-identical.
2. `--dry-run` — report the source count and profile hash without compiling, cleaning, or rewriting a
   manifest.

Its payload gains `compile.addonManifestsUpdated`, `compile.addonsSkipped`, and `compile.dryRun`.

## Primary Command

Example baseline invocation:

```bash
mo cr \
  --runtime-id general \
  --board esp32 \
  --json-output
```

Dry-run validation without copy/build:

```bash
mo cr \
  --runtime-id general \
  --board esp32 \
  --dry-run \
  --json-output
```

## Supported Arguments

Required:

1. --runtime-id <id>
2. --board <board>

Optional path overrides:

1. --micropython-root <path>
2. --modules-path <path>
3. --device-root <path>
4. --build-dir <path>
5. --embedded-inventory-output <path>

Optional behavior flags:

1. --clean-staging
2. --clean-build
3. --module-packaging-mode <source-py|compiled-mpy>
4. --package-ids <id>[,<id>...]
5. --json-output
6. --verbose
7. --request-id <id>
8. --timeout-seconds <int>
9. --dry-run
10. --force-overwrite (replace an already-published firmware artifact instead of exiting `9`)

Notes:

1. Path safety checks enforce workspace-root and MicroPython-root boundaries.
2. Invalid values are mapped to structured validation errors and deterministic exit codes.
3. `--package-ids` freezes only the listed node packages into the image; omitting it keeps every
   package the runtime manifest declares. Ids are trimmed, blanks dropped, and repeats collapsed
   (first-seen order wins). Unknown ids raise `unknown-package-id`, and runtime-local-only ids raise
   `package-not-staged`; both exit `2`. Selection only changes image contents — collection deploy
   still uploads sources for packages that are not in the image.
4. `--module-packaging-mode compiled-mpy` ships an mpy-only module tree: every staged `.py` module is
   compiled and its source removed, except paths listed in the runtime manifest's
   `mpySourceExcludes` (the boot path). See
   [mpy-precompilation/workflow.md](../dev/mpy-precompilation/workflow.md).

## Interactive Firmware Menu

`mo firmware` (alias `mo fw`) is an interactive menu that lists the buildable boards from
`boards.json`, shows the firmware versions available locally, and lets the user build or deploy.

```bash
mo fw
```

Pass `--build-if-stale` to skip the action prompt and run the "build (if needed) and deploy"
flow described below.

Behavior:

1. Renders a board table (board name, compile board, local firmware versions, latest version,
   and a status column marking whether the latest built firmware is up to date or needs a
   rebuild for the current source).
2. Prompts for the board number, defaulting to the last selected board.
3. Prompts for the action as a numbered choice — `1` build, `2` deploy, `3` rebuild all stale
   firmware, `4` build (if needed) and deploy — defaulting to the last selected action (or
   `deploy` when local firmware exists, otherwise `build`).
4. Build runs `compile-runtime` with fixed defaults `--runtime-id general --clean-staging
   --clean-build` — these are set automatically and not prompted. If the resolved firmware version
   is already published, the menu shows the existing artifact and asks `Remove existing firmware and
   rebuild?`; answering `no` keeps the published firmware and exits with the `compile-runtime`
   error code `9` (`FIRMWARE_ALREADY_PUBLISHED`). An artifact that exists on disk without a runtime
   lineage entry is a leftover from an interrupted build, so the build replaces it directly (with a
   warning) instead of prompting.
5. Rebuild all stale firmware compiles every board whose latest built firmware no longer matches
   the current source constituents, stopping after a non-zero build if one fails. Each board gets
   the same already-published prompt, so a stale target whose version file already exists on disk
   can still be rebuilt instead of ending in the `FIRMWARE_ALREADY_PUBLISHED` dead end. A declined
   prompt does not count as a new failure reason: the board reports exit code `9` and the remaining
   stale boards are still attempted.
6. Deploy detects serial ports (with `/dev/serial/by-id` friendly labels when available), lists
   them numbered, and prompts for the port index (defaulting to the last used port). Ports the kernel
   reports without any identity — the phantom Linux `/dev/ttyS*` UARTs — are ignored, so only
   attached devices are listed. If no ports
   are detected, it falls back to prompting for a raw port path.
7. Deploy then prompts for `--wipe-filesystem` and `--monitor` (defaulting to the last
   selections).
8. The selected board, action, port, and wipe/monitor choices are persisted in the state file
   (see below).
9. `build (if needed) and deploy` (menu `4`, or `--build-if-stale`) checks the selected board's
   staleness first: if the latest built firmware no longer matches the current source (or was
   never built, or its published firmware file is missing) it runs the same fixed-default build
   with the already-published overwrite prompt, and only flashes after a successful build. If the
   build fails — including declining the overwrite prompt, which exits with code `9` — deployment
   is aborted with that exit code. When the board is up to date the build is skipped. The check
   compares the same constituents a rebuild would freeze, including the installed add-ons and the
   package variants the board's capabilities select; a `schemaVersion: 3` sidecar is compared field
   by field rather than by `contentHash`, because a hash written by an older variant-blind build
   cannot prove that the variants match. When
   staleness cannot be determined (for example because the MicroPython clone is unavailable), it
   warns and deploys the existing build.

## Firmware packages

`mo firmware` also hosts the package verbs for moving a published image between publish roots as a
self-contained `.firmware.zip` (see [firmware-packages.md](../dev/firmware-compile/firmware-packages.md)):

```bash
mo firmware package <image.bin> [-o out.firmware.zip]   # package one published image
mo firmware export <version> [--board esp32] [-o out.zip]   # resolve from the inventory + package
mo firmware import <pkg.firmware.zip> [--force] [--firmware-dir DIR]   # validate + install
mo firmware list [--json] [--firmware-dir DIR]           # list the publish root
```

Importing never builds or flashes; it only lands a verified image (SHA-256, filename identity,
sidecar agreement) in the publish root. An identical re-import reports `already-present`; a name
collision requires `--force`. Export refuses a path outside the publish root
(`firmware-path-invalid`).

## Deployment Command

Use deploy-runtime to flash a built firmware image to an ESP32 device.

Host platform note:

1. The examples below assume a Linux serial path such as `/dev/ttyUSB0`.
2. This is the expected path format inside the devcontainer.
3. On Windows hosts, forward the USB device into the Linux side first so the container can see `/dev/ttyUSB*` or `/dev/ttyACM*`.
4. Windows COM ports are not usable directly from this Linux container.

Example:

```bash
mo deploy-runtime --port /dev/ttyUSB0
```

Alias:

```bash
mo dr --port /dev/ttyUSB0
```

Optional monitor:

```bash
mo deploy-runtime --port /dev/ttyUSB0 --monitor
```

Wipe filesystem before flash:

```bash
mo deploy-runtime --port /dev/ttyUSB0 --wipe-filesystem
```

Supported arguments:

1. --port <serial-port> (required)
2. --board <board> (esp32, ESP32_GENERIC_S2 or ESP32_GENERIC_S3)
3. --micropython-root <path>
4. --build-dir <path>
5. --monitor
6. --wipe-filesystem
7. --firmware <path> — flash a prebuilt `.bin` instead of a build directory
8. --flash-backend <id> — pinned flash backend; omit for `auto` selection
9. --timeout-seconds <n> — bound the flash tool invocation
10. --json-output — emit the final payload as compact JSON on stdout

Board parameters (canonical `name`, `slug`, chip, and per-backend `build`/`flash` objects) are
defined in `src/micro_otter/nodes/device/firmware/boards.json` and resolved by
`resolve_board_target`, so no board values are hardcoded in the CLI.

### Firmware image path and its payload

`--flash-backend` and `--timeout-seconds` affect image flashing only; they never gate the web-app
source upload, which does not run through this command at all.

The `--firmware` path routes through
[firmware_deploy.py](../../../src/micro_otter/tools/firmware_compile/firmware_deploy.py) whenever
`--json-output`, `--flash-backend`, or `--timeout-seconds` is present, because only that path can
honour backend selection and a tool timeout. A plain `mo dr --firmware <path>` (none of the three)
keeps the historical inline `esptool` invocation, so its messages and exit codes are unchanged.

JSON mode prints one object:

```bash
mo dr --port /dev/ttyUSB0 --board esp32 --firmware firmware.bin --json-output
```

```json
{"schemaVersion":1,"status":"succeeded","board":{"id":"esp32","chip":"esp32"},"port":"/dev/ttyUSB0","backend":"esptool","firmware":{"path":"/abs/firmware.bin","sizeBytes":1916592,"sha256":"sha256:9f9f5111f7b27a781f1f1ddde5ebc2dd2b796bfc7365c9c28b548e564176929f"},"exitCode":0,"errors":[],"warnings":[]}
```

`firmware.sha256` matches `sha256sum <image>` and is `null` when the deploy failed before the image
was verified. Failures use the same payload with `status: "failed"` and one `errors` entry shaped by
the shared error object (`code`, `category`, `message`, optional `details`/`hint`):

| Exit | `errors[0].code` | When |
|------|------------------|------|
| `3` | `firmware-image-invalid` | the explicit `--firmware` path is missing, empty, or unreadable |
| `3` | `firmware-image-unavailable` | no image resolved from the inventory (WS/API callers); carries a `hint` |
| `2` | `board-not-flashable` | the board declares no flashable chip |
| `1` | `flash-unknown-backend` | `--flash-backend` named an id that does not exist; the message lists the known ids |
| `1` | `flash-tool-missing` | the backend's tool is not on `PATH` |
| adapter | `flash-command` | the tool exited non-zero |
| `2` | `flash-unsupported-chip` | a hard-selected backend cannot flash the board's chip |
| `1` | `flash-backend-unavailable` / `flash-no-available-backend` | no usable backend for the chip |

`--json-output` without `--firmware` keeps the build-directory behaviour of `mo deploy-runtime`
unchanged and is not routed through the helper.


### State file

The interactive `mo fw` menu remembers the last selected board, action, USB port, and the last
wipe-filesystem / monitor selections in `$XDG_CONFIG_HOME/micro-otter/state.json` (fallback
`~/.config/micro-otter/state.json`):

```json
{
  "lastAction": "deploy",
  "lastBoard": "ESP32_GENERIC_S3",
  "lastMonitor": false,
  "lastPort": "/dev/ttyACM0",
  "lastWipeFilesystem": true
}
```

Missing or corrupt state files fall back to defaults without failing. Valid `lastAction`
values are `build`, `deploy`, and `build-deploy` (the "build if needed, then deploy" flow).

## Node package inventory

`mo node-packages` (alias `mo np`) lists every node package that exists locally and whether the
selected runtime stages it into its firmware.

```bash
mo node-packages --runtime-id general
mo np --runtime-id general --json-output
mo np --runtime-id general --sync-local
```

Options:

1. `--runtime-id <id>` — runtime whose manifest decides staging; defaults to `general`.
2. `--json-output` — emit the payload below instead of the table.
3. `--sync-local` — rewrite `nodePackages.local` in the runtime manifest to match the folders under
   `device/runtime/<runtime_id>/node_pkgs/`.

Payload:

```json
{"schemaVersion":1,"runtime":{"id":"general"},"packages":[{"id":"core","name":"Core Nodes","version":"1.9.0","source":"global","staged":true,"gatedOut":false,"missingCapabilities":[],"manifestPath":"/abs/src/micro_otter/nodes/device/node_pkgs/core/manifest.json"}],"warnings":[]}
```

- `source` is `global` (`node_pkgs/index.json`) or `runtime-local`
  (`runtime/<runtime_id>/node_pkgs/<id>`). Runtime-local packages are reported as `staged: false`
  because the resolver never stages them.
- `staged: true` requires both a `nodePackages.global` entry and satisfied `requiredCapabilities`;
  `gatedOut` is the listed-but-rejected case and `missingCapabilities` names the unmet entries.
- **`staged: false` means "not in this firmware image", never "skip the source upload".** The
  collection deploy path still uploads source for `missing` / `override-required` packages.
- With `--sync-local` the payload gains `"sync": {"written", "previous", "current", "skipped"}`;
  `skipped` lists entries under the runtime `node_pkgs` folder that are not valid package folders
  (plain files such as `README.md`, folders without a manifest, or an `id` mismatch).
- A missing runtime manifest exits `2` with `runtime-not-found` and a hint listing the runtime ids
  that exist; a malformed one exits `2` with `runtime-manifest-invalid`.

## Output Contract

Default output mode:

1. Human-readable status
2. Error summary on failure

JSON mode (--json-output):

1. Final stdout payload follows schemaVersion 1 contract.
2. Includes stable top-level keys:
   1. schemaVersion
   2. status
   3. requestId
   4. runtime
   5. target
   6. paths
   7. staging
   8. build
   9. metadata
   10. warnings
   11. errors

Common fields used operationally:

1. paths.firmwareArtifact
2. staging.embeddedInventoryPath
3. staging.embeddedInventoryHash
4. metadata.modulePackagingMode
5. metadata.precompiledFiles
6. metadata.mpySourcesRemoved
7. metadata.mpyCrossPath
8. metadata.packageIds
9. metadata.firmwareArtifactSizeBytes
10. metadata.firmwareArtifactHash

`metadata.packageIds` echoes the frozen selection (`null` when the run kept every declared
package), `metadata.precompiledFiles` and `metadata.mpySourcesRemoved` report the mpy-only
conversion counts, and `metadata.mpyCrossPath` names the compiler that produced them.

## Exit Codes

The tooling uses deterministic exit categories:

1. 0 success
2. 2 input-validation
3. 3 manifest-resolution
4. 4 staging-conflict
5. 5 micropython-config
6. 6 build-toolchain-invocation
7. 7 build-command-failed
8. 8 artifact-verification
9. 9 firmware-already-published (`FIRMWARE_ALREADY_PUBLISHED`, resolved with `--force-overwrite`);
   also the fallback for unexpected-internal (`INTERNAL_ERROR`) failures

Exit code `9` covers both buckets, so callers should branch on the error `code`: only
`FIRMWARE_ALREADY_PUBLISHED` means an existing artifact can be replaced. That error is only raised
for versions recorded in the runtime lineage — see *Publish Conflict Detection* above for the
unrecorded-artifact case, which is rebuilt without prompting.

Exit code `2` also covers `--package-ids` rejections:

1. `unknown-package-id` — `details.requested` lists the ids that were asked for,
   `details.known` lists the ids the runtime manifest declares, and `hint` repeats the known ids.
2. `package-not-staged` — runtime-local packages live in `device/runtime/<runtime_id>/node_pkgs/`
   and are never staged into an image; `details.packageIds` names them.

## Staged Content and Metadata

The staging flow writes managed firmware module content under the target modules path:

1. tools/
2. libs/
3. app/
4. otter/
5. main.py (startup shim)

Embedded metadata files:

1. otter/embedded_manifest.json
2. otter/embedded_hashes.json

Startup contract:

1. main.py imports libs.micro_otter_main
2. main.py calls run()
3. Startup execution is performed through run(), not import side effects

## Build/Artifact Behavior

When not in dry-run mode, orchestration attempts to discover and verify firmware artifacts.

1. Candidate search under ports/<target>/build*/firmware.bin
2. Verification includes file existence, non-empty size, and sha256 hash
3. Verification result is reflected in payload fields and exit-code behavior

### Published artifact pair

A successful build publishes two files side by side in the firmware publish root:

- `<repo>-<platformVersion>-<slug>-<runtime>-<runtimeFirmware>-<contentHash>.bin` — the image. The
  final segment is `firmware_content_hash(...)`, a 12-hex hash over the *logical* contents (slug,
  backend, platform version, constituents, embedded packages), never the raw binary.
- `<name>.manifest.json` — the sidecar `firmware-manifest.json` recording `contentHash`, the
  per-backend `constituents`, `embeddedPackages`/`notEmbedded`, and build metadata (git source,
  finished-at). The manifest is the authoritative record of what the image contains.

`latest_versions.json` and `runtime_lineage.json` entries also record the `contentHash` for lookup.

### Publish Conflict Detection

A published `.bin` is only treated as an already-published release when the matching runtime
firmware version also has a runtime lineage entry under
`src/micro_otter/nodes/device/firmware/runtime_lineage.json` for the target
(`<board>-<runtime-id>`):

1. Recorded version + `--force-overwrite` — the existing artifact is removed and the build runs.
2. Recorded version, no `--force-overwrite` — the build stops with exit code `9`
   (`FIRMWARE_ALREADY_PUBLISHED`); the interactive menu offers to remove and rebuild.
3. Unrecorded version — the artifact is a leftover from a build that was interrupted (or failed)
   between publication and bookkeeping. It is removed automatically and the build continues; the
   payload gains a warning naming the replaced file.
4. Version identity that cannot be parsed — the conservative already-published behavior is kept.

Publication happens before the lineage/registry update, so if that bookkeeping fails the freshly
published artifact is discarded again: the tooling never leaves a `.bin` behind that the lineage
does not know about.

## Relationship To Device Deployment

After flashing a firmware image produced by this flow:

1. Device metadata under /otter/ enables embedded runtime mode detection.
2. Web deployment logic keeps collection deployment available.
3. Runtime reinstall-style actions are gated for embedded mode.
4. Collection deployment prioritizes effective inventory behavior established in earlier phases.

## Build And Deploy Firmware From The Web UI

The web app's **Firmware** tab is the interactive renderer of this contract (the same `compile.start` /
`deploy.start` / `scan-local` frames, `modulePackagingMode: compiled-mpy`, and stable error `code` +
`hint`). It is a firmware-image path, distinct from collection deploy (which uploads node-package
source): the tab builds or flashes a firmware image and never stages or uploads source. The tab sends
the selected UI `targetId` and the server resolves it to a build board via
`resolve_web_target` — the tab's target selection maps to a build board on the server, never on the
client. See
[view-system/firmware-build-view-architecture.md](../dev/view-system/firmware-build-view-architecture.md)
for the full state machine, capability gating, and job lifecycle.

## Related Tests

Representative tests for this contract include:

1. ../../tests/test_firmware_compile_command.py
2. ../../tests/test_firmware_compile_module_cli.py
3. ../../tests/test_firmware_compile_boundary_enforcement.py
4. ../../tests/test_firmware_compile_build_orchestration.py
5. ../../tests/test_firmware_compile_build_artifact.py

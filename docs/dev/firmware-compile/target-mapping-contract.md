# Target Mapping Contract

**Status:** Implemented Contract
**Scope:** Compile-time target mapping and propagation from compile request to embedded metadata and setup APIs

## Purpose

Define the canonical contract for using compile inputs to constrain target selection while preserving the user-selected compile board as authoritative.

Compile metadata must describe firmware-family compatibility, while exact board target identity is selected later during host onboarding.

## Authoritative Board Source

1. Board name is provided by user input in `compile-runtime --board`.
2. Request normalization keeps this board name authoritative for compile execution.
3. Mapping logic may enrich metadata but must not silently rewrite the board name.

## Canonical Mapping Artifact

- Path: `src/micro_otter/nodes/device/targets/compile_target_mappings.json`

Schema requirements:

1. `schemaVersion` integer.
2. Ordered `rules` array where each rule defines:
   - `id`
   - `webTargetId`
   - `runtimeIdInclude` (string list; defaults to `["*"]` when omitted)
   - `runtimeIdExclude` (string list; defaults to `[]` when omitted)
   - `compile.board` — the canonical board name (`*` for a wildcard target)
   - `compile.backend` — the build backend id (`esp-idf`), optional in legacy files
   - `compile.params` — backend-owned build parameters (e.g. `{"port": "esp32"}`), optional
   - `compile.port` — legacy top-level field; `compile.params["port"]` is preferred and wins
   - `priority`

Runtime matching precedence:

1. Include list grants candidate match (`*` or exact runtime id).
2. Exclude list removes match and takes precedence over include.
3. `runtimeIdPattern` is not supported in the current model.

## Server-Side Web-Target Resolution

`resolve_web_target(target_id, *, workspace_root, runtime_id=None)` turns a UI `targetId`
(`esp32_wroom`, `esp32_s3_mini`, `custom`, `generic_micropython`) into the board + backend the
server should build. It is the single authority for that lookup; the web app no longer resolves
`getCompileTarget(...).board` for the build/deploy request.

- Filters rules by `webTargetId` and, when `runtime_id` is given, the runtime include/exclude
  lists (a `None` runtime — the deploy path has no runtime — matches any runtime).
- Picks the highest-priority unambiguous rule (same priority/ambiguity rule as
  `resolve_compile_target_resolution`).
- A wildcard rule (`compile.board == "*"`) resolves to `board=None`/`backend=None` — the target
  has no concrete board the server can build.
- An id with no matching rule raises `WebTargetUnknownError` with the stable
  `code = "target-unknown"`.

The returned `WebTargetResolution` carries `target_id`, `board`, `backend`, `params`, `rule_id`,
`source`, and `confidence`. `board`/`backend` then resolve to a `BoardTarget` via
`resolve_board_target` (the M4b catalog lookup), which the WS runner calls next.

## Resolution Semantics

1. Match by runtime id + compile board (`*` wildcard allowed).
2. Deterministic selection: `priority` (descending), then declaration order.
3. Ambiguous top-priority matches fail with category `TARGET_MAPPING_AMBIGUOUS`.
4. No match fails with category `TARGET_MAPPING_NO_MATCH`.
5. Missing artifact falls back to builtin generic mapping with warning category `TARGET_MAPPING_FALLBACK`.

## Propagation Contract

Compile-family metadata is propagated to:

1. Compile command JSON output (`target` payload):
   - `board`
   - `port`
   - optional mapping provenance/constraint diagnostics (for example mapping source and confidence)

2. Embedded metadata payload constants (`RUNTIME_IDENTITY_MODE_SUMMARY`):
   - additive `target` object with compile + provenance fields
   - no compile-time requirement to set an exact board `targetId`

3. Writable setup artifacts:
   - `/manifest.json` additive `target` object
   - `/device.json` `targetId`, display/description fields

4. Host setup API call:
   - `apply_bootstrap_setup(options)` with `force` / `forcePaths` only

Target content is **not** propagated into the firmware's writable setup artifacts: the app writes
`/device/targets/active_target.json` itself and firmware never touches that file (see
[user-target-config-architecture.md](../core/user-target-config-architecture.md)).

## Specific Target Selection Contract

The compile board remains a firmware family selector, while specific board identity
is selected in host onboarding.

Compile must not preselect a concrete exact board target id for device identity.

1. Allowed specific targets are derived from `compile_target_mappings.json` using:
   - runtime id (`runtimeIdInclude` / `runtimeIdExclude` with exclude precedence)
   - compile board (`compile.board` exact or `*`)
2. Resolution uses exact board matches first; wildcard board rules are used only when no exact match exists.
3. Allowed target ids are de-duplicated and preserve mapping declaration order.
4. If allowed-target resolution returns an empty set for embedded onboarding, host flow fails with explicit user-visible error.

The staged firmware records that list as `target.allowedWebTargetIds` in the device metadata
(`embedded_metadata_payload.py`), which the host reads on connect (`DeviceState.allowedWebTargetIds`)
and uses to filter the onboarding/target choosers. When the field is absent or empty there is no
filter.

## Target Catalog `runtimeModes`

Each `targets/index.json` entry declares a `runtimeModes` list — the onboarding/deployment modes the
target supports. `"embedded"` marks a concrete board target selectable during embedded onboarding;
`"dynamic"` marks `generic_micropython`, the board-unknown answer for a dynamic runtime. Wildcards
declare no `embedded` mode (the Firmware tab's buildable filter already excludes them).

## Derived User Targets and Base Resolution

A user target is a shipped base plus sparse overrides (`baseTargetId` + `targetData`). The compile
identity is resolved **on the base**: the client sends `baseTargetId` alongside `targetId` in
compile/deploy frames and `resolve_web_target()` resolves the base's mapping rule. An unknown base
answers `base-target-unknown`; a base whose rule is a wildcard answers `base-no-mapping` (it has no
concrete board to build). `DeviceRuntime.getCompileTarget()` mirrors this on the client, resolving a
derived id through `baseTargetId`.

## Bootstrap Defaults for Unset Specific Target

Bootstrap setup writes no target file at all. The only target identity it records is
`/device.json.targetId`, seeded from the compiled image identity
(`RUNTIME_IDENTITY_MODE_SUMMARY['target']['id']`) and `null` when the image records none;
`targetDisplayName` / `targetDescription` stay empty strings (Locked Decision 9). The app overwrites
the triple when it uploads a target.

`/device/targets/active_target.json` therefore does not exist until the app writes it, and the host
treats its absence as "no target selected yet" (a normal state, not a read failure). The file is
written by `DeviceDeployment._uploadTargetConfiguration` only, with the resolved effective target
payload plus the delivery header fields; a payload without pin information is rejected on read and
repaired through onboarding.

Compile-family metadata remains available via additive `/manifest.json.target.compile.*` fields.

## Connect-Time Onboarding Requirement

For embedded runtime mode:

1. On `refreshDeviceInfo()`, if specific target id is unset, host must require target selection.
2. Dialog options are constrained by compile-board mapping rules when compile metadata is available.
3. User custom description is captured in the same dialog and persisted to `/device.json.targetUserDescription`.
4. Devices with already-selected target ids are not re-prompted.

## Target Identity Lifecycle Summary

1. Compile stage: resolve firmware-family compatibility (`target.compile.board`, `target.compile.port`) and mapping constraints/provenance.
2. Compile stage: do not preselect a concrete exact board `targetId`.
3. Onboarding stage: first connect with unset target requires user selection from compile-board-constrained options.
4. Persisted exact target identity is written only by onboarding target configuration updates.

## Warning Categories

1. `TARGET_MAPPING_FALLBACK`
2. `TARGET_MAPPING_WILDCARD`
3. `TARGET_MAPPING_PARTIAL`

## Compatibility Notes

1. Existing readers that only consume runtime identity (`id`, `name`, `version`) continue to work.
2. Legacy `targetId` field remains available for existing host/runtime flows.
3. New target metadata fields are additive.

## Known Board Mappings

The `esp32_s3` target maps to the MicroPython ESP32 port board `ESP32_GENERIC_S3`.
That board's default build auto-detects quad SPIRAM (PSRAM) at startup, which matches the
ESP32-S3 Mini (ESP32-S3 FH4R2: 4 MB flash + 2 MB quad PSRAM), so no `BOARD_VARIANT` is
needed. Use `ESP32_GENERIC_S3` with `BOARD_VARIANT=SPIRAM_OCT` only for octal PSRAM boards;
do not reuse `esp32`.

The `esp32_s2` target is a **standalone** map (no `baseTargetId`) and therefore owns its own rule:
it maps to the MicroPython ESP32 port board `ESP32_GENERIC_S2` with `port: esp32`. The generic S2
build carries no PSRAM variant, so neither `esp32` (classic) nor `ESP32_GENERIC_S3` may be reused.
Its flash offset is `0x1000`, not the S3 board's `0`.

A derived target (e.g. `esp32_s3_mini`, whose file declares `baseTargetId: "esp32_s3"`) carries
**no mapping rule of its own**: one rule exists per **base** id, and `resolve_web_target()` resolves
a derived id through its chain to the base rule. The image records that base id as
`target.buildBaseTargetId`; `allowedWebTargetIds` is retained for pre-M4x images and is no longer the
compatibility authority.

## Frontend Resolution

The host frontend loads `compile_target_mappings.json` as part of `DeviceRuntime#loadDeviceTargets`
and exposes `DeviceRuntime.getCompileTarget(targetId)`, which returns `{ board, port }` for
specific targets (resolving a derived target through its `baseTargetId` via
`getTargetBuildBaseId`) and `null` for wildcard (`*`) / unknown targets. `TargetConfigView` uses this
to display the compile board a selected target maps to.

The Firmware tab treats that `null` as "not buildable here" and leaves such targets out of its
Target dropdown (`FirmwareBuildView._selectableTargets()`), so `generic_micropython` is not
selectable there. The chooser is further intersected with `allowedWebTargetIds` when the connected
board's firmware records them. The server has the last word regardless: a request that names a
wildcard target fails with `target-unknown`.

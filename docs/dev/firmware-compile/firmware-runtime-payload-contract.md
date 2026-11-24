# Firmware Runtime Payload Contract

**Status:** Active
**Scope:** What one built firmware image carries, how a frozen-only runtime reaches the device
filesystem, and how to verify both.

## 1. Purpose and scope

This document pins down the runtime payload of a Micro-Otter firmware image: which files are frozen
into the MicroPython image, what the first boot materializes onto the device filesystem, which parts a
deploy uploads instead, and how to verify the result. It is the contract the build pipeline
(`firmware_compile/`), the device bootstrap (`otter_runtime/`), and the deploy routing
(`device-deployment.ts` / `collection-deployment.ts`) must agree on.

It does **not** restate the packaging, staging, or metadata schemas; those live in
[runtime-packaging-contract.md](runtime-packaging-contract.md), [staging-workflow.md](staging-workflow.md),
and [embedded-metadata-api-contract.md](embedded-metadata-api-contract.md).

## 2. Runtime modes and detection

A runtime reaches a device in one of two ways:

| Mode | Carrier | Deploy behaviour |
|------|---------|------------------|
| `dynamic` | Uploaded as source by the deploy menu | The runtime is copied to the device filesystem (`/`), the same as a collection deploy |
| `embedded` | Frozen into the firmware image | The deploy path skips the runtime upload and runs the embedded-compatibility route instead |

Both modes run the **same** runtime code; only the carrier differs. `embedded` exists so a user with a
compiled image gets a bootable runtime without any source upload, while `dynamic` keeps the normal
source-upload path available.

Detection lives in `DeviceDeployment._resolveRuntimeDeployRoutingDecision()`
(`js/deployment/device-deployment.ts`):

1. `getDeviceInfoData().runtimeDeploymentMode` is authoritative when it reports
   `dynamic` / `embedded` / `unknown`.
2. Device state is authoritative only for `embedded` / `unknown`.
3. Missing information keeps the legacy `dynamic` fallback (so a device that never reports a mode
   still gets a runtime uploaded).
4. An explicit `unknown` yields `undetermined` — no runtime-upload assumption is made.

The decision is logged as `runtime-deploy-routing-decision` with `mode=`, `source=api|fallback`, and
the reason; that line is the diagnosis anchor when a runtime is (or is not) uploaded.

## 3. In-image frozen layout and the relative-name invariant

`ports/esp32/boards/manifest.py` freezes the whole `$(PORT_DIR)/modules` tree with
`freeze("$(PORT_DIR)/modules")`. The frozen entry list of a `general` image is:

- `main` — the frozen `main.py` shim (kept `.py` by `mpySourceExcludes`); the Micro-Otter entry point.
- `otter_main` — the runtime's `run()` module (`.py` in `source-py`, `.mpy` in `compiled-mpy`).
- `otter_runtime/*` — the bootstrap setup, embedded metadata payload, and embedded static assets
  modules.
- `otter_<id>/*` — the frozen node-package modules (`otter_core/system`, `otter_mqtt/umqtt`, …).
- `otter/embedded_manifest.json` + `otter/embedded_hashes.json` — the embedded inventory sidecar that
  `embedded_metadata_payload.py` also carries as a frozen constant for device introspection.
- `app/main_loop.py` — the collection-preserving main loop (kept `.py` by `mpySourceExcludes`).
- Non-Python assets (`html/`, `locales/`, `manifest.json`, `custom_view.json`, `device.json`) are
  embedded as zlib-compressed constants in `embedded_static_assets` / `bootstrap_setup_templates` and
  materialized to `/` at first boot; they are never frozen as modules.

`embedded_metadata_payload.py` carries the runtime identity mode summary, whose additive `target`
object includes `compile` (board/port), the mapping provenance (`mappingRuleId` / `mappingSource` /
`mappingConfidence`), `buildBaseTargetId` — the terminal build base id the image was built against
(null for a board-only build) — and `allowedWebTargetIds` — the web target ids this firmware's board
can onboard, in mapping order (an empty list for an unmapped board). The host reads `buildBaseTargetId`
on connect and compares a target's resolved base id against it; `allowedWebTargetIds` is retained for
pre-M4x images and expanded through the target resolver. See `device-connection.ts`,
`device-state.ts`, and `target-compatibility.ts`.

**The relative-name invariant.** A frozen module name is a dotted relative Python path: no leading
`/`, no drive prefix, no backslash, no `.py`/`.mpy` suffix, no `..`. The name is what
`import <name>` must resolve on the device.

The chain that decides the name:

1. A `.py` file freezes under its manifest target path (relative to `$(PORT_DIR)/modules`).
2. A `.mpy` file freezes under the name embedded in its header — qstr 0 — which
   `tools/mpy-tool.py freeze` reads as `source_file`.
3. `compile_sources_to_sibling_mpy()` therefore passes `mpy-cross -s <staged relative path>` so the
   header name is the staged module path, not the absolute host path it would otherwise embed.

A name that violates the invariant can never be imported and fails the build: the post-build guard
`verify_frozen_module_names()` raises `ArtifactVerificationError` (exit `8`, category
`artifact-verification`) before publish, and the preflight `find_stock_module_problems()` fails a build
whose checkout has a tracked stock module shadowed by a stray `.mpy`.


## 4. First-boot materialized `/`

The frozen `main` shim calls
`otter_runtime.bootstrap_setup_startup.run_bootstrap_setup_from_startup(...)`, which runs
`apply_bootstrap_setup()` and writes the user filesystem **only when a path is missing**:

| Path | Writer |
|------|--------|
| `manifest.json` | `apply_bootstrap_setup()` from `bootstrap_setup_templates` |
| `device.json` | `apply_bootstrap_setup()` from `bootstrap_setup_templates` |
| `app/main_loop.py` | `apply_bootstrap_setup()` |
| `custom_view.json` | `apply_bootstrap_setup()` |
| `html/` | `apply_bootstrap_setup()` from `embedded_static_assets` |
| `locales/` | `apply_bootstrap_setup()` from `embedded_static_assets` |

`/device/targets/active_target.json` is **not** a bootstrap artifact: firmware never writes target
content. The app owns that file and writes it on target selection (see
[user-target-config-architecture.md](../core/user-target-config-architecture.md)).

Because the write is "missing paths only", re-flashing without a wipe preserves user data, and a
dynamic deploy that already populated `/` is not overwritten.

**Explicit non-facts.** There is **no `/boot.py`** on the device: `_boot.py` is MicroPython's own VFS
mounter, frozen into the image. There is **no `/main.py`**: the entry point is the frozen `main`
module. A user filesystem that lists neither is correct, not broken.

## 5. Boot sequence

1. ROM → MicroPython firmware.
2. Frozen `_boot` mounts the littlefs VFS.
3. Frozen `main` runs the `otter_main` shim.
4. `otter_runtime.bootstrap_setup_startup` materializes the first-boot `/` tree (Section 4).
5. `otter_main.run()` starts the console and web server.

The shim reports two failure classes on the console, both prefixed `[error] boot:`:

- `[error] boot: runtime import failed (…)` — `otter_runtime.bootstrap_setup_startup` or `otter_main`
  could not be imported (for example, a frozen module carried an absolute name).
- `[error] boot: bootstrap setup trigger failed (…)` — the import worked but the setup trigger raised.

## 6. Deploy routing matrix

Firmware is a baseline, never the only source of truth. Per collection deploy, each needed package is
classified against the firmware (`collection-deployment.ts`) and, for the runtime itself, by the
routing mode (`device-deployment.ts`):

| Situation | Decision | Behaviour |
|---|---|---|
| Runtime is `embedded` | skip runtime upload | Run the embedded-compatibility route; validate the collection against the embedded package list |
| Package bundled in the firmware and current | `available-embedded` | Keep the firmware copy, remove any stale local copy |
| Package not bundled in the firmware | `missing` | Upload the package source; warn `deployment.packageNotInFirmware` (extra RAM) |
| Firmware bundles it, host copy is newer, or firmware version unknown | `override-required` | Confirm, then upload the complete package source (tagged `override-embedded`); warn about RAM |
| Runtime is `dynamic` (or mode undetermined) | runtime source upload | The runtime and every needed package take the source path |

This matrix restates the roadmap's non-negotiable rule: `BuildBackend`/`FlashBackend` produce and flash
images only; they never gate or replace this path.

`otter/embedded_hashes.json` describes the same tree after the `.py`→`.mpy` reconciliation, so it
always matches `frozen_content.c` minus MicroPython's own modules.

## 7. Verification recipe

**Build side (mandatory, no device needed):**

```bash
# 1. No absolute frozen names (this was 81 in the broken image; must be 0).
grep -c 'MICROPY_FROZEN_LIST_ITEM("/' \
  /opt/micropython/ports/esp32/build-ESP32_GENERIC_S3/frozen_content.c

# 2. The entry points and package modules freeze under relative names.
grep -o 'MICROPY_FROZEN_LIST_ITEM("[^"]*"' \
  /opt/micropython/ports/esp32/build-ESP32_GENERIC_S3/frozen_content.c \
  | grep -E '"(main|otter_main|otter_runtime/[a-z_]+|otter_[a-z_]+/[a-z_]+)"'

# 3. MicroPython's stock modules are intact after the build.
git -C /opt/micropython status --porcelain ports/esp32/modules   # no " D " line
```

A build that would publish an absolute-named image fails first with
`ARTIFACT_VERIFICATION_ERROR` (exit `8`, category `artifact-verification`); a build in a checkout
whose tracked stock module is shadowed by a stray `.mpy` fails in preflight with the
`git -C <root> checkout -- ports/<port>/modules` hint.

**Device side (needs a reachable device):**

```python
import os
sorted(os.listdir('/'))
# expect: ['app', 'custom_view.json', 'device', 'device.json', 'html', 'locales', 'manifest.json']

import otter_runtime.embedded_metadata_payload  # frozen under a relative name
open('/otter/embedded_hashes.json')             # the sidecar still describes the .mpy tree
```

Acceptance: the listing matches, no `[error] boot:` line appears, `/boot.py` and `/main.py` do **not**
exist, the web server answers, and onboarding completes.

## 8. Related

- [runtime-packaging-contract.md](runtime-packaging-contract.md) — file groups, path mapping, metadata schema.
- [staging-workflow.md](staging-workflow.md) — how the modules tree is assembled and precompiled.
- [mpy-precompilation/workflow.md](../mpy-precompilation/workflow.md) — `mpy-cross -s` and mpy-only packaging.
- [embedded-metadata-api-contract.md](embedded-metadata-api-contract.md) — the `otter_runtime` metadata and setup API.
- [firmware-deploy-contract.md](firmware-deploy-contract.md) — flashing and image resolution.
- [build-pipeline-integration.md](build-pipeline-integration.md) — pipeline order and the guards.
- [device-folder-structure.md](../device-communication/device-folder-structure.md) — the on-device tree.


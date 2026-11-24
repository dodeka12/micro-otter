# Device-Info Ownership and Onboarding Lifecycle

## Purpose

Define the canonical ownership and lifecycle boundary between `DeviceConnection` and `DeviceDeployment` for device-info loading, embedded onboarding, and dynamic runtime install behavior.

## Ownership Contract

1. `DeviceConnection` owns:
- transport-backed device-info reads
- canonical device-info cache/state authority
- initialization status emission (`device-initialization-status`)
- embedded onboarding loop when the stored target is missing or unusable
- adapter-config upload as part of embedded onboarding completion
- post-onboarding reread and second-pass failure handling

2. `DeviceDeployment` owns:
- runtime and collection deployment orchestration
- dynamic runtime install/upgrade/refresh/remove flows
- reacting to `DeviceConnection` canonical status and cache
- connect/refresh orchestration through `DeviceConnection` APIs only
- onboarding dialog rendering and target persistence (the single writer below)

## Single Writer

`/device/targets/active_target.json` has exactly one writer: `DeviceDeployment._uploadTargetConfiguration`,
reached from onboarding or `reconfigureDeviceTarget()`. Firmware bootstrap setup never creates or
touches the file, which is why its absence is a normal state rather than an error.

## Stored-Target Verdicts

`DeviceConnection` reads the file through `isCompleteActiveTargetPayload()`
(`js/data/target-payload.ts`) and only adopts a payload carrying pin information:

- file missing → verdict `missing` (logged as info, `load-target-config-missing`)
- incomplete/legacy skeleton (no pin information) → verdict `incomplete`
  (`load-target-capabilities-incomplete`)
- malformed JSON → nothing adopted (`load-target-capabilities-failed`), no verdict

`DeviceDeployment` then adds the one verdict the connection cannot make: a stored target whose base
id falls outside the flashed image's board family → `image-incompatible`
(`target-config-image-incompatible`, `result: 'reject'`). A rejected target becomes
`deviceTargetInfo = null` plus `targetConfigurationIssue`, which is what makes the initialization
verdict `needs-onboarding`. Nothing judges a target when there is no runtime to resolve its base id;
such a target is kept.

This is the ESP32-S3 Mini symptom fixed here: an older bootstrap wrote a five-key skeleton that the
reader used to adopt, so validation ran against a target with no pin capabilities and `irq`-using
graphs silently lost their capability. The skeleton is now rejected as `incomplete` and repaired.

## Canonical Status Semantics

Use existing initialization status fields from `DeviceConnection`:

- no compiled firmware / dynamic install eligible:
  - `initializationVerdict = 'ready-for-runtime-install'`
  - `runtimeDeploymentMode = 'dynamic'`

- embedded runtime present but target not initialized:
  - `initializationVerdict = 'needs-onboarding'`
  - `runtimeDeploymentMode = 'embedded'`

"Not initialized" covers both "no target stored" and "stored target rejected" — the reader verdicts
above are the only inputs; an unusable payload is never upgraded into a usable one.

This distinction allows the UI/deployment layer to keep dynamic upload controls available while routing embedded target onboarding through `DeviceConnection`.

## Deterministic Embedded Onboarding Sequence

1. Connect via `DeviceConnection`.
2. Load device info and emit initialization status.
3. If the embedded runtime's stored target is missing or unusable, run onboarding selection:
   `DeviceDeployment._promptTargetSelection` renders the dialog through
   `ViewManager.showFormDialog`, filtered by `targetConstraints.allowedTargetIds` from the image's
   compile-board mapping, pre-filled with the rejected payload's `targetId`
   (`getConfiguredTargetIdHint()`) and `device.json`'s `targetUserDescription`, so repair is one
   confirmation instead of a fresh choice.
4. Upload target configuration through onboarding adapter — the write goes through
   `DeviceDeployment._uploadTargetConfiguration`, the single writer.
5. Reread device info in the same `DeviceConnection` flow.
6. If the target is still rejected on second pass, show onboarding error and fail the load.

## Guardrails

- Do not add a second deployment-owned transport read path for device info.
- Do not move dynamic runtime upload/install ownership into `DeviceConnection`.
- Do not add parallel onboarding orchestration paths in deployment code.

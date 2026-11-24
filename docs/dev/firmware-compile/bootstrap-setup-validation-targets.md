# Bootstrap Setup Validation Targets

**Status:** Handoff Input  
**Scope:** Validation targets for firmware-owned bootstrap setup behavior.

## Objective

Provide the canonical validation matrix for bootstrap setup delivery:

1. Status API correctness.
2. Setup API idempotent create/repair behavior.
3. Startup auto-setup idempotency.
4. Host orchestration and view UX integration.

## Contract Areas To Validate

### 1. Setup Status API

Validate `get_bootstrap_setup_status()`:

1. Returns `schemaVersion`, `ready`, `files`, `missingOrInvalid`, `errors`.
2. Reports `missing` and invalid-schema reasons deterministically.
3. Returns `ready=true` only when all required writable files are present and minimally valid.
4. Required paths are `/manifest.json`, `/device.json`, `/app/main_loop.py`, plus the runtime's
   custom view path when one is declared — three writable files plus an optional custom view.
5. Target content is **not** part of status: there is no `/device/targets/active_target.json` row,
   and no device-side target-payload validation. The app owns that file.
6. The `/device.json` schema it checks is the firmware-owned identity block: `runtime`, `version`,
   `targetId`, `targetConfigPath` (plus the app-owned `targetDisplayName`, `targetDescription`,
   `targetUserDescription`). `targetId` is seeded from
   `RUNTIME_IDENTITY_MODE_SUMMARY['target']['id']` (the image's base target, `null` when the image
   declares none) and `targetConfigPath` is the constant `ACTIVE_TARGET_PATH`; the app later
   overwrites `targetId` and fills the display/description fields.

Primary tests:

- `tests/test_runtime_bootstrap_setup_status_api.py`
- `tests/test_runtime_bootstrap_setup_contract.py`

### 2. Setup Apply API

Validate `apply_bootstrap_setup(options=None)`:

1. Returns normalized payload with `schemaVersion`, `ok`, `results`, `errors`.
2. Uses action vocabulary only: `created`, `updated`, `unchanged`, `error`.
3. Applies preservation rules for user-editable `device.json` fields.
4. Creates/repairs the required writable files only:
   - `/manifest.json`
   - `/device.json`
   - `/app/main_loop.py`
5. Accepts `force` / `forcePaths` only — there is no `targetMetadata` option and no target branch in
   `_build_template_text_by_path`, so a lossy first write can no longer become permanent.
6. Leaves `/device/targets/active_target.json` untouched; firmware never writes target content, and
   the deleted `_validate_active_target_payload` (with its `capabilities` requirement) has no
   replacement because the app is the only writer and validates before writing.
7. Is idempotent across repeated runs.

Primary tests:

- `tests/test_runtime_bootstrap_setup_apply_api.py`
- `tests/test_runtime_bootstrap_setup_templates.py`

### 3. Startup Auto-Setup Trigger

Validate startup helper wiring and once-per-boot guard:

1. Startup path calls shared bootstrap setup helper.
2. Auto-setup path is idempotent and safe across repeated startup calls.
3. Startup path still reaches `libs.micro_otter_main.run()` contract.

Primary tests:

- `tests/test_runtime_bootstrap_setup_startup.py`
- `tests/test_firmware_compile_staging_startup.py`

### 4. Host Deployment Orchestration

Validate API-only host embedded setup behavior:

1. Embedded route uses `apply_bootstrap_setup()` (no host bootstrap file composition).
2. Setup errors surface deterministic user-facing failures with setup results.
3. Post-setup `refreshDeviceInfo()` is always required and executed on success.
4. State fields include `bootstrapSetupReady` and `bootstrapSetupStatus`.

Primary tests:

- `tests/deployment/device-deployment-step3.test.js`
- `tests/data/device-state.test.js`
- `tests/deployment/bootstrap-setup-contract.test.js`

### 5. Deployment View UX

Validate setup UX semantics and retry behavior:

1. Prompt/action text references running setup API.
2. Setup result summary renders per-file actions.
3. Recoverable failures keep retry path available.

Primary tests:

- `tests/views/device-deployment-view-runtime-mode-gating.test.js`

### 6. Specific Target Onboarding

Validate compile-family filtered specific-target onboarding behavior:

1. Allowed specific target options derive from `compile_target_mappings.json` (runtime id + compile board).
2. Bootstrap seeds `/device.json.targetId` from the image identity and writes no target file; display
   and description stay empty until the app uploads a target.
3. Embedded connect/refresh prompts when the stored target is absent or unusable (no pin information,
   image-incompatible, or unreadable), persists selection + custom description, and does not
   re-prompt after a complete target exists.
4. Reader verdicts and log keys:
   - missing file → `missing` (`load-target-config-missing`, info, not an error)
   - incomplete/legacy skeleton → `incomplete` (`load-target-capabilities-incomplete`, info)
   - malformed JSON → no target adopted (`load-target-capabilities-failed`)
   - image-family mismatch → `image-incompatible` (`target-config-image-incompatible`,
     `result: 'reject'`)
5. Confirming the onboarding dialog rewrites `/device/targets/active_target.json` through
   `DeviceDeployment._uploadTargetConfiguration` — the single writer.

Primary tests:

- `tests/deployment/device-deployment-target-workflow.test.js`
- `tests/deployment/device-deployment-target-validity.test.js`
- `tests/test_runtime_bootstrap_setup_templates.py`

## Focused Validation Commands

```bash
pytest tests/test_runtime_bootstrap_setup_contract.py \
  tests/test_runtime_bootstrap_setup_templates.py \
  tests/test_runtime_bootstrap_setup_startup.py \
  tests/test_runtime_bootstrap_setup_status_api.py \
  tests/test_runtime_bootstrap_setup_apply_api.py \
  tests/test_firmware_compile_staging_startup.py

node --import tsx --test \
  tests/deployment/bootstrap-setup-contract.test.js \
  tests/data/device-state.test.js \
  tests/deployment/device-deployment-step3.test.js \
  tests/deployment/device-deployment-target-workflow.test.js \
  tests/deployment/device-deployment-target-validity.test.js \
  tests/views/device-deployment-view-runtime-mode-gating.test.js
```

## Exit Criteria

1. All contract-level tests pass for status/apply/startup APIs.
2. Embedded host deploy route remains API-only.
3. Deployment view communicates setup API behavior and result outcomes clearly.
4. No regressions in dynamic runtime deploy route.

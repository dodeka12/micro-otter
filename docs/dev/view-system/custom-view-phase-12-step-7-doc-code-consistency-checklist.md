# Custom View Phase 12 Step 7 - Doc/Code Consistency Checklist

**Status**: Applied
**Applied On**: 2026-04-02

## Purpose

Lock documentation-to-code consistency for custom-view schema version, execution entrypoints, runtime-impact semantics, and structured return payload expectations.

## Checklist

- [x] D1. Schema version is consistent between architecture docs and runtime definition files.
- [x] D2. Execution entrypoint contract in docs matches renderer implementation (`executeCustomViewAction(...)`, no direct fallback path).
- [x] D3. Runtime-impact semantics in runtime action declarations conform to documented allowed values.
- [x] D4. General runtime custom-view actions declare no-impact semantics where applicable.
- [x] D5. Device-side function implementations used by general runtime custom view return structured JSON payloads.

## Applied Audit (2026-04-02)

### Evidence

| ID | Result | Evidence |
| --- | --- | --- |
| D1 | PASS | Docs use `custom-view-v1` schema and `src/micro_otter/nodes/device/runtime/general/custom_view.json` uses `$schema: https://micro-otter.dev/schemas/custom-view-v1.json`. |
| D2 | PASS | Docs define `DeviceConnection.executeCustomViewAction(functionName, parameters, { runtimeImpact })`; renderer executes through `_deviceConnection.executeCustomViewAction(...)` and rejects direct fallback (`direct executeCode fallback is not supported`). |
| D3 | PASS | Runtime function declarations in `custom_view.json` use supported `runtimeImpact` values (`none`, `stop`, `restart`) or omit per contract. |
| D4 | PASS | General runtime actions `create_runtime_settings`, `read_runtime_settings`, and `check_wifi_status` explicitly declare `runtimeImpact: none`. |
| D5 | PASS | `check_wifi_status`, `read_runtime_settings`, and `create_runtime_settings` in `app/custom_settings.py` return `json.dumps(...)` structured payloads with expected data/success-error forms. |

## Automation Guard

- Guard test: `tests/data/custom-view-doc-code-consistency.test.js`
- Focused run: `node --import tsx --test tests/data/custom-view-doc-code-consistency.test.js`

## Outcome

Step 7 consistency checks are documented and enforced with a focused regression guard.

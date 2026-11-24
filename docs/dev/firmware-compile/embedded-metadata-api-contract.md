# Embedded Metadata and Bootstrap Setup API Contract

**Status:** Implemented Contract  
**Scope:** Runtime API boundary for embedded-mode metadata retrieval and firmware-owned bootstrap setup.

## Purpose

Define the stable runtime API contract used by host deployment logic to:

1. Detect embedded runtime mode and load immutable embedded metadata.
2. Query writable-file bootstrap setup status.
3. Invoke firmware-owned bootstrap setup/repair.

This contract removes host-side file composition assumptions for embedded bootstrap.

## API Module

- Runtime module: `runtime.embedded_metadata_api`
- Host call boundary: `DeviceConnection.executeCode(...)`
- Host envelope markers:
  - Metadata query: `OTTER_EMBEDDED_API_START` / `OTTER_EMBEDDED_API_END`
  - Setup status query: `OTTER_BOOTSTRAP_SETUP_API_START` / `OTTER_BOOTSTRAP_SETUP_API_END`
  - Setup apply query: `OTTER_BOOTSTRAP_APPLY_API_START` / `OTTER_BOOTSTRAP_APPLY_API_END`

## Required API Functions

1. `get_runtime_identity_mode_summary()`
2. `get_embedded_packages_summary()`
3. `get_embedded_inventory_hash_payload()`
4. `get_embedded_metadata_bundle()`
5. `get_bootstrap_setup_status()`
6. `apply_bootstrap_setup(options=None)`

## Metadata Bundle Response

Host-side extraction expects:

```json
{
  "ok": true,
  "payload": {
    "runtime": {
      "mode": "embedded",
      "id": "general",
      "name": "General Runtime",
      "version": "1.11.0",
      "description": "optional"
    },
    "packagesSummary": {
      "totalPackages": 0,
      "totalFiles": 0,
      "totalBytes": 0,
      "packages": []
    },
    "inventory": {
      "schemaVersion": 1,
      "files": []
    }
  }
}
```

Unavailable/error envelope:

```json
{
  "ok": false,
  "error": "embedded metadata unavailable"
}
```

## Bootstrap Setup Status Response

`get_bootstrap_setup_status()` returns:

```json
{
  "schemaVersion": 1,
  "ready": false,
  "files": [
    { "path": "/manifest.json", "exists": true, "valid": true, "reason": null },
    { "path": "/device.json", "exists": false, "valid": false, "reason": "missing" }
  ],
  "missingOrInvalid": [
    { "path": "/device.json", "reason": "missing" }
  ],
  "errors": []
}
```

## Bootstrap Setup Apply Response

`apply_bootstrap_setup(options=None)` returns:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "results": [
    { "path": "/manifest.json", "action": "updated", "reason": null },
    { "path": "/device.json", "action": "created", "reason": null },
    { "path": "/app/main_loop.py", "action": "unchanged", "reason": "exists" }
  ],
  "errors": []
}
```

Action vocabulary: `created`, `updated`, `unchanged`, `error`.

Options: `force` and `forcePaths` only. There is no `targetMetadata` option — firmware never writes
target content. Setup never overwrites an existing file unless `force` / `forcePaths` names it, which
is why a lossy first write used to be permanent.

Templates come from `_build_template_text_by_path`, which builds `manifest.json`, `device.json`,
`app/main_loop.py` and the optional custom view path; there is no target branch. `device.json` is
generated with firmware-owned identity only: required fields `runtime`, `version`, `targetId`,
`targetConfigPath`, where `targetId` is seeded from `RUNTIME_IDENTITY_MODE_SUMMARY['target']['id']`
(`null` when the image records none) and display/description stay empty. The app overwrites the
target triple on upload.

Error categories: `validation`, `filesystem`, `runtime`, `unknown`.

## Contract Rules

1. API-first detection: runtime mode and embedded metadata are loaded from API payloads.
2. Firmware-owned setup: writable bootstrap files are created/repaired by firmware APIs.
3. Host orchestration is API-only: host does not compose or write embedded bootstrap compatibility files.
4. Post-setup refresh is required: host must call `refreshDeviceInfo()` after successful setup apply.
5. Dynamic fallback: if metadata API is unavailable or invalid, deploy routing falls back to dynamic behavior.
6. Deterministic JSON-compatible payloads only: dict/list/string/number/bool/null.

## Startup Auto-Setup Notes

- Firmware startup calls shared idempotent setup helper (`ensure_bootstrap_setup_once()`) through target startup adapters.
- Startup auto-setup uses the same canonical setup engine as `apply_bootstrap_setup()`.

## Related

- `src/micro_otter/nodes/device/runtime/general/libs/runtime/embedded_metadata_api.py`
- `src/micro_otter/nodes/device/runtime/general/libs/runtime/bootstrap_setup_contract.py`
- `src/micro_otter/nodes/device/runtime/general/libs/runtime/bootstrap_setup_startup.py`
- `src/micro_otter/nodes/html/js/deployment/device-deployment.ts`

# Firmware Deploy Contract

One finished firmware image, one board, one port. This contract covers the headless deploy helper in
`src/micro_otter/tools/firmware_compile/firmware_deploy.py`, which is the single entry point for
flashing from the CLI (`mo deploy-runtime --firmware … --json-output`) and from the server
(`deploy.start`). It is *not* part of the collection-deploy pipeline: nothing here stages, builds,
hashes, or uploads node-package source.

## Entry points

| Symbol | Purpose |
|--------|---------|
| `FirmwareDeployRequest` | Normalized inputs of one deploy. The dataclass *is* the normalized form; callers build it directly. |
| `flash_firmware(request, *, on_event=None, environ=None)` | Verify the image, select a backend, flash, and return a `FirmwareDeployReport`. |
| `resolve_firmware_image(*, board_spec, firmware_path=None, runtime_id=None, channel=None, publish_root=None)` | Return the image to flash: an explicit path wins, otherwise the newest published image for the board (optionally narrowed to a channel). |
| `resolve_latest_firmware_for_board(*, board_id, runtime_id=None, content_hash=None, channel=None, publish_root=None)` | Pure filesystem lookup behind the resolver; `None` when nothing matches. |
| `build_deploy_payload(outcome, *, request=None)` | The only serializer for the deploy surface (CLI and `WS /firmware` both use it). |
| `FirmwareDeployError` (+ `FirmwareImageUnavailableError`, `FirmwareImageInvalidError`, `FirmwareBoardUnsupportedError`) | Structured failure family with a stable `code`, `category`, `exit_code`, `details`, and `hint`. |

## Request fields

| Field | Meaning |
|-------|---------|
| `board_spec` | Catalog entry (`BoardSpec`) that supplies the board id, chip, flash offset, and default backend. |
| `port` | Serial port path, e.g. `/dev/ttyUSB0`. |
| `firmware_path` | The `.bin` to flash. Always the resolved absolute path by the time a backend sees it. |
| `backend_id` | Pinned flash backend id, or `None` for the documented precedence. |
| `wipe_filesystem` | Pass the backend's filesystem wipe. Default `False`. |
| `timeout_seconds` | Bound on the tool invocation. Default `None` (the backend's own default). |

`monitor` is deliberately absent: monitoring is a build-directory feature (`MonitorNotSupportedError`
already encodes that rule), so the helper rejects it by construction instead of carrying a flag it can
never honour. The request also carries no package, node-graph, or upload field, mirroring the
`FlashRequest` invariant in [flash-backend-contract.md](flash-backend-contract.md#source-upload-boundary).

## Steps

1. **Verify.** `_verify_image` delegates to `verify_firmware_artifact`, so the missing-file and
   empty-file rules have exactly one implementation. A failure is `firmware-image-invalid`.
2. **Reject an unflashable board.** A catalog entry without a chip raises `board-not-flashable` before
   any tool runs.
3. **Select a backend.** `select_flash_backend_for_board` owns the precedence — requested `backend_id`
   → `MICRO_OTTER_FLASH_BACKEND` → the board's catalog default → `auto`. Registry failures are
   translated into the deploy error family, never re-raised as adapter errors.
4. **Flash.** `backend.flash(FlashRequest(...), on_event)` runs the tool invocation. `on_event` is
   forwarded verbatim, so the same `FlashEventKind` stream reaches the CLI and the server; nothing here
   renames, buffers, or filters it.
5. **Report.** A `FirmwareDeployReport` carries `exit_code`, `board_id`, `port`, `backend_id`,
   `firmware_path`, `size_bytes`, `sha256`, and an optional `message`.

Everything stays synchronous. The server runs `flash_firmware` in a worker thread, which keeps the
seam free of event-loop concerns, matching the `FlashBackend` contract.

A non-zero `FlashResult.exit_code` is a *completed but failed* flash and is reported, never raised: the
CLI needs the process exit code and the server needs a failed-but-terminal `result` frame. Only
unrecoverable setup problems raise.

## Image resolution

`resolve_firmware_image` prefers an explicit `firmware_path` and otherwise asks
`resolve_latest_firmware_for_board` for the newest published image:

- The folder comes from `local_firmware.resolve_publish_root`, so `MICRO_OTTER_FIRMWARE_DIR` and
  `micro-otter.toml` keep working. This is a pure filesystem read: no device access, no subprocess.
- Only `.bin` files whose name parses as a firmware filename for the requested board (and, when given,
  the requested runtime) are candidates.
- `resolve_latest_firmware_for_board` also accepts an optional `content_hash`: when given, only the
  `.bin` whose name records that hash is a candidate, so a deploy can request an exact content
  combination. The sidecar manifest (not the filename alone) is the authority for the hash.
- `channel` (optional, `release`/`dev`) narrows the candidates to that channel; `None` keeps the
  newest-across-channels behaviour. There is **no** cross-channel fallback: a requested-but-empty
  channel raises `firmware-image-unavailable` with `details.channel` next to `boardId`/`runtimeId`/
  `publishRoot` — deploying a dev image when a release was requested is the failure this prevents.
- Candidate versions order by `_version_sort_key`: strict `x.y.z` values rank above any other name and
  compare numerically; non-semver names still order deterministically, so the newest pick is never
  ambiguous.
- Nothing matching raises `FirmwareImageUnavailableError` (`firmware-image-unavailable`) with
  `details.boardId`, `details.runtimeId`, `details.publishRoot`, and a hint naming both `mo cr` and
  `MICRO_OTTER_FIRMWARE_DIR`.

Imported firmware packages ([firmware-packages.md](firmware-packages.md)) land in the same publish
root with the same filename identity, so `resolve_firmware_image` resolves an imported image exactly
like a locally built one — import is a filesystem operation only and never selects or flashes
anything.

## Firmware manifest

Every published image is accompanied by a sidecar `firmware-manifest.json` written next to the
`.bin` (`<name>.manifest.json`). The manifest is the self-describing record of what the image
contains — the authoritative home for the content hash, the per-backend constituents, and the
embedding decision:

- `backend`, `board`, `slug`, `platformVersion`, `runtime {id, version}`,
  `runtimeFirmwareVersion`, and `contentHash` (from `firmware_content_hash`, computed over the
  logical contents, never the raw binary).
- `constituents` — a per-backend `str → str` map (`esp-idf`: runtime-source/device-tools/
  runtime-assets versions).
- `embeddedPackages` (`id → version`) versus `notEmbedded` (ids the backend cannot embed). The split
  is explicit: a `notEmbedded` package still flows through the collection source-upload path, exactly
  as it would have without the manifest.
- `modulePackagingMode`, `optimizationLevel`, `fileHashes` (path → `sha256:<hex>`), and
  `build` (git source, finished-at) — informational; `build` is never part of the hash.

The embedded `/otter/embedded_manifest.json` inside the firmware stays unchanged for device
introspection; the sidecar is the external copy that travels with the publish.

## Deploy payload

`build_deploy_payload` is the single serializer: the CLI prints exactly what the server sends, so a
client cannot see a different shape depending on the entry point.

| Field | Content |
|-------|---------|
| `schemaVersion` | `1`. |
| `status` | `succeeded` when `exitCode == 0`, else `failed`. |
| `board` | `{id, chip}`; `chip` is `null` when no request was supplied. |
| `port` | The port the backend reported, falling back to the request. |
| `backend` | The backend id that ran, falling back to the error's `details.backend_id`, then the request. |
| `firmware` | `{path, sizeBytes, sha256}`; `sizeBytes`/`sha256` are `null` on a failure. |
| `exitCode` | The process exit code the CLI would return. |
| `errors` | Empty on success; one `build_error_object` entry (`code`, `category`, `message`, `details`, `hint`) on failure. |
| `warnings` | Always empty: the deploy path has no advisory findings today. |

Unknown hardware detail is reported as `null` rather than omitted, so a client can render the payload
with a fixed field set.

## Flash error codes

`FLASH_ERROR_CODES` is the complete family. The code is derived from the adapter exception class:
strip a trailing `Error`, split camel case, drop the redundant `flash` token, and prefix `flash-`
(`_flash_error_code`). Listing them explicitly is what lets
[firmware-build-websocket-protocol.md](firmware-build-websocket-protocol.md) and
`tests/test_firmware_contract_invariants.py` assert set equality instead of re-deriving the rule.

| Code | Adapter exception | Meaning |
|------|-------------------|---------|
| `flash-backend` | `FlashBackendError` | Generic adapter failure. |
| `flash-error` | (fallback) | Class name yields no category. |
| `flash-firmware-image-not-found` | `FirmwareImageNotFoundError` | The backend cannot find the image. |
| `flash-tool-missing` | `FlashToolMissingError` | The flasher executable is missing. |
| `flash-monitor-not-supported` | `MonitorNotSupportedError` | A monitor was requested where none exists. |
| `flash-command` | `FlashCommandError` | The flasher ran and exited non-zero. |
| `flash-backend-unavailable` | `FlashBackendUnavailableError` | The backend reports itself unusable. |
| `flash-unsupported-chip` | `UnsupportedFlashChipError` | The chip is not supported by this backend. |
| `flash-no-available-backend` | `NoAvailableFlashBackendError` | No backend is available at all. |
| `flash-unknown-backend` | `UnknownFlashBackendError` | An unknown backend id was requested. |

Structured detail is copied from a fixed allowlist (`backend_id`, `tool`, `chip`, `returncode`,
`detail`, `supported_chips`, `known_backend_ids`, `considered_backend_ids`), so an adapter cannot leak
arbitrary object state into a payload a client reads.

The deploy error family's own codes sit alongside them: `firmware-image-unavailable` and
`firmware-image-invalid` (exit code 3), and `board-not-flashable` (exit code 2). The base class default
`firmware-deploy-failed` is a defensive fallback — every path in `flash_firmware` sets a more specific
code, so it never reaches a client.

## Boundary: what a deploy never does

- It never builds, stages, precompiles, or writes hashes. `mo cr` produces the `.bin`; this contract
  only writes it to a board.
- It never uploads node-package source and never reads a deploy plan. A flash result — success or
  failure — is **not** an input to the collection-deploy decision: `missing` and `override-required`
  packages are still uploaded by `runtime-deployment.ts` regardless of what, or how, the last image
  flash did. See
  [deployment-system-architecture.md](../deployment/deployment-system-architecture.md).
- It never touches a second board. One request is one image, one port, one backend invocation.

## Related

- [flash-backend-contract.md](flash-backend-contract.md) — the backend seam (`FlashBackend`,
  `FlashRequest`, event vocabulary, esptool argv) this helper drives.
- [board-catalog-contract.md](board-catalog-contract.md) — where chip, flash offset, and the default
  backend come from.
- [firmware-versioning-and-artifact-publish-contract.md](firmware-versioning-and-artifact-publish-contract.md)
  — where a published `.bin` gets its name and version.
- [firmware-build-websocket-protocol.md](firmware-build-websocket-protocol.md) — how `deploy.start`
  frames reach this helper and how its payload comes back.
- [server-firmware-api.md](server-firmware-api.md) — the `firmware-deploy` feature that gates the job.
- [docs/tools/firmware-compile-reference.md](../../tools/firmware-compile-reference.md) —
  `mo deploy-runtime --firmware … --json-output`.
- Tests: `tests/test_firmware_deploy.py`, `tests/test_local_firmware.py`,
  `tests/test_firmware_compile_flash_backends.py`, `tests/test_firmware_contract_invariants.py`.

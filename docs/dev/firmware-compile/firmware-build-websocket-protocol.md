# Firmware Build WebSocket Protocol

The frame contract of `WS /firmware`: eight client frames, four server frames, one job at a time per
connection. This document is the client-facing spec; `src/micro_otter/tools/firmware_ws_handler.py`
is its only implementation, and `tests/test_firmware_contract_invariants.py` fails if the code table
below and the module's `ERROR_CODES` ever disagree.

The endpoint extends the frame contract introduced by
[firmware-build-deploy-view phase 6](../../../ldev/todos/firmware-build-deploy-view/phase-6-firmware-websocket-handler.md)
**additively**: no frame `type` is removed or renamed and every added frame carries only new fields,
so a client written against the parent contract keeps working. `firmware.import` (M4o) and
`addon.install` / `addon.uninstall` (M4p) were added this way.

## Connection lifecycle

1. The client opens a WebSocket to `ws://<host>:8000/firmware`. The upgrade passes the same
   `Host`/`Origin` trust check as every other endpoint, so a foreign origin is refused with HTTP `403`
   before any frame is exchanged (see [server-firmware-api.md](server-firmware-api.md#trust-model)).
2. The client sends one job frame. The server answers `status` (`queued`), then `status` (`running`)
   frames per stage, any number of `output` frames, and exactly one terminal frame — `result` or
   `error`.
3. The client may send another job frame after the terminal frame; the connection stays open.
4. A `cancel` frame asks the running job to stop. It never produces a frame of its own; the job's own
   terminal frame reports the outcome.
5. Closing the socket cancels whatever is still running, exactly as `cancel` would.

**One job per connection.** A second job frame while a job is active is answered with a `job-busy`
error frame and the running job keeps going. Two browser tabs may each run a job; the guard is per
connection.

## Client → server frames

| `type` | Fields | Purpose |
|--------|--------|---------|
| `compile.start` | `runtimeId`*, `board`†, `targetId`, `packageIds`, `packageVariants`, `modulePackagingMode`, `cleanBuild`, `timeoutSeconds` | Build a firmware image. |
| `deploy.start` | `board`†, `port`*, `targetId`, `firmwarePath`, `backendId`, `wipeFilesystem`, `timeoutSeconds` | Flash a firmware image to a board. |
| `scan-local` | `runtimeId`* | Read-only local package inventory; no build, no device access. |
| `firmware.list` | — (every field is ignored) | Read-only firmware inventory over the publish root; the server computes `isLatest`. |
| `firmware.delete` | `firmwarePath`* | Delete one published image (bin + sidecar) after a path-containment check. Gated on `firmware-compile`. |
| `firmware.import` | `path`‡, `url`‡, `force` | Import one `.firmware.zip` package (resolved from a server path or URL) into the publish root. Gated on `firmware-compile`. |
| `firmware.import-binary` | `path`‡, `url`‡, `targetId`*, `force` | Import one raw `.bin` image (resolved from a server path or URL) into the publish root under a synthesized imported name. Gated on `firmware-compile`. |
| `firmware.export` | `firmwarePath`*, `destinationDir`*, `force` | Package one published image into `<stem>.firmware.zip` inside a caller-picked folder. Gated on `firmware-compile` and `local-file-access`. |
| `addon.install` | `path`‡, `url`‡, `force` | Install one add-on package archive (resolved from a server path or URL) into the addons folder. No capability gate. |
| `addon.uninstall` | `packageIds`* | Remove installed add-on packages from the addons folder. No capability gate. |
| `fs.list` | `requestId`*, `path`, `extensions`, `showHidden` | Read-only side channel: list one directory on the server's machine. Gated on `local-file-access`. |
| `cancel` | — (every field is ignored) | Ask the running job to stop. |

`*` = required. `†` = required unless `targetId` is present, in which case the server
resolves the board from the mapping rules. `‡` = exactly one of `path` / `url`.

### `compile.start`

| Field | Type | Meaning |
|-------|------|---------|
| `runtimeId` | string | Runtime whose manifest decides staging, e.g. `"general"`. |
| `board` | string | Catalog board name, e.g. `"esp32"`. Optional when `targetId` is present. Validated against the board catalog; an unknown id is `board-unknown`. |
| `targetId` | string | Selects the board via the mapping rules when `board` is absent; a wildcard or unknown target is `target-unknown`. |
| `baseTargetId` | string | Optional base of a derived user target; when present the board is resolved on the base (an unknown base is `base-target-unknown`, a wildcard base is `base-no-mapping`). |
| `packageIds` | array of string | Narrows what the image embeds. Normalized (trim, drop blanks and duplicates); empty or absent means "every stageable package". See [package-selection.md](package-selection.md). |
| `packageVariants` | object of string | Explicit `packageId → variantId` overrides; `"py"` selects the default implementation and is `variant-unknown` for a package without one. Normalized (blank values dropped). |
| `modulePackagingMode` | string | `source-py` (default) or `compiled-mpy`. |
| `cleanBuild` | boolean | Wipe the build directory first. Default `false`. |
| `timeoutSeconds` | number | Per-job budget; default `900`. Must be positive. |

### `deploy.start`

| Field | Type | Meaning |
|-------|------|---------|
| `board` | string | Catalog board name; decides chip, flash offset, and the default backend. Optional when `targetId` is present. |
| `port` | string | Serial port path, e.g. `/dev/ttyUSB0`. |
| `targetId` | string | Selects the board via the mapping rules when `board` is absent; a wildcard or unknown target is `target-unknown`. |
| `baseTargetId` | string | Optional base of a derived user target; when present the board is resolved on the base (an unknown base is `base-target-unknown`, a wildcard base is `base-no-mapping`). |
| `firmwarePath` | string | Explicit `.bin` to flash. When absent the newest published image for the board is used, and a missing image is `firmware-image-unavailable`. |
| `channel` | string | Optional `release`/`dev`; narrows the implicit image lookup to that channel with no cross-channel fallback. Omitted keeps newest-across-channels. |
| `backendId` | string | Pinned flash backend; omit for `auto` selection. |
| `wipeFilesystem` | boolean | Pass the backend's filesystem wipe. Default `false`. |
| `timeoutSeconds` | number | Budget for the flash tool invocation; default `900`. |

`deploy.start` carries no package, node-graph, or source-upload field, and it never will: firmware
flashing and node-package source upload are independent seams.

### `scan-local`

| Field | Type | Meaning |
|-------|------|---------|
| `runtimeId` | string | Runtime to inspect. |

The server never writes the runtime manifest; `nodePackages.local` bookkeeping stays a CLI action
(`mo np --sync-local`).

### `firmware.list`

No fields. The server lists every published image in the publish root and computes `isLatest` per
`(boardId, runtimeId)` using the shared version sort key, so the client never orders images or picks
a newest file. The result payload is described in
[firmware-inventory-contract.md](firmware-inventory-contract.md).

### `firmware.delete`

| Field | Type | Meaning |
|-------|------|---------|
| `firmwarePath` | string | Absolute path of the image to delete, exactly as handed back by `firmware.list`. |

The server re-checks the path against the publish root (`firmware-path-invalid` on a traversal) and
returns the refreshed inventory plus `removed` / `absent` lists in the single result frame, so the
client never issues a follow-up `firmware.list`. The frame is gated on `firmware-compile`
(`compile-disabled` when absent), because the firmware producer owns the publish root.

### `firmware.import`

| Field | Type | Meaning |
|-------|------|---------|
| `path` | string | Absolute path of the `.firmware.zip` on the server's machine. Exactly one of `path` / `url`. |
| `url` | string | `https://` URL (or loopback `http://`) the server fetches. Exactly one of `path` / `url`. |
| `force` | boolean | Optional; replace an existing different image with the same name. |

The client never sends package bytes; the server resolves the path or URL itself under
[archive-source-contract.md](archive-source-contract.md) (the size rule is `archive-too-large`), while
the package-format caps (`firmware-package-too-large`, `MAX_ENTRIES`, `MAX_UNPACKED_BYTES`) stay where
they are. The result is the refreshed inventory payload plus an `imported` record (`status`,
`filename`, `imagePath`, `sidecarPath`, `sha256`, `boardKnown`). The frame is gated on
`firmware-compile` like `firmware.delete`.

### `firmware.import-binary`

| Field | Type | Meaning |
|-------|------|---------|
| `path` | string | Absolute path of the `.bin` on the server's machine. Exactly one of `path` / `url`. |
| `url` | string | `https://` URL (or loopback `http://`) the server fetches. Exactly one of `path` / `url`. |
| `targetId` | string | Selects the board whose slug becomes part of the published filename and the deploy target; a wildcard or unknown target is `target-unknown`. The platform is a flash-path decision only, never device configuration. |
| `force` | boolean | Optional; replace an existing different image with the same name. |

The frame imports one raw MicroPython image (`.bin` only — a `.uf2` is refused), resolved under
[archive-source-contract.md](archive-source-contract.md) with the accepted suffix `.bin`; the
byte cap is `MAX_IMPORTED_BINARY_BYTES`. The server validates, names, and installs the image through
`imported_firmware.py` and reports job kind `import` — the same job group `firmware.import` uses, so
a job group may be fed by more than one frame and the overwrite-confirmation flow is shared. The
result is the refreshed inventory payload plus an `imported` record (`status`, `filename`,
`imagePath`, `sidecarPath`, `sha256`, `boardKnown`, `boardId`, `targetId`, `originalFilename`,
`micropythonVersion`). The frame is gated on `firmware-compile` like `firmware.import`; no new
feature key is introduced.

### `firmware.export`

| Field | Type | Meaning |
|-------|------|---------|
| `firmwarePath` | string | Absolute path of the published image to package, exactly as handed back by `firmware.list`. |
| `destinationDir` | string | Absolute directory the caller picked through `fs.list`. |
| `force` | boolean | Optional; overwrite an existing `<stem>.firmware.zip` in that directory. |

The job re-checks the image against the publish root (shared with `firmware.delete`), validates the
destination directory, and writes exactly `<image-stem>.firmware.zip` — the server names the file, so
the browser never invents a path. The stage is `export`, and the terminal `result` payload carries an
`exported` record (`path`, `imagePath`, `bytes`); the inventory is untouched, so the client does not
re-list. An existing package answers `firmware-export-exists` until the client re-sends with
`force: true`. Gated on `firmware-compile` (`compile-disabled`) and `local-file-access`
(`fs-not-allowed`).

### `addon.install`

| Field | Type | Meaning |
|-------|------|---------|
| `path` | string | Absolute path of the `.zip` add-on archive on the server's machine. Exactly one of `path` / `url`. |
| `url` | string | `https://` URL (or loopback `http://`) the server fetches. Exactly one of `path` / `url`. |
| `force` | boolean | Optional; replace an already installed package with the same id. |

The client never sends archive bytes; the server resolves the path or URL itself under
[archive-source-contract.md](archive-source-contract.md). The archive cap is
`addon_archive.MAX_ARCHIVE_BYTES` (64 MiB), enforced by the resolver, so an oversized local file
answers `archive-too-large` while an oversized extracted tree still answers
`addon-archive-unpacked-too-large`. A `__MACOSX/` directory a macOS `zip -r` adds is ignored. The
result is the refreshed add-on inventory payload plus an `installed` record (`id`, `version`,
`replaced`, `archiveSha256`, `packageDir`). An existing id is refused with
`addon-already-installed`; confirm the replace and re-send with `force: true`.

### `addon.uninstall`

| Field | Type | Meaning |
|-------|------|---------|
| `packageIds` | array of string | Add-on ids to remove. Required; trimmed, blanks dropped. An absent or empty list is `invalid-frame`. |

The ids are removed one at a time, in order, each announced by its own `running` status frame with
the id in `message`, so a failure part-way still shows what was already removed. The result is the
refreshed add-on inventory payload plus a `removed` list (`id`, `version` per entry).

Both add-on frames are accepted **without a capability gate**, like `scan-local` and
`firmware.list`: they write only `Config.addons_dir`, which is user state that needs no toolchain.
A client should still offer them only on a `ready` capabilities snapshot.

### `cancel`

Any fields are ignored. With no job running the frame is a no-op: answering would invent a state the
client already knows it is not in.

### `fs.list`

| Field | Type | Meaning |
|-------|------|---------|
| `requestId` | string | Correlation id the client uses to route the answer to a pending promise. |
| `path` | string | Absolute directory to list. Defaults to the server's home directory. |
| `extensions` | array of string | Case-insensitive file suffixes to show; an empty or absent list means every file. Directories are always listed. |
| `showHidden` | boolean | Include dot-files. Default `false`. |

`fs.list` is a **read-only side channel**, answered on the connection read loop — never as a job —
so a file picker can browse while a build or deploy holds the job slot, and a slow listing can never
surface as `job-busy`. It is gated on `local-file-access` (`fs-not-allowed` when absent), and every
failure is answered with `fs.list.error` (no `job` key). See
[server-firmware-api.md](server-firmware-api.md#enumerating-local-files).

## Server → client frames

| `type` | Fields | Purpose |
|--------|--------|---------|
| `status` | `job`, `state` (`queued` \| `running` \| `done`), `stage`, `message` | Job lifecycle and stage boundaries. |
| `output` | `job`, `stream` (`stdout` \| `stderr`), `text` | One build/flash output line, trailing `\n` included; a reprinted line begins with `\r`. |
| `result` | `job`, `status` (`succeeded` \| `failed` \| `cancelled` \| `timeout`), `payload`, `cleanup` | Terminal frame of a job that produced a payload. |
| `error` | `job` (absent for a frame-level rejection), `code`, `message`, `hint`, `details` | Terminal frame of a job, or the answer to a frame the server refused. |
| `fs.list.result` | `requestId`, `path`, `parent`, `roots`, `entries` | One directory listing for a matching `fs.list` request. |
| `fs.list.error` | `requestId`, `code`, `message`, `hint` | The refusal or failure for one `fs.list` request; carries no `job` key. |

### `status`

| Field | Meaning |
|-------|---------|
| `job` | `compile`, `deploy`, `scan`, `list`, `delete`, `import`, `addon-install`, or `addon-uninstall`. |
| `state` | `queued` (accepted, worker not started), `running` (with `stage` and/or `message`), `done` (job body finished, terminal frame follows). |
| `stage` | Stage id from the build orchestration (`staging`, `precompile`, `build`, ...) or one of the job-owned stages `scan`, `deploy-resolve`, `inventory`, `delete`, `import`, `addon-install`, `addon-uninstall`. |
| `message` | Free-form progress sentence from a stage callback. An `addon.uninstall` repeats its stage frame once per id with that id in `message`, so a failure part-way shows what was already removed. |

A deploy's progress is not a field on this frame: esptool's output, progress bar included, arrives as
ordinary `output` frames so the client log stays a faithful transcript of the tool.

### `output`

`stream` is `stdout` or `stderr`; `text` is the raw line, not JSON-escaped again by the client. There
is no ordering guarantee *between* streams, only within one stream.

`text` starts with a single `\r` when the tool reprinted the line before it, which is how esptool
writes every progress-bar update under `TERM=dumb`. The client rewrites its last log line instead of
appending a duplicate, so a bar advances on one line; a line that is itself a reprint resolves the
ambiguity in favour of a new line, so an ordinary message is never replaced by a later bar.

### `result`

`payload` is exactly the CLI payload of the same operation (`mo cr --json-output` for a compile,
`mo dr --json-output` for a deploy, `mo node-packages --json-output` for a scan), so one client
renderer covers both entry points. For `firmware.list` / `firmware.delete` it is the inventory
payload of [firmware-inventory-contract.md](firmware-inventory-contract.md); a delete result adds
`removed` / `absent` string lists. `cleanup` is present only when the server removed something:

```json
{"type": "result", "job": "compile", "status": "cancelled", "payload": {"exitCode": null}, "cleanup": {"removedArtifact": "/abs/src/micropython/ports/esp32/build-ESP32_GENERIC/micropython.bin"}}
```

- `status: "failed"` with a `payload` means the operation completed and reported a non-zero exit code
  (a failed flash, or a build the toolchain rejected). The payload's `errors` array carries the
  structured reason.
- `status: "cancelled"` and `status: "timeout"` carry `payload.exitCode: null`; a timeout also carries
  `payload.timeoutSeconds` so the client can report the budget that expired.
- `cleanup.removedArtifact` is a path or `null`. It names a firmware binary the job itself wrote and the
  server deleted, because a half-built image must never be left where a later deploy would flash it. A
  binary that predates the job is never removed, and `cleanup` is omitted entirely when nothing was
  removed.

### `error`

`error` frames use the same `{code, message, hint, details}` object the CLI payloads and the HTTP
rejections use. `job` is present when a job had started and absent when the server rejected the frame
itself (so a client can tell "your request was refused" from "your job failed"). `details` is
structured and never contains a traceback or a host path outside the workspace the client already
knows; an unexpected exception is reported as `internal-error` with `details.exception` set to the
exception type name only.

### `fs.list.result`

| Field | Type | Meaning |
|-------|------|---------|
| `requestId` | string | Echoes the `fs.list` request the listing answers. |
| `path` | string | Absolute path of the listed directory. |
| `parent` | string \\| null | Absolute parent directory, or `null` at the filesystem anchor. |
| `roots` | array of `{id, path}` | Shortcut roots (`home`, `workspace`, `root`) the picker can offer. |
| `entries` | array | Sorted directory-then-file entries; see [server-firmware-api.md](server-firmware-api.md#enumerating-local-files). |

### `fs.list.error`

`requestId` echoes the request, and `code` / `message` / `hint` use the same shape as `error` frames —
but with **no** `job` key, because the side channel is never a job.

## Frame rules

- **Unknown extra fields are ignored.** A newer client may send fields this server does not know; that
  is not an error, because the contract grows additively.
- **An unknown `type` is an error** (`unknown-frame-type`). Accepting it would silently do nothing,
  which is worse than refusing.
- **Malformed input is answered, not fatal.** Invalid JSON, a non-object payload, a missing `type`, a
  binary frame, or a mistyped field produces one `error` frame and keeps the connection open.
- **Exactly one terminal frame per job.** Any number of `status`/`output` frames may precede it; nothing
  follows it for that job.
- **One job per connection at a time** (`job-busy` above).
- **All frames are UTF-8 JSON objects.** Binary frames are refused with `invalid-frame`.
- **No frame carries an archive.** `addon.install`, `firmware.import`, and `firmware.import-binary`
  name a path or URL, so the socket keeps the `websockets` library default message size. The archive
  caps stay server-side (`addon_archive.MAX_ARCHIVE_BYTES`, `firmware_package.MAX_PACKAGE_BYTES`,
  `imported_firmware.MAX_IMPORTED_BINARY_BYTES`), and an oversized file is refused as
  `archive-too-large` (or `firmware-import-invalid` for a binary source).

## Error codes

Every `error.code` this endpoint can emit, what it means, and what a client should show. The set is
`ERROR_CODES` in `firmware_ws_handler.py`; anything not listed here is not part of the contract.

| Code | When | Hint / details |
|------|------|----------------|
| `invalid-frame` | The frame is not JSON, not a JSON object, has no `type`, or a field has the wrong type. Also the answer to a binary frame. | `hint` names the field and the expected shape; `details` repeats the offending `type` or `field`. |
| `unknown-frame-type` | `type` is not `compile.start`, `deploy.start`, `scan-local`, `firmware.list`, `firmware.delete`, `firmware.import`, `firmware.import-binary`, `firmware.export`, `addon.install`, `addon.uninstall`, `fs.list`, or `cancel`. | `details.type` repeats the received value. |
| `job-busy` | A job is already running on this connection. | Wait for the running job's terminal frame, then send the next job. The running job is unaffected. |
| `compile-disabled` | `compile.start` while the server does not advertise `firmware-compile`. | Enable compile support in `micro-otter.toml` and reload; the client should read `features` before offering the action. |
| `deploy-disabled` | `deploy.start` while the server does not advertise `firmware-deploy`. | Same, with `enable_deploy`. |
| `runtime-not-found` | `scan-local` for a runtime without a manifest under `device/runtime/<id>/`. | The hint lists the runtime ids that do exist. |
| `runtime-manifest-invalid` | The runtime manifest exists but is not readable as JSON or misses required keys. | Fix the manifest; nothing is written. |
| `board-unknown` | `board` is not in the board catalog. | Pick a board id from the advertised firmware targets. |
| `target-unknown` | `targetId` resolves to no concrete board (a wildcard target) or matches no mapping rule. | Pick a target with a concrete build board; `details.targetId` names the id. |
| `base-target-unknown` | `baseTargetId` (a derived user target's base) matches no mapping rule. | Pick a shipped target as the base; `details.baseTargetId` names the id. |
| `base-no-mapping` | `baseTargetId` resolves to a wildcard (no concrete board), so the derived target cannot build. | Pick a shipped base with a concrete compile board; `details.baseTargetId` names the id. |
| `unknown-package-id` | `packageIds` names an id the runtime's manifest union does not contain. | The hint lists every valid id for that runtime. Nothing is built. |
| `package-not-staged` | `packageIds` names a runtime-local package, which the resolver never stages. | Remove the id or move the package into `nodePackages.global`; `mo np` reports the same verdict. |
| `build-timeout` | The server-side backstop expired because the build worker stopped responding (not the ordinary timeout, which is a `result` with `status: "timeout"`). | Restart the job after checking the build log; `details.timeoutSeconds` reports the backstop budget. |
| `internal-error` | An unexpected exception escaped the job body. | `details.exception` is the exception type name only; the traceback stays in the server log. |
| `firmware-image-unavailable` | `deploy.start` without `firmwarePath` and no published image for the board (or none in the requested `channel`). | Build and publish with `mo cr`, or point `MICRO_OTTER_FIRMWARE_DIR` at the image folder; `details` carries `boardId`, `runtimeId`, `publishRoot`, and `channel` when one was requested. |
| `firmware-image-invalid` | The resolved image is missing, empty, or fails verification. | Rebuild the image; the flash never starts. |
| `board-not-flashable` | The catalog entry for the board has no chip, so no backend can flash it. | `details.boardId` names the board; pick a flashable board. |
| `firmware-not-found` | Reserved; `firmware.delete` reports a missing image through `absent` rather than this code. | Delete only images returned by `firmware.list`. |
| `firmware-path-invalid` | `firmware.delete` for a path outside the publish root (a traversal attempt). | `details.path` / `details.publishRoot`; delete only images returned by `firmware.list`. |
| `firmware-package-invalid` | `firmware.import` whose archive is not a valid `.firmware.zip` (missing descriptor, unexpected member, traversal, symlink, duplicate, or a bad descriptor schema). | `details` names the offending member when one is known; re-create the package with `mo firmware package`. |
| `firmware-package-identity-mismatch` | The package filename and its sidecar disagree on board/runtime/version/content hash, or the sidecar's `contentHash` no longer recomputes. | Re-package the image with its own sidecar. |
| `firmware-package-checksum-mismatch` | The image's SHA-256 does not match the descriptor. | `details.declared` / `details.actual`; re-download or re-package the image. |
| `firmware-package-too-large` | The archive exceeds `MAX_PACKAGE_BYTES` (or a field decodes above the cap). | The package must hold a single image plus its sidecar and descriptor. |
| `firmware-import-exists` | An import would overwrite a different image with the same name. | Pass `force: true` (web app) or `--force` (CLI) to replace it. |
| `firmware-import-denied` | The publish root cannot be created or written. | `details.publishRoot`; set `MICRO_OTTER_FIRMWARE_DIR` to a writable folder. |
| `firmware-import-invalid` | A `firmware.import-binary` source that is not a `.bin`, is empty, or exceeds the byte cap. | Import one `.bin` image here, or a `.firmware.zip` through `firmware.import`. |
| `flash-backend` | The flash adapter failed with no more specific category. | `details` carries whichever of `backend_id`, `tool`, `chip`, `returncode`, `detail` the adapter exposed. |
| `flash-error` | The adapter raised an exception whose class name yields no category (the naming rule's fallback). | Same `details` fields; the adapter id is the actionable part. |
| `flash-firmware-image-not-found` | The backend could not find the image it was told to flash. | Rebuild; the path came from the server's own resolution or `firmwarePath`. |
| `flash-tool-missing` | The flasher executable is not installed or not on `PATH`. | `details.tool` names the missing tool; install the toolchain with `mo toolchain`. |
| `flash-monitor-not-supported` | A monitor was requested on a backend that cannot provide one. | The server never requests a monitor, so this only appears for a non-server caller's request. |
| `flash-command` | The flasher ran and exited non-zero. | `details.returncode` and `details.detail` carry the tool's own report; the image is unchanged on the device. |
| `flash-backend-unavailable` | The selected backend reported itself unavailable. | `details.detail` explains why; run `mo doctor`. |
| `flash-unsupported-chip` | The backend does not support the board's chip. | `details.chip` and `details.supported_chips`; pick another board or install a backend for that chip. |
| `flash-no-available-backend` | No flash backend is available at all. | `details.known_backend_ids`; install a toolchain. |
| `flash-unknown-backend` | `backendId` (or `MICRO_OTTER_FLASH_BACKEND`) names no known backend. | `details.known_backend_ids` and `details.considered_backend_ids` list the valid ids. |
| `addon-already-installed` | `addon.install` for an id that is already installed, without `force`. | Confirm the replace, then re-send with `force: true` (CLI: `--force`). |
| `addon-archive-invalid` | The uploaded archive is not a readable `.zip`. | Re-create the archive; nothing is written. |
| `addon-archive-no-manifest` | The archive holds no package folder with a `manifest.json`. | Ship `<folder>/manifest.json`, or a root `manifest.json` plus `--as <id>` in the CLI. |
| `addon-archive-not-found` | The source path does not exist (a CLI or directory install). | Check the path, or run `mo addons list` for what is installed. |
| `addon-archive-symlink` | The archive contains a symbolic link. | Ship regular files only; nothing is extracted. |
| `addon-archive-too-large` | The archive exceeds `addon_archive.MAX_ARCHIVE_BYTES` (64 MiB). | Ship only the manifest, node definitions, generators, and `mpAssets`. |
| `addon-archive-too-many-entries` | The archive holds more than 2000 members. | Reduce the member count; nothing is extracted. |
| `addon-archive-unpacked-too-large` | The unpacked tree would exceed 128 MiB. | Ship fewer or smaller assets. |
| `addon-archive-unsafe-path` | A member path is absolute, contains `..`, uses a backslash, or repeats a name. | Re-create the archive with relative, unique paths. |
| `addon-id-conflicts-builtin` | The manifest `id` names a built-in package. | Rename the package; built-in ids are immutable. |
| `addon-id-invalid` | The id (or `--as` value) is not lowercase letters, digits, and underscores. | Fix the manifest `id`. |
| `addon-id-mismatch` | The archive's id differs from the id the install was asked for (`--as`). | Drop `--as`, or fix the manifest `id`. |
| `addon-manifest-forbidden-asset` | `mpAssets` declares a file the tool owns (`__mpycache__`, `.installed.json`). | Remove that entry from the manifest. |
| `addon-manifest-invalid` | The manifest is unreadable or misses required keys. | Fix `manifest.json`; see [node-definitions.md](../nodes/addons/node-definitions.md). |
| `addon-manifest-missing-asset` | `mpAssets` names a file the archive does not contain. | Ship every declared asset. |
| `addon-manifest-missing-version` | The manifest declares no `version`. | Add a non-empty `version`. |
| `addon-module-root-invalid` | An `mpAssets` root is outside `moa_<id>` / `moa_<id>_<variant>`. | Move the module under the reserved `moa_` namespace. |
| `addon-not-installed` | `addon.uninstall` for an id that is not installed. | The hint lists the installed ids; refresh the add-on table. |
| `addon-variant-capabilities-missing` | A variant manifest declares no `requiredCapabilities`. | Declare the capabilities the variant needs. |
| `addon-variant-hardware-missing` | A variant manifest declares no `hardware` description. | Add a localised `hardware` map (`en`/`de`). |
| `addon-variant-manifest-invalid` | A `manifest.<variant>.json` is unreadable, misses keys, or carries a bad `variant` id. | Fix the variant manifest. |
| `addon-variant-precedence-duplicate` | Two variant manifests declare the same `precedence`. | Give each variant a distinct precedence. |
| `archive-path-invalid` | `addon.install` / `firmware.import` with a `path` that is missing, not a file, or not a `.zip`; `firmware.import-binary` with a `path` that is missing, not a file, or not a `.bin`. | Point at the archive file on the server's machine. |
| `archive-too-large` | The local archive file exceeds the caller's byte cap. | Package fewer or smaller sources, or raise the documented cap. |
| `archive-url-invalid` | The archive URL scheme is not `http`/`https`, or it has no hostname. | Use an `https://` URL, or a path instead. |
| `archive-url-blocked` | Plain `http` towards a non-loopback host. | Use an `https://` URL for anything that is not this machine. |
| `archive-url-redirect` | The archive URL redirects more than three times. | Shorten the redirect chain, or point at the final URL directly. |
| `archive-url-unreachable` | The archive URL could not be fetched (`HTTPError` / `URLError` / timeout). | Check the URL, and that the server can reach it. |
| `archive-url-too-large` | The streamed URL body exceeds the caller's byte cap. | Package fewer or smaller sources, or raise the documented cap. |
| `fs-not-allowed` | `fs.list` or `firmware.export` while the server does not advertise `local-file-access`. | Bind the server to a loopback host to enable the file picker. |
| `fs-path-invalid` | `fs.list` for a non-absolute path. | Pass an absolute path returned by a previous listing or a root. |
| `fs-not-found` | The listed path or export destination does not exist. | Pick another directory. |
| `fs-not-a-directory` | The listed path is a file, or the destination is a symlink/file. | Pick a directory (and a real one, for the destination). |
| `fs-permission-denied` | The server process cannot read the directory. | Pick a directory the server process may read. |
| `fs-too-many-entries` | The directory has more than 2000 matching entries. | Narrow the listing, or open a subfolder. |
| `fs-not-writable` | The export destination is not writable by the server process. | Pick a folder the server process may write. |
| `fs-destination-not-absolute` | The export destination is not an absolute directory. | Pick an absolute folder through the file picker. |
| `firmware-export-exists` | `firmware.export` whose derived `<stem>.firmware.zip` already exists in the destination, without `force`. | Pick another folder, or confirm the overwrite and re-send with `force: true`. |

The `flash-*` codes are derived from the adapter exception class by
[firmware_deploy.py](../../../src/micro_otter/tools/firmware_compile/firmware_deploy.py)
(`_flash_error_code`), one code per class in
[flash-backend-contract.md](flash-backend-contract.md#failure-categories).

## Cancel, timeout, and cleanup

- **Cancel is cooperative.** `cancel` sets a flag the job polls; the build orchestration kills the
  child process group (and only that group) at its next poll and raises `BuildCancelled`. The job then
  answers `result` with `status: "cancelled"`.
- **Cancellation is only observable once a subprocess exists.** Staging, mpy precompilation, and
  manifest bookkeeping run in-process and are allowed to finish; a `cancel` sent during that window
  takes effect as soon as the build step starts. A `scan-local` job holds no subprocess and so ignores
  `cancel` in practice — it completes in milliseconds.
- **Deploy jobs complete once started.** The flash backend owns the tool invocation and killing it
  mid-write would leave the board in an undefined state, so a `cancel` during a deploy is recorded but
  has no effect; the deploy runs to completion and its result is the terminal frame.
- **Timeout is per job, default 900 s.** `timeoutSeconds` on `compile.start`/`deploy.start` overrides
  the default. An expired build yields `result` with `status: "timeout"`; an expired flash is reported
  by the backend itself, as a `flash-*` error carrying the tool's exit status.
- **A timed-out or cancelled build never leaves a flashable partial image.** Before the job starts the
  server records the artifact that already existed; after a cancel or timeout it deletes the artifact
  only when its modification time is at or after the job start. A pre-existing good binary therefore
  survives, and `cleanup.removedArtifact` reports exactly what was deleted.
- **A disconnect cancels the job.** The flag is set when the socket closes, so an abandoned tab cannot
  keep a build running for the full budget.

## Client-side mapping (web app)

The web app consumes this protocol through `js/firmware/firmware-client.ts` and
`js/firmware/firmware-job-state.ts`. The client owns the transport and the reducer owns the state;
no view code parses frames.

- **Frame → reducer transition.** `status` sets the phase (`queued` → `queued`, `running`/`done` →
  `running`), `output` appends a log line (ring buffer capped at 2000) — or, when the line begins with
  the redraw marker `\r`, rewrites the last line of the same stream so a progress bar keeps one line —
  and the terminal `result` or `error` sets the final phase and clears `busy`. `job-busy` is special: it
  keeps the running job's phase and `busy` and is shown as a transient banner.
- **One job per connection.** The view holds one `FirmwareJobClient` and one `FirmwareJobState`; a
  second action while `busy` is refused locally rather than hitting `job-busy`.
- **Disconnect cancels the job.** On socket close the view transitions to `disconnected` (via
  `markDisconnected`), which clears `busy` but keeps the log. There is no auto-reconnect: the next
  user action opens a fresh socket.
- **`cancel` without a job is silent.** The client's `cancel()` never resolves or waits for an
  acknowledgement, because the server answers nothing when no job is running.
- **One import routing rule.** `js/firmware/firmware-requests.ts` is the single routing decision:
  `isBinaryFirmwareSource(name)` (query/fragment stripped, case-insensitive `.bin` suffix) chooses the
  binary path and `buildFirmwareImportBinaryRequest(input)` builds the
  `{ type: 'firmware.import-binary', path|url, targetId, force? }` frame; every other picked name
  keeps `buildFirmwareImportRequest`. A future frame addition starts from these two helpers.

See [firmware-build-view-architecture.md](../view-system/firmware-build-view-architecture.md).

## Related

- [server-firmware-api.md](server-firmware-api.md) — the capability payload that tells a client whether
  `compile.start`/`deploy.start` will be accepted, and the trust model in front of the upgrade.
- [firmware-deploy-contract.md](firmware-deploy-contract.md) — what a `deploy.start` job runs, field by
  field, and the `flash-*` code family.
- [package-selection.md](package-selection.md) — `packageIds` and `modulePackagingMode` semantics,
  including the source-upload independence rule.
- [backend-compile-interface-contract.md](backend-compile-interface-contract.md) — the compile payload a
  `result` frame carries.
- [websocket-serial-bridge.md](../device-communication/websocket-serial-bridge.md) — the sibling
  `/serial` endpoint and the shared port.
- [docs/tools/firmware-compile-reference.md](../../tools/firmware-compile-reference.md) — the CLI
  payloads this protocol re-uses.
- Tests: `tests/test_firmware_ws_handler.py`, `tests/test_serial_bridge_firmware_route.py`,
  `tests/test_firmware_contract_invariants.py`.

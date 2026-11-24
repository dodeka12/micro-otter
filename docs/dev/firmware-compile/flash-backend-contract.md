# Flash Backend Contract

**Status:** Implemented Contract
**Scope:** Internal seam between the firmware flash path and one flash tool family (esptool today).

## Purpose

`FlashBackend` mirrors the [build backend seam](build-backend-contract.md) for the write side of the
firmware lifecycle: it turns one `FlashRequest` into a flashed board using one tool family. The
caller-facing behavior stays the contract in
[backend-compile-interface-contract.md](backend-compile-interface-contract.md) and the existing
`mo dr --firmware` command.

Iteration 1 adds the seam only. `mo dr` still calls `esptool` directly, so CLI behavior is
unchanged.

## Source-upload boundary

A flash backend flashes firmware images and nothing else. Collection package source upload — the
`missing` and `override-required` paths in `collection-deployment.ts` / `device-deployment.ts` — is
decided in the web app over WebSerial and is **not** a flash responsibility. No flash backend may
inspect, gate, or replace it, and `FlashRequest` deliberately carries no collection or package
fields. The build backend is bound by the same rule.

## Package layout

```text
src/micro_otter/tools/firmware_compile/flash/
├── __init__.py   # re-exports contract types and registry helpers
├── base.py       # FlashBackend protocol, value types, structured errors
├── registry.py   # built-in specs, entry-point discovery, select_flash_backend()
└── esptool.py    # EsptoolFlashBackend adapter
```

Adapter modules are resolved by module path from the registry on first use, so importing the seam
has no tool-side effects.

## Registry and selection

```python
select_flash_backend(
    *,
    chip: str,
    requested: str | None = None,
    board_default: str | None = None,
    environ: Mapping[str, str] | None = None,
) -> FlashBackend
```

Precedence, highest first:

1. `requested` — an explicit id from a CLI flag or API caller. **Hard** choice.
2. `MICRO_OTTER_FLASH_BACKEND` when it names a concrete id. **Hard** choice. `auto`, blank, and
   unset values are ignored at this level.
3. `board_default` — `BoardSpec.flash_backend` from the board catalog. **Soft** preference.
4. `auto` — the resolver of last resort.

Hard choices fail loudly: an unknown id raises `UnknownFlashBackendError`, an unavailable tool
raises `FlashBackendUnavailableError`, and a chip the backend does not list raises
`UnsupportedFlashChipError`. None of them falls back.

A soft board default is best-effort: an unknown id or a backend that is unavailable or does not
list the chip logs a diagnostic and falls through to `auto`. This lets a catalog prefer a backend
without turning a missing optional tool into a hard failure.

### Catalog defaults and board helper

`BoardSpec.flash_backend` (JSON `flashBackend`, default `"esptool"`) is catalog data, not a
decision. It reaches selection only as `board_default`, which keeps the override order intact:

| Situation | Result |
| --- | --- |
| `requested` set | That backend, or a structured error. The catalog default is ignored. |
| `MICRO_OTTER_FLASH_BACKEND` set to a concrete id | That backend, or a structured error. `auto`/blank falls through to the catalog default. |
| Only the catalog default applies | The catalog backend when available and supported, otherwise `auto`. |
| Nothing applies | `auto`. |

`select_flash_backend_for_board(board_spec, *, chip=None, requested=None, environ=None)` packages
this for M2: it supplies `board_default=board_spec.flash_backend` and `chip=board_spec.chip`, so a
config resolver never re-implements the order. Both shipped boards default to `esptool`, and
`auto` still resolves `esptool` for `esp32` and `esp32s3` when no catalog default is present.

`auto` walks candidates in this order and returns the first whose `status().available` is true and
whose `supported_chips()` contains the normalized chip:

1. built-in adapters (`esptool`),
2. programmatically registered backends, in registration order,
3. entry points from `micro_otter.flash_backends`, sorted by entry-point name.

When nothing qualifies, `NoAvailableFlashBackendError` names the chip and the considered ids.

### Chip normalization

Chip ids are compared with `normalize_chip()` (strip + lowercase), so `ESP32S3`, `esp32s3`, and
` esp32s3 ` are the same target. `supported_chips()` implementations should return normalized ids
and are normalized defensively on read.

### Entry-point registration

Distributions register an out-of-tree backend with:

```toml
[project.entry-points."micro_otter.flash_backends"]
lab = "lab_flash.backend:LabFlashBackend"
```

The entry point may resolve to a class, a zero-argument factory, or an instance. A broken entry
point — one that raises on `load()` or does not satisfy `FlashBackend` — is skipped with a warning
so a single bad third-party distribution cannot break every flash invocation. The project never
depends on this group itself; `esptool` is a built-in.

## Protocol

```python
@runtime_checkable
class FlashBackend(Protocol):
    id: str

    def status(self) -> BackendStatus: ...
    def supported_chips(self) -> tuple[str, ...]: ...
    def flash(
        self,
        request: FlashRequest,
        on_event: StreamCallback | None = None,
    ) -> FlashResult: ...
```

Rules:

- `flash()` is synchronous and blocks until the tool exits. Event loops belong to callers.
- `status()` reports whether the tool is installed; it must never require a connected device.
- `supported_chips()` returns normalized, lower-case esptool chip ids (`esp32`, `esp32s2`, `esp32s3`).
- Progress is reported only through `on_event`; a `None` callback must be inert.

## Value types

| Type | Fields | Notes |
| --- | --- | --- |
| `FlashRequest` | `board_spec`, `port`, `firmware_path`, `wipe_filesystem`, `timeout_seconds?`, `monitor` | Firmware images only; `board_spec` supplies `chip` and `firmware_flash_offset`. |
| `FlashResult` | `exit_code`, `backend_id`, `port`, `firmware_path`, `message?` | `exit_code` is the mapped CLI exit code, not the raw tool code. |

Events reuse [`BuildEvent`](build-backend-contract.md) and `StreamCallback` from
`backends/base.py`; there is no second event type and no second vocabulary.

## Failure categories

Every failure is a `FlashBackendError` carrying the `exit_code` the CLI already maps:

| Error | Raised when | `exit_code` |
| --- | --- | --- |
| `FirmwareImageNotFoundError` | The image path does not exist or is not a file. | `3` |
| `FlashToolMissingError` | The flash tool is not installed / not on `PATH`. | `1` |
| `MonitorNotSupportedError` | `monitor=True` is combined with image flashing. | `2` |
| `FlashCommandError` | The tool ran and failed. | Tool code when positive, else `1`. |
| `UnknownFlashBackendError` | The selected id resolves to no backend. | `1` |
| `FlashBackendUnavailableError` | A hard-selected backend reports unavailable. | `1` |
| `UnsupportedFlashChipError` | A hard-selected backend cannot flash the chip. | `1` |
| `NoAvailableFlashBackendError` | `auto` finds no backend for the chip. | `1` |

Selection failures are raised by the registry; tool failures are raised by the adapter. Both are
`FlashBackendError` subclasses so a caller can catch one type and still honor `exit_code`.

## Event semantics

The esptool adapter emits, in order:

| Event `message` | Kind | Payload |
| --- | --- | --- |
| `erase-start` | `stage` | `port`, `chip` |
| `erase-finish` | `stage` | `port`, `chip` |
| `write-start` | `stage` | `port`, `chip`, `offset`, `firmware` |
| `write-finish` | `stage` | `port`, `chip`, `offset` |
| `done` | `status` | `port`, `chip`, `firmware` |
| `error` | `error` | `exception`, `exit_code` |

`erase-start` / `erase-finish` appear only when `wipe_filesystem` is set. `error` is emitted once,
immediately before the adapter raises, so a streaming caller sees the failure without parsing
exceptions.

The adapter emits no percentage event: how far a write has got is visible in the tool's own streamed
output, which reaches `log_callback` line by line.

### Streamed tool output

`FlashRequest.log_callback` is the `(stream, text)` sink the adapter forwards to
`process_stream.run_streamed_process`; every line the tool writes reaches the caller while the flash
runs. `stderr` stays `stderr`. A timeout raises `ProcessTimeout`, which the adapter maps onto
`FlashCommandError` with `exit_code = -1`. The protocol remains synchronous — output travels only
through `on_event` and `log_callback` — see [process-streaming.md](process-streaming.md).

The adapter is a transcript relay: **every line reaches `log_callback` verbatim, progress-bar lines
included.** It does not parse esptool's wording, so the Deploy log shows what the tool printed and an
esptool release that rewords its bar cannot break the adapter. Deduplicating or collapsing a redraw is
the seam's job (it renders a bare `\r` as an overwrite and marks a reprinted line with `\r` so the log
rewrites it in place), not the adapter's.

## Esptool adapter

`EsptoolFlashBackend` (`flash/esptool.py`) is the built-in adapter registered under the id
`esptool`. It reproduces the existing `mo dr --firmware` command sequence exactly:

```text
esptool --chip <board_spec.chip> --port <port> [erase-flash] \
  write-flash -z <board_spec.flash_params["offset"]> <resolved firmware path>
```

- The offset comes from the board's backend-owned `flash` recipe (`flash_params["offset"]`), never
  from the adapter: `esp32` and `ESP32_GENERIC_S2` write at `0x1000`, `ESP32_GENERIC_S3` at `0`.
- `erase-flash` runs first only when `wipe_filesystem` is set; the firmware write always follows.
- The firmware path is resolved and must be a regular file; validation happens **before** the tool
  runs.
- `monitor=True` is rejected because monitoring belongs to the `idf.py` build-directory deploy path.
- `status()` only checks `PATH` via `shutil.which("esptool")`; it never opens a serial port.
- `supported_chips()` returns `("esp32", "esp32s2", "esp32s3")` from a single tuple.

`tests/test_firmware_compile_flash_backends.py` asserts the argv byte-for-byte against the shapes
`tests/test_cli_deploy_runtime.py` expects, so the adapter and the CLI cannot drift apart.

Iteration 1 does not route the CLI through the adapter; `cli/app.py::_run_deploy` remains the
behavior reference until M2/M3 move the call site.

## Related

- [Build backend contract](build-backend-contract.md) — the build-side seam this mirrors.
- [Backend compile interface contract](backend-compile-interface-contract.md) — caller-facing CLI contract.
- [Board catalog contract](board-catalog-contract.md) — source of `chip` and `firmware_flash_offset`.

## Implementation References

- `src/micro_otter/tools/firmware_compile/flash/base.py`
- `src/micro_otter/tools/firmware_compile/flash/registry.py`
- `src/micro_otter/tools/firmware_compile/flash/esptool.py`
- `src/micro_otter/cli/app.py` (`_run_deploy` firmware branch, the behavior reference)
- `tests/test_firmware_compile_flash_backends.py`
- `tests/test_cli_deploy_runtime.py`

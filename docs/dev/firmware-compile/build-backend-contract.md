# Build Backend Contract

**Status:** Implemented Contract
**Scope:** Internal seam between the firmware compile pipeline and one toolchain family (ESP-IDF today, streaming and other toolchains later).

## Purpose

`BuildBackend` is the seam that lets the compile pipeline gain toolchains without changing the
CLI contract in [backend-compile-interface-contract.md](backend-compile-interface-contract.md).
The CLI contract describes what a caller may ask for; this document describes how the package
answers that request internally.

Iteration 1 adds the seam only. No CLI command or server route is routed through it yet, so
`mo cr` behavior is unchanged.

## Package layout

```text
src/micro_otter/tools/firmware_compile/backends/
├── __init__.py   # re-exports contract types and registry helpers
├── base.py       # BuildBackend protocol, value types, structured errors
├── registry.py   # built-in specs, entry-point discovery, select_backend()
└── esp_idf.py    # EspIdfBackend adapter over run_build_orchestration()
```

`backends/__init__.py` deliberately does not import `esp_idf`. The registry resolves built-ins by
module path on first use, so importing the seam has no toolchain-side effects and no import cycle
with `build_orchestration`.

## Protocol

```python
@runtime_checkable
class BuildBackend(Protocol):
    id: str

    def status(self) -> BackendStatus: ...
    def supported_targets(self) -> tuple[str, ...]: ...
    def embedding(self) -> Literal["mpy-freeze", "none"]: ...
    def resolve_name(self, name: str, *, micropython_root: Path) -> BoardTarget | None: ...
    def build(
        self,
        request: BuildRequest,
        on_event: StreamCallback | None = None,
    ) -> BuildResult: ...
```

Rules:

- `build()` is synchronous and blocks until the toolchain finishes. Event loops and queues belong
  to callers, not to the protocol.
- All progress is reported through `on_event` (`Callable[[BuildEvent], None]`). A `None` callback
  must be inert — no printing, no logging that the caller did not ask for.
- `status()` must stay cheap: no build, no workspace requirement, no long subprocess. It is called
  during `auto` selection, potentially several times per invocation.
- `supported_targets()` returns normalized, lower-case target ids (`esp32`, `esp32s3`).
- `embedding()` reports how the backend embeds node packages: `mpy-freeze` freezes package sources
  into the image; `none` cannot embed, so declared packages flow through the source-upload path
  (recorded as `notEmbedded`). See `ResolvedContents` in `firmware_compile/resolved_contents.py`.
- `resolve_name()` is the backend-owned off-catalog fallback for a board name absent from the
  catalog; it returns a `BoardTarget` or `None`. See
  [board-catalog-contract.md](board-catalog-contract.md).

## Value types

| Type | Fields | Notes |
| --- | --- | --- |
| `BackendStatus` | `backend_id`, `available`, `version?`, `detail?`, `missing_requirements` | Availability snapshot returned by `status()`. |
| `BuildRequest` | `target`, `contents`, `workspace_root`, `micropython_root`, `device_root`, `packaging_mode`, `optimization_level`, `modules_path?`, `embedded_inventory_output?`, `clean_build`, `dry_run`, `package_ids?`, `constituent_versions?`, `addons_root?`, `log_callback?`, `cancel_event?`, `timeout_seconds?` | The backend-typed board plus the content inventory and the build inputs the backend owns. |
| `BuildResult` | `exit_code`, `backend_id`, `artifact_path?`, `orchestration?` | `artifact_path` is the backend-discovered artifact; `orchestration` carries the staging/preflight detail for callers that need it. |
| `BuildEvent` | `kind`, `message`, `payload?` | `kind` is `status`, `stage`, `log`, `artifact`, or `error`. `payload` is a read-only mapping. |

`BuildEventKind` and `StreamCallback` name the event vocabulary and callback signature.

## The backend owns the pipeline

`build()` owns every MicroPython-specific decision: the staging destination, the optional `.mpy`
precompile, the toolchain command, and the `build-*/firmware.bin` artifact. The shared
`run_build_orchestration()` resolves the `BoardTarget` and the `ResolvedContents`, selects the
backend, and delegates — it imports no `build_toolchain`, `staging_paths`, `build_precompile`,
`build_preflight`, or `build_artifact` module.

## Failure categories

Selection failures are exceptions, not events; `build()` failures are whatever the toolchain
raises. Both live in `backends/base.py`:

| Error | Raised when |
| --- | --- |
| `UnknownBuildBackendError` | The selected id resolves to no built-in, registration, or entry point. Message lists the known ids. |
| `BuildBackendUnavailableError` | A hard-selected backend reports `status().available == False`. Message includes the reported `detail`. |
| `UnsupportedBuildTargetError` | A hard-selected backend does not list the normalized target in `supported_targets()`. Exposes `supported_targets`. |
| `NoAvailableBuildBackendError` | `auto` found no backend that is available for the target. Message names the target and the considered backend ids. |

All four derive from `BuildBackendError` (itself a `RuntimeError`), so callers can catch the
family when they only need a single exit-code mapping.

## Selection precedence

`select_backend(*, target, requested=None, board_default=None, environ=None)` resolves in this
order:

1. `requested` — explicit CLI/API value.
2. `MICRO_OTTER_BUILD_BACKEND` when set to a concrete id (a blank value or `auto` is ignored).
3. `board_default` from the board catalog.
4. `auto`.

Steps 1 and 2 are **hard choices**: an unknown id, an unavailable backend, or an unsupported
target raises. Step 3 is a **soft preference**: an unknown, unavailable, or unsupported board
default is logged and falls through to `auto`. `environ` overrides `os.environ` for callers that
resolve configuration elsewhere (and for tests).

`auto` considers built-ins first, then programmatic registrations, then entry points sorted by
name; it returns the first backend that supports the normalized target and reports itself
available. A backend whose `status()` raises is logged and skipped rather than aborting selection.

### Catalog defaults and board helper

The catalog default is data, not a decision: `BoardSpec.build_backend` (JSON `buildBackend`,
default `"esp-idf"`) is validated with the rest of the board entry and then handed to selection as
`board_default`. That distinction is what lets a distribution override a catalog preference:

| Situation | Result |
| --- | --- |
| `requested` set | That backend, or a structured error. The catalog default is ignored. |
| `MICRO_OTTER_BUILD_BACKEND` set to a concrete id | That backend, or a structured error. `auto`/blank falls through to the catalog default. |
| Only the catalog default applies | The catalog backend when available and supported, otherwise `auto`. |
| Nothing applies | `auto`. |

`select_backend_for_board(board_spec, *, target=None, requested=None, environ=None)` packages this
for M2, so a config resolver never re-implements the order: it passes the `BoardSpec`, and the
helper supplies `board_default=board_spec.build_backend` and `target=board_spec.chip` by default.

## Registry and entry-point discovery

- `get_backend(id)` resolves in order: programmatic registration, built-in adapter, entry point
  whose name or `backend.id` matches.
- `register_backend(backend)` registers an instance for the rest of the process and overrides a
  built-in with the same id; `reset_registry()` drops registrations back to built-in defaults.
- `known_backend_ids()` lists every visible id in resolution order for diagnostics.
- Out-of-tree backends register through the `micro_otter.build_backends` entry-point group. Each
  entry point may resolve to an instance, a class with no required arguments, or a zero-argument
  factory. A broken entry point (import error, wrong shape) is skipped with a warning so a single
  bad distribution cannot break every compile invocation.

Provider packages declare the group in `pyproject.toml`:

```toml
[project.entry-points."micro_otter.build_backends"]
vendor-toolchain = "vendor_pkg.backend:VendorBackend"
```

## ESP-IDF adapter

`EspIdfBackend` (`backends/esp_idf.py`, id `esp-idf`) is a translation layer, not a policy layer:

- `status()` reports `available=True` when `idf.py` resolves through `Config.idf_py` /
  `micro_otter.toolchain.launcher_path()` (falling back to `PATH`); `detail` holds the resolved path
  and `version` comes from `<Config.idf_path>/version.txt`. Otherwise it returns `available=False` with
  `missing_requirements=("idf.py",)` and a "source the ESP-IDF environment" detail. It never spawns
  `idf.py --version`, which would initialise the toolchain Python environment during a status probe.
- `supported_targets()` returns `("esp32", "esp32s3")` from a single module tuple; board offsets
  and port paths remain the job of the existing target-mapping and toolchain modules.
- `build()` forwards every `BuildRequest` field to `run_build_orchestration()` and returns
  `BuildResult(exit_code=orchestration.build_exit_code or 0, backend_id="esp-idf",
  orchestration=...)`.

## Child-process environment

Backends never assemble toolchain variables themselves. `Config.toolchain_env()` is the single source
of the environment handed to `idf.py` / `make` subprocesses: it sets `MICRO_OTTER_TOOLCHAIN_DIR`,
`IDF_PATH`, `IDF_TOOLS_PATH`, and `MICROPYTHON_ROOT` from the resolved configuration and prepends the
launcher directory to `PATH`, so a bare `idf.py` also resolves to the repository launcher. Values come
from `micro-otter.toml`, the `MICRO_OTTER_*` variables, or the platform defaults — see
[Configuration Reference](../deployment/configuration.md).

Exception behavior is unchanged: a missing `idf.py`, an unknown MicroPython target, staging
conflicts, and subprocess failures propagate with the same types and messages the CLI already maps
to exit codes. The adapter only adds one `error` event before re-raising.

## Stage events

`run_build_orchestration()` accepts an optional
`stage_callback: Callable[[str, Mapping[str, Any]], None]`. It is invoked at pipeline boundaries:

| Stage | Payload | When |
| --- | --- | --- |
| `preflight` | `target`, `board` | Before toolchain preflight checks. |
| `staging` | `runtime_id`, `dry_run` | Before runtime staging. |
| `precompile` | `packaging_mode`, `dry_run` | Before the optional `.mpy` precompile phase. |
| `build-start` | `argv`, `cwd` | Immediately before the toolchain subprocess starts. |
| `build-finish` | `exit_code` | After the subprocess returns. |
| `build-skip` | `reason` (`dry-run` or `staging-conflicts`) | When the subprocess is not started. |

When `stage_callback` is `None` the orchestration performs no extra work and produces no output,
so existing orchestration tests and CLI flows are unaffected. `EspIdfBackend` turns each stage call
into a `BuildEvent(kind="stage", message=<stage>, payload=<payload>)`.

`preflight`, `staging`, and `precompile` are emitted *before* their phase runs, so a caller can
render "starting X" before a long step; `build-start` and `build-finish` bracket the subprocess.

## Streaming boundary

A backend reports progress two ways: stage boundaries through `on_event` (as above) and raw toolchain
output through `BuildRequest.log_callback`. Both are delivered while the command runs.

- The command itself runs through
  [`process_stream.run_streamed_process`](process-streaming.md), never a direct `subprocess.run`:
  that seam owns the reader threads, the cancel event, and the timeout budget.
- `log_callback(stream, text)` receives one call per line; the server turns each into an `output`
  frame, the CLI discards them.
- A cancel raises `BuildCancelled`, a timeout raises `BuildTimeout`; both are subclasses of the
  seam's `ProcessCancelled` / `ProcessTimeout`. A non-zero exit stays a
  `subprocess.CalledProcessError` so exit-code mapping remains caller-owned.

A boundary test fails if `build_orchestration.py`, `backends/*.py`, or `flash/*.py` launches a process
directly.

## Adding a backend

1. Create `<pkg>/backend.py` with a class that satisfies `BuildBackend` (id, `status()`,
   `supported_targets()`, `build()`).
2. Keep `build()` synchronous, emit progress through `on_event` only, and let toolchain errors
   propagate unchanged so exit-code mapping stays caller-owned.
3. Register it either programmatically with `register_backend()` (tests, embedders) or through the
   `micro_otter.build_backends` entry-point group (distributions).
4. Add a unit test that asserts the command shape and that the backend reports
   `isinstance(backend, BuildBackend)`.

## PlatformIO decision

PlatformIO is not a backend in iteration 1. The project builds MicroPython firmware with the
ESP-IDF/make toolchain, and a PlatformIO backend would need `platformio.ini` generation plus a
different artifact layout; that is out of scope until a real second toolchain family is required.
The seam exists so it can be added as an out-of-tree entry point without touching the CLI contract.

## Related

- [Backend compile interface contract](backend-compile-interface-contract.md) — caller-facing CLI contract.
- [Build pipeline integration](build-pipeline-integration.md) — orchestration sequence this seam wraps.
- [Board catalog contract](board-catalog-contract.md) — source of the `board_default` preference.
- [Deploy layout](../deployment/deploy-layout.md) — toolchain installation that provides `idf.py`.

## Implementation References

- `src/micro_otter/tools/firmware_compile/backends/base.py`
- `src/micro_otter/tools/firmware_compile/backends/registry.py`
- `src/micro_otter/tools/firmware_compile/backends/esp_idf.py`
- `src/micro_otter/tools/firmware_compile/build_orchestration.py`
- `tests/test_firmware_compile_build_backends.py`
- `tests/test_firmware_compile_build_orchestration.py`

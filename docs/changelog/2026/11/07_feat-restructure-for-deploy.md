# Changes since version 1.25.0

## New Features

- **Add-on node packages** — third-party node packages install into a dedicated folder
  (`Config.addons_dir`, default `<home>/addons`) and take part in the palette, the firmware build, and
  the device `.mpy` cache exactly like a shipped package. `mo addons install|list|uninstall|validate`
  validate an archive (layout, ids, paths, sizes), publish it with one `os.replace`, and reject a
  built-in id before anything is written; every failure carries a stable code
  (`addon-already-installed`, `addon-id-conflicts-builtin`, …). `PackageRoots` is the single
  node-package path join, so staging, the mpy helpers, and the server resolve
  `device/node_pkgs` then `<addons_dir>/<id>` without a second join, and `addons_root=None` reproduces
  the pre-add-on behaviour byte for byte. The local server serves a merged
  `/device/node_pkgs/index.json`, add-on assets under `/device/node_pkgs/<id>/…`, and
  `nodePackages.addons` in the runtime manifest (plus the `node-package-addons` capability), while the
  palette marks those sections with an "Add-on" badge. `mo compile-mpy` covers installed add-ons and
  writes `mpyCompileProfiles` atomically (`--skip-addons` / `--dry-run` opt out), and the collection
  deploy path is unchanged: it still uploads add-on source whenever the image cannot serve it.
- **Add-on variants and the `moa_` module namespace** — add-on device code now lives under a
  reserved `moa_` namespace (`moa_<id>` base, `moa_<id>_<variant>` variants; `otter_*` stays
  Micro-Otter), so an add-on can never overwrite a shipped module. A package may ship
  `manifest.<variant>.json` files (one index entry per manifest) and the build selects exactly one
  variant per id by capability + precedence. The Firmware tab gains an "Installed add-ons" table
  (scoped Select all / Clear / Refresh), a "Minimal" button that selects exactly what the collection
  uses, and a per-package variant picker; `--package-variants` / the `packageVariants` frame field
  let the server override the auto-selected variant and reject unknown, unsatisfiable, or unselected
  overrides (`variant-unknown`, `variant-capabilities-unsatisfied`,
  `variant-package-not-selected`). `examples/addons/node_pkgs/{hello,pulse}` document the
  single-implementation and base+viper layouts.
- **Installation assets have a home** — `deploy/` now owns host toolchain installation, with
  `deploy/toolchain/versions.env` as the single pin source plus `bootstrap.sh` and `doctor.sh`
  dispatchers. The devcontainer mirrors those pins and a test fails when they drift.
- **Pluggable firmware build backends** — the compile package exposes a `BuildBackend` protocol
  (with `BuildRequest`, `BuildResult`, `BuildEvent`, and structured selection errors), a lazy
  registry with `micro_otter.build_backends` entry-point discovery, and `select_backend()` with the
  precedence explicit request → `MICRO_OTTER_BUILD_BACKEND` → board default → `auto`.
- **ESP-IDF adapter** — `EspIdfBackend` wraps the existing MicroPython/ESP-IDF orchestration,
  reports availability from `idf.py`/`$IDF_PATH` without starting a build, and turns pipeline stage
  boundaries into `stage` events for future server-side streaming.
- **Pluggable firmware flash backends** — the flash path gains a `FlashBackend` protocol
  (`FlashRequest`, `FlashResult`, reused `BuildEvent` vocabulary), a registry with
  `micro_otter.flash_backends` entry-point discovery, and `select_flash_backend()` with the same
  precedence as build selection. Structured errors keep the existing `mo dr` exit codes
  (missing image `3`, missing tool `1`, failed tool = tool code, `--monitor` `2`).
- **esptool adapter** — `EsptoolFlashBackend` emits the exact `esptool write-flash` command the CLI
  already uses, including optional `erase-flash` and the board-catalog offset (`0x1000` on `esp32`,
  `0` on `esp32s3`), and reports `status()` from `PATH` only.
- **One configuration resolver** — `micro_otter.config` loads `micro-otter.toml` and resolves every
  path and flag with `CLI flag > environment > TOML > platform default` precedence, so the CLI and
  server can find the workspace, firmware, and toolchain locations outside the devcontainer.
- **Repository-owned `idf.py` launcher** — `deploy/toolchain/esp-idf/idf.py` is now the single ESP-IDF
  launcher; it derives `IDF_PATH`/`IDF_TOOLS_PATH` from the configured toolchain directory, sources
  `export.sh`, and prints a `micro-otter toolchain install` hint when the checkout is missing. The
  devcontainer image no longer embeds a second copy and links this one onto `PATH` at create time.
- **`micro-otter toolchain status|install`** — `toolchain status` prints the resolved paths (with the
  winning configuration layer for each) plus a component table for Python, Node.js, `mpy-cross`,
  ESP-IDF, esptool, pyserial, and every registered build/flash backend, and `--json`/`--json-output`
  emit a stable schema-version-1 payload. `toolchain install` delegates to
  `deploy/toolchain/bootstrap.sh` with the resolver-built child environment and supports `--backend`,
  `--dir`, `--dry-run`, and `--force`.
- **`micro-otter doctor`** — checks the interpreter version, workspace layout, every toolchain
  component, the writable firmware and state directories, which `micro-otter.toml` won, and whether
  the container-wide `/opt` layout is in use. Exits `0` healthy, `1` on a failed check (`--strict`
  also fails on warnings), and `2` on a configuration error, with `--json` for scripts.
- **Configuration reference and example file** — `docs/dev/deployment/configuration.md` documents the
  precedence chain, the `micro-otter.toml` schema, the platform defaults, the state directory, and the
  `toolchain`/`doctor`/`serve` contracts (JSON payloads and exit codes). The repository ships
  `micro-otter.toml` with every key commented out, and a test fails when the page names an environment
  variable the resolver ignores.

- **Headless firmware server surface** — a running server now answers
  `GET /api/server-capabilities` with exactly seven keys (`serverType`, `version`, `features`,
  `buildBackends`, `flashBackends`, `firmwareSources`, `releaseIndexUrl`), derived per request from the
  installed build/flash adapters and the resolved `micro-otter.toml`, and advertises `firmware-compile` /
  `firmware-deploy` only when a backend is genuinely available. `WS /firmware` sits next to `WS /serial`
  and runs one job per connection — `compile.start`, `deploy.start`, `scan-local`, and `cancel` —
  streaming stage and output frames, enforcing a per-job timeout, rejecting a second concurrent job, and
  answering every failure with a stable `code` + `hint` + `details` error frame instead of a traceback.
  A cancelled or timed-out build deletes only the artifact it wrote, so a pre-existing image stays
  flashable. Both endpoints share the loopback `Host`/`Origin` check, which returns `403` with
  `host-not-allowed` / `origin-not-allowed` and no CORS header. On top of that the CLI gained
  `mo dr --firmware … --json-output` (`flash_firmware` / `resolve_firmware_image` in
  `firmware_deploy.py`, with the `flash-*` error family and one serialiser shared with the server) and
  `mo node-packages` (`mo np`) to list every locally discoverable package and whether the runtime stages
  it into an image. Four contract documents —
  [server-firmware-api.md](../../../dev/firmware-compile/server-firmware-api.md),
  [firmware-build-websocket-protocol.md](../../../dev/firmware-compile/firmware-build-websocket-protocol.md),
  [firmware-deploy-contract.md](../../../dev/firmware-compile/firmware-deploy-contract.md), and
  [package-selection.md](../../../dev/firmware-compile/package-selection.md) — pin the surface down, and
  `tests/test_firmware_contract_invariants.py` fails if a documented code or capability key drifts from
  the code. None of this touches node-package source upload: `missing` / `override-required` packages are
  still uploaded by the web app independently of firmware content, feature flags, and package selection.
- **Firmware tab** — the last tab in the node editor is always present, probes
  `GET /api/server-capabilities` and `WS /firmware`, and reports `enable_compile`/`enable_deploy`. It
  shows the resolved build target with its compile board, chip, and flash offset, lists stageable
  packages (`global ∪ local ∪ addons`, add-ons badged, capability-unsatisfied and runtime-local
  entries disabled), streams a single cancellable compile job with the published artifact, runtime
  version, and publish status, and flashes a chosen serial port with an opt-in filesystem wipe.
  Failures render the server's stable `code` plus its `hint`. The existing source-upload deploy path
  is untouched.

## Breaking Changes

- **`serve` binds loopback by default** — `micro-otter serve` now binds `127.0.0.1:8000` (resolved
  from `micro-otter.toml` / `MICRO_OTTER_HOST` / `MICRO_OTTER_PORT`) instead of every interface. Pass
  `--host 0.0.0.0` to expose it, which prints a warning while `enable_compile`/`enable_deploy` are
  enabled.
- **CLI state moved to the platform state directory** — the interactive firmware menu stores its
  state in `XDG_STATE_HOME/micro-otter`, `%LOCALAPPDATA%\micro-otter`, or
  `~/Library/Application Support/micro-otter` (override with `MICRO_OTTER_STATE_DIR`). An existing
  `~/.config/micro-otter/state.json` is still read once and never deleted, so remembered boards and
  ports survive the upgrade.

## Improvements

- **Board catalogs describe their toolchain** — board entries accept optional `mcuFamily`,
  `buildBackend`, `buildEnv`, and `flashBackend`. Absent fields fall back to `None`/`esp-idf`/
  `{}`/`esptool` defaults, so existing schema-v1 catalogs load unchanged; `buildEnv` is stored as a
  read-only string map and reserved for the M2 config resolver.
- **Build orchestration reports progress without changing behavior** — `run_build_orchestration()`
  accepts an optional `stage_callback` for `preflight`, `staging`, `precompile`, and
  `build-start`/`build-finish`/`build-skip`; with no callback it emits nothing, so `mo cr` output
  and exit codes are unchanged.
- **Builds and deploys share one toolchain environment** — firmware builds, the CLI `deploy-runtime`
  path, and the ESP-IDF backend now take the `idf.py` command from `Config.idf_py` and the child
  environment from `Config.toolchain_env()`, so an exported `MICRO_OTTER_TOOLCHAIN_DIR` relocates the
  whole toolchain without editing code and no call site probes `/usr/local/bin/idf.py` directly.
- **Config-first discovery replaces hardcoded `/opt` paths** — the compile command, the publish-root
  scanner, the staleness check, the device syntax gate, and the CLI workspace/MicroPython helpers all
  resolve through `micro_otter.config` (`resolve_micropython_root`, `resolve_firmware_publish_root`).
  `/opt/micropython` and `/opt/micro_otter/firmware` remain the documented discovery fallback, and a
  test now fails when a new `/opt` literal appears outside `config.py`.
- **Cross-platform serial discovery** — `detect_serial_ports()` uses
  `serial.tools.list_ports.comports()`, so Windows `COM*` and macOS `/dev/cu.*` ports are found next to
  Linux `/dev/ttyUSB*`/`/dev/ttyACM*`; labels still prefer `/dev/serial/by-id` and fall back to the
  pyserial description. The glob scan remains the fallback when pyserial is unavailable, and the
  `/api/serial-ports` payload is unchanged.
- **`enable_compile` / `enable_deploy` shape the interactive firmware menu** — the menu only offers
  enabled actions, prints which ones configuration disabled, and exits early when both are off.
  `--build-if-stale` requires both flags (exit `2`). The explicit `compile-runtime` /
  `deploy-runtime` commands and the collection-deploy source-upload path are unaffected.
- **`nodePackages.optional` is honoured as a cosmetic default** — a runtime manifest can list package
  ids that default to unchecked in the Firmware tab's checklist; ids not present in
  `global`/`local`/`addons` are ignored, and the server never sees the flag.
- **The board catalog feeds the target info row** — the web app reads `boards.json` (through
  `js/firmware/board-catalog.ts`) to show the compile board, chip, and flash offset for the selected
  target; the offset is display-only and never used to flash.
- **The Firmware tab uses the view system** — the tab gains a registered stylesheet, a flex/scroll
  shell, seven `CollapsibleView` sections (Target, Packages, Installed add-ons, Build, Deploy, Log,
  Result), `DataTableView`
  info/result/package tables, a `CodeView` job log, and the shared dropdown/text/checkbox/button
  controls with capability gating; `FirmwareBuildView` is registered in `ViewFactory`, so a saved
  layout restores it instead of an empty `ViewBase`.

- **The Firmware tab lists and deploys local images** — a new **Local firmware** section shows every
  published image for the selected target with a **latest** badge, a **compatibility marker** against
  the current package selection, and a tooltip describing the image's sidecar contents. Images can be
  selected for deploy and deleted behind a destructive confirm. Deploy resolves its image by
  selected-row → last build → newest-image priority and shows the active source. Two new `WS /firmware`
  frames — `firmware.list` (read-only) and `firmware.delete` (gated on `firmware-compile`) — back this
  with a new server-side inventory module that computes `isLatest` and refuses paths outside the
  publish root.
- **Build and deploy logs are separate, and a failure reveals the right one** — the Build section owns
  a build log and the Deploy section owns a deploy log, so a deploy no longer overwrites build output.
  A terminal failure expands and scrolls to the owning log.
- **Progress for running jobs is shown in place, not in an overlay** — while a compile or deploy runs,
  the Build Firmware group (or the Deploy group) shows a labelled progress readout with the current
  stage or message, an elapsed timer, and Cancel for a build. The group auto-expands when its job
  starts, and the readout disappears on the terminal frame, so the rest of the tab stays interactive
  instead of being covered by a dismissal-proof window.
- **A shared `ProgressBarView` for in-section progress** — the tab no longer carries a one-off progress
  surface. `ProgressBarView` (`js/views/progress-bar-view.ts`, stylesheet registered in
  `themes.json`) renders a label, a status line, an elapsed timer and an optional Cancel button inside
  a `role="status"` live region. It draws **no bar**: the `WS /firmware` protocol carries no
  percentage, and a styled native `<progress>` is not portable (invisible when indeterminate in
  Chromium/WebKit, a full "100 %" bar in Gecko), so the elapsed line is the progress cue. The firmware
  tab hosts one instance in the Build Firmware group and one in the Deploy group.
- **A freshly built image auto-appears in the list** — a published build refreshes the local inventory
  and selects the new image (badged "new"), so the deploy-first workflow closes the loop.
- **The Local firmware list moves to a compact hash/version/runtime/target table with a details view**
  — the table shows the content hash (or `n/a`), MicroPython version, runtime, and target board, with
  the filename, size, last-modified, and embedded packages moved into a details view below that always
  shows the selected (deploy) image. The `firmware.list` scan now renders as an in-section indeterminate
  progress bar.
- **Delete uses the view system instead of hand-rolled UI** — deleting an image opens a whole-app
  `ViewManager.showConfirmation` (destructive, Escape cancels) rather than a dialog attached to
  `document.body`. `FirmwareBuildView` now requires an injected `viewManager` for that dialog.
- **The Firmware tab leads with firmware identity and one consolidated build group** — the Local
  firmware table now shows the firmware version (with `latest`/`new` badges and the compatibility
  marker), MicroPython, and runtime (the redundant target column and the hash column are gone). The
  details view below shows every field — including the hash — and renders the embedded packages as a
  `DataTableView`. The Deploy section shows the selected image's firmware version / MicroPython /
  runtime / hash instead of its filename. Packages, Installed add-ons, and the build action/log are now
  nested collapsible sub-sections of a single **"Build Firmware"** group (top toolbar with the Build
  button and Clean-build checkbox), replacing the three standalone sections.
- **Production builds land in a repo-root `_dist/webapp` that the server serves directly** — `npm run
  build` now writes to `<repo>/_dist/webapp` (previously `src/dist/webapp`), and
  `resolve_static_root()` in `tools/server_capabilities.py` picks it up for both
  `serial_bridge`/`mo serve` endpoints and the `/api/version` stamp. The resolution order is
  `<repo>/_dist/webapp`, then `dist/webapp` next to an installed package, then the TypeScript source
  tree, so serving the production build no longer needs a manual copy into `src/micro_otter/dist/`,
  and `_dist/` is git-ignored and excluded from linting.
- **One icon workflow for both icon sets** — `docs/workflow/adding-icons.md` replaces the two
  Google-only pages and documents Material Design Icons (Pictogrammers, pinned MDI 7.4.47) next to
  Google Material Symbols: the same download → normalize (`fill="#e3e3e3"`) → place → register
  recipe, with the app shelf (`html/icons/` + `IconProvider`) and the package folders
  (`node_pkgs/<package>/icons/` + `node_definitions.json`) kept visibly distinct and the Home
  Assistant `mdi:<name>` webfont path called out as a separate, file-less case. MDI glyphs are taken
  from the pinned `@mdi/svg` dependency or its jsDelivr mirror, so no floating upstream branch is
  involved.
- **Material Symbols are attributed in Info → About** — `tools/open-source-package-overrides.json`
  gains a `vendoredAssets` list for icon sets the dependency scan cannot see, so the generated
  `OPEN_SOURCE_PACKAGES` rows now name Google Material Symbols as Apache-2.0 and link its upstream
  `LICENSE`. The downloaded SVGs ship a matching `src/micro_otter/nodes/html/icons/LICENSE` notice
  declaring the one modification (the added `fill`).
- **The Firmware tab speaks in glyphs** — the Local firmware (Refresh / Delete), Packages (Minimal /
  Select all / Clear / Refresh), Installed add-ons (Select all / Clear / Refresh), Deploy, and Retry
  controls are icon-only `ButtonControl`s (`icon` + `iconOnly`) that keep their translated label as
  `title` and `aria-label`, so the toolbars stay compact without losing an accessible name. The
  inventory badges became glyphs as well: `latest`, `new`, and a new **add-ons** badge shown when any
  embedded package id is an installed add-on (resolved through
  `DeviceRuntime.packageProvenance()`); the compatibility marker keeps words only for the
  `otherTarget` case, and the row `aria-label` now names the compatibility status that the removed
  status word used to carry. Glyph tones reuse the existing `brightness(0) saturate(100%) …` filter
  idiom, so no per-colour icon variants were needed, and the thirteen new MDI 7.4.47 glyphs follow the
  shared icon workflow.

## Limitations

- No CLI command or server route selects a backend yet; selection, streaming of raw toolchain
  stdout, and artifact events arrive with later milestones.

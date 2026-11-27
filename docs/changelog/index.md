# Changelog

## [Since 1.43.0] — 2026-11-26
- Releases are cut by hand: `tools/make_release_index.py` writes `index.json` + the GitHub Release body from a directory of exported images · `docs/workflow/release.md` is the full procedure (per-board build, export, exe, tag, upload) · the Firmware tab and install pages say where an official image comes from · the `windows` CI job and `bump-version.yml` are `workflow_dispatch`-only and CI builds no firmware · `tests/test_ci_workflow.py` pins both
→ [Details](2026/11/26_feat-m8.md)
- Installable wheel + runtime/compile Docker images + Windows `micro-otter.exe` · devcontainer signs only when `GIT_SIGNING_ENABLED=1` · automatic CI scoped to the published repository
→ [Details](2026/11/26_feat-wheel-images-windows-exe.md)
- `npm run check:docs-links` gates every published markdown tree · 72-link `docs/` backlog fixed
→ [Details](2026/11/26_build-docs-link-gate.md)
- Published devcontainer is a declared publication variant: `prepare` ships the portable config without the maintainer's public-clone bind mount
→ [Details](2026/11/26_chore-devcontainer-published-variant.md)

## [Since 1.43.0] — 2026-11-25
- Stray `v0.0.1` tag deleted, version identity back on the mirrored `v1.43.0` · tagging guarded to the public repository with a hard `v*` baseline check · Node test suite (386 s of the 400 s `web` job) suspended in CI and kept as the local publication gate
→ [Details](2026/11/25_fix-ci-gates-and-version-tags.md)

## [Since 1.43.0] — 2026-11-24
- Plans live in the private `ldev/` tree while `dev/` is a published scaffold · `AGENTS.md` is a declared per-repository variant · publication is one command (`ldev/tools/publish.mjs` with eight guards) · `tools/mod` retired · version artifacts are build outputs (`_version.py`, `html/version.json`) with `importlib.metadata` as fallback · new developer guide for the two-tree workflow, the publication loop and the sdist/wheel split
→ [Details](2026/11/24_feat-repository-workflow.md)
- README reduced to a 77-line overview with a *Start here* table · dev-container and git-hooks guides split out of it · stale ViewBase lifecycle links and the dead `NODE_SYSTEM_README.md` reference fixed
→ [Details](2026/11/24_docs-readme-slim.md)
- Two-repository model on one page (independent repos, merge ≠ publish, split by path) · routing procedure from changed file to PR A, publication and PR B, then sync down · new `two-repository-workflow` skill and links from `AGENTS.md` and the existing publication pages
→ [Details](2026/11/24_docs-two-repository-workflow.md)

## [Since 1.42.1] — 2026-11-24
- Least-privilege `ci.yml` with stable `python`, `web` and `docs` jobs, caching, `contents: read` and no publishing · one run per change: `push` only on `main`, `ldev/**`-only pull requests skipped · `check:ci-local:web` split from the mpy-cross device gate · legacy workflows deduplicated · contributing docs list the jobs and local equivalents
→ [Details](2026/11/24_ci-iteration-31-baseline.md)

## [Since 1.42.0] — 2026-11-23
- User documentation site (MkDocs + mike) organised into Setup, App, Nodes and Addons · one page per app view · setup, targets and connect pages with the install guides left as placeholders · node reference with a package page and a page for each of the 92 node types · add-on authoring guide · `npm run check:docs` strict build gate in `check:ci-local`
→ [Details](2026/11/23_feat-mo-docs.md)

## [Since 1.41.0] — 2026-11-23
- `core.range-adapt` takes `Minimum`, `Maximum` and `Invert` as the `min`, `max` and `invert` connectors with inline defaults `0`, `100` and unchecked, so another node can drive the range and the mirror switch, while `Mode` stays the only control · `min`/`max`/`invert` stay visible in every mode and `default` only in *To Default* mode · the output type still follows only `value` and `default` · `core` package `1.29.0`
- Breaking: graphs saved with the old `Minimum`/`Maximum`/`Invert` controls store no connector defaults, so they transpile with `0`, `100` and no mirroring
→ [Details](2026/11/23_feat-range-adapt.md)

## [Since 1.39.0] — 2026-11-23
- `vars.array-math` gains `Length`, `Minimum`, `Maximum`, `Mean` and `Median`; `Minimum`/`Maximum` use a `0..100` `Percent` control to pick the highest value in the lowest N% or the lowest in the highest N%, with dynamic `int`/`float` outputs · `vars` package `0.70.0`
→ [Details](2026/11/23_feat-array-max-extend.md)

## [Since 1.39.0] — 2026-11-22
- A graph can use the new `function` execution type and is emitted as a callable `async def` with parameters from its declared inputs, a `return` from its declared outputs, and a hoisted `_init_` coroutine awaited once at startup · the graph settings gain a function block (palette category, collapsible input/output sections, per-port name and data-type multi-select, move/delete toolbars, generated-signature preview) · every enabled function graph appears in the node palette under its category and under *Functions*, and dragging it in emits `await <function>(…)` · *Function Input* and *Function Output* nodes in the Organizational section mirror the ports on the canvas
- The graph tab context menu gains *Copy Graph* and *Paste Graph*, duplicating a whole graph into any collection with fresh ids, remapped connections and a reset viewport; function graphs keep their signature and structural nodes
- Function graphs gain a Markdown **description** and per-port **documentation** (edited via a new reusable `MarkdownEditorControl`), and the palette/graph-panel node-info window renders node descriptions as Markdown with KaTeX math and a plain-text offline fallback · collapsible sections gain a general `contentGuide` line, used by the function parameter rows
- Refactor: one shared execution-type contract for the graph model, settings view, toolbar and transpiler
→ [Details](2026/11/22_feat-function-graphs.md)

## [Since 1.36.0] — 2026-11-20
- The Line Graph Web View node (`graph-display`) plots one series from a `y` array or an `x`+`y` pair, with a `title` string connector, automatic or manual per-axis ranges with manual bounds hidden in auto mode, axis labels, height, line colour, tick count, and a `maxPoints` tail cap · the webview package ships `otter_webview/graph.py` (`1.43.4`) and redraws the canvas on refresh and resize · the canvas is sized from its own box and its axis gutters follow the rendered tick labels, so nothing paints outside the card
→ [Details](2026/11/20_feat-graph-web-node.md)
- `core.adc-array` captures a block of 16–128 ADC samples at 1–10 kHz into a `vars.array` of 0–3.3 V readings, paced by an absolute deadline so the sample spacing stays drift-free · the block blocks the graph for samples / rate (≈ 13 ms at the default 64 samples / 5 kHz) · wire `Samples` into a `graph-display` `y` input to plot it
→ [Details](2026/11/21_feat-adc-array-node.md)
- `vars.array-set` gains a `Shift` index mode that slides the whole array by the deficit of an out-of-range write instead of clamping or wrapping, plus a `Fill Value` connector for the slots the slide vacates · `Clamp` and `Wrap` keep their connectors and generated statements, so existing graphs transpile unchanged · `vars` package `0.66.0`
→ [Details](2026/11/20_feat-array-shift-add.md)

## [Since 1.35.0] — 2026-11-20
- `core.const` gains a `Mode` dropdown with custom and special constants (Pi, Euler's number, degrees→radians, radians→degrees), where `Special` hides the type/value controls and outputs a float · every constant is emitted as an inlined MicroPython `const(...)` with one `from micropython import const` per graph · option typing from a hidden dropdown no longer retypes connectors
→ [Details](2026/11/20_feat-constant-node-extension.md)

## [Since 1.33.0] — 2026-11-20
- `vars.array-modify` gains `Repeat`, `Ping-Pong`, `Concat` and `Interlace` modes with new `Count` and `Other Array` connectors, so an array can be repeated, mirrored, appended to a second array, or woven into it · each mode shows only its own connectors and controls, `Shift` keeps its old behavior and generated code
→ [Details](2026/11/20_feat-extend-array-modify.md)

## [Since 1.30.0] — 2026-11-20
- `core.select-index` forwards one of two to eight values chosen by a zero-based `index`, where an out-of-range index becomes `None` and an unconnected value forwards its integer default `0` · union typing ignores inputs hidden by an `affectsInputs` dropdown, so raising `count` widens the union and prunes connections it can no longer reach
→ [Details](2026/11/20_feat-multi-select.md)
- `core.tuple-select` gains an `Index Mode` dropdown (`Default Value` / `Clamp` / `Wrap`) and an `int` `Default` connector that is hidden in clamp and wrap mode · clamp reads the first or last element, wrap counts modulo the tuple length
- Breaking: out-of-range positions now read the default value (`0` when the connector is unwired) instead of `None`
→ [Details](2026/11/20_feat-tuple-select-index-node.md)
- The Range Convert node maps a value from one min/max range to another with a linear, power (gamma), exponential, or stepped transfer, clamps out-of-range values, and inverts on reversed bounds · a `Quantization` control chooses whether a stepped level holds until the next step starts, picks the nearest level, or switches at the step start
→ [Details](2026/11/20_feat-range-convert-node.md)

## [Since 1.29.0] — 2026-11-20
- Range Adapt node clamps, wraps, ping-pongs, or falls back to a default when a value leaves its configured range, with optional inversion · Array Set `Step Width` now fills every index of a step with its interpolated value
→ [Details](2026/11/19_feat-range-adapt-node.md)

## [Since 1.28.1] — 2026-11-19
- The Web View number input gains `Min Value`, `Max Value` and `Step` controls, with the configured default, connector values and typed values clamped to the range · six value-bearing Web View controls gain a one-tick `changed` bool output (button excluded, select compares the option value, joystick reports either axis) · columns directly inside a row share the row width equally
→ [Details](2026/11/19_feat-web-node-improvements.md)

## [Since 1.28.0] — 2026-11-19
- Dropping a dragged node on a connection inserts at the mouse pointer instead of the node centre, so an edge-grabbed drop still previews and splices · a plain click never splices · multi-node drags skip the insert preview
→ [Details](2026/11/18_feat-drop-in-node-at-mouse-pointer.md)

## [Since 1.27.0] — 2026-11-18
- The graph interval is now a cadence between iteration starts, and `0` ms generates a yield-only loop · both settings surfaces call the value **Interval (ms)** with a `0–60000` ms range · blank or invalid input falls back to 500 ms · generated loops use `utime.ticks_*` deadline scheduling and register `import utime as _utime` only when a continuous graph needs it
→ [Details](2026/11/18_feat-cadence-graph-timing.md)

## [Since 1.26.0] — 2026-11-18
- Every collapsible section header is 28 px tall by default, with the per-view 30/32 px overrides removed · the base header surface moves to `--mo-surface-2` and the `nested` variant to `var(--mo-surface-3, #1c2a40)`, while the Firmware log sub-sections keep their deliberate 24 px · the unused view-layout save/restore (`config.viewLayout`) is gone, with no visible layout change
→ [Details](2026/11/18_feat-improve-layout.md)

## [Since 1.25.0] — 2026-11-17
- The graph canvas remembers its pan and zoom per graph document and flushes it on tab, graph and panel switches · a graph without a stored view opens centered on its content, an empty graph on the grid center · one wheel notch zooms 5 % instead of 10 %
→ [Details](2026/11/17_feat-restructure-for-deploy.md)

## [Since 1.25.0] — 2026-11-16
- `core.tuple` with `compose`, `decompose` and `tuple-select` · `core.select` is single-channel (saved multi-channel selects collapse to channel 1) and a mixed tuple/scalar union reports `any` · capability requirements now come from `resourceUsage` pins, so a target without the needed capability shows one node-level error · a fail-closed embedded override gate, per-option deploy hints, a reported stale `_dist/webapp` build, stock MicroPython `.bin` import and the ESP32-S2 target
→ [Details](2026/11/16_feat-restructure-for-deploy.md)

## [Since 1.25.0] — 2026-11-15
- The Deployment tab now uses the standard collapsible split shell: five panes when connected (**Deployment Actions**, **Device Information**, **Runtime Information**, **Collection on Device**, **Collection Comparison**) and a single Markdown **Deployment Help** pane when disconnected, without replacing the split · the duplicate runtime-provided custom view overlay is removed because `DeviceConnectionView` owns runtime views
→ [Details](2026/11/15_feat-restructure-for-deploy.md)

## [Since 1.25.0] — 2026-11-15
- A re-expanded split-view section no longer reclaims its maximized height: `desiredSize` hints are capped at the pane's equal share via a new pure `split-view-sizing.ts` solver, and splitter thickness (6px active / 4px inactive, border-box) is a single CSS/TS constant
→ [Details](2026/11/15_split-view-fair-share.md)

## [Since 1.25.0] — 2026-11-15
- The `Branching` node is removed; output input-source typing is `typeInputSources` only; unwired union outputs report their declared inputs' primary types · the transpiler emits one flat topological loop and `resolveDeclaredInputSources()` is the single parser
→ [Details](2026/11/15_remove-branching-node.md)

## [Since 1.25.0] — 2026-11-14
- Cancellable device connection: the badge opens a cancel-only dialog while connecting; duplicate connects join one attempt; Web Serial `port.open()` times out after 15 s
→ [Details](2026/11/14_device-connection-cancel.md)

## [Since 1.25.0] — 2026-11-13
- A firmware image's identity records the **package variant** it froze: `packageVariants` enters the content hash, the v3 sidecar, the `firmware.list` payload and the device's `device.json`; staleness compares it field by field; the Firmware tab gains a **Variant** column and the build log one `info: Packages: id@variant` line · staging, identity and the firmware menu share one `TargetPackageContext` and one `collect_package_versions()`, so a multi-variant package no longer fails a build after ESP-IDF ran · `null` variants still produce a byte-identical v2 payload · the collection source-upload path is untouched
→ [Details](2026/11/13_feat-restructure-for-deploy.md)

## [Since 1.25.0] — 2026-11-11
- Firmware images can be exported and imported as a self-contained `.firmware.zip` (binary + sidecar + `firmware-package.json` descriptor with a SHA-256) · `mo firmware package/export/import/list` verbs (with the interactive `mo firmware`/`mo fw` menu preserved as the bare form) · the Firmware tab's Local firmware toolbar gains **Import**/**Export** buttons · a new `firmware.import` `WS /firmware` frame and `GET /api/firmware/package?path=…` download route · import validates zip safety, checksum, and filename/sidecar identity, dedupes by SHA-256, and requires `--force`/confirmation to overwrite a different image · the collection `missing` / `override-required` source-upload path is untouched
→ [Details](2026/11/11_feat-firmware-import-export.md)

## [Since 1.25.0] — 2026-11-11
- Every firmware job reports in **both** the log and the result of the group that owns its controls: Build Firmware gained a **Build Result** sub-section, Deploy gained **Deploy log** and **Deploy Result**, Local firmware gained a **Local firmware log** and **Result**, and the cross-cutting Result pane is gone · build/deploy `warnings` are no longer dropped and a scan warning no longer says "No output yet" · refusals report next to the button that was pressed, `firmware.list`/`delete` failures write a log line and a result row, and the header notice keeps only server state · one `_createSubSection()` factory builds every nested sub-section · `esptool` erase/write run through the new `firmware_compile/process_stream.py`, so Deploy output streams while it flashes · the Firmware tab's Help is now Markdown via a reusable `MarkdownView`, the three Result sub-sections were removed (outcomes now live in the owning log with `info:` summary lines), the disabled "Local" firmware-source dropdown is gone, and the target dropdown defaults to the active collection's target · both port choosers share the server-formatted serial-port `display` names (`js/serial/serial-ports.ts` renders the payload verbatim, no local parsing) · the deploy port chooser is a titled "Device" field that lists only available ports and selects the first · unfolding the Help pane now actually opens it (no stale collapsed height, and the released pane re-equalizes)
→ [Details](2026/11/11_feat-restructure-for-deploy.md)

## [Since 1.26.0] — 2026-11-06
- The `vars` Name picker now models a variable as **declared** (one node on `Declare variable…` with a `Variable name`) versus **used** (`(not set)` or an existing name), so the list shows only declared names, a declaring node never lists itself, renaming a declaration rewrites every reference, and a declaration that disappears resets dangling references to `(not set)` · a second node declaring the same variable in the same store is badged as an error on both declaring nodes · JS/TS + labels only, no firmware rebuild
→ [Details](2026/11/06_vars-explicit-variable-declaration.md)

## [Since 1.26.0] — 2026-11-06
- The `vars` Name / Store picker row now follows the companion text field **while you type** instead of only after the editor closes, and the row is repainted when the deferred rebuild lands, so it can no longer keep the frame the placeholder was drawn in · typing into a companion field updates the picker option list in place instead of re-creating the node's controls, so a keystroke in one node no longer flickers the icon row of every other node (the icon control reloaded its glyph on each rebuild) · clicking the drawn `New variable` / `New store` row now edits that field: hit testing used the unresolved control list, so the click landed on a hidden sibling and the typed name was stored where neither the field nor the picker could show it · JS/TS only, no firmware rebuild
→ [Details](2026/11/06_vars-picker-live-echo.md)

## [Since 1.26.0] — 2026-11-06
- The `vars` Store / Name pickers keep showing what you typed instead of snapping back to `New store…` / `New variable…` (new `displayLabel` on the sentinel option, trigger + canvas only; the menu keeps the translated label) · a fresh `var-read` / `var-write` now starts on `default` rather than on the sentinel, and an unset/empty store resolves to `default` — no blank option any more · pickers in a previously rendered graph tab now pick up namespaces and names created in another graph (cross-graph refresh) · JS/TS only, no firmware rebuild
→ [Details](2026/11/06_vars-picker-sentinel-label.md)

## [Since 1.26.0] — 2026-11-06
- `var-read` / `var-write` replace free text with two cascading pickers: a **Store** dropdown over the collection's namespaces (`default` first, `_`-prefixed namespaces hidden) and a **Name** dropdown over the variables of the selected store · both end in a translated "New store…" / "New variable…" sentinel that reveals a text field, and the typed text is what the generator emits · the store value still lives in `inputDefaults.store`, so existing graphs keep their values and compile to the same Python · `vars` 0.38.0 (no firmware rebuild required)
→ [Details](2026/11/06_vars-store-and-name-pickers.md)

## [Since 1.26.0] — 2026-11-06
- Graph tabs gain a right-click / `Shift+F10` context menu with **Rename Graph**, the graph **Enabled** toggle and **Delete Graph** (`TabbedView.TabContextMenu.v1`, graph actions owned by `CollectionView`) · Rename reuses the double-click inline editor · **Delete Graph** leaves the hamburger menu · the graph enabled checkbox leaves the panel toolbar · removing a tab now drops its `.tabbed-view__view-container` wrapper, so the surviving graph fills the pane instead of sharing half the width
→ [Details](2026/11/06_tab-context-menu-and-graph-pane-fix.md)

## [Since 1.26.0] — 2026-11-06
- Graph tabs can be reordered by dragging (`TabbedView.reorderable`, 4 px threshold, insertion indicator, `Alt+Arrow`, Escape/pointercancel/blur cancellation) · pinned `movable: false` tabs act as walls · the new order is persisted through `CollectionManager.moveGraph()` and mirrored with `Collection.GraphMoved.v1` · reload/export keep it without a schema change · reordering is not undoable
→ [Details](2026/11/06_tabbed-view-tab-reordering.md)

## [Since 1.26.0] — 2026-11-05
- New `array-select` node in `vars`: reads one element of an array as a scalar `float` · an `Index Mode` dropdown (`Default Value` / `Clamp` / `Wrap`) resolves out-of-range indices, and `Clamp`/`Wrap` hide the `Default` input · runtime helper `_arr.select(buf, index, default, mode=...)` · themed `flex_no_wrap` icon · `vars` 0.36.0 (firmware rebuild required)
→ [Details](2026/11/05_vars-array-select.md)

## [Since 1.26.0] — 2026-11-05
- `math` gains `Floor` and `Ceiling` · `Round` gets a `Decimal Places` control (`0..6`, default `0`) · the same three operations in `array-math` (`_arr.round(a, decimals=<n>, clamp=...)`) · `core` 1.9.0, `vars` 0.33.0
→ [Details](2026/11/05_core-vars-math-floor-ceil-round.md)

## [Since 1.26.0] — 2026-11-05
- The device console is cleared when a connect attempt starts, so `Connecting...` is always the first line of a session and stale output of the previous session cannot mix into the new boot log · the clear sits in the connection-state handler, so toolbar, Deployment view and programmatic `connect()` behave alike · a repeated `connecting` event does not wipe a running attempt · the test seeds a stale message and asserts the new log content
→ [Details](2026/11/05_device-console-log-cleared-on-connect.md)

## [Since 1.26.0] — 2026-11-05
- The node palette now starts sorted by category (a stored `organizationMode` still wins) · small icon tiles stay at 32-36 px and wrap into additional columns instead of inflating the icons (about 6 per row at 300 px, 9 at 420 px) · one shared clamped tile width for favourites, recently used, the flat grid and the collapsible sections · tests pin both behaviours
→ [Details](2026/11/05_node-palette-category-default-and-tile-cap.md)

## [Since 1.26.0] — 2026-11-05
- The `HA Availability` node drew the same `binary_sensor` glyph as `HA Binary Sensor`, so a flag publisher looked like a sensor: the node now uses Material Symbols **`cloud_alert`** (`icons/cloud_alert_24dp.svg`, outlined 24dp with the standard `#e3e3e3` fill, added with `docs/workflow/adding-material-icons-to-node-packages.md`) · `tests/data/node-icon-material-mappings.test.js` pins the definition path and the themed file · no behaviour, generated code or firmware rebuild affected · `hass` 0.18.0
→ [Details](2026/11/05_hass-availability-icon.md)

## [Since 1.26.0] — 2026-11-05
- Writable HA entities could not follow their own input once Home Assistant had sent a value, and two of the four writable components had no node at all: `HA Number`/`HA Switch`/`HA Select`/`HA Text` gain an `Authority` dropdown (`Device wins` / `Home Assistant wins`, legacy-safe via a new `legacyDefault` in the node-definition migration), new `Command` (1) and `Updated` (2, one-cycle bool edge under a per-node `hass_cmd_<nodeId>` key) outputs, and an opt-in `Report State` (off = announced without a `state_topic`, write-only control) · new `HA Text` and `HA Button` nodes (the latter receive-only: `Pressed` for one cycle, `report_state=False`) · runtime `register_entity(..., report_state=False)` plus the `state=none` log and the state-less-entity guards · graph rules cover all seven entity nodes · demo collection, developer and user docs follow · `hass` 0.17.0 (firmware rebuild required)
→ [Details](2026/11/05_hass-node-taxonomy.md)

## [Since 1.26.0] — 2026-11-05
- Runtime-settings uploads that wrote station credentials, an access-point password or broker settings into a **disabled** section answered with a plain success while nothing could connect: `create_runtime_settings()` now returns one `warning` dialog per affected section (*Saved, But Not Enabled*) · the custom-view dialog protocol accepts `type: "warning"` (info dialog, `Warning` title, `⚠️` icon) · HA nodes print `[warning] hass: entity: … with MQTT disabled (enabled=false in /mqtt_settings.json)` once per entity and on their first state publish · docs and troubleshooting follow · `hass` 0.11.0, runtime `general` 1.50.2 (firmware rebuild required)
→ [Details](2026/11/05_disabled-settings-warnings.md)

## [Since 1.26.0] — 2026-11-05
- An entity with `Expire After` went `unavailable` seconds after boot on a live device: the state was retained *and* de-duplicated, HA expired it after the single message, and both availability topics still said `online` · `publish_state()` now repeats the unchanged value once per half window for entities with a positive `expire_after` (`_state_memo()`, `ticks_ms()`/`ticks_diff()`) · entities without `expire_after` are untouched · the `entity:` log line now carries `expire=<n>s` and the availability topics/mode · the `Expire After` control description and both HA docs explain the liveness contract · `hass` 0.10.0 (firmware rebuild required)
→ [Details](2026/11/05_hass-expire-after-liveness.md)

## [Since 1.26.0] — 2026-11-05
- `str.isalnum()` in the HA bridge crashed `app/main_loop.py` on every boot (MicroPython has no `isalnum`), and the supervisor's `Task.exception()` replaced the real error with its own `AttributeError` and reloaded in a loop · the supervisor now awaits the finished task (`_collect_task_failure()`), classifies `SystemExit`/`KeyboardInterrupt`/cancel separately and logs the genuine failure once · `wait_until_server_ready()` awaits `_server_task` instead of calling `exception()` · new `tests/test_device_micropython_api_guard.py` fails the suite on CPython-only calls in the device tree (`micropython-api-ok` marker for documented exceptions) · `docs/dev/mpy-precompilation/workflow.md` explains why `mpy-cross` cannot catch these and the `code` skill now requires both gates · runtime `general` 1.50.1, `hass` 0.9.1
→ [Details](2026/11/05_micropython-runtime-api-guard.md)

## [Since 1.26.0] — 2026-11-05
- One canonical device log taxonomy (`system`, `otter`, `info`, `warning`, `error`, `success`, `data`, `user`; everything else → `raw`) · the host now parses `[success]`/`[data]` instead of dumping them into `raw`, and `[debug]` is gone instead of being silently rewritten to `info` · `log_plain()` normalises an unknown level to `info` · ad-hoc tags (`[web-server]`, `[wv-refresh]`, `[web]`, `[WiFi]`, `[servo]`, …) replaced by `[data]`/`[info]`/`[warning]`/`[error]` with a source name · failures that were `[info]` are now `[error]`, completions `[success]` · `tests/test_log_prefix_contract.py` fails the build when device, host and docs drift
→ [Details](2026/11/05_device-log-prefix-taxonomy.md)

## [Since 1.26.0] — 2026-11-05
- An `Init` graph holding only the HA bridge no longer produces an empty `async def init():` body (`pass` instead of `SyntaxError`, so the app loads and announces) · MQTT defers `start()` until `machine.WLAN(STA_IF).isconnected()` and reconnects through the service controller · 10 s socket timeout on `umqtt.simple` connect · `start: … wifi=up/down/unknown`, `start: deferred …`, `publish: queued …`, `connect: re-announcing <n> deferred topic(s)` · `skip mqtt: disabled` names its cause via `disabled_reason()`
→ [Details](2026/11/05_mqtt-hass-startup-timing.md)

## [Since 1.26.0] — 2026-11-05
- `Device` is a default-on entry in every HA entity's `Available Flags` list · the separate `Availability` checkbox is gone · the list now expresses device-only, device + subsystem flags, subsystem-only and no availability · existing graphs migrate automatically (`valueMigration`), with a legacy generator fallback · the missing-flag rule ignores the reserved `__device__` entry
→ [Details](2026/11/05_device-availability-flag.md)

## [Since 1.26.0] — 2026-11-04
- Searchable MDI icon picker for Home Assistant entity icons (bundled MDI 7.4.47, names and aliases, offline) · `Show more` paging through all 7,447 icons · the node shows the picked icon · `Enter` accepts the typed value and closes the editor · entity icons now reach the discovery config · editors survive typing · `hass-icon-invalid` validation for malformed icons
→ [Details](2026/11/04_mdi-icon-picker.md)

## [Since 1.26.0] — 2026-11-04
- MQTT last will (`mqtt-will`), retained replay (`mqtt-announce`), `json-store` payloads, graph-topic dropdowns, topic-coherence badges · `select` mux node, `round` math operation · union output typing · new `hass` package (bridge + sensor/binary-sensor/number/switch/select) · `hass-bridge` as a collection singleton with a one-will badge · MQTT `on_message` hooks · shared graph-rule registry (`scope: 'graph' | 'collection'`) · Web View structure badges on permissive targets · node-validation architecture page
→ [Details](2026/11/04_mqtt-primitives-and-home-assistant.md)

## [Since 1.26.0] — 2026-11-04
- MQTT survives a soft reset · a value that could not be published is sent after the reconnect · first successful publish logged · `mqtt-write` retains by default · `mqtt-read` disconnected-default label shortened to `Default on Dis.`
→ [Details](2026/11/04_mqtt-reliability-and-defaults.md)

## [Since 1.26.0] — 2026-11-03
- Main toolbar upload button moved directly next to the graph collection selector
→ [Details](2026/11/03_workspace-upload-next-to-collection.md)

## [Since 1.25.0] — 2026-11-03
- Embedded source overrides survive redeploys · stale cleanup keeps libraries the firmware cannot replace · version-unknown firmware shadows in-use packages · RAM warning for packages not bundled in the firmware
- Docs: deploy pattern "Complete Plan, Subtractive Removal" · redeploy runbook · new Device Info row for libraries on device
→ [Details](2026/11/03_embedded-override-redeploy-fix.md)

## [Since 1.26.0] — 2026-11-03
- `array-math` gains the full core math operation set · `angleUnit` for trig · waveform runtime renamed to `sin_wave`
→ [Details](2026/11/03_vars-array-math-operations.md)

## [Since 1.26.0] — 2026-11-03
- `array-modify` gains an `In-Place` checkbox — off by default, so the operation writes into a copy and leaves the input array untouched
→ [Details](2026/11/03_vars-array-modify-inplace.md)

## [Since 1.26.0] — 2026-11-03
- `array-modify` gains random uniform and random normal types with `mean`, `stdDev`, and `min`/`max` range controls
→ [Details](2026/11/03_vars-array-modify-random.md)

## [Since 1.25.0] — 2026-11-02
- Ctrl+drag copies nodes · Alt+drag bypasses pass-through nodes · graph panel toolbar with execution type and sleep duration mirrored with the graph settings · align-to-grid in one undo step · print node `enabled` input · `mqtt-read` `Default` input and `Default when disconnected` checkbox · new `mqtt-status` node · one JSON parse per payload and type · MQTT device diagnostics (settings source, broker target, connect result with reason code and latency, per-topic subscribe confirmations, first payload per topic) · service controller skip reasons
- Fix: capability tooltips survive a tab switch · input default controls keep a usable width on rows shared with an output · nodes grow to fit their panel controls with a shared label/value column · long titles ellipsise clear of the header chrome · 21 px connector pitch with a 12 px section gap and a hairline separator · Cut removes the selected nodes immediately in one undo step · ADC Input uses the DAC Output icon with the arrow pointing down · Web Value Store Load defaults to on · MQTT read crash on a topic without messages · MQTT read nodes consuming each other's messages · MQTT subscriptions dropped when the link was up at boot · MQTT link dropped by the broker after ~90 s of silence (no `PINGREQ`) · `TypeError` with a username and no password · `sync()` aborting every later service when one adapter's state check throws · half-open client socket leaked after a failed connect
- Refactor: `init_mqtt` emits one `_mqtt.start()` after all registrations
→ [Details](2026/11/02_feat-improve-ui.md)

## [Since 1.26.0] — 2026-11-02
- LED driver hardening · all six color orders · advisory pin claims · duplicate-pin detection · frame throttling
→ [Details](2026/11/02_led-and-pin-hardening.md)

## [Since 1.25.0] — 2026-11-02
- `array-generate` buffer reuse · `array-modify` in-place fill/ramp/steps/hat/sine/shift with `modifyType`-driven visibility
→ [Details](2026/11/02_vars-array-generate-modify.md)

## [Since 1.24.0] — 2026-11-01
- Improved AP server plan · NeoPixel unconnected-input handling · in-place NeoPixel rendering
- Fix: RGBW order with three-letter color orders · zero-fill and padding
→ [Details](2026/11/01_feat-improved-ap.md)

## [Since 1.23.0] — 2026-11-01
- Variable store (`vars` package) · LED and LED-strip nodes (`led` package) · declare-once variable validation
→ [Details](2026/10/27_led-strip-and-variable-store.md)
- Store-only `vars` nodes · array generate/math/shift operations with clamp · run-once startup graphs
→ [Details](2026/10/29_vars-store-and-array-operations.md)
- Dry/wet `mix` and click-free bypass on bitcrusher/downsampler · anti-alias filter · no DC crackle or block-rate buzz
→ [Details](2026/10/30_audio-lofi-artifact-fixes.md)
- Square-fuzz `mix` control · no power-on glitch · no amplifier pop on unmute
→ [Details](2026/10/30_audio-startup-glitch-and-fuzz-strength.md)
- `ring-mod` audio node · bitcrusher relabel and gain fixes · resilient I²S streaming
→ [Details](2026/10/30_audio-viper-ring-mod-and-gc-fixes.md)
- `mo fw` can rebuild already-published firmware versions · exit-code `9` handling fixed
→ [Details](2026/10/30_firmware-menu-overwrite-recovery.md)
- `persist` on webview input controls · web value store read/write/save/load nodes · `requiredPackages` dependencies
→ [Details](2026/10/30_webview-persist-and-value-store.md)
- Independent station/AP WiFi settings · WiFi can be switched off · station reconnect supervisor · `visibleWhen` control property
→ [Details](2026/10/30_wifi-per-mode-settings.md)
- Web server honours its `enable`/`port` settings · late connect starts only enabled services · MQTT disconnects/reconnects with the link · configurable reconnect and resync intervals
→ [Details](2026/10/31_communication-endpoints.md)
- Device-list refresh button · wrapping `stack` layout in custom views · device names survive deployments
→ [Details](2026/10/31_feat-bugs-and-ui.md)
- Selection glow and active-node-on-top rendering · grid snap works · connection splice and Ctrl+drag bypass fixed
→ [Details](2026/10/31_graph-panel-interaction-fixes.md)
- Node "Show Info" dialog gains a Type column · corrected web-view `persist` guidance · German documentation for all nodes
→ [Details](2026/10/31_node-info-types-and-german.md)

## [Since 1.22.0] — 2026-10-23
- Extended device-target capability model · target capability/resource validation · ESP32-S3 Mini target · revamped Target Config view with foldable groups and icon legend
- Fixes: splitter movability next to collapsed panes · per-direction digital/I2S pin-capability icons
→ [Details](2026/10/23_feat-capability-config.md)

## [Since 1.21.1] — 2026-10-22
- Web-view input controls · initial-state sync · navigation polish · console raw filter · slider value display · deployment package-version compatibility · WiFi config status
→ [Details](2026/04/25_more-web-nodes.md)

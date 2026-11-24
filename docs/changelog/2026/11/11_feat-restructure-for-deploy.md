# Changes since version 1.25.0

## New Features
- **Every firmware job reports where its buttons are** — a build, package scan, deploy, firmware list,
  or delete now writes its warnings, errors, and failures to **both** the log and the result of the
  group that owns its controls (Build Firmware, Deploy, Local firmware). The cross-cutting Result pane
  is gone: Build Firmware gained a **Build Result** sub-section, Deploy gained **Deploy log** and
  **Deploy Result** sub-sections, and Local firmware gained a **Local firmware log** and **Local
  firmware Result**. The header notice now carries only server availability and capability state.
- **Warnings are visible** — a build or deploy whose payload carries `warnings` shows a warning row in
  its result and a matching `warning:` line in its log, and a package scan no longer labels every
  warning "No output yet".

## Improvements
- **One sub-section factory** — `_createSubSection()` builds every nested collapsible (Packages,
  Installed add-ons, Build log, Build Result, Deploy log, Deploy Result, Local firmware log/result), so
  the header height, nested variant, and spacing cannot drift apart.
- **Deploy output streams while it flashes** — `esptool` erase and write run through the new
  `firmware_compile/process_stream.py`, so the Deploy log fills line by line instead of appearing after
  the flash finishes. Build and flash now share one seam for streamed output, cancellation, and
  timeouts; a boundary test keeps every backend on it.
- **The Deploy log is the tool's own transcript** — every line `esptool` writes reaches the log
  verbatim, its progress bar included, so the log shows what the tool actually did instead of a filtered
  summary. The progress bar therefore advances in the log while the flash runs, and the readout beside
  it keeps naming the stage and ticking the elapsed seconds.
- **An add-on's nodes show their own icon** — `node_definitions.json` points `icon` at an SVG in the
  add-on's `icons/` folder, beside its definitions. The server serves that file from the installed
  package and `mo addons package` carries it into the archive, so a copied or published add-on keeps
  its glyph. The hello example now ships `waving_hand` and the pulse example `vital_signs`.

## Fixes
- `payload.warnings` from a successful build or deploy was dropped by the result renderer.
- A refused action (no port, server capability gone) reported in a pane that owned none of the pressed
  controls; it now reports in the pane whose button the user pressed.
- A failed `firmware.list` only flipped the inventory table's empty state and a failed
  `firmware.delete` reported nothing at all; both now write a log line and a result row.
- **A streaming tool no longer goes silent after its first line** — the streamed child now runs with
  `PYTHONUNBUFFERED=1`, `TERM=dumb`, `NO_COLOR=1`, and `CLICOLOR=0`, so a Python tool stops
  block-buffering into the pipe and stops treating it as a smart terminal that may overwrite and delete
  the lines it already printed.
- **A redrawn progress line no longer corrupts the next log line** — the seam renders a bare `\r` the
  way a console does (the new text overwrites the old), holds a `\r` that ends a pipe read until the
  next read decides whether `\n` follows, and strips ANSI escapes, so an in-place redraw can neither
  glue its unterminated tail (and its `[1A[2K` erase codes) onto the following message nor flood the
  log with intermediate updates.
- **A progress bar advances on one line** — esptool rewrites its bar for every flash block, and under
  `TERM=dumb` it ends each rewrite with `\n`, so the Deploy log showed one line per block: several
  hundred near-identical bars scrolling the rest of the transcript away. The seam now keeps the
  carriage return of a line that reprints the line before it, and the log reducer rewrites its last
  line instead of appending, so the bar advances in place as it does in a console while a bar that
  follows an ordinary message still starts a line of its own.
- **A live log no longer snaps back to its first line** — `CodeView` replaced its rendered content on
  every update, which resets the scroll position, so the Deploy log kept showing the lines of its first
  screenful while `esptool` was already writing the image: a running deploy looked frozen. Log views now
  update with `setCode(text, { follow: true })`, which keeps the tail in view while the reader sits
  there and holds the offset of a reader who scrolled back.
- **A log box scrolls instead of cutting its text off** — the Firmware tab caps its log boxes at 240 px
  on `.view-code`, while the text scrolls in `.view-code__scroll-wrapper`. That wrapper is
  `height: 100%`, which inside an auto-height host means "as tall as my text", so it never overflowed:
  the cap, together with `.view-code`'s `overflow: hidden`, silently deleted every line past the first
  screenful. A deploy showed exactly its first fourteen lines — the esptool banner up to
  `Flash will be erased …` — with no scrollbar to reach the several hundred lines behind them.
  `code-view.css` now gives the wrapper `max-height: inherit`, so the box's cap reaches the scrolling
  element and a long transcript scrolls inside it.
- **A fresh compiled-mpy firmware no longer reports every bundled package as "outdated"** — the deploy
  compatibility check compared the declared `.py` library paths against the firmware's `.mpy`
  inventory entries, so a firmware that correctly froze `otter_mqtt/__init__.py` as
  `otter_mqtt/__init__.mpy` was marked `Incompatible` with "firmware update required" for every
  compiled package. `resolveFirmwareInventoryPath()` now treats a `.mpy` inventory entry as the
  declared `.py` module everywhere the plan classifies firmware-bundled files.
- **One source of truth decides whether a library is up to date, missing, or outdated** — the deploy
  previously split that answer across three places: a host-catalog availability evaluator, a
  device-inventory safety net, and a version comparison. The three disagreed, so a firmware that was
  current by version but whose inventory missed a newly-added file was hard-blocked with
  "Deployment blocked", and a firmware reporting a non-semver package version was silently trusted as
  current. The new `resolveFirmwareModulePlan()` in `embedded-module-plan.ts` answers the question
  once: a package is *current* only when its firmware version is at least the host version **and**
  every needed file is inventory-confirmed; a version-equal package with a missing file, an outdated
  package, and a package with an unusable version are all shadowed as a whole (host source upload)
  instead of blocking, and a non-semver firmware version is never accepted as currency. The firmware
  build now also rejects a node package whose manifest `version` is not strict `x.y.z`.

## Improvements

- **The Firmware tab's Help is Markdown** — the Help pane now renders one Markdown string through the
  new, reusable `MarkdownView` (`js/views/markdown-view.ts`, safe allowlisted HTML via the
  documentation renderer), replacing the two plain-text intro lines. The copy explains that a graph
  needs only MicroPython, that `.mpy` precompilation saves user-area RAM and starts faster, and that
  deploying a collection needs no firmware rebuild.
- **The three Result sub-sections are gone** — a job's outcome now lives in the log of the pane that
  owns its controls, and the structured summaries (build artifact/publish status/runtime/size, deploy
  image/size/SHA-256/port/board/chip, deleted image + count) are written as `info:` lines, so no
  information is lost. The three logs (Build, Deploy, Local firmware) stay.
- **The disabled "Local" firmware-source dropdown is removed** — the Target pane no longer renders a
  dead single-option chooser; the server `firmwareSources` capability is untouched.
- **The target defaults to the active collection's target** — when that target is buildable (so the
  generic/custom wildcard targets fall through), otherwise to the runtime default, otherwise to the
  first offered target. An explicit pick survives a collection switch.
- **Both port choosers share one source of truth** — the Firmware tab's deploy dropdown and the
  Device Connection view both read `/api/serial-ports` through the new `js/serial/serial-ports.ts`
  helper, and the server now formats each port's human-readable `display` name
  (`format_serial_port_label` in `micro_otter/cli/state.py`) so the browser renders it verbatim
  instead of parsing `/dev/serial/by-id` labels locally. The raw `label` stays in the payload; a
  pre-`display` server still works via a `display → label → device` fallback. The formatter also
  stops repeating a port name that already appears in its label (a Windows
  `USB Serial Port (COM3)` no longer renders `… (COM3) (COM3)`).
- **The deploy port chooser is now a titled `Device` field** — the dropdown gains a `Device` title
  label to its left (a new `label` option on the shared `DropdownControl`) and no longer shows the
  `Port` placeholder: it lists only the available ports and selects the first one when nothing is
  picked, so the trigger always names a real port.

## Fixes

- **Unfolding Help now actually opens it** — two fixes stop the Firmware tab's Help pane from
  growing by just a few pixels on first expand: `CollapsibleView` no longer remembers a
  "height before collapse" during the *initial* collapsed render (only a real collapse captures a
  height to restore), and `SplitView` re-equalizes the flexible panes when the last fixed pane is
  released, so a section that started collapsed regains a fair share instead of keeping the tiny
  ratio it held at its header height.

## New Features
- **Add-on packages install and remove in the Firmware tab** — the Installed add-ons sub-section gains
  **Install** and **Remove** buttons: Install opens a hidden `.zip` picker and sends one
  `addon.install` frame, Remove uninstalls the ticked rows through one `addon.uninstall` frame, a
  replace and a removal both ask through the shared `ViewManager` confirmation, and every outcome is
  reported in the Build Firmware log next to the buttons. The sub-section is now visible on any
  `ready` capabilities snapshot, because the server advertises `node-package-addons` only *while* an
  add-on is installed — the old gate made the first install impossible.
- **One add-on wire contract** — `WS /firmware` gains `addon.install` (`filename`, `archiveBase64`,
  `force`) and `addon.uninstall` (`packageIds`), accepted without a capability gate because they write
  only `Config.addons_dir`. Their results carry the same inventory payload
  (`addons`/`conflicts`/`warnings`) that `mo addons list --json-output` prints, plus
  `installed`/`removed`, and all 22 stable `addon-*` codes join the endpoint's error set and render as
  translated sentences in `en` and `de`.
- **Add-on size caps rise and move server-side** — `addon_archive.MAX_ARCHIVE_BYTES` goes to 64 MiB
  and `MAX_UNPACKED_BYTES` to 128 MiB (the 2000-member cap is unchanged); the archive cap is enforced
  by the path-or-URL resolver before the zip is opened, and the unpacked cap remains the real guard
  against a zip bomb.

## Breaking Changes
- **`addon.install` / `firmware.import` accept `{path | url}` and nothing else** — the 16 MiB base64
  upload and `WEBSOCKET_MAX_MESSAGE_BYTES` are gone, and the socket is back to the `websockets`
  library default.
- **`GET /api/firmware/package` is deleted** — Export writes into a folder chosen through the picker
  (or `mo firmware export --output-dir`) instead of downloading through the browser.
- **The tab's local-path actions (Import, Install, Export) exist only while the server advertises
  `local-file-access`** — which needs a loopback-bound server; the *from URL…* actions and the CLI
  remain the remote path.

## New Features
- **One resolver for path-or-URL archives** (https only, `http` only towards loopback, at most three
  re-validated redirects, a streamed byte cap, timeouts) behind both frames and the CLI verbs, plus
  `mo addons package` for turning an add-on folder into a reproducible zip that nests every member
  under `<folder>/` — the shape `addon.install` accepts without `--as`, and the shape a plain
  `zip -r` produces.
- **A server-side file picker** — the `fs.list` → `fs.list.result` / `fs.list.error` side channel
  answered on the read loop (so browsing works during a build) and `FilePickerDialogView` with file
  and folder-only modes.
- **`firmware.export`** copies the selected image to `<image-stem>.firmware.zip` inside the chosen
  folder, refuses an existing file with `firmware-export-exists` until the overwrite is confirmed,
  and reports the written absolute path.
- **Without a server the Firmware tab renders one Markdown explainer** (what a server adds, how to
  start one) instead of a grid of disabled controls, and every new `archive-*` / `fs-*` /
  `firmware-export-exists` code renders as a translated sentence in `en` and `de`.

## Improvements
- **One containment rule** shared by `firmware.delete` and the new export.
- **Self-made archives just work** — a macOS `__MACOSX/` metadata directory is ignored on validate and
  install, and `mo addons package` skips `.DS_Store`, `Thumbs.db`, and `__pycache__`.
- **`is_loopback_host` promoted** to `tools/host_policy.py`, shared by the CLI, the capability
  payload, and the URL policy.
- **`js/firmware/firmware-import.ts` deleted** with the hidden file inputs, the base64 reader, and
  the `<a download>` path they served.
- **The pulse example add-on now works end to end** — its `pulse.tick` node gained real inputs
  (Value, Interval), a gated `Out` output, `Duty`/`Invert` controls, and full palette and Show-Info
  help text. A shared generator emits the node's call behind a guarded import (`moa_pulse` /
  `moa_pulse_viper`), and both device modules expose the same `high()` API, so the node can be
  tested in the palette and on a board.
- **The hello example add-on is wired up too** — its `hello.greet` node gained the missing
  `implementations` entry, a corrected generator that imports `moa_hello` and returns the
  `greeting()` call, and palette/Show-Info help text, so the minimal single-implementation example
  actually builds and emits its string.

## Improvements
- **The Firmware tab's panes size to their content** — every pane collapsible sets
  `sizeToContent: true`, the mode the Settings tab already uses, so a short section (Help, or Deploy
  before anything ran) takes only its own height instead of an equal share of the split and the
  leftover space stays unused. A pane whose content outgrows the available space stays capped and
  scrolls inside its `ContentView`, as before.

## Fixes
- **A pane that still has room no longer leaves the split half empty** — `SplitView` wrote its
  normalized ratios straight into `flexGrow`, and CSS hands out the space that content-capped panes
  release only in proportion to the flex factors of the panes that are still unfrozen, granting just
  `sum × free space` when that sum is below one. Once the four short Firmware-tab sections froze at
  their caps, Build Firmware was offered its own ~0.24 fraction of the released ~230 px and scrolled
  while the rest sat empty below it. Flex factors are now scaled by the smallest positive ratio
  (`_flexGrowScale()`), so every pane weighs at least one and any set of unfrozen panes can take all
  of the released space; the residual filler uses the same scale so it still absorbs only the unused
  space. `_renderChildren()` also re-applies the final ratios after the panes attach, because a
  mid-attach recalculation could leave them on the pre-attach snapshot.
- **The content-fit cap includes the content box padding** — `CollapsibleView` now adds the vertical
  padding of `.collapsible-view__content` to the measured cap, so a themed content box (the Firmware
  tab pads it 8 px top and bottom) no longer leaves a pane that fits its content a padding short and
  scrolling.


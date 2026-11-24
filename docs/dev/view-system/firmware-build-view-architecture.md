# Firmware Build View Architecture

The **Firmware** tab is an always-present panel that renders the local server's firmware
compile/deploy contract. It never re-implements the contract: board, chip, flash offset, backend
selection, package staging, error codes, cancel/timeout semantics, and image resolution are decided
by the server. The view parses frames, renders payloads, and disables controls it knows the server
cannot honour.

## Purpose and boundary

- **What it is:** the renderer of `GET /api/server-capabilities` and `WS /firmware`.
- **What it is not:** it never touches `js/deployment/`, never stages packages, never reads
  `target.webTargetId` (it sends `_selectedTargetId` as `targetId` and lets the server resolve the
  board), and never uploads node-package source — that stays in `DeviceDeployment`/`runtime-deployment.ts`
  for `missing` / `override-required` packages.
- **Why always present:** gating the layout on a probe would make the tab appear and disappear when
  the backend restarts. The state machine lives inside the view instead.

## State machine

```
probing → ready | unavailable
```

- `probing` — the first paint and any forced re-probe: the five panes render with every gated control
  disabled, and the offline section stays hidden so a startup probe never flashes an outage.
- `ready` — a `serverType === "micro-otter"` payload arrived; controls are enabled subject to their
  per-feature gates (`firmware-compile`, `firmware-deploy`, `node-package-addons`, …).
- `unavailable` — the probe failed (`unreachable`, `malformed`, `not-micro-otter`), or no snapshot
  exists; the panes are hidden and replaced by one expanded offline Help section, and every gated
  control is disabled. The tab offers no recovery control of its own: the title-bar badge and the
  reconnect dialog in the app shell own that (see
  [server-connection.md](../core/server-connection.md)).

The "server decides, client renders" rule: where the server is silent, the client omits a field
rather than inventing a value. Concretely, the tab sends `targetId` (the server resolves it to the
build board) and fixes `modulePackagingMode` to `compiled-mpy`.

## Capability contract

The capabilities snapshot comes from [server-firmware-api.md](../firmware-compile/server-firmware-api.md)
and is decoded only in `js/firmware/server-capabilities.ts`. Unknown keys and unknown feature ids
are ignored (forward compatibility).

## Module map

- `js/views/firmware-build-view.ts` — the shell, five composed SplitView panes (Help, Target, Local
  firmware, Deploy, Build Firmware), the per-group log routing, control gates, and the
  `viewManager` wiring for whole-app dialogs.
- `js/views/markdown-view.ts` — the shared `MarkdownView` that renders the Help pane's Markdown to a
  safe HTML subset via `js/core/markdown-renderer.ts`; styled by `styles/standard/markdown-view.css`.
- `js/views/firmware-inventory-panel.ts` — the Local firmware section (toolbar, table, details view,
  in-section progress bar); presentational and dialog-free.
- `js/views/firmware-packages-panel.ts` — the Packages / Installed add-ons checklists.
- `js/views/progress-bar-view.ts` — the shared `ProgressBarView` that reports the progress of one
  running operation as a text-only readout (label, stage/message, elapsed timer, optional Cancel — it
  deliberately draws no bar); styled by `styles/standard/progress-bar-view.css`.
- `styles/standard/firmware-build-view.css` — the registered view stylesheet.
- `js/firmware/server-capabilities.ts` — the cached capability client (the tab receives this store;
  the app-shell monitor that polls it is
  [server-connection.ts](../core/server-connection.md)).
- `js/firmware/firmware-job-state.ts` — the pure frame reducer.
- `js/firmware/firmware-client.ts` — the `WS /firmware` client.
- `js/firmware/firmware-inventory.ts` — the firmware-inventory decoder + compatibility classifier.
- `js/firmware/board-catalog.ts` — the `boards.json` reader.
- `locales/{en,de}.json` — the `firmwareBuild` locale root.
- `tests/views/firmware-build/` — the view's suites (`fixtures.js` plus one suite per subject). The
  suites query the shared components' own classes; there is deliberately no selector-map helper.

## View composition and styling

The tab is a `display: flex; flex-direction: column` shell (root `overflow: hidden`, `__content` host
`overflow: hidden` too — the tab itself never grows a scrollbar) whose children are `__content` and
the `__offline` host. `__content` holds the panes; `__offline` holds the single offline Help section
and is hidden while the panes are shown. Nothing in the tab reports server state: there is no header,
no state badge, no server version, no `role="status"` notice, and no Retry control — availability,
the title-bar badge, and the reconnect dialog belong to the app shell
([server-connection.md](../core/server-connection.md)).

The content host holds one vertical **`SplitView`** (`js/views/split-view.ts`, `orientation:
'vertical'`, `minPaneSize: 32`, `gap: 4`), so every section is a real pane with its own `ContentView`
scroller and a draggable splitter between neighbours. Panes, in order: **Help**, **Target**, **Local
firmware**, **Deploy**, **Build Firmware**. There is deliberately no cross-cutting Result pane.

Scrolling is per pane, matching Target Config, Device Deployment, and the Console: a section that
outgrows its pane scrolls inside its `ContentView` instead of pushing the tab into a whole-view
scrollbar, so every collapsed pane header stays put while one long list scrolls.

Every pane sets `sizeToContent: true` (`_createSection()`), the same mode the Settings tab uses, so a
pane is capped at its rendered content height instead of claiming an equal share of the split: five
equal panes would either clip short sections or leave tall ones without the space they need. A short
section — Help, or Deploy before anything ran — takes only its own height and the leftover space stays
unused; a section whose content outgrows the available space stays capped and scrolls. Because the
tab's stylesheet pads `.collapsible-view__content`, the shared cap includes that padding, so a fitting
pane never grows a scrollbar by a few pixels. The panes also weight their flex factors relative to the
smallest one (the collapsed 28 px Help header), so the space the four capped sections release reaches
Build Firmware — the only section that can still use it — instead of leaving an empty band above it;
see [Content-height Sizing](settings-views-guide.md#content-height-sizing).

The five top-level panes use the shared `CollapsibleView` default of 28 px and pass no
`headerHeight` override. Only `_createSubSection()` pins a smaller value: its nested log sub-sections
keep `headerHeight: 24` and the `nested` variant, whose header uses `var(--mo-surface-3, #1c2a40)` —
one surface step above the `--mo-surface-2` base header — so a log header still reads as a child of
its pane header.

**Help** is the first pane and starts collapsed. It renders one Markdown string —
`firmwareBuild.help.body` — through the shared `MarkdownView` (`.view-markdown` inside a
`.firmware-build-view__help-body` host): what the tab builds and deploys, that a graph needs only
MicroPython (the Deploy tab uploads sources as `.py`), that `.mpy` precompilation saves user-area
RAM and starts faster, and that deploying a collection never recompiles firmware. Neither encodes
state, so it is not a live region; `_renderHelpText()` rewrites it on a locale switch. It lives in a
pane rather than in a cross-cutting heading so a user who knows the tab can collapse the explanation
away.

### One owner per job

Every job reports through the **log** of the pane that owns its controls. Each pane carries its own
nested `CollapsibleView` sub-section, built by `_createSubSection()` (`nested: true`,
`headerHeight: 24`, `sizeToContent: true`):

| Job | Owning pane | Log sub-section |
|---|---|---|
| `compile` | Build Firmware | Build log |
| `scan` | Build Firmware | Build log |
| `deploy` | Deploy | Deploy log |
| `list` | Local firmware | Local firmware log |
| `delete` | Local firmware | Local firmware log |
| `import` | Local firmware | Local firmware log |

Four cross-cutting surfaces stay, and none of them carries job text: the Build log's capability
diagnostics report the server's toolchain state only (see below), the inventory table's
`refreshFailed` line is that table's empty-state summary, `_renderCompositionBanner()` gives pre-action
image advice, and `ProgressBarView.setStatus()` shows transient stage text.

### Capability diagnostics

A `ready` snapshot that cannot compile or flash is reported in the **Build Firmware log**, not in a
header notice: `_buildDiagnosticLines()` walks `buildBackends` (when `firmware-compile` is absent) and
`flashBackends` (when `firmware-deploy` is absent), writes one `firmwareBuild.doctor.backend` line per
unavailable backend — echoing the server's `reason` untranslated, because it describes a local
installation — and closes with the `firmwareBuild.doctor.hint` (`micro-otter doctor`). An empty
backend list yields `firmwareBuild.doctor.noBackend`, and a backend without a reason yields
`firmwareBuild.doctor.noReason`.

The lines are cached in `_capabilityDiagnostics` (already prefixed `warning: `) and
`_diagnosticTexts`, and `_buildGroupLogLines()` spreads them **first** for the `build` group, ahead of
the group's evidence and the job's outcome, because a capability problem predates every job. They are
derived from the snapshot on each `_renderCapabilityDiagnostics()` instead of being appended, and the
job panels only re-render when the text changed, so a re-render can neither duplicate a line nor
shuffle it. The deploy log stays free of them: the deploy pane's own refusal lines already explain a
blocked deploy.

Server availability itself is not this view's business — see
[server-connection.md](../core/server-connection.md) for the app-level monitor that owns it.

`_groupKeyForJob()` maps a job to `'build'`, `'deploy'`, or `'inventory'`. A refusal that happens
before a job starts cannot travel as a server frame, so `_addGroupNotice(group, severity, text)`
buffers it as an evidence line for that group's log. Every other line is derived on each render
(`_outcomeLines()`), never appended, so a re-render cannot duplicate a warning; on success the
owning group's summary (artifact, publish status, runtime version, frozen packages, size; image, size,
SHA-256, port, board, chip; deleted path and image count) is appended as `info:` lines, so the log is
the single place a job reports its outcome.

A failure expands the owning pane and opens its log sub-section. A successful background
`firmware.list` leaves the Local firmware log empty and collapsed, so the tab does not pop a pane
open on every page load.

**Build Firmware** is one pane whose content holds the existing-firmware line, the build progress
readout, and three **nested** `CollapsibleView` sub-sections with a smaller `headerHeight` (24):
**Packages**, **Installed add-ons**, and **Build log**. The sub-sections pass `nested: true`, the
shared `CollapsibleView` variant (its header drops one surface step to `--mo-surface-2` and its title
to a lighter weight), so the hierarchy comes from the shared view instead of a firmware-specific
class; the option is opt-in, never inferred from DOM depth. The add-ons sub-section is visible on any
`ready` capabilities snapshot; only its *tickable rows* are gated on `node-package-addons`, because
the server advertises that feature only while an add-on is installed — hiding the whole sub-section
would make the first install impossible.

### Existing-firmware line

Above the Packages sub-section sits one muted line (`_renderBuildMatch()`, class
`.firmware-build-view__build-match`) answering "must I build again?". It runs
`findFirmwareSelectionMatch()` against the **ticked** checklist (`FirmwareSelection`), not the
collection's needs, and stays hidden until the inventory has been read, a target is chosen, and at
least one package is ticked — an unknown list would otherwise claim "no firmware exists".

The wording follows `FirmwareSelectionMatch.exact`, because an image that merely *contains* the
selection is not the firmware that selection would build:

- **exact** — `firmwareBuild.build.matchingFirmware` ("a firmware for exactly this selection already
  exists: `{{version}}`"), hint `firmwareBuild.build.matchingFirmwareHint`.
- **superset** — `firmwareBuild.build.matchingFirmwareSuperset` ("a firmware that includes this
  selection already exists: `{{version}}`"), hint `firmwareBuild.build.matchingFirmwareHintSuperset`,
  which adds that a rebuild would only slim the image.

Both states take the accent `--exists` variant, and neither disables the Build button: a user may
deliberately want the minimal image, so the line informs instead of gating.

### Imported images in the inventory

An imported raw binary is listed **by board only**: `renderInventorySection` filters on
`entry.boardId === context.boardId && (entry.runtimeId === context.runtimeId ||
isImportedFirmware(entry))`, because an imported image's `imported` runtime is not a Micro Otter
runtime. Its row carries an `Imported` badge (`.firmware-inventory__badge--imported`, the
`IconProvider.download` glyph the Import button already uses) with the translated label, and the
details table inserts two rows directly after the image row — `detailsOriginalFile`
(`entry.originalFilename`) and `detailsImportTarget` (`entry.targetId`) — each falling back to
`notAvailable`. The channel, version-source, and runtime rows already show `notAvailable` / `imported`,
and the packages table stays empty because the sidecar has no package data.

### Pane toolbars

Each pane opens with a `ToolbarView` as its first content row, attached straight to the pane root:
the pane's own `flex-direction: column` lays the row out, so the toolbar needs no wrapper element and
no `.view-toolbar` override. The row is content, not chrome — a collapsed header hides it with the
rest of the pane — which is why a started job expands its owning pane before the user needs the
controls back (see the progress-readout paragraph below).

Both rows place the `ButtonControl` first and its checkbox to the right, so the tab has exactly one
button treatment (no labelled Build next to an icon-only Deploy):

- **Build Firmware** → Build button, then the Clean-build checkbox.
- **Deploy** → Deploy button, then the wipe checkbox (host `.firmware-build-view__wipe`, carrying the
  hint as its `title`).

The Build button carries the `deployed_code` glyph (`IconProvider.deployedCode`) and swaps to
`IconProvider.close` while a job runs or is cancelling, so the button that offered "build" shows
"cancel" in the same place. Both buttons are `iconOnly: true`: the label becomes the `title` tooltip
and the `aria-label`, so an icon-only control keeps its accessible name and `setLabel()` refreshes
both.

Every toolbar in the view — these two rows, Packages, Installed add-ons, Local firmware — keeps the
shared `ToolbarView` at its default height and its own surface; none of them overrides it.

A pane that needs a second row gives that row its own host element. `ToolbarView.render()` mounts
through `ViewBase.mountContent()`, which calls `replaceChildren()` on the host, so attaching a second
toolbar to the pane root would silently delete the first. The Deploy pane's **port row** is the only
such row — a `.firmware-build-view__deploy-port-toolbar` host under the action row, holding the
connected-port `DropdownControl` and the rescan `ButtonControl`, exactly like the Packages and
Installed add-ons toolbars sit in their `firmware-build-view__packages-toolbar` /
`-addons-toolbar` hosts.

There is no shared log section. The Build Firmware group owns the **build log** sub-section and the
Deploy section owns a **deploy log** (each a `CodeView`). `_onFrame` snapshots the reducer's log buffer
into `_buildLogLines`/`_deployLogLines` by job (`compile` → build, `deploy` → deploy; `list` /
`delete` / `scan` touch neither), so a deploy never overwrites build output. A terminal failure (an
`error` frame, `failed`/`timeout` result, or disconnect) expands the owning collapsible — for a build
that means both the outer Build Firmware section and the Build log sub-section — and scrolls its log
into view.

Deploy resolves its image by a three-step priority — the selected inventory row, then the last
same-target build, then the server's newest-image default. When an image is selected, the Deploy
section shows its **identity** as a `DataTableView` (firmware version / MicroPython / runtime / hash)
instead of the filename; otherwise a status line shows the fallback source
(`firmwarePathFromBuild` / `firmwarePathNewest`). Selecting a row sets `_selectedFirmwarePath`; a
target change or a successful delete clears it, so the view never silently flashes a stale or wrong
image.

A running compile/deploy job shows a **`ProgressBarView`** inside its own group — the build readout in
the Build Firmware section, the deploy readout in the Deploy section. The view keeps one instance per
group (`_buildProgressView`, `_deployProgressView`) and drives it from `_renderJobProgress()`: the
operation label (`firmwareBuild.progress.building` / `.deploying`), the stage or message the server
reported (`message` wins over `stage`), and an elapsed timer fed by an owner-supplied formatter. Only
the build readout offers Cancel: a `cancel` during a deploy is recorded by the server but the flash
runs to completion, so there is nothing to cancel. The readout disappears on the terminal frame. The
tab never blocks: it stages no overlay and no scrim, and the group auto-expands when its job starts so
a collapsed section cannot hide the readout. The `firmware.list` refresh instead shows its own
**in-section indeterminate progress bar** inside the Local firmware section.

**No bar is drawn for a build or a deploy, on purpose.** The `WS /firmware` protocol carries no
percentage, so a determinate fill is impossible, and the indeterminate state has no portable
rendering: once a native `<progress>` is styled, Chromium and WebKit paint nothing at all, while Gecko
paints a full bar that reads as "100 %". `ProgressBarView` therefore renders text only — the ticking
elapsed line, the stage and the message are the progress cue — and the `role="status"` live region
announces the changes. A future percentage from the backend is the prerequisite for a bar; revisit
this decision then, and verify the rendering in all three engines before shipping it.

A deploy's own progress is visible where it belongs: esptool's bar lines are ordinary log lines in the
Deploy log, so the readout stays one short line and the log stays the tool's transcript. Both logs
render through `_renderLogInto`, which updates its `CodeView` with `setCode(text, { follow: true })`:
the view replaces its rendered content on every streamed line, so without `follow` the log would jump
back to its first line and a running deploy would look frozen. `follow` keeps the tail in view while
the reader sits at the end, and holds the offset of a reader who scrolled back to read an earlier line.

A bar update rewrites the line it is on, so the Deploy log shows one advancing bar instead of one line
per flash block. Under `TERM=dumb` esptool terminates every update with `\n` and prefixes it with `\r`,
so the seam cannot collapse the updates itself: it marks a line that starts with a bare `\r` with that
same carriage return (`process_stream.py`), and `reduceOutput` in `firmware-job-state.ts` turns a
marked frame into a rewrite of the log's last line. Only a line that is itself a reprint is rewritten,
so the first bar of a run — and a bar that follows an ordinary message or the other stream — still
adds a line and never overwrites text the tool meant to keep.

The log box scrolls, and both halves of that are load-bearing. `.view-code` is capped at 240 px
(`firmware-build-view.css`) and is `overflow: hidden`, while the text scrolls in
`.view-code__scroll-wrapper`: a cap without a scroller would delete every line past the first
screenful, which is what "a deploy shows only its first fourteen lines" looks like. The wrapper's
`height: 100%` only fills a host that has a height, and these hosts size to their content, so
`code-view.css` gives the wrapper `max-height: inherit` — the cap reaches the scroller and a long
transcript scrolls inside those 240 px. See rule 8 of the
[view reuse rules](view-reuse-rules.md).

Deleting an image goes through a whole-app `ViewManager.showConfirmation` (`destructive: true`, Escape
cancels) — the panel itself owns no dialog and never attaches to `document.body`. The view receives a
required `viewManager` (a structural `FirmwareViewManagerLike` with `showConfirmation` as its only
member).

Per section, the shared view-system pieces are:

| Section | Shared views / controls |
|---|---|
| Target | rich `DropdownControl` (target), `DataTableView` info table |
| Local firmware | `ToolbarView` (icon-only refresh / delete / import / export `ButtonControl`s — import gated on `firmware-compile`, export on a selected row), `DataTableView` image list (firmware version split into base + dimmed pre-release suffix + `latest`/`latestInChannel`/channel/`new`/add-ons/`complete`-or-`partial` glyph badges + compatibility marker, MicroPython, conditional runtime; row select), `DataTableView` details view (all fields + Channel / Version source / Add-ons, each package suffixed with `(<variant>)` when the sidecar recorded one) + packages `DataTableView` (`Package` / `Version` / `Variant`; the variant cell is empty for a pre-v3 sidecar), in-section progress bar, `CodeView` Local firmware log |
| Deploy | pane `ToolbarView` first row (deploy `ButtonControl`, then the wipe `CheckboxControl` wrapped in `.firmware-build-view__wipe` with the hint as its `title`), port row `ToolbarView` (connected-port `DropdownControl` followed by the rescan `ButtonControl`, both in `.firmware-build-view__action` wrappers on a `.firmware-build-view__deploy-port-toolbar` host), `ProgressBarView` (deploy progress), `DataTableView` selected-firmware identity (firmware version + Channel / Version source + MicroPython / runtime / hash), composition warning banner, `CodeView` deploy log |
| Build Firmware | top `ToolbarView` (`ButtonControl` build/cancel with the `deployed_code` → `close` glyph swap + `CheckboxControl` clean build); an existing-firmware status line ("a firmware for exactly this selection already exists" / "a firmware that includes this selection already exists", per `FirmwareSelectionMatch.exact`); `ProgressBarView` (build progress with Cancel); nested `CollapsibleView` sub-sections for Packages (`ToolbarView` icon-only minimal / select all / clear / refresh, `DataTableView` checklist whose name cell carries a variant badge for one implementation or the `(auto)` `DropdownControl` for several, each with the effective variant's description as its tooltip), Installed add-ons (`ToolbarView` icon-only select all / clear / refresh / install / remove, `DataTableView`, inline refusal line, hidden `.zip` picker), Build log (`CodeView`) |

Every firmware toolbar (Build Firmware, Deploy, Packages, Installed add-ons, Local firmware) uses the
same `ButtonControl` treatment — `icon` + `iconOnly` + `style: 'secondary'` — so every
row renders the same 28px bordered icon button and the four toolbars read as one control strip. The
label stays the accessible name through `title` and `aria-label`, so the toolbars stay narrow without
losing a name for screen readers. The Build button swaps its glyph (`deployed_code` ↔ `close`), so the
one state a user must read at a glance survives the missing label. The inventory
`latest`/`new`/add-ons badges and the compatibility marker are glyphs for the same reason; each
carries its own `title`/`aria-label`, and the row `aria-label` names the compatibility status, because
the status word is what the glyph replaced. The marker renders for two states only — `compatible`
(a tick) and `unknown` (a question mark); `incomplete` deliberately renders nothing, so the list
never shows three look-alike glyphs, and its status word survives in the row `aria-label`. The tick
compares what the *active collection* needs against the image contents as `embeddedPackages` *plus*
`addonPackages`, because a v2 sidecar files an add-on there. Only `otherTarget` keeps a text chip —
there the words *are* the message. Because the collection is the yardstick, the view subscribes to its
`node-added` / `node-removed` graph events (`_subscribeToGraphChanges()`) and re-renders the rows plus
the Deploy banner; no other edit can change the needed package set. A collection that needs no package
draws no marker at all. Glyph tones come from the app-wide `brightness(0) saturate(100%) …` filter idiom
(the SVGs ship neutral grey), so a badge colour needs no second icon variant and the panels stay free
of inline styles. The add-ons badge is presentational: a v2 sidecar lists add-ons in `addonPackages`,
so that object is the primary signal — it survives an add-on being uninstalled, which a
runtime-provenance lookup would not. An id in `embeddedPackages` that the runtime still classifies
as an add-on counts too, through `FirmwareInventoryPanelOptions.isAddonPackage`, which reads
`DeviceRuntime.packageProvenance()`; an image without a sidecar never gets the badge.

Badge order is pinned left-to-right: `latest` (newest across channels) → `latestInChannel` (the
other channel's leader) → the channel badge (`release`/`dev`) → `new` → `add-ons included` →
`complete` or `partial` → the compatibility marker. The
version cell splits a pre-release version at the first `-` into the base
(`.firmware-inventory__name`) and a dimmed suffix span (`.firmware-inventory__version-suffix`); the
full string stays in the row `title`/`aria-label`. Coverage is one mutually exclusive answer, drawn
as a moon-phase pair by `firmwarePackageCoverage()` (`firmware/firmware-inventory.ts`): the filled
circle (`complete`) means the image embeds every package the target can embed, the half circle
(`partial`) means it omits at least one. It compares the frozen contents — `embeddedPackages` for
built-ins plus `addonPackages` for add-ons, because an embedded add-on is extra content and never a
gap — against the target's *built-in* catalog,
`FirmwareInventoryPanelOptions.availablePackageIds()` (fed by
`FirmwarePackagesPanel.availablePackageIds()`, which lists built-ins only: the add-ons badge already
reports add-ons). `selection.packageIds` is not consulted, because it records the *request* and
staging may drop ids from it. An empty catalog (unknown target or runtime) or a sidecar without
package data shows neither badge rather than a guess. The runtime column is hidden when every shown
image shares one
runtime (the list is already filtered to a single board + runtime, so the column is normally
redundant). The deploy section renders a
composition banner that answers "does the newest image for this board/runtime supply what my
collection needs?" — it reports the missing ids (`firmwareBuild.inventory.missingPackages`) and never
blocks the deploy button. Both the banner and the rows read `_collectionContext()`; only the Build
Firmware line reads `_selectionContext()`. The complementary question — "does a firmware for this
exact selection already exist?" — is answered in the Build Firmware group by
`findFirmwareSelectionMatch()` (`firmware/firmware-inventory.ts`): the image whose manifest embeds
every ticked id (`embeddedPackages` for built-ins, `addonPackages` for add-ons), preferring an exact
package-set match and then `isLatest`. That line stays hidden until a `firmware.list` result has
arrived (`_inventoryLoaded`), so an unread or failed inventory never claims "no firmware exists".

The inventory list scrolls horizontally: `.firmware-inventory__list` — the immediate host of the
`DataTableView` — sets `overflow-x: auto`, because every ancestor (`.firmware-build-view__content`
and the `CollapsibleView` content box) clips overflow. With `table-layout: auto` the table grows to
its content, so the grown columns scroll inside the host instead of being clipped by the section box.

The stylesheet is registered in `styles/themes.json`, uses `--mo-*` tokens only, and never styles a
shared component class outside the `.firmware-build-view` scope. The conformance suite
(`tests/views/firmware-build/conformance.test.js`) keeps full `firmware-build-view__*` class parity
between the source and the stylesheet.

The view is registered in `ViewFactory` as `FirmwareBuildView`; `deserialize()` rebuilds it from
`deviceConnection`, `runtimeCollection`, `collectionManager`, and `viewManager` (all four required and
named in the thrown error when missing) plus the optional `firmwareCapabilities` store, so a
saved-layout restore no longer degrades to an empty `ViewBase`.

Three small public API additions support the composition: the rich `DropdownControl` gained
`setDisabled()` and a `disabled` option (a disabled control cannot open, and closes an open menu),
plus `DropdownOption.description` (per-option row tooltip) and `DropdownControlOptions.description`
(trigger tooltip); `ButtonControl` gained `setLabel()` for the Build ↔ Cancel relabel, and
`ButtonControl.setIcon()` swaps (or removes, with `null`) the glyph of a rendered button so the Build
button can trade `deployed_code` for `close` without re-rendering.

## Add-on install, replace, and remove

The Installed add-ons sub-section is the one place the tab mutates the addons folder, and it does so
through the two `WS /firmware` frames `addon.install` / `addon.uninstall` — never through a second
HTTP route and never by touching files itself.

- **Install** opens the server-side `FilePickerDialogView` in file mode (`extensions: ['.zip']`);
  the *Install from URL…* sibling opens `ViewManager.showFormDialog`. Neither reads a byte in the
  browser — the chosen server path or URL is sent in one `addon.install` frame and resolved by the
  server under the archive-source policy.
- **Replace** is the same two-step the firmware import uses: the server answers
  `addon-already-installed`, the view asks through `ViewManager.showConfirmation`
  (`firmwareBuild.addons.installConfirm*`, destructive), and only a confirm re-sends with
  `force: true`.
- **Remove** acts on the ticked rows (`FirmwarePackagesPanel.selectedAddonIds()`, sorted, add-ons
  only), asks through the same `ViewManager.showConfirmation` (`removeConfirm*`), and sends exactly
  one `addon.uninstall` frame with those ids.
- **Reporting.** Both jobs belong to the `build` group (`_groupKeyForJob()` falls through to
  `'build'`), so their streamed output, warnings, the refusal/`disconnected` notices, and the
  `installSummary` / `removeSummary` `info:` lines all land in the Build Firmware log, next to the
  buttons that started them.
- **Refresh.** A succeeded result runs one sequence: `firmwareCapabilities.refresh({ force: true })`
  (the store must not answer `node-package-addons` from its TTL cache, because that feature flips the
  moment the first add-on exists), then `runtimeCollection.load()` (the served
  `/device/node_pkgs/index.json` and the runtime manifest are synthesized per request), then
  `_renderState()`, which re-renders the panels and re-applies control gating. A failed job only
  writes its log lines and never refreshes.
- **Gating.** Install (path) is gated on `local-file-access`; the URL sibling and Remove are gated
  only on `isBusy()` plus the selection. Both are re-gated by
  `FirmwarePackagesPanel.updateAddonsButtons()`, so the *section* can bootstrap the first add-on
  while the buttons still follow the job state.

## Import, export, and the offline explainer

- **Import** opens the picker in file mode (`extensions: ['.firmware.zip', '.bin']`) or the *from
  URL…* dialog; the picked name is routed by `_routeImportSource`, the single routing decision in
  the view. `isBinaryFirmwareSource(name)` (query/fragment stripped, case-insensitive `.bin` suffix)
  sends `firmware.import-binary {path|url, targetId}` and every other name keeps the existing
  `firmware.import {path | url}`. The platform (`targetId`) is asked for through the existing
  `ViewManager.showFormDialog` dropdown variant (cross-links: [view-manager.md](view-manager.md) and
  [device-deployment-view-architecture.md](device-deployment-view-architecture.md)); it selects how
  the image is flashed (chip, flash offset) and is provenance only — the imported image carries no
  runtime. The overwrite re-send replays the *same* frame kind through `_pendingImport.kind`
  (`package` | `binary`), which never reaches the wire. No new component is added; see
  [view-reuse-rules.md](view-reuse-rules.md).
- **Binary import ends with a hint, not an install.** A succeeded binary import appends exactly one
  `firmwareBuild.inventory.importedHint` line to the inventory log; there is no auto-flash,
  auto-deploy, or auto-install — the runtime is installed afterwards from the Device tab.
- **Export** opens the picker in folder-only mode; the sent frame is
  `firmware.export {firmwarePath, destinationDir}` and `firmware-export-exists` re-sends with
  `force: true` after `showConfirmation`. The Export button is enabled only while
  `local-file-access` is present, so there is no typed-path fallback.
- **Offline.** When the capability snapshot is not `ready` (or a re-probe is in flight),
  `_renderState()` hides `firmware-build-view__content` and shows `firmware-build-view__offline`: one
  `CollapsibleView` (an ordinary `ContentView` body, outside the `SplitView`) titled
  `firmwareBuild.help.title`, holding the offline `MarkdownView` (`firmwareBuild.offline.body`) plus
  the `_buildDiagnosticLines()` rows. It reuses the Help title because it is the same reference
  material, and entering the offline mode **expands** it: the body is the recovery text (what the tab
  needs, what the server adds, how to start it), so an outage answers the question the empty tab
  raises instead of hiding it behind another click. The section is built folded and hidden and only
  expanded on entering the mode, so a re-render during an ongoing outage does not undo a collapse the
  user just made. The `MarkdownView` gets its own host element because it
  mounts by replacing its host's children (`ViewBase.mountContent` → `replaceChildren`), which would
  otherwise wipe the diagnostic rows on every locale change. `_renderPanels()` and
  `_ensureBoardCatalog()` early-return, so an offline tab issues no board-catalog probe. While
  `probing`, the explainer stays hidden — a startup probe never flashes an outage.

## Gating

`_setControlsEnabled()` plus `_registerControl(control, gate)` is the single path: every shared control
is registered and disabled through its `setDisabled()`, never by a direct `.disabled` write (the one
exception is the package-table checkbox, a raw input handled by a single delegated `change` listener).
`firmware-compile` / `firmware-deploy` / `local-package-scan` reach the view through the advertised
features, not through a direct config read.

### Buildable targets only in the chooser

The Target dropdown lists the targets the server can build, not every target the runtime catalog
offers (`_selectableTargets()`). A target is listed when `DeviceRuntime.getCompileTarget()` resolves
a concrete board for it; a wildcard mapping rule (`compile.board == "*"`) is skipped when that map is
built, so `generic_micropython` and `custom` — both wildcards — are never offered. They are not a
disabled state but an absent one: the server answers `target-unknown` for any compile or deploy
request that names them, so an entry would only stage a guaranteed failure. The board of the chosen
target is still resolved server-side from `targetId`; nothing here sends a board.

The initial selection follows the same rule, preferring the active collection's target first: the
view selects the collection target when it is in the list and buildable (which excludes
`generic_micropython` and `custom`), otherwise the runtime's default target, otherwise the first
listed target. An explicit user pick is remembered (`_targetPinnedByUser`) and survives a collection
switch. When *no* target resolves a board (a mapping catalog that failed to load, or a runtime whose
targets are all wildcards) the unfiltered list is returned instead of an empty chooser: the info row
then names `firmwareBuild.target.noMapping` per target and Build/Deploy stay disabled, which tells
the user more than a dropdown with nothing in it.

The Target pane no longer renders a firmware-source chooser: the server only advertises the `local`
source today, and a disabled single-option dropdown was dead UI. The `firmwareSources`
server-capabilities field stays in the contract, unread by the tab.

## Cross-links

- [server-firmware-api.md](../firmware-compile/server-firmware-api.md)
- [firmware-build-websocket-protocol.md](../firmware-compile/firmware-build-websocket-protocol.md)
- [board-catalog-contract.md](../firmware-compile/board-catalog-contract.md)
- [package-selection.md](../firmware-compile/package-selection.md)

## Build flow

Both actions follow the same ordered sequence: **gate → stale-capability refresh → re-check →
connect → send**. The gate registry refuses an empty selection, a missing compile mapping, and an
already-running job before the socket is touched; a stale snapshot is refreshed by the action that
needs it, and the feature is re-checked because a refresh can flip `enable_compile` /
`enable_deploy`.

A build sends `compile.start` with `{ runtimeId, targetId, packageIds, modulePackagingMode:
'compiled-mpy', cleanBuild }`. The client never sends a board it resolved itself: the server resolves
`targetId` to the build board via the mapping rules. The mapping-file read
(`DeviceRuntime.getCompileTarget`) feeds only the info row and capability gating. While running, the
Build button becomes Cancel; cancel sends `{ type: 'cancel' }` once and sets a local
`cancelRequested` flag, so the button reads "Cancelling…" until the terminal frame arrives — the
server may answer nothing when the job already finished, so cancel never hangs on a promise.

Artifact sources (all with `null` fallbacks): `result.payload.paths.firmwarePublishedArtifact`
falls back to `result.payload.paths.firmwareArtifact` (labelled "not published");
`result.payload.metadata.firmwarePublishStatus` and `firmwareArtifactSizeBytes`;
`result.payload.runtime.version`. On success these are written into the Build log as `info:` lines by
`_appendBuildSummary()`. A build that froze package variants adds exactly **one** more line,
`info: Packages: id@variant, …`, derived from `metadata.packageVariants` (sorted by the server, so the
line is stable); an empty or absent map adds nothing, so a package-less build log is unchanged and a
re-render never duplicates the line. Failures come from two places: an `error` frame (rendered through
`describeFirmwareError`, hint included) and a `result` frame with `status: 'failed'` whose
`payload.errors[]` each carry their own `code`/`hint`; both are written into the log. After a
terminal frame the client closes and the next action reconnects; a `disconnected` phase renders
`firmwareBuild.errors.disconnected` — never a silent retry.

## Deploy flow

Port discovery reads `/api/serial-ports` through the shared `js/serial/serial-ports.ts` helper
(`fetchSerialPorts` + `serialPortOptions`), the same one the Device Connection view uses, so the
deploy chooser offers the *same* ports, *same* filter, and *same* names as the device selector.
The server already drops ports the kernel reports without any identity (the Linux `/dev/ttyS*`
ghosts) and formats each entry's `display` name; the view renders that `display` verbatim, falling
back to the raw `label` then the device path for an older server — it never parses OS identifiers
(see [Supported ports](../device-communication/websocket-serial-bridge.md#supported-ports)). The
chooser is titled `Device` to its left (the `DropdownControl` `label` option) and shows only the
available ports: the first one is selected when nothing is picked, so the trigger never reads a
placeholder. The rescan `ButtonControl` beside it re-reads the endpoint, so a board plugged in
after the tab opened appears without reopening it. A rescan joins one already in flight instead of
starting a second, and reports `portsLoading` while it runs while leaving the options on screen
untouched; a failed read keeps the ports already known and shows `portsUnavailable`, and an empty
answer shows `noPorts`.
The display name is as long as the board's USB descriptor: the
trigger is width-capped by `.firmware-build-view__dropdown--port` (`max-width: 220px`) instead of
letting the label stretch the row, the shared `.dropdown-control__button-label` rule ellipsizes it,
the label's `title` keeps the full name one hover away, and the viewport-capped menu
(`min(420px, calc(100vw - 16px))`) still prints the untruncated option labels.
Neither state disables Deploy. The deploy button and the wipe checkbox share the pane's
first content row — the `ToolbarView` described in [Pane toolbars](#pane-toolbars) — with the button
first and the checkbox following in `.firmware-build-view__wipe` carrying the hint as its `title`.
Keeping the only modifier of the action next to the action, above the port row rather than on a row of
its own, is why the pair leads the pane. `wipeFilesystem` is opt-in
only: the checkbox defaults to unchecked and the key is present only when the user clicks it — never
implicitly or from a stored preference. A sentence rendered by `MarkdownView` above the chooser
(`firmwareBuild.deploy.portFreeNote`) states the port rule: Deploy releases the app's connection and
reconnecting afterwards is one click on the title-bar badge.

A serial port has one writer, so `_onDeployAction()` releases the app's own connection
(`deviceConnection.disconnect()`) **after** the capability gate — a refusal never disconnects a
working device — and **before** `_startGroupJob('deploy')` / `_jobClient.connect()` — a failed release
leaves the Deploy group idle and re-deployable, with `firmwareBuild.deploy.portReleaseFailed` in its
log. A successful release writes `firmwareBuild.deploy.portReleased` into the started group's log,
because `_startGroupJob()` clears the group's evidence lines, and re-renders the port status line. A
connected `deviceConnection` makes the status line read `portBusy`, which now states the behaviour
instead of warning that the flash may fail; the app never reconnects by itself afterwards.

The deploy request is `{ targetId, port, firmwarePath?, wipeFilesystem?, backendId? }`.
`firmwarePath` is included only for a successful build of the same target, otherwise omitted so the
server resolves the newest image. Success renders `result.payload.firmware` (`path`, `sizeBytes`,
`sha256` truncated to 12 chars) and `result.payload` (`port`, `board.id`, `board.chip`) as `info:`
lines in the Deploy log via `_appendDeploySummary()`. The payload has no duration field, so the view
does not invent one. The server `hint` is rendered verbatim — it is written for the user and is
never rewritten by the view.

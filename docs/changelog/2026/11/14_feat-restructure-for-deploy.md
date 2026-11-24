# Changes since version 1.25.0

## New Features
- **Collapsible section headers toggle on click** — clicking anywhere on a `CollapsibleView` header
  (title, padding, or chevron) folds or unfolds the section; clicks that land on a header button are
  left to that button, so the chevron does not toggle twice, and the header stays a pointer-only
  shortcut while the buttons keep the keyboard path and translated `aria-label`s.
- **A section can expand itself and collapse its siblings** — a `CollapsibleView` attached as a
  direct `SplitView` pane renders a solo "+" button whose `splitview:solo-request` message makes the
  host expand that pane and collapse the other direct collapsible panes, which is how the three
  Settings sections now switch between each other with one click.
- **The workspace title bar picks the collection target** — the read-only runtime/target label is
  now a target dropdown next to the runtime name, listing the same
  `CollectionManager.listTargetsForRuntime()` options as the collection settings view and writing
  through `Collection.setTargetId()`, so `Collection.TargetIdChanged.v1` keeps both dropdowns in
  sync.
- **Play and Stop sit in the workspace title bar** — the bar shows Play and Stop icon buttons
  directly right of Deploy whenever the device badge reports `connected`, and hides Deploy, Play and
  Stop while no device is connected. The buttons call the same `DeviceConnection.startMain()` /
  `stopExecution()` as the Device tab and follow its `execution-started` / `execution-stopped`
  events, so both surfaces always show the same execution state.
- **The title bar pulses while a device attempt runs** — a soft, layout-neutral inset glow on the
  workspace bar follows the badge snapshot from `connecting` through `loading` and clears on
  `connected`, `error`, `disconnected` and `disconnecting`. The reusable `ActivityPulse` helper
  (reason-based, so overlapping activities never cancel each other) and
  `WorkspaceView.setActivityPulse()` let any other long-running event drive the same cue, and
  `prefers-reduced-motion` falls back to a static faint ring.
- **Device writes report progress in one standard modal dialog** — collection deploy, sync and
  remove plus runtime install, upgrade, remove and refresh now report into a single
  `DeploymentProgressDialogView` driven by the new `js/app/deployment-progress-controller.ts`, so a
  deploy started from the title bar shows the same two-tier progress as one started from the Device
  tab; the Device tab's hand-rolled inline progress panel and its CSS are gone, and `ModalDialogView`
  gained a `showDismiss` option for dialogs that must be closed programmatically.
- **StackView and MessageView are reusable view-system primitives** — `StackView`
  (`stack-view.ts`) owns vertical/horizontal flex layout, item growth, fixed widths, wrapping,
  native `hidden` state, and optional striped rows; `MessageView` (`message-view.ts`) renders
  tone-aware plain or panel text with `status`/`alert` live-region roles.
- **CollapsibleView can render a static section** — `collapsible: false` pins the content open,
  renders no toggle or solo button, adds `.collapsible-view--static`, and reports
  `isCollapsible: false` so SplitView solo handling ignores it.
- **Device tab runtime settings and log are collapsible panes** — `DeviceConnectionView` now wraps
  its connection toolbar, the device-provided General Runtime Configuration, and the device log in
  `CollapsibleView` panes; the runtime pane takes its title from the definition and uses the
  `CustomRuntimeView` / `CustomViewRenderer` `showHeader: false` option to suppress the duplicate
  inner header while keeping the description and sections.
- **Core digital and DAC outputs accept an Enabled input** — a new first input with a checkbox that
  defaults to on gates only the per-tick pin write, so existing graphs are unchanged and a false
  value suppresses the output without deleting the node.
- **Home Assistant publishers and MQTT writes can be muted** — every state publisher, the MQTT
  write and the MQTT announce node gain an Enabled input; false skips the publish (and the announce
  trigger observation) while entity registration, subscriptions, command handling and outputs keep
  working.
- **Variable and webview store writes accept an Enabled input** — `var-write`, `var-store-save`,
  `web-store-write` and `web-store-save` leave the store untouched while false, and save triggers
  are not observed during the disabled period.
- **LED outputs and the servo accept an Enabled input** — the three LED drivers and the stdmo servo
  stop driver writes/angle commands while false; the driver stays initialized and the servo still
  returns its angle output.

## Refactor
- **Custom runtime views are built from standard components** — `CustomViewRenderer` now composes
  `StackView`, `MessageView`, `ToolbarView`, `SplitView`, and `CollapsibleView` instead of
  hand-rolled renderer DOM; `custom-view-renderer.css` and `custom-runtime-view.css` are deleted,
  visibility uses `StackItem.setHidden()` / native `hidden`, invalid controls use
  `.custom-control.is-invalid`, and `CustomRuntimeView` delegates top-level collapse to a standard
  `CollapsibleView`.
- **SplitView owns the solo layout change** — the pane channel gains `SPLIT_VIEW_EVENTS.soloRequest`
  and `ViewBase.requestSplitViewSolo()`, the host applies it through the new public
  `CollapsibleView.isCollapsible` marker plus `collapse()`/`expand()`, reports
  `{ handled, hosted, hostId, viewId, paneIndex, collapsedViewIds }`, and emits `layoutChange` with
  `source: 'solo'`; listeners are torn down with the rest of the per-pane message target.

## Bug Fixes
- **The Device tab runtime configuration pane keeps its full height** — `CollapsibleView` now caps an
  expanded pane only when its content view declares a finite `maxHeight`; a content minimum alone
  (for example `CustomRuntimeView`'s 72 px) no longer pins the General Runtime Configuration pane to
  `header + 72 px`, so the hosted section `SplitView` and its WiFi/Webserver/MQTT panes get the space
  the outer split allocates.
- **Device commands no longer return empty output over the WebSocket bridge** — `DeviceConnection`
  now reads the raw-REPL response as the byte stream the firmware actually sends (`OK` as two bytes
  without a newline, stdout, `0x04`, stderr, `0x04`, `>`), so a transport that coalesces the ack with
  the output no longer wipes the command result and a split frame no longer truncates it.
- **Device errors and tracebacks are visible again** — stderr is read up to its own `0x04` marker and
  logged, the new `executeCodeDetailed()` returns stdout and stderr separately, and a helper's
  `ERROR: ...` line is preserved instead of being discarded with the frame.
- **Reconnects survive a re-enumerating board** — raw-REPL entry waits for an idle line and for the
  banner including its `>` prompt, retries up to three times, and leaves the friendly REPL on
  disconnect; the bridge takes over a stale client slot, opens the port `exclusive`, and retries the
  open for about a second, which covers the USB re-enumeration that follows a `HUPCL` close.


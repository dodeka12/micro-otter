# Device Connection UI

There is exactly one place to connect a device: the cable badge in the title bar, which opens one
connection dialog. Everything else in the app *reports* what that connection does. This page is the
contract for the badge, the dialog and the shared state behind them.

## The one-surface rule (D1)

M4t retired three competing controls. Before it, the app offered a connection in the Device tab's
toolbar, a "Connect Device" button in the Deploy tab's empty state, and only then the actual
provider/port choice.

| Former surface | Where it was | What it does now |
|---|---|---|
| Provider dropdown, port chooser, Connect/Disconnect | `device-connection-view.ts` toolbar | Gone. The Device tab keeps Play/Stop/Soft reset/Hard reset in a collapsible Connections pane, plus collapsible runtime and device-log panes; the title bar mirrors Play/Stop next to Deploy while connected. |
| "Connect Device" button | `device-deployment-view.ts` empty state | Gone. The Help collapsible (`deployment.helpTitle`) is the sole pane of the deployment split while disconnected and renders `deployment.connectViaTitleBar` through a `MarkdownView` to name the badge. |
| The connection itself | — | The title-bar badge opens [`DeviceConnectionDialogView`](../view-system/device-connection-dialog.md). |

Two surfaces remain, and they never disagree because both read one monitor.

## Title-bar quick actions

Once the monitor reports `connected`, the workspace title bar shows **Play** and **Stop** directly
right of Deploy. With no device connected all three actions are hidden — Deploy follows
`DeviceConnection.isConnected()`, and the two runtime actions follow the badge snapshot — so the bar
offers no device action without a device. The two buttons are icon buttons built by the title bar's
own `_createIconButton()` — the same chrome as undo/redo and Deploy — not an embedded `ToolbarView`.

They are not a second execution surface. `WorkspaceView` calls
`workspace.deviceConnection.startMain()` and `stopExecution()`, the methods the Device tab's toolbar
also calls, reads `isExecutionRunning()` for enablement (Play while idle, Stop while running), and
subscribes to the connection's `execution-started` / `execution-stopped` events. A change triggered
from the Device tab, a deployment, or a custom view therefore repaints the title bar without extra
wiring. Failures surface through the shared error dialog with the same
`deviceConnection.errors.playFailed` / `stopFailed` titles the Device tab uses; the connection already
writes its own message to the console.

### Title-bar activity pulse

While an attempt is in flight the bar pulses softly — a slow inset glow on `.view-workspace`, nothing
that moves or resizes — and settles back the moment the monitor reports anything other than
`connecting` or `loading`. Both states belong to the same attempt: `connecting` opens the port and
`loading` reads device information, so the cue must not blink between them. `error`, `disconnected`
and `disconnecting` clear it, and a bar attached while an attempt is already running paints the pulse
at once.

The pulse is not a second state machine. It is the shared `ActivityPulse` helper
(`js/views/activity-pulse.ts`) driven from the same monitor subscription that paints the badge, under
the single reason `device-connection`. `WorkspaceView.setActivityPulse(reason, active)` is the public
entry point, so a background deploy or any other long event can add its own reason without clearing
this one. The visual is the `mo-activity-pulse` class from
`styles/standard/activity-pulse.css`, which falls back to a static faint ring under
`prefers-reduced-motion: reduce`. The bar deliberately carries no `aria-busy`: the badge already
announces the connection state, and marking the container busy would mute the bar's child
announcements.

## The monitor contract

`js/serial/device-connection-monitor.ts` owns the device state for the badge and the dialog. It is
DOM-free, created once in `main.ts` before the views, injected into `WorkspaceView` and into the
dialog, and started once.

`DeviceConnection` keeps its four `ConnectionState` values. The monitor adds the two the UI needs and
carries the percentage of the `device-info-load` tracker:

| State | Set by | Cleared by |
|---|---|---|
| `disconnected` | construction; `disconnect()` settles here in a `finally`; `statechange: disconnected` | a connect attempt |
| `connecting` | `connect()` before awaiting; `statechange: connecting` | `connected`, `loading`, `error`, `disconnected` |
| `loading` | `device-info-load` `START`/`UPDATE` while `isConnected()` | `COMPLETE` → `connected`; `ERROR` → `error` |
| `connected` | `statechange: connected`; `device-info-load` `COMPLETE` | a new attempt or a disconnect |
| `disconnecting` | `disconnect()` before awaiting | the `finally` on `disconnected` |
| `error` | a rejected `connect()`; `statechange: error`; `device-info-load` `ERROR` | `resetError()` or a new `connect()` |

Two rules keep the derived state honest:

- **`connected` while `loading` is ignored.** The bridge provider re-emits `connected` when its
  WebSocket reconnects mid-load; resetting there would blank the ring the user is watching.
- **`error` latches.** `DeviceConnection` closes with a `disconnected` transition even after a
  failure, so the monitor keeps `error` until `resetError()` runs - which the badge does when its
  dialog opens, and which `connect()` does before a retry.

Cancellation is a third, separate path:

- **A user cancel never latches `error`.** `cancelConnect()` (on the monitor and the connection) and
  a rejected `connect()` carrying `ConnectCancelledError` settle on `disconnected` with `error`
  cleared, so the badge returns to `Connect` instead of `Failed`.
- **`connect()` is single-flight.** A second call while one is in flight joins the running attempt
  instead of publishing a second `connecting` or opening a second transport.
- **`disconnect()` during `connecting` is a cancel.** `DeviceConnection.disconnect()` hands a live
  attempt to `cancelConnect()` so the promise cannot hang.

Progress events from any other `source` are ignored, and so is the whole `device-info-load` family
while `isConnected()` is false: a stale tracker from a failed connect must not paint a ring over a
disconnected device.

Notifications are field-wise deduplicated, so a `disconnected` produced both by the transition and
by the `finally` is delivered once.

The monitor also exposes the connection's **pre-onboarding signal**, which is not part of the
snapshot: `subscribeOnboardingPrompt(listener)` registers on the existing
`device-initialization-status` event and fires (synchronously, once per emission) only when
`detail.onboardingActionable === true`. The signal exists so a progress surface can clear the modal
layer before the connection opens its target-selection form; the snapshot shape is unchanged, so
badge and dialog fixtures never see a `prompt` field. The subscription is independent of
`start()`/`stop()`; `start()` only controls whether the underlying event is observed.

## The badge contract

`WorkspaceView` renders `.workspace-device-badge` immediately before the M4s server badge, so the
offline badge reads to the right of the connect badge. It is **always visible** - it is the only way
to connect - while the server badge only appears during an outage. Its glyph is `cable`; the server
badge's is `cloud_off`, so the two facts the app knows about the outside world stay distinguishable.

| `snapshot.state` | Label | `aria-busy` | Ring |
|---|---|---|---|
| `disconnected` | `workspace.device.connect` (Connect) | `false` | hidden |
| `connecting` | `workspace.device.connecting` (Connecting…) | `true` | hidden |
| `loading` | `workspace.device.loading` (Loading 55 %) | `true` | visible, `stroke-dashoffset = 100 - percent` |
| `connected` | `workspace.device.connected` (Connected) | `false` | hidden |
| `disconnecting` | `workspace.device.disconnecting` (Disconnecting…) | `true` | hidden |
| `error` | `workspace.device.error` (Failed) | `false` | hidden |

`title` and `aria-label` come from the matching `workspace.device.*Title` key; the `error` state
appends the failure message, because the tooltip is the only place that text can appear without a
dialog. The label and the percentage live in separate spans so the bar does not reflow between
`9 %` and `100 %`; the ring is a 12 px inline SVG driven by `pathLength="100"`.

Clicking the badge calls `resetError()` and opens the dialog. While a connect is in flight the
dialog opens in a cancel-only mode (one "Cancel connecting" button) instead of offering a second
`Connect`, so the badge is the cancel surface as well as the entry point. A badge click is ignored
while the dialog is already on the modal layer, because `showModal` would otherwise detach the open
dialog without a `close` event and orphan its `open()` promise.

## The dialog contract

The dialog owns the provider, the port and the connect/disconnect action, and it owns nothing else.
It deliberately reports no progress: it closes *before* it connects, so it cannot say `Loading 55 %`
- the badge does. See [the dialog page](../view-system/device-connection-dialog.md) for the
composition and the `open()` sequencer. The one exception is the cancel-only mode: opened while the
snapshot is `connecting`, it shows a single "Cancel connecting" action and reports no progress.

## The port rule

A serial port has one writer. `Deploy` in the Firmware tab therefore releases the app's own
connection before it sends the flash request, and says so in the Deploy log; afterwards the app does
**not** reconnect on its own. Reconnecting is one click on the title-bar badge. The bridge is the
only writer of the port during a flash - see
[the WebSocket serial bridge](websocket-serial-bridge.md).

## The filtered onboarding surface

When a device's firmware records `target.buildBaseTargetId` (M4x), the app resolves a chosen target
through its derivation chain and offers only targets whose base id matches — the Firmware tab's
Target dropdown (`FirmwareBuildView._selectableTargets()`), the collection settings and workspace
title-bar target dropdowns (both via `CollectionManager.listTargetsForRuntime()`), and the embedded
onboarding dialog (`_promptTargetSelection`). The base id comes from the embedded metadata probe in
`device-connection.ts` and lands in `DeviceState.buildBaseTargetId`. Images built before M4x carry
only `target.allowedWebTargetIds`, which the app expands through the resolver to base ids; an absent
or empty list means "no filter". The host also refuses an incompatible collection target before
upload with `target-not-compatible`, and the device-side onboarding predicate enforces the same
constraint, so a stale client cannot force an incompatible upload.

The workspace title-bar dropdown is a second writer for the same collection field, not a second
source of truth: it calls `Collection.setTargetId()` like the settings dropdown, and
`Collection.TargetIdChanged.v1` (relayed as `Workspace.CollectionChanged.v1` with
`changeType: 'targetId'`) refreshes both surfaces.

## Where it is wired

- `main.ts` creates the monitor and starts it once, after the layout is attached.
- `WorkspaceView` subscribes for the badge and re-renders it on `languagechange`; the same snapshot
  gates the Deploy and Play/Stop quick actions, and the connection's execution events keep Play/Stop
  enabled state in sync.
- `DeviceConnectionDialogView` is opened from the badge only; it takes the monitor as its
  connection and drives `connect()` / `disconnect()` itself. A confirmed connect hands the wait to
  `ConnectingProgressDialogView` (see
  [connecting-progress-dialog.md](../view-system/connecting-progress-dialog.md)), which reports the
  connection and device-information phases until the onboarding prompt, a failure, a cancel or
  completion closes it.

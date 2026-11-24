# Server Connection — Developer Documentation

## What it is

`js/firmware/server-connection.ts` is the app's single answer to *"is the local server reachable?"*.
It is a thin monitor over the already-existing capability client
[`ServerCapabilitiesStore`](../../../src/micro_otter/nodes/html/js/firmware/server-capabilities.ts):
the store decodes `GET /api/server-capabilities`, the monitor schedules the probes and publishes a
three-valued connection state the shell can render.

The monitor adds **no endpoint** and decodes **nothing**. Every field of its snapshot is either
derived from the store's snapshot (`reason`, `detail`) or measured by the monitor itself
(`disconnectedSince`, `checking`). `connected` is exactly `snapshot.state === 'ready'` — there is no
second state machine to drift from the first.

Nothing else in the app probes for reachability. The title-bar badge, the reconnect dialog
(`js/app/server-connection-controller.ts`), and the Firmware tab all read this one snapshot, so the
three surfaces cannot disagree.

## State model

```ts
type ServerConnectionState = 'unknown' | 'connected' | 'disconnected';

interface ServerConnectionSnapshot {
    state: ServerConnectionState;
    reason: CapabilityUnavailableReason | null; // 'unreachable' | 'malformed' | 'not-micro-otter'
    detail: string | null;
    disconnectedSince: number | null; // epoch ms, start of the outage
    checking: boolean;                // a probe is in flight
}
```

| State | Meaning |
|---|---|
| `unknown` | Before the first probe resolves. Never a failure state, so nothing is shown. |
| `connected` | The store's snapshot is `ready`. `reason`, `detail`, and `disconnectedSince` are `null`. |
| `disconnected` | The store's snapshot is `unavailable`; `reason`/`detail` are passed through unchanged so a consumer renders the same explanation the tab uses. |

`disconnectedSince` records the **start** of the outage, not the last failed probe: repeated failures
keep the original timestamp, and only a `ready` snapshot clears it. That is what lets the reconnect
controller start mid-outage (a resumed tab, an injected monitor) and still wait out the correct share
of the grace period.

`subscribe()` compares the five fields, not object identity, and notifies only on a real change, so a
probe that answers the same thing never re-renders the badge. `getSnapshot()` returns a copy, so a
listener cannot mutate the monitor's state.

## Cadence

| Situation | Behaviour |
|---|---|
| Connected | One probe every 15 s (`CONNECTED_POLL_MS`). |
| Disconnected | One probe every 3 s (`DISCONNECTED_POLL_MS`), so a restarted server reappears quickly. |
| `document.hidden` | No timer fires and no probe runs; the pending timer is allowed to expire. |
| `visibilitychange` → visible | Immediate probe, then the cadence resumes from its completion. |
| `window` `online` | Immediate probe. |
| `checkNow()` | Clears the pending timer, probes once, and reschedules from the completion time, so a click cannot stack requests. |

The cadence is always scheduled **from the completion** of a probe, never in parallel with it, so a
slow server cannot accumulate requests. A generation token is bumped by `start()` and `stop()`; an
asynchronous probe re-checks it after its `await` and neither publishes nor reschedules when it no
longer matches. That is why `stop()` is safe even with a probe in flight.

`start()` is idempotent and runs the first probe immediately. `stop()` unsubscribes from the store,
removes the two DOM listeners, and cancels the timer. The monitor never throws: the store maps every
failure onto an `unavailable` reason, and a rejecting `refresh()` is caught and treated as
`unreachable`.


## Who consumes it

`js/app/main.ts` creates exactly one monitor and therefore exactly one store:

```ts
this.serverConnection = new ServerConnectionMonitor({ store: new ServerCapabilitiesStore() });
```

and hands the two halves to their consumers before any of them renders:

| Consumer | Receives | Uses it for |
|---|---|---|
| `WorkspaceView` | the monitor, as `serverConnection` | the title-bar badge |
| `FirmwareBuildView` | `monitor.store`, as `firmwareCapabilities` | the capability snapshot: panes vs. offline Help, control gates, diagnostic lines |
| `startServerConnectionController()` | the monitor, the workspace `ViewManager`, `t`, `dev: IS_DEV_BUILD` | the reconnect dialog |

`startServerConnection()` runs **last** in `initialize()`, after the view tree is attached, so the
first probe, the badge subscription, and the tab's own attach probe share the store's single
in-flight request. One store, three consumers, no second probe anywhere.

## The badge contract

`WorkspaceView` renders one button through its existing `_createIconButton(IconProvider.cloudOff, …)`
helper, tagged `workspace-server-badge`, with a `workspace-server-badge__label` span inside it (the
icon stays visible, the label carries the word). The glyph is `cloud_off` since M4t: the title bar
also carries the device badge, whose glyph is `cable`, to the left of the server badge, so the two
are distinguishable at a glance (see
[the device connection UI](../device-communication/device-connection-ui.md)). The badge then drops
the helper's inline style attribute: those styles include `display: flex`, which outranks the
`.workspace-server-badge[hidden] { display: none }` rule in `styles/standard/workspace-view.css` and
would keep the badge painted — as a bare icon button — while the server answers. Appearance and
visibility come from that class alone, so `[hidden]` is what actually removes the badge from the bar.

| Snapshot | Badge |
|---|---|
| `connected`, `unknown` | Hidden (`[hidden]`), no `data-state`. |
| `disconnected` | `data-state="offline"`, label `workspace.server.offline`, title/`aria-label` `workspace.server.offlineTitle`. |
| probe in flight after a click | `data-state="reconnecting"`, label `workspace.server.reconnecting`, `aria-busy="true"`, disabled so a second click cannot start a second probe. |

Clicking the badge calls `monitor.checkNow()` and repaints from the resulting snapshot. `unknown` is
deliberately hidden: *"we have not probed yet"* is not an outage, so a healthy session looks exactly
as it does without the badge.


## The dialog contract

`startServerConnectionController()` owns the *prompting* policy only. It never probes on its own
except after the user answers, never renders, and never decides the connection state.

- **Grace period.** A `disconnected` snapshot arms a timer for the remaining share of
  `DISCONNECT_GRACE_MS` (15 s) — derived from `disconnectedSince`, so an outage the controller joined
  late is not granted a fresh 15 s. The badge reacts immediately; the modal waits, because most
  outages are a dev-server restart that heals itself.
- **One dialog per outage.** An open dialog, a pending timer, and (in a dev build) the *Continue
  without server* escape each suppress another prompt.
- **The dialog** is the shared `ViewManager.showConfirmation`
  (`js/views/view-manager.ts` → `js/views/confirmation-dialog-view.ts`), never a bespoke overlay:

  ```ts
  {
      title: t('workspace.server.dialogTitle'),
      message: t('workspace.server.dialogMessage'),
      detail: t('workspace.server.dialogDetail'),
      icon: '🔌',
      confirmLabel: t('workspace.server.retry'),
      // dev only:
      cancelLabel: t('workspace.server.continue'), showCancel: true,
      // production instead:
      showCancel: false, disableEscape: true,
  }
  ```

- **Reconnect** forces `monitor.checkNow()`; if the server still does not answer, the timer re-arms
  for the remaining grace instead of looping on the modal. `connected` disarms everything and clears
  the suppression, so the *next* outage can prompt again.
- **Continue without server** exists only in a dev build (`import.meta.env.DEV`). Choosing it
  suppresses prompting until the connection returns. A production dialog cannot be dismissed, so an
  outage cannot be clicked away into a half-working tab; a dialog the view manager closed for another
  reason simply re-arms.

## What it does not do

- No WebSocket policy: the firmware job socket, the device socket, and the terminal keep their own
  lifecycles. The monitor reports HTTP availability only.
- No page reload, no data re-fetch, and no recovery of anything but the capability snapshot. Graphs
  live in the browser and keep working during an outage; reconnecting re-renders the consumers, it
  does not replay requests.
- No persistence: an acknowledged outage is not remembered across a reload.
- No rendering and no DOM beyond the two injected listeners (`document`, `window`).

## Tests

| Suite | Covers |
|---|---|
| `tests/firmware/server-connection.test.js` | state derivation, cadence, hidden-tab pause, generation token, `disconnectedSince`. |
| `tests/app/server-connection-controller.test.js` | grace timer, one-dialog-per-outage, retry re-arm, dev escape, stop semantics. |
| `tests/views/workspace-view-server-badge.test.js` | badge visibility, `data-state`, label, click probe. |

## Related

- [server-firmware-api.md](../firmware-compile/server-firmware-api.md) — the capability payload the
  store decodes and the polling rules stated for the server's point of view.
- [firmware-build-view-architecture.md](../view-system/firmware-build-view-architecture.md) — the tab
  that consumes the same store, including its offline Help section and diagnostic lines.
- [view-reuse-rules.md](../view-system/view-reuse-rules.md) — why the dialog is
  `ViewManager.showConfirmation` and not a new dialog class.

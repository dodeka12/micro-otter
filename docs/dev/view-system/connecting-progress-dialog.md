# Connecting Progress Dialog

`ConnectingProgressDialogView` (`js/views/connecting-progress-dialog-view.ts`) is the one progress
surface for a **connect attempt**: it covers the moment after the user confirms
[`DeviceConnectionDialogView`](device-connection-dialog.md) and before the target-selection form or
the first retry-able error appears.

It exists because the configuration dialog closes before `connect()` runs. Without this surface the
wait is silent: the only feedback is the title-bar badge. The progress dialog is not a second
connection surface — it has no provider, port or Connect/Disconnect controls, and its only action is
the state-dependent footer button.

## Ownership

`DeviceConnectionDialogView.open()` constructs and shows the dialog through
`ViewManager.showModal(progress, { scrim: true })` **before** awaiting `connection.connect(...)`.
The view itself never calls `ViewManager`; it reports the monitor snapshot and closes itself.
`open()` calls `markConnectSettled()` when `connect()` resolves and `close()` when it rejects.

`open()` shows the dialog only for a confirmed `connect`. A disconnect, a dismissed configuration
dialog and the existing cancel-only mode for an in-flight attempt never show it.

## Composition

| Part | Source | Notes |
|------|--------|-------|
| Header | inherited `ModalDialogView`, `IconProvider.cable` | `showDismiss: true`, Escape allowed, no confirm action, `autofocus: false` |
| Status | `.connecting-progress-dialog__status` | `role="status"`, `aria-live="polite"`; `deviceConnection.connecting`, else the tracker message, else `deviceConnection.loadingDeviceInfo` |
| Progress | `ProgressDetailView` inside `.connecting-progress-dialog__detail` | Overall tier only; the host is `hidden` until `snapshot.progress` is finite, because the hosted component always paints a determinate bar |
| Footer | one `ModalDialogView` footer button | `Cancel connecting` (primary) while `connecting`; `Close` (ghost) otherwise |
| Dismiss | header × and Escape | Same rules as the footer button |

The dialog reuses the determinate bar from [`ProgressDetailView`](progress-detail-view.md). Its
stylesheet (`styles/standard/connecting-progress-dialog.css`) owns only the status line and the
detail slot, hides the unused second tier and divider, and adds no second background, border,
radius, padding, `position`, `inset` or `z-index`. Modal chrome comes from `modal-dialog.css`.

## Close rules

The rules are ordered so the modal layer is free exactly when the next surface needs it:

1. **Pre-onboarding prompt** — the monitor's `subscribeOnboardingPrompt()` signal fires synchronously
   before `requestSelection()` → `showFormDialog()`. The dialog closes first, so the target form owns
   the layer without a fight.
2. **Snapshot `error`** — closes immediately; `open()` then reports the failure with `showError`.
3. **Snapshot `disconnected`** — closes immediately; this is also the user-cancel path after
   `cancelConnect()`.
4. **Snapshot `connected` after `loading` was observed** — closes when device information finished.
   A bare `connected` before the device-info tracker starts does not close the dialog.
5. **`markConnectSettled()`** — closes a happy path that resolved without ever entering `loading`.

A dialog constructed mid-attempt takes its initial `loading` as the observation in rule 4, so a
replacement surface can still close on the next `connected`.

`close()` is idempotent: every path emits exactly one `close` event, and the dialog detaches both the
snapshot and the pre-onboarding subscriptions. `open()` also closes it before `showError` and before
returning on a cancelled connect.

## Cancel versus Close

While the snapshot state is `connecting`, the footer button, the header × and Escape all cancel:
they call `connection.cancelConnect()` once and close. While `loading`, the same controls only close
the progress surface — device information is already being read, and there is no cancel to offer.

## Repaint and lifecycle

The view stores the last snapshot and replays it in `render()`, so a re-attached dialog shows the
live percentage rather than an empty shell. The hosted `ProgressDetailView` stores the bar state.
`beforeDetach()` drops cached elements and detaches the child before `super.beforeDetach()`;
subscriptions are detached on `close()` and on detach through the base cleanup list.

`serialize()` adds `type: 'ConnectingProgressDialogView'` to the inherited dialog state.
`deserialize()` requires `context.deviceConnection` and throws a message naming that service when it
is missing.

## Registration and locale keys

The view is registered in `view-factory.ts` as `ConnectingProgressDialogView`. The stylesheet is
listed as `connecting-progress-dialog` in `styles/themes.json` and `DEFAULT_THEME_STYLES`
(`js/views/view-theme-registry.ts`).

Locale keys: `deviceConnection.progressTitle` (dialog title), `deviceConnection.connecting`,
`deviceConnection.cancelConnecting`, `deviceConnection.loadingDeviceInfo`, and the shared
`dialog.close`.

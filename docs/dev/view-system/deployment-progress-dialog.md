# Deployment Progress Dialog

`DeploymentProgressDialogView` (`js/views/deployment-progress-dialog-view.ts`) is the one progress
surface for device **write** operations: collection deploy, sync and remove, and runtime install,
upgrade, remove and refresh.

It replaces the hand-rolled `deployment-progress-panel` that used to live inside the Device tab.
That panel was absolutely positioned inside its own tab, so a deploy started from the title-bar
**Deploy** button showed no progress at all unless the Device tab happened to be visible. The
dialog is trigger-independent: it is driven by the operation trackers' own `ProgressEventBus`
events, so the title bar, the Device tab and any future trigger get the same surface with no
per-trigger code.

The lifecycle owner is `js/app/deployment-progress-controller.ts`; see
[progress-event-system.md](../core/progress-event-system.md#device-write-operations-the-modal-progress-dialog)
for the event routing.

## Ownership

**The dialog never calls `ViewManager`.** It has no `show()`/`hide()` and knows nothing about the
modal layer. The controller creates it, feeds it, shows it with `ViewManager.showModal()` and
closes it. This keeps the view unit-testable with `attachTo()` alone (a jsdom container is enough)
and keeps the eviction rules in one place.

## Composition

| Part | Source | Notes |
|------|--------|-------|
| Header | `ModalDialogView` | `IconProvider.deployCollection` by default, controller-supplied title |
| Phase line | `__phase` | `role="status"`, `aria-live="polite"`, e.g. *Syncing collection: Demo* |
| Detail tiers | `ProgressDetailView` inside `__detail` | Overall + detail bars, labels, messages and divider; see [progress-detail-view.md](progress-detail-view.md) |
| Footer | `__footer` | hidden, no buttons — `ModalDialogView` expects a footer, the dialog has no action |

The dialog constructs the hosted component with the translated labels
`deployment.progressOverall` / `deployment.progressCurrentFile` and the idle file line
`deployment.progressFileIdle`, then delegates `setOverall()` / `setFile()` to it. The dialog keeps
only the phase line's own state (`#phase`, `#phaseState`); both tier states live in the child.

Both bars carry `role="progressbar"`, `aria-label` (the tier label), `aria-valuemin="0"`,
`aria-valuemax="100"`, `aria-valuenow` (the percentage) and `aria-valuetext` (the tier message), and
their width is set inline from the same numbers by `ProgressDetailView`.

The dialog is constructed with `showDismiss: false` and `disableEscape: true` (see the
[`showDismiss` option](view-manager.md#low-level-dialog-handling)):

- **No `×`:** the dialog is closable only by its owner; a user-closed dialog would hide the progress
  of an operation that is still writing to the device.
- **No Escape:** same reason.
- **No Cancel:** neither `CollectionDeployment` nor `RuntimeDeployment` exposes cancellation, and a
  cancelled write has no defined device state. The dialog reports; it does not allow a decision.
- `autofocus: false`: the dialog has no focusable element, so there is nothing to focus and nothing
  to trap.

## Setter contract

| Method | Effect |
|--------|--------|
| `setPhase(message)` | Phase line text; clears a previous `is-error` highlight |
| `setOverall(progress, message)` | Delegates to `ProgressDetailView.setOverall()`: overall bar width, `aria-valuenow`, `aria-valuetext` and message line |
| `setFile(progress, message)` | Delegates to `ProgressDetailView.setDetail()`: same for the file tier, independent of the overall tier |
| `markComplete(message)` | Phase and both messages, both bars at `100`, `is-complete` on the root |
| `markError(message)` | Phase and both messages, `is-error` on root and phase line; **bar widths are kept** via `setMessages()` |

`progress` is clamped to `0…100` by the hosted component; a non-finite value (`NaN`, `Infinity`) is
ignored and the previous width kept, while the message still updates — a coarse tracker that sends a
bad percentage must not make the bar jump or vanish. The [component doc](progress-detail-view.md)
owns that contract.

`markError` deliberately does not reset the bars: the operation failed *at that point*, and a
zero-width bar would read as "nothing was written".

The file line starts at `deployment.progressFileIdle` ("No active file transfer") because the
controller sets it when the operation starts and every `file-send-*` event replaces it.

## Repaint from state

The dialog stores the phase line (`#phase`, `#phaseState`); the hosted `ProgressDetailView` stores
both labels and both tier states. The dialog's own rendered elements are cached in `#elements`,
which is `null` while the view is detached.

- `render()` calls `super.render(container)` — which rebuilds the body through `_buildBody()` and
  repopulates `#elements` — attaches `#detailView` to the `__detail` host, and then `#sync()`s the
  phase. The child repaints its own state during its `render()`. The controller relies on this: it
  re-shows the **same instance** after a foreign dialog evicted it, instead of building a new one.
- `beforeDetach()` drops `#elements` and detaches the child before `super.beforeDetach()`, so a
  setter that fires between detach and re-attach cannot write into detached DOM. The child keeps its
  state and replays it on the next attach.
- `#sync()` is a no-op while `#elements` is `null`; the phase state is still updated, and the child's
  setters still store.

`serialize()` adds `phase`, `phaseState`, `overall` and `file` to the base dialog state, reading the
tiers from the child's getters, and `deserialize()` restores all four through the child's setters.
The serialized shape is unchanged, so saved layouts stay compatible.

## Why a hosted `ProgressDetailView`

`ProgressBarView` (`progress-bar-view.ts`) is deliberately text-only: its JSDoc explains that a
percentage bar would be invisible or lying for the indeterminate `WS /firmware` protocol. These
device writes *do* report 0–100 %, so the dialog needs determinate bars — and two of them (overall
plus current file), each with a label and a message. That pair is generic content, so it lives in
`ProgressDetailView` rather than in this dialog.

The visual is **moved**, not redesigned: the tier, label, text, wrapper and bar rules come from the
removed `.progress-bar-wrapper` / `.progress-bar` / `.progress-*` block of
`styles/standard/device-deployment-view.css`, renamed under `.progress-detail-view` in
`styles/standard/progress-detail-view.css`. The dialog's body adds **no** second background, border,
radius or padding: the modal surface, scrim, border and focus behaviour belong to
`modal-dialog.css`, and the old nested `width: min(520px, 100%)` + `padding: 10px 12px` (without
`box-sizing`) was exactly the overflow this composition removes. The dialog stylesheet therefore
declares only the phase line, the `__detail` slot and the hidden footer — no `position`, `inset` or
`z-index` (`tests/views/deployment-progress-dialog-view.test.js` pins that).

Both stylesheets are registered: `progress-detail-view` and `deployment-progress-dialog` in
`styles/themes.json` and in `DEFAULT_THEME_STYLES` (`js/views/view-theme-registry.ts`). The classes
are registered with `ViewFactory` as `ProgressDetailView` and `DeploymentProgressDialogView`.

Locale keys used (all pre-existing; this feature adds none): `deployment.progressOverall`,
`deployment.progressCurrentFile`, `deployment.progressFileIdle`. The title is passed in by the
controller, already translated.


# Device Connection Dialog

`js/views/device-connection-dialog-view.ts` — one `ModalDialogView` subclass that chooses the
provider and the port and starts or ends the connection. It is the **only** provider dropdown, port
chooser and `Connect` / `Disconnect` action in the app; the title-bar cable badge is its only entry
point (see the [device connection UI](../device-communication/device-connection-ui.md)).

It is modelled on [FilePickerDialogView](file-picker-dialog.md): a `ModalDialogView` subclass, its
own registered stylesheet, shared controls inside, and a `ViewFactory` entry.

## Composition

| Row | Component | Notes |
|---|---|---|
| Header | inherited `ModalDialogView` header, `IconProvider.cable` | Rendered as an `<img>` through `IconProvider.isImageSource()`, like every other registered icon: the provider answers an inlined `data:` URI, so writing it as text would print the base64 document. |
| Provider | `DropdownControl` (`controls/dropdown-control.ts`) | Options come from `connection.getProviders()`; the label falls back to the provider key. Changing it calls `connection.setActiveProvider()` and is refused with `deviceConnection.errors.changeWhileConnected` while connected. |
| Device | `DropdownControl` | Only shown for the `websocket` provider: the browser WebSerial provider asks the browser for a port instead of naming a path. Options come from `serialPortOptions(ports)` - the same helper and the same names the Firmware tab's port chooser uses. |
| Status | `role="status"` `aria-live="polite"` line | `Loading devices…` / `No devices found` / `Could not read the device list`. |
| Refresh | `ButtonControl` with `iconOnly: true`, `style: 'secondary'`, `IconProvider.refresh` | The exact variant of the Firmware tab's rescan button. |
| Hint | one `<p class="device-connection-dialog__hint">` | `deviceConnection.hint`: connecting reads the device information, and a first connection may ask which target the device is. |

Everything is styled by `styles/standard/device-connection-dialog.css` (registered as
`device-connection-dialog` in `styles/themes.json`); the view writes no inline styles. The device row
carries `[hidden]` for the WebSerial provider, and the stylesheet re-states `display: none` for it
because the row's `display: flex` would outrank the user agent's rule.

## Port scanning

The port list comes from an injectable `fetchPorts`, defaulting to `fetchSerialPorts()`:

- one scan on attach and one per refresh click;
- a click while a scan is in flight is ignored, not queued;
- a resolved list keeps the current selection when it is still present, else selects the first port;
- a rejection shows `deviceConnection.portsFailed` and keeps the options already on screen;
- an empty list shows `deviceConnection.portsEmpty` and disables the primary action.

## The `open()` sequencer: close before you connect

`DeviceConnectionDialogView.open(viewManager, options)` is the only way the dialog is used, and it is
what makes "close before you connect" a property of the code rather than of a call site:

1. Build the dialog and subscribe to its `close` event.
2. `viewManager.showModal(dialog, { scrim: true })` — which calls `clearModal()` **synchronously**,
   so the modal layer is free the moment the call returns.
3. Await the user's answer (`getResult()`, or `null` when cancelled).
4. `connection.resetError()`.
5. For a confirmed `connect`, build [`ConnectingProgressDialogView`](connecting-progress-dialog.md)
   and show it with `viewManager.showModal(progress, { scrim: true })` **before** awaiting
   `connection.connect(...)`, so no progress or onboarding signal can be missed. On resolution call
   `progress.markConnectSettled()`; on rejection close the progress dialog before `showError`.
6. For `disconnect()`, run it without a progress dialog.

The ordering matters because `DeviceConnection.connect()` opens the first-connect identification
dialog through `showFormDialog` → `showModal`. If this dialog awaited its own `close` *before*
clearing the layer, the identification dialog and this one would fight for the modal host.

The progress dialog stays through the connection and device-information-loading phases and closes for
the onboarding prompt, an error, a user cancel, or completion. See its
[close rules](connecting-progress-dialog.md#close-rules).

A rejected `connect()` is reported with `ViewManager.showError` (title
`deviceConnection.errors.connectFailed`, message from the error) after the progress dialog has
closed, so the badge - not a stale dialog - shows the resulting `Failed` state.

## `getResult()` contract

Confirming does **not** connect. `_onConfirm()` records:

```ts
{ action: 'connect' | 'disconnect' | 'cancel-connect', providerKey: string, device: string | null }
```

`device` is the selected port for the `websocket` provider and `null` otherwise;
`buildConnectOptions()` turns it into `{ device, baudRate: 115200 }` for the bridge and `{}` for the
browser provider. Cancelling or dismissing the dialog answers `null` and runs nothing.

The primary action is disabled while the provider list is empty and while the `websocket` provider has
no port; `Disconnect` stays available regardless.

## Connecting mode: the one cancellation surface

While the snapshot state is `connecting`, the dialog renders only a `role="status"` line
(`deviceConnection.connecting`) and a footer with a single button labelled
`deviceConnection.cancelConnecting` (the inherited `modal-dialog__btn--primary` variant). It skips the
port scan and the provider/device rows - there is nothing to configure mid-attempt - and the badge
still reports the progress.

Every way out of that dialog means "cancel": the button, the header × and Escape all record

```ts
{ action: 'cancel-connect', providerKey: string, device: null }
```

and `open()` calls `connection.cancelConnect()` (skipping `resetError()`, `connect()` and
`disconnect()`). The dialog also subscribes to the snapshot and closes itself - with no result - when
the attempt settles on its own, so the user is never offered a cancel for an attempt that is already
done. This is the one exception to "closes before it connects": the badge opens it *during* a connect,
and it remains the fallback for a badge click while an attempt is in flight. A connect started through
`open()` reports its progress in [`ConnectingProgressDialogView`](connecting-progress-dialog.md).

## Footer and registration

The action row is the inherited, text-only `ModalDialogView` footer - no glyphs - matching
`ConfirmationDialogView` and `FilePickerDialogView`. The labels come from `deviceConnection.connect` /
`deviceConnection.disconnect` and `dialog.cancel`, chosen from the connection's state when the dialog
is constructed.

The view is registered in `view-factory.ts` as `DeviceConnectionDialogView`. `deserialize()` requires
`context.deviceConnection` and throws a message naming that service when it is missing, because the
dialog cannot build a connection of its own.

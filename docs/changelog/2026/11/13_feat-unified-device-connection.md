# Changes since version 1.25.0

## New Features

- **One place to connect** — the title bar now carries a cable badge that is always visible and is
  the only way to connect a device. It reads `Connect`, `Connecting…`, `Loading 55 %` (with a small
  progress ring), `Connected`, `Disconnecting…` or `Failed`, and clicking it opens the one connection
  dialog, which chooses the provider and the port and offers `Connect` / `Disconnect`. The Device tab
  keeps its console and its Play/Stop/reset controls but no longer offers its own provider or port
  chooser, and the Deploy tab's "no device connected" panel now points at the badge instead of
  connecting behind your back.
- **Deploy frees the serial port for you** — pressing `Deploy` in the Firmware tab releases the app's
  own connection to the port before flashing and says so in the Deploy log, so you no longer have to
  disconnect first. The app does not reconnect on its own afterwards: one click on the title-bar badge
  brings the console back.

## Improvements

- **The server badge has its own glyph** — the title-bar "server unreachable" badge uses `cloud_off`
  and the new device badge uses `cable`, so the two are distinguishable at a glance; the unused
  `link_off` icon is gone.
- **The connection state has one owner** — a DOM-free `DeviceConnectionMonitor`
  (`js/serial/device-connection-monitor.ts`) derives the six badge states from `DeviceConnection`'s
  `statechange` events plus the `device-info-load` progress stream, latches `error` until the dialog
  opens or a retry starts, and is the single source both the badge and the dialog render. See
  `docs/dev/device-communication/device-connection-ui.md`.
- **The dialog closes before it connects** — `DeviceConnectionDialogView.open()` awaits the modal's
  close and only then calls `connect()` / `disconnect()`, so `ViewManager.showModal`'s synchronous
  `clearModal()` leaves the modal layer free for the first-connect identification dialog. The dialog
  reports no progress by design; the badge does. See
  `docs/dev/view-system/device-connection-dialog.md`.
- **The Firmware tab explains the port rule** — a `MarkdownView` sentence above the port chooser states
  that Deploy releases the app's connection, and the busy line now reads as a statement of that
  behaviour instead of a warning.
- **Dialog header icons can be registered icons** — `ModalDialogView` now renders its header icon
  through `IconProvider.isImageSource()`, so a dialog may pass any `IconProvider` value (an inlined
  `data:` URI, a served path or a URL) as well as the emoji glyph the other dialogs use. The connection
  dialog's `cable` icon renders as an image instead of printing its base64 document as text. See
  `docs/workflow/adding-icons.md`.

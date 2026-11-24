# Device view

The Device tab is the runtime side of the app: connection controls, the device log and, on runtimes
that provide one, a device-specific control panel.

## Connect

Connecting happens in one place: the cable badge in the title bar.

1. Click the cable badge.
2. Pick a **Provider**: `Web Serial` (default) or `WebSocket (Bridge)`.
3. For the bridge, pick the serial **Device** path from the list; use the refresh button to rescan.
4. Confirm with **Connect**.

| Provider | What it uses | Notes |
|---|---|---|
| Web Serial | the browser's serial port picker | Chrome or Edge; the browser asks which port to use |
| WebSocket (Bridge) | the local server's serial bridge | the Device list is read from the bridge |

- Connecting reads the device information and may ask once which target the device is.
- The provider cannot be switched while connected; disconnect first.
- The same badge disconnects, and it shows connection progress while an attempt runs.

## Runtime controls

The Connections section holds four buttons.

| Button | Enabled when | What it does |
|---|---|---|
| Play | connected, not running | starts code execution on the device |
| Stop | connected, running | stops code execution |
| Soft Reset | connected | restarts the MicroPython interpreter (the `Ctrl`+`D` reset) |
| Hard Reset | connected | `machine.reset()`; asks for confirmation first |

A hard reset drops the connection: reconnect afterwards. A soft reset keeps it.

## Device Log

The Device Log pane mirrors the device console: transfer progress, connection state, runtime output,
warnings and errors. See [Console and output](console-view.md) for filters, copy, clear and
auto-scroll.

## Custom View

When the connected runtime publishes a view definition, the Device tab grows a section named after
it. Its controls belong to the runtime (for example wireless or board settings) and act on the
connected device directly; the section is absent until such a runtime is connected.

## Related

- [Deploy view](deploy-view.md) — upload the collection before pressing Play.
- [Console and output](console-view.md) — log filters and the transpiler output.

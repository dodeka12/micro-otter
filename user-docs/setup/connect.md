# Connect a device

There is one place to connect: the **cable badge** in the title bar. It opens the **Connect Device**
dialog, which also holds the only **Disconnect** action. Nothing else in the app opens a port.

## Two ways to reach the board

| Provider | What it does | Needs |
|---|---|---|
| **Web Serial** (default) | the browser opens the USB serial port itself | a Chromium-based desktop browser (Chrome, Edge, …) on a secure context — `http://localhost` or `https://`; the published hosted app qualifies |
| **WebSocket (Bridge)** | the app asks the local server to open the port and talks to it over a WebSocket | `micro-otter serve` running on the machine the board is plugged into |

Web Serial is the simplest choice on a desktop with the board plugged in. Use the bridge when the
browser cannot see the port — for example when the app is loaded from another machine or the browser
has no Web Serial support.

The provider cannot be changed while connected: the dropdown snaps back to the current one and the
dialog's status line says *"Cannot change provider while connected. Disconnect first."*

### Web Serial

Pick **Web Serial** and press **Connect**. The browser opens its own port chooser; choose the board's
entry (usually labelled with the USB-serial chip, e.g. `CP2102` or `CH340`) and confirm. No device
dropdown is shown for this provider, because the browser owns port selection, and the chooser appears
on every connect.

The picker is filtered to the common USB-serial vendors: Silicon Labs `CP210x` (0x10c4), WCH
`CH340`/`CH341` (0x1a86), FTDI (0x0403), Prolific (0x067b) and Arduino (0x2341). A board whose bridge
chip reports a different vendor id will not be listed; use the WebSocket bridge for those.

### WebSocket (Bridge)

Pick **WebSocket (Bridge)** and the dialog shows a **Device** dropdown listing the serial paths the
server can reach — `/dev/ttyACM0`, `/dev/ttyUSB0` or `COM3`, depending on the host. **Refresh device
list** rescans. The bridge opens the chosen path at 115200 baud.

| Dropdown state | Meaning |
|---|---|
| *Loading devices...* | the scan is running |
| *No devices found* | nothing the server can open; **Connect** stays disabled |
| *Could not read the device list* | the scan failed; already listed entries stay on screen |

## What happens on Connect

1. The **Connecting Device** dialog appears, with the status *Connecting...*.
2. Once the port is open, the app reads the device information — firmware banner, files, target — and
   the status follows the read, naming the step in progress, for example *Reading MicroPython
   version...*. A progress bar fills under the status and repeats the step text beneath the bar.
3. The dialog closes when the read finishes. The device log records *Connected via Web Serial* or
   *Connected via WebSocket (Bridge)*.

The dialog footer has one button. While the port is opening it reads **Cancel connecting** and aborts
the attempt; once device information is loading it becomes a quieter **Close**, because there is
nothing left to cancel and it just hides the progress surface.

A **first** connection to a board that runs the runtime from the firmware and has no target recorded is
followed by the **Select Device Target** dialog. See [Targets](targets.md) for what to choose there.

## While connected

| Action | Where |
|---|---|
| **Play** / **Stop** | title bar, right of Deploy (only while connected), and the Device view's Connections pane |
| **Soft Reset** (Ctrl+D) | Device view → Connections pane |
| **Hard Reset** | Device view → Connections pane, after a confirmation |
| **Disconnect** | the Connect Device dialog (same badge) |

**Soft Reset** sends Ctrl+D from the controlled REPL. The interpreter restarts and any running program
stops — the port stays open, so press **Play** to run the app again. **Hard Reset** sends
`import machine; machine.reset()`, waits briefly, then disconnects and reports *Reconnect required
after hard reset*; connect again to continue. Both actions log *Device soft reset complete* /
*Device hard reset complete*.

## Troubleshooting

| Symptom | Check |
|---|---|
| no board in the browser's chooser (Web Serial) | use a data cable, not a charge-only one; try another USB port; on Linux make sure your user is in the `dialout` group |
| *No devices found* (bridge) | is the board plugged into the machine running `micro-otter serve`, and is the server still up? |
| *Connection failed: …* with an "access denied" or "busy" message | another program holds the port — close serial monitors, Arduino IDE's serial plotter, or a second browser tab |
| the app loads but the badge does nothing | Web Serial needs a secure context: serve over `http://localhost` or `https://`, not a plain LAN address |
| the board answers but files look wrong | the device may be running different firmware; check the firmware/target pairing in [Targets](targets.md) |

## Related

- [Targets](targets.md) — picking and changing the board target
- [Device view](../app/device-view.md) — Connections pane, runtime pane, device log
- [Deploy view](../app/deploy-view.md) — install runtime, deploy, sync

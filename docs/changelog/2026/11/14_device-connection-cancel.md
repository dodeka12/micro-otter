# Changes since version 1.25.0

## Bug Fixes
- **A device connection can no longer hang forever on the wrong port** — a second `connect()` while
  one is in flight now joins the running attempt instead of opening a second transport, which
  previously overwrote the WebSocket bridge's pending promise and left the first attempt unresolved;
  the cable badge no longer re-opens a full connect dialog while one is already on screen.
- **A connection attempt is now cancellable** — the title-bar badge opens a cancel-only dialog
  while `connecting`, and a `ConnectCancelledError` settles every layer (transport → connection →
  monitor) back to `Disconnected` without latching the badge into `Failed`.
- **Web Serial `port.open()` is bounded** — a driver that never settles now rejects after 15 s
  instead of leaving the badge spinning indefinitely.

## Refactor
- **Single-flight connect attempts** — `WebSocketConnection`, `WebSerialConnection` and
  `DeviceConnection` each keep one in-flight attempt, and `cancelConnect()` releases the transport
  before the late `close`/`ready`/port frames arrive so a cancelled attempt cannot fight a later one.

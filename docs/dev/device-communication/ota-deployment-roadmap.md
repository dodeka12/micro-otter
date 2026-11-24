# OTA / Device-Hosted Deployment Roadmap

Design note for a future, **serverless** way to reach an ESP32-S3 without Web Serial and without the
local WebSocket bridge: the device hosts the endpoint itself, so the browser connects directly to the
device's IP and the app still needs no per-user server.

## Why the local bridge exists today

See [websocket-serial-bridge.md](websocket-serial-bridge.md). The local bridge reintroduces a process
on the user's machine. Replacing it with a device-hosted endpoint removes that requirement.

## Two device-hosted paths

### 1. WebREPL (WebSocket on port 8266)

MicroPython ships `webrepl`, a WebSocket REPL on port 8266 that listens on both STA and AP
interfaces and natively supports **file upload/download**. The repo's generated `boot.py` already
starts it (`import webrepl; webrepl.start()`).

- **Framing caveat**: WebREPL uses its own binary packet framing, not a raw byte stream. The existing
  `DeviceConnection` raw-REPL layer therefore needs a WebREPL framing adapter (a provider that
  translates WebREPL frames to the `data`/`send` byte contract), rather than reusing
  `WebSocketConnection` as-is.

### 2. Custom HTTP endpoint on the device

The device already runs an HTTP server (`otter_runtime/web_server.py` on port 80) with a route
registration seam (`register_extra_routes` in `app.webserver_hooks_generated`). Add:

- `POST /api/deploy` — accepts a file bundle (assets + manifest), writes the files, then resets.
- Any metadata endpoints the app needs (e.g. the current manifest hash).

This bypasses the REPL entirely and is the simplest OTA path; the browser uses `fetch()`.

## Cross-cutting concerns

- **Discovery**: browsers cannot do mDNS. Options: device in AP mode (fixed SSID), or STA mode with
  manual IP entry in the device view.
- **Mixed content / Private Network Access**: an app served over `https://` connecting to
  `http(s)://192.168.x.y` must satisfy Chrome's Private Network Access preflight — the device server
  must return CORS headers for the app origin (and ideally `Access-Control-Allow-Private-Network`).
- **Security**: WebREPL requires a password; a custom endpoint should gate writes (e.g. a shared
  token).

## Reuse note

`WebSocketConnection` is transport-agnostic: it can target `ws://<device-ip>:...` instead of
`ws://localhost:...`. The local bridge is therefore the stepping stone to this serverless path — the
provider seam (`SerialConnectionBase` + `DeviceConnection`) stays the same.

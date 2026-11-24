# WebSocket Serial Bridge

## Overview

The WebSocket serial bridge lets the Micro-Otter web app talk to an ESP32 over a serial port without
the browser's Web Serial API. It exists because:

- **Firefox** does not implement the Web Serial API at all.
- On **Linux**, Chromium's Web Serial enumerates only kernel `tty` devices (via udev and
  `/proc/tty/drivers`), so a userspace "fake USB port" cannot be added to the picker. Devices claimed
  by kernel drivers (e.g. `cdc_acm` for `/dev/ttyACM0`) may additionally be unavailable.

Instead of a USB path, a single local server (`serial_bridge.py`) serves the app's static files **and**
opens the real serial device over a WebSocket on the **same port**. The browser connects with
`WebSocketConnection`, and everything above the connection — the MicroPython raw-REPL protocol, file
transfer, and deployment in `DeviceConnection` — works unchanged, because the bridge is a **dumb byte
pipe**.

## Wire protocol

| Endpoint | Purpose |
|---|---|
| `GET /api/serial-ports` | `200` with `[{"device": "/dev/ttyACM0", "label": "...", "display": "..."}]` (from `detect_serial_ports()` / `serial_ports_payload()` in `micro_otter/cli/state.py` and `micro_otter/tools/serial_bridge.py`). |
| `GET /api/server-capabilities` | `200` with the capability payload from `micro_otter.tools.server_capabilities` (see below). |
| `WS /serial?port=<device>&baud=<int>` | Byte pipe. Default baud `115200`. |
| `WS /firmware` | Firmware job endpoint: compile, deploy, scan, list/delete/import/export, add-on install/uninstall, and the `fs.list` side channel. See [Firmware build WebSocket protocol](../firmware-compile/firmware-build-websocket-protocol.md). |

- WebSocket **binary** frames carry raw serial bytes in both directions.
- Exactly one **text** JSON frame is sent server → client on connect: `{"type":"ready"}` or
  `{"type":"error","message":"..."}`.
- No REPL/raw-REPL framing is imposed; `DeviceConnection` owns the MicroPython protocol.

### `WS /firmware`

`WS /firmware` is a sibling endpoint on the same port and behind the same local-only trust check; it
shares nothing else with `/serial`. It carries JSON frames only (never serial bytes), runs at most
one job per connection (`compile.start`, `deploy.start`, `scan-local`, `firmware.list`,
`firmware.delete`, `firmware.import`, `firmware.export`, `addon.install`, `addon.uninstall`,
`cancel`), answers the read-only `fs.list` side channel on the read loop, streams `status`
and `output` frames, and answers exactly one terminal `result` or `error` frame per job. The frame
table, the stable error codes, and the cancel/timeout semantics live in
[Firmware build WebSocket protocol](../firmware-compile/firmware-build-websocket-protocol.md); the
implementation is `micro_otter.tools.firmware_ws_handler`.

`/serial` is unchanged by this endpoint: the serial byte pipe and its `ready` frame behave exactly as
before.

### Message size ceiling

No frame carries a firmware or add-on archive any more: `addon.install` and `firmware.import` name a
path or URL, so the shared socket keeps the `websockets` library default message size. The archive
caps stay server-side (`addon_archive.MAX_ARCHIVE_BYTES` for add-ons,
`firmware_package.MAX_PACKAGE_BYTES` for firmware packages, plus the path/URL byte cap in
[archive-source-contract.md](../firmware-compile/archive-source-contract.md)), so an oversized file
is refused as `archive-too-large` rather than closed by a transport limit.

## Port ownership and open behaviour

The bridge owns one serial port at a time and makes that ownership survive a reconnect:

- **One live client.** A second client that arrives while a client is still connected receives
  `{"type":"error","message":"serial port already in use"}` and is closed. A slot whose socket has
  already closed or is closing (`_is_stale_connection()`) is **taken over** instead, because the
  previous teardown may still be running when the browser reconnects; before that, a normal
  reconnect could be rejected until the old handler finished.
- **Exclusive open.** `_open_serial()` opens with `exclusive=True`, `rtscts=False`, `dsrdtr=False`.
  Exclusivity makes the OS refuse a second opener, so the bridge cannot silently shadow `mpremote`
  or the Web Serial tab; the flow-control overrides match an ESP32 dev board, which has no RTS/CTS
  wiring.
- **Bounded open retry.** Up to 5 attempts, 200 ms apart, all inside `_open_serial()`. Closing a
  port drops DTR/RTS (`HUPCL`), which makes a native-USB board re-enumerate: for a moment the device
  node is gone and an immediate open fails with `ENOENT`/`EBUSY`. `mpremote --wait` exists for the
  same race. A genuinely busy port still reports its last error after roughly a second.
- **Coalescing contract.** The server writes `reader.read(4096)`, so one WebSocket message can carry
  the ack, the output and all markers of a raw-REPL frame at once. The protocol layer must therefore
  never depend on read boundaries; `DeviceConnection` reads the frame as a byte state machine (see
  [micropython-protocol.md](micropython-protocol.md)).

Diagnosing a failed connect: compare with `mpremote a2 ls` (or `mpremote connect <device> ls`). If
`mpremote` works and the dialog does not, the bridge is the suspect — check the server console for
the takeover note or the reported open error, and confirm no other process holds the port
(`fuser /dev/ttyACM0`).

## Server capabilities

`GET /api/server-capabilities` is the one request a client makes before it offers a firmware action.
`micro_otter.tools.server_capabilities` owns the payload; `serial_bridge.py` only serialises it:

```json
{
  "serverType": "micro-otter",
  "version": "0.4.0",
  "features": ["serial-bridge", "local-package-scan", "firmware-compile"],
  "buildBackends": [{"id": "esp-idf", "available": true, "version": "4.5.2",
                     "reason": "/opt/esp-idf/tools/idf.py", "targets": ["esp32", "esp32s3"]}],
  "flashBackends": [{"id": "esptool", "available": true, "version": "4.7.0",
                     "reason": "/usr/local/bin/esptool", "targets": ["esp32", "esp32s3"]}],
  "firmwareSources": ["local"],
  "releaseIndexUrl": ""
}
```

- Exactly those seven keys; there is intentionally no `schemaVersion`, so clients must ignore unknown
  keys and a later release can add one without breaking an installed client.
- `features` is derived per request: `serial-bridge` and `local-package-scan` are always advertised;
  `firmware-compile` needs `enable_compile` plus an available build backend with at least one target;
  `firmware-deploy` needs `enable_deploy`, an available flash backend with at least one chip, and an
  importable `serial_asyncio`; `node-package-addons` is advertised only while at least one add-on is
  installed in `addons_dir` (see [add-on discovery](#add-on-discovery)).
- Backend entries come from `status()` snapshots only (device-free by contract). An unavailable
  backend stays listed with `available: false` and a human `reason`; a backend whose probe raises is
  skipped and logged rather than failing the request.
- `reason` mirrors the adapter's own status `detail` and falls back to the joined
  `missing_requirements` list, so an available backend may carry an informational note (for `esp-idf`
  and `esptool` that is the resolved executable). `targets` is empty only while the backend is
  unavailable or its target probe failed.
- The payload never gates collection deploys or node-package source uploads.

## Local-only trust

The server answers a local browser only. Before dispatching any request,
`server_trust.ensure_local_request()` checks two headers and returns a `403` envelope when either
fails:

```json
{"error": {"code": "host-not-allowed", "message": "Host 'evil.example' is not allowed.",
           "hint": "Open the editor through the address printed by 'mo serve'; ..."}}
```

- **Allowed `Host`** — `localhost`, `127.0.0.1`, `::1` (any port), plus the address `mo serve` was
  told to bind. A wildcard bind (`0.0.0.0` / `::`) accepts any host, because the operator already
  chose to expose the port. This blocks DNS rebinding.
- **Allowed `Origin`** — a missing/empty header, the loopback origins above, and the Vite dev origins
  `http://localhost:5173` / `http://127.0.0.1:5173`. The opaque `null` origin (sandboxed iframes,
  `file://`) and any foreign origin are rejected, which blocks cross-site WebSocket hijacking.
- `/api/server-capabilities` echoes the request's `Origin` in `Access-Control-Allow-Origin` only when
  it passed the check, and error responses carry no CORS header. Static assets and `/api/version`
  keep the wildcard. `Access-Control-Allow-Credentials` is never sent.
- `--host <addr>` therefore decides both the bind address and the accepted `Host` headers; exposing
  the port on a LAN address still warns while `enable_compile`/`enable_deploy` are on.

The full client-facing contract — including the `/firmware` WebSocket frames — is planned for
`docs/dev/firmware-compile/server-firmware-api.md`.

## Add-on discovery

Installed add-on node packages are discovered without touching the shipped device tree. Two requests
are therefore **synthesized in memory** instead of read from disk, by `serial_bridge.py` (the
`mo serve` path) and identically by `serve_nodes.py` (the standalone dev server), so both servers show
the same app:

| Request | Response |
|---------|----------|
| `GET /device/node_pkgs/index.json` | The built-in index followed by one entry per installed add-on (`{"id": "<id>", "manifest": "<id>/manifest.json", "root": "addons"}`). |
| `GET /device/node_pkgs/<addon-id>/…` | The file from `<addons_dir>/<id>/…` when the shipped path does not exist. |
| `GET /device/runtime/<runtime-id>/manifest.json` | The file on disk plus `nodePackages.addons: ["<id>", …]` (sorted, `[]` when nothing is installed). |

- The payloads live in `micro_otter.tools.addon_store` (`merged_index_payload`,
  `addon_asset_path`, `runtime_manifest_addons`, `apply_addons_to_runtime_manifest`), so the two
  servers cannot drift on which requests are synthesized or on the payload shape.
- Both remain **read-only**: no request handler writes to the device tree or the add-ons folder, so
  `git status` stays clean and two add-on sets can be served from one checkout.
- The synthesized responses are produced *after* the local-only trust check and after the
  direct-navigation guard, exactly like the static files they replace, so a foreign `Host`/`Origin` is
  still answered with `403`.
- A missing file under `/device/node_pkgs/<id>/…` still answers `404`: only declared assets of an
  installed add-on resolve, and `addon_asset_path` refuses traversal.
- `nodePackages.addons` is additive: an older client ignores it, and a hosted build with no local
  server never sees the key at all.

## One writer per port

While a flash runs, the bridge is the only writer of the serial port. The Firmware tab's `Deploy`
releases the app's own connection first (see
[the device connection UI](device-connection-ui.md#the-port-rule)), logs
`firmwareBuild.deploy.portReleased`, and only then sends the deploy request; the app does not
reconnect afterwards. The serial monitor in the Device tab reconnects by one click on the title-bar
cable badge.

## Components

- **Server** — `src/micro_otter/tools/serial_bridge.py`: a single asyncio `websockets` server that
  serves static files, `/api/version`, `/api/serial-ports`, and the `/serial` WebSocket on **one
  port**. It opens the serial device with `serial_asyncio`, forwards bytes both ways, and enforces
  **one live client per serial port** (a second concurrent client receives an error frame; a client
  whose socket has already closed no longer holds the slot). The port is released when the client
  disconnects. Static files are served from the repo-root `_dist/webapp`
  (or a `dist/webapp` bundled next to an installed package) when a production build exists,
  otherwise from the `src/micro_otter/nodes` source tree, which only works behind Vite.
- **Client** — `src/micro_otter/nodes/html/js/serial/websocket-connection.ts`:
  `WebSocketConnection extends SerialConnectionBase`, registered as the `websocket` provider in
  `workspace.ts`. It mirrors `WebSerialConnection` but writes/reads WebSocket binary frames. Its URL
  is relative (`/serial?...`), so the browser uses the app's own origin; Vite proxies `/serial` to the
  server during development.
- **CLI** — `micro-otter serve` runs the single unified server; the bind address and port come from
  `micro-otter.toml`, `MICRO_OTTER_HOST`/`MICRO_OTTER_PORT`, or the platform defaults
  (`127.0.0.1:8000`), and `--host`/`--port` override them. A non-loopback host prints a warning while
  `enable_compile`/`enable_deploy` are enabled.

## Supported ports

`/api/serial-ports` lists whatever `detect_serial_ports()` finds in `micro_otter/cli/state.py`:
`serial.tools.list_ports.comports()` is the primary source, so Linux `/dev/ttyUSB*`/`/dev/ttyACM*`,
macOS `/dev/cu.*`, and Windows `COM*` devices are all reported. Labels prefer the
`/dev/serial/by-id` name (it identifies the board) and fall back to the pyserial description. A
POSIX-only glob scan (`/dev/ttyUSB*`, `/dev/ttyACM*`, `/dev/cu.*`) remains as the fallback when
pyserial cannot be imported; the payload shape is unchanged either way.

Each entry also carries a server-formatted `display` name. `format_serial_port_label()`
(`micro_otter/cli/state.py`) splits the raw label on `-`/`_`, drops the leading `usb` marker and
any bare hex token of eight or more characters (the embedded serial number), and annotates the
device path — `(usb, <device>)` for a `/dev/serial/by-id` name, `(<device>)` otherwise — omitting
the annotation when the device already appears in the text (a Windows `USB Serial Port (COM3)`
label would otherwise repeat `COM3`). `label` stays the raw identity; the browser renders
`display` verbatim, so the Device Connection chooser and the Firmware tab's deploy chooser show
identical names without parsing OS identifiers (see `js/serial/serial-ports.ts`).

Only entries pyserial actually identified are reported. Linux exposes phantom 8250 UARTs
(`/dev/ttyS0`…`/dev/ttyS31`) that `comports()` lists with no VID/PID, `hwid="n/a"` and
`description="n/a"`; nothing is attached behind them, so `_has_device_identity()` drops them and a
chooser built from this endpoint offers attached devices only. A port keeps its entry as soon as
pyserial reports *any* identity — a USB VID/PID, a hardware id such as `PNP0501`, or a description —
so a genuine UART and an unfamiliar platform never lose an option.

## Running

```bash
uv run micro-otter serve            # app + API + WebSocket bridge on :8000
uv run micro-otter serve --port 9000
```

Development uses `npm run dev:all`: Vite serves/compiles the TypeScript app on `:5173` and proxies
`/api`, `/device`, and `/serial` to the unified server on `:8000`. For a standalone run, build first
(`npm run build`) and then `uv run micro-otter serve`.

In the app, select the **WebSocket (Bridge)** provider in the device view and set the serial device
path (default `/dev/ttyACM0`).

## Related

- [MicroPython protocol implementation](micropython-protocol.md) — the frame the byte pipe carries
- [WebSerial Architecture](webserial-architecture.md)
- [OTA deployment roadmap](ota-deployment-roadmap.md)

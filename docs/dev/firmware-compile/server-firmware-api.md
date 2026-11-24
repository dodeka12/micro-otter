# Server Firmware API

What a client may ask a running Micro-Otter server about firmware, and what the server will refuse.
The surface is deliberately small: one HTTP capability payload that says what the server *can* do,
one WebSocket endpoint that runs a job, and a local-only trust check in front of both.

The code lives in `src/micro_otter/tools/server_capabilities.py` (payload),
`src/micro_otter/tools/server_trust.py` (trust rules), and
`src/micro_otter/tools/serial_bridge.py` (routing on the single served port).

## Endpoints

| Endpoint | Kind | Purpose |
|----------|------|---------|
| `GET /api/server-capabilities` | HTTP | What this server can build, flash, and scan. Read it before offering a firmware action. |
| `WS /firmware` | WebSocket | One firmware job per connection: `compile.start`, `deploy.start`, `scan-local`, `firmware.list` / `delete` / `import` / `import-binary` / `export`, `addon.install` / `uninstall`, `cancel`, plus the `fs.list` side channel. `firmware.import` and `firmware.import-binary` share the single job kind `import` — a job group may be fed by more than one frame. See [firmware-build-websocket-protocol.md](firmware-build-websocket-protocol.md). |
| `WS /serial` | WebSocket | Serial byte pipe. Unrelated to firmware jobs; see [websocket-serial-bridge.md](../device-communication/websocket-serial-bridge.md). |
| `GET /api/version` | HTTP | The installed `micro_otter` package version — the same string the capability payload reports. |

The capability endpoint answers every request, even when no toolchain is installed: a client needs
`available: false` plus a `reason` to explain a disabled button.

## `GET /api/server-capabilities`

The payload is built per request from backend `status()` snapshots and the resolved `Config`, so an
edited `micro-otter.toml` or a newly installed adapter takes effect without a server restart.
Nothing in the builder builds, flashes, opens a serial port, or mutates state.

### Keys

Exactly the nine keys in `CAPABILITY_KEYS` — no more:

| Key | Type | Meaning |
|-----|------|---------|
| `serverType` | string | Always `"micro-otter"`. Lets a client tell a Micro-Otter server from a proxy. |
| `version` | string | Version of the running `micro_otter` package (`micro_otter.__version__`), e.g. `1.43.0`. |
| `features` | array of string | The feature ids this server advertises, in derivation order (below). |
| `buildBackends` | array of `BackendDescriptor` | One entry per visible build backend. |
| `flashBackends` | array of `BackendDescriptor` | One entry per visible flash backend. |
| `firmwareSources` | array of string | Image sources this server can offer. Currently `["local"]`. |
| `releaseIndexUrl` | string | Empty string until a released-firmware index exists. |
| `webappBuildServedVersion` | string \| null | Version stamped into the served `_dist/webapp` build while it is **stale** against the running package; `null` when the build is current or the source tree is served. See [Build and Deployment → Stale build warning](../guides/build-and-deployment.md#stale-build-warning). |
| `webappBuildSourceVersion` | string \| null | Version of the running `micro_otter` package while the build is stale; `null` otherwise. The key name predates the single version source and stays for compatibility. |

There is **no** `schemaVersion` key. Clients must ignore unknown keys and unknown `features`
entries, so a later iteration can add a key or a feature id without breaking an installed client.

### `BackendDescriptor`

| Field | Type | Meaning |
|-------|------|---------|
| `id` | string | Backend id, e.g. `espidf` or `esptool`. |
| `available` | boolean | Whether the adapter's own `status()` reported itself usable. |
| `version` | string \| null | Adapter-reported version; `null` when unknown. |
| `reason` | string \| null | Adapter prose: why the backend is unavailable, or (for an available backend) the resolved tool path it will use. `null` when the adapter reports neither. |
| `targets` | array of string | Compile targets (build backends) or supported chips (flash backends). Empty when unavailable. |

`targets` is only probed when the backend reported itself available, so an uninstalled toolchain is
never probed beyond what its own `status()` already did. A backend whose probe raises is logged and
omitted from the payload instead of failing the endpoint.

### Feature derivation

`features` is derived in this order, so a client may treat it as a stable list:

1. `serial-bridge` — always advertised (no toolchain needed).
2. `local-package-scan` — always advertised (read-only filesystem work).
3. `firmware-compile` — `enable_compile` is true **and** at least one build backend is available with
   at least one target.
4. `firmware-deploy` — `enable_deploy` is true **and** at least one flash backend is available with at
   least one chip **and** `pyserial-asyncio` is importable.
5. `node-package-addons` — at least one add-on is installed (additive; clients that ignore unknown
   feature ids are unaffected).
6. `local-file-access` — the server is bound to a loopback host (`is_loopback_host`), so it may
   enumerate this machine's filesystem; advertised last, and only then.

`firmware-compile` and `firmware-deploy` gate *only* whether `WS /firmware` accepts a job. They never
gate a collection deploy or a node-package source upload; see
[package-selection.md](package-selection.md#what-this-does-not-mean). `local-file-access` gates the
`fs.list` side channel and `firmware.export` (see [Enumerating local files](#enumerating-local-files)).

## Enumerating local files

When `local-file-access` is advertised, the `WS /firmware` connection also answers an `fs.list`
frame (fields: `requestId`, `path`, `extensions`, `showHidden`) with `fs.list.result`
(`requestId`, `path`, `parent`, `roots`, `entries`) or `fs.list.error` (`requestId`, `code`,
`message`, `hint`). It is the transport behind the server-side file picker.

- **Capability.** `local-file-access` is advertised only while the server is bound to a loopback
  host, because it lets a browser enumerate this machine's filesystem. A refusal answers
  `fs.list.error` / `fs-not-allowed`.
- **Cap.** A directory with more than 2000 matching entries answers `fs-too-many-entries` instead of
  streaming an unbounded list.
- **Symlink rule.** Any symlink is reported as `kind: "symlink"` — never enterable and never
  selectable — so no listing can walk outside what it shows.

**Why a side channel.** The picker must work while a build or deploy holds the connection's job
slot, and a slow listing must never touch job state, so `fs.list` is answered on the read loop
before `_start_job` and is never a job. See
[firmware-build-websocket-protocol.md](firmware-build-websocket-protocol.md#fslist).

## Trust model

## Trust model

The server is loopback-only in intent, and both endpoints sit behind the same check
(`server_trust.ensure_local_request`), which runs before any routing happens.

| Header | Rule |
|--------|------|
| `Host` | Must name a loopback host (`localhost`, `127.0.0.1`, `::1`, `[::1]`; a trailing dot is ignored) or the configured bind host. A wildcard bind (`0.0.0.0`, `::`) allows every host, because the operator already exposed the port. A missing header is allowed so local tools such as `curl` keep working. |
| `Origin` | Must be absent/empty (non-browser clients), a loopback origin, or a Vite dev origin (`http://localhost:5173`, `http://127.0.0.1:5173`). The opaque `null` origin, any non-`http(s)` scheme, and any foreign host are rejected. |

The host check runs first: a request rejected for its `Host` must never look like an allowed-origin
answer. A rejection is an HTTP `403` with this body — and, deliberately, no
`Access-Control-Allow-Origin` header:

```json
{
  "error": {
    "code": "host-not-allowed",
    "message": "Host 'evil.example' is not allowed.",
    "hint": "Open the editor through the address printed by 'mo serve'; ..."
  }
}
```

| `error.code` | When |
|--------------|------|
| `host-not-allowed` | The `Host` header names a host this server may not answer for (DNS-rebinding guard). |
| `origin-not-allowed` | The `Origin` header names an origin that may not script this server (cross-site WebSocket hijacking guard). |

Both codes use the same `{code, message, hint}` object as an `WS /firmware` error frame, so a client
can render one error shape everywhere.

## What this surface does not do

- It does not upload node-package source, and it never will: the collection-deploy fallback for
  `missing` / `override-required` packages is decided and executed by the web app
  (`runtime-deployment.ts`), independently of every key and flag described here. See
  [deployment-system-architecture.md](../deployment/deployment-system-architecture.md).
- It does not authenticate. There is no token, TLS, or multi-user model; loopback plus the header
  checks above is the whole trust story.
- It does not persist a manifest. `scan-local` and `mo node-packages` read the inventory; only the
  CLI's `--sync-local` rewrites `nodePackages.local`.

## Related

- [firmware-build-websocket-protocol.md](firmware-build-websocket-protocol.md) — the `WS /firmware`
  frame contract this payload gates.
- [firmware-deploy-contract.md](firmware-deploy-contract.md) — what a deploy job actually runs.
- [package-selection.md](package-selection.md) — what `packageIds` and the packaging mode mean.
- [websocket-serial-bridge.md](../device-communication/websocket-serial-bridge.md) — the port, the
  static file server, and the shared trust check.
- [docs/tools/firmware-compile-reference.md](../../tools/firmware-compile-reference.md) — the CLI
  equivalent of every job (`mo cr`, `mo dr`, `mo np`).
- Tests: `tests/test_server_capabilities.py`, `tests/test_server_trust.py`,
  `tests/test_firmware_contract_invariants.py`.

## Consuming the capability payload (web app)

The Firmware tab reads this payload through `js/firmware/server-capabilities.ts`
(`ServerCapabilitiesStore` / `probeServerCapabilities`), which normalises it into a typed snapshot
and is the only place the wire shape is decoded. Rules a client must follow:

- **Forward compatibility.** Unknown top-level keys and unknown feature ids are ignored, never
  fatal. There is deliberately no `schemaVersion`; a newer server must not break an installed
  client, so the client keeps unknown feature ids as strings rather than rejecting them.
- **Three `unavailable` reasons.** A probe maps every failure to one of `unreachable` (network /
  timeout / non-`ok`), `malformed` (invalid JSON, missing `serverType`, non-array `features`), or
  `not-micro-otter` (`serverType !== "micro-otter"`). The reason (and the optional `detail`) travels
  unchanged through `ServerConnectionSnapshot`; it is diagnostic state for the shell, not header text
  — the Firmware tab replaces its panes with one offline Help section instead of printing a reason.
- **TTL and refresh-on-action.** A snapshot is fresh for 30 s and the store itself never polls. A user
  action (Build, Deploy) refreshes a stale snapshot before it is used.
- **Polling lives in the monitor, not the store.** The web app polls this endpoint through
  `ServerConnectionMonitor` (`js/firmware/server-connection.ts`): every 15 s while connected, every
  3 s while disconnected, no timer while `document.hidden`, and an immediate probe on
  `visibilitychange`→visible and on `online`; a failed probe *is* the disconnected signal. The
  title-bar badge, the reconnect dialog, and the Firmware tab's offline Help section all read that one
  snapshot — see [server-connection.md](../core/server-connection.md).
- **`enable_compile` and `enable_deploy` gate independently.** `enable_compile = false` removes
  `firmware-compile` while `firmware-deploy` can remain, so the client gates Build and Deploy
  separately. `firmware-compile` is advertised only when a usable build backend advertises at least
  one target, and `firmware-deploy` only when a flash backend is available with serial support. When
  the server is `ready` but either feature is missing, the tab names every unavailable backend and its
  `reason` as a diagnostic line in the Build Firmware log, closing with the `micro-otter doctor` hint.

See [firmware-build-view-architecture.md](../view-system/firmware-build-view-architecture.md) for
the tab that consumes this snapshot.

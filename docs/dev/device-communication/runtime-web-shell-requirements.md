# Runtime Web Shell Requirements

This document defines the required `index.html` shell contract for any device runtime that wants to support DOM-writing node packages (including Web View).

## Why this exists

DOM-oriented node packages render dynamic page content from node graphs, but the runtime `index.html` remains the authoritative base shell for:

- global theme/background
- typography and static branding
- base layout and viewport behavior

To keep runtime UX consistent, package content is mounted into a dedicated body container in `index.html` rather than replacing the full document.

## Scope

Applies to runtime templates under:

- `src/micro_otter/nodes/device/runtime/<runtime-id>/html/index.html`

## Required Shell Contract

A runtime `index.html` that supports DOM-writing packages MUST:

1. Keep a standard HTML document shell (`<!DOCTYPE html>`, `<html>`, `<head>`, `<body>`).
2. Provide a stable mount container in `<body>` with id `otter-dom-root`.
3. Keep shell-owned styles and branding outside the mount container where possible.
4. Allow the mount container to hold dynamically rendered page content.
5. Include fallback content when no web root/page graph is registered.

## Minimum Body Structure

```html
<body>
    <!-- runtime shell content (branding/background wrappers/etc.) -->
    <main id="otter-runtime-shell">
        <section id="otter-dom-root" data-otter-dom-mount="true">
            <p>No package content is currently configured.</p>
        </section>
    </main>
</body>
```

Notes:

- Additional shell wrappers are allowed.
- The mount id must remain stable (`otter-dom-root`).
- Package runtime logic should only replace children inside the mount container.

## Rendering Contract

- Runtime serves `index.html` as root page (`GET /`).
- Package renderer provides body fragment content (not full `<html>/<head>/<body>`).
- Server/runtime injects rendered fragment into `#otter-dom-root`.
- If no package page/content is registered, fallback content remains visible.

## Asset Delivery Contract

The static asset handler (`_resolve_static_asset_response`) delivers generated webview assets
with the following guarantees:

- **gzip is served only when the client advertises it.** The `force_compressed_only` build flag
  never overrides `Accept-Encoding`; it only means no uncompressed fallback was shipped. A
  compressed-only build answers a non-gzip client with `406 Not Acceptable` and a readable body
  instead of gzip bytes labelled as `text/html`.
- **Every static asset carries** `ETag`, `Cache-Control: no-cache` and `Vary: Accept-Encoding`.
  The `ETag` is derived from file size and mtime; `no-cache` (not `max-age`) keeps `index.html`
  revalidating after a redeploy.
- **`If-None-Match` yields `304 Not Modified`** (no body), so an unchanged asset revalidates in one
  round trip and a changed asset answers `200` with a new `ETag`.
- Resolution is lazy and costs one `os.stat` on the common path (two at most when the preferred
  candidate is missing).

## Runtime Integration Hook

To keep the web server independent from package-specific runtimes, package code must integrate through a standardized runtime instance variable:

- Module: `app.web_interface`
- Variable name: `WEB_INTERFACE`
- Ownership: the network-service controller's `WebServerService` adapter creates `WebInterface(...)`
  and assigns it to `WEB_INTERFACE` (see `otter_runtime/webserver_service.py`)
- Package usage: packages read `WEB_INTERFACE` and call only its public methods

Expected public API used by packages:

- `register_post_topic(path, handler, *, return_type=..., headers=...)`
- `set_dom_mount_renderer(renderer)`

Packages should treat `WEB_INTERFACE` as optional at startup (for example during import ordering) and retry registration later when needed.

### Late Server Start (controller-driven)

The controller's `WebServerService` adapter creates `WebInterface(host_ip=..., enable_server=False,
port=...)` when the web server is enabled but no transport is up yet, and starts it later once the
station connects:

- `WebInterface.start_server(server=None) -> bool` builds and starts the server and registers the
  endpoints. It is idempotent: it returns `False` and constructs nothing when `web_server` already
  exists. Start failures keep surfacing through `wait_until_server_ready()` and
  `get_server_start_error()`.
- `WebInterface.set_host_ip(host_ip)` publishes the address clients should dial after a late connect
  and logs `host-ip-updated`.

The late-start path is driven by the controller: `station_supervisor()` reports the late connect
(and link drop) to `otter_main`, which re-runs `controller.sync(network)`; the adapter then reuses
the existing `WebInterface` via `set_host_ip()` and `start_server()`'s idempotency (see
[device-tools-reference.md](./device-tools-reference.md#wifi_bootpy-runtime) and
[network-services.md](./network-services.md)).

## Runtime Diagnostic Endpoints

The generic runtime `WebInterface` exposes JSON endpoints for diagnostics and runtime toggles:

- `GET /api/heartbeat`: returns heartbeat status payload.
- `POST /api/heartbeat`: toggles heartbeat via `enabled` (`true/false`, `1/0`, `on/off`).
- `GET /api/web-logs`: returns web server frequent-log status payload.
- `POST /api/web-logs`: toggles frequent request/response web logs via `enabled`.

`/api/web-logs` controls only high-frequency web server request logs (receive/stream/response lines). Error/forced logs remain enabled for operational visibility.

## Relationship to Option B (AST/IR)

For Option B, generators compile graph data to AST/IR body fragments plus mount metadata. The runtime composes final HTML by combining:

- Shell template (`index.html`)
- Mounted dynamic fragment inside `#otter-dom-root`

## Runtime Author Checklist

When creating a new runtime with web support:

- [ ] Add `html/index.html` with mount id `otter-dom-root`
- [ ] Keep shell/background/base styles in the template
- [ ] Ensure dynamic renderer only updates mount contents
- [ ] Provide fallback text/content in mount element
- [ ] Verify root page still loads if no DOM package nodes are deployed

## Related Docs

- `docs/dev/device-communication/device-folder-structure.md`
- `docs/dev/nodes/transpiler-architecture.md`
- `ldev/todos/2026-03-02_web-view-plan/overview.md`

# Changes since version 1.21.1

## New Features

- **Web-view input controls** — new `web-view-tile`, `web-view-number-input`, `web-view-string-input`, `web-view-slider`, `web-view-checkbox`, and `web-view-select` nodes for building interactive device web pages, backed by a shared `InputControl`/`DualInputControl` runtime that handles user and connector input deterministically.
- **Web-view initial-state sync** — a sync-epoch mechanism pushes the current device value to each input control on connect/reconnect, so the frontend starts with live values instead of stale defaults.
- **Web-view navigation polish** — the web-root page is always the first menu entry, its navigation icon is enlarged, and collections with more than one `web-root` node are rejected.
- **Console log raw filter** — device text that does not match a known tag (e.g. `[otter]`, `[user]`) is routed to a dedicated "Raw" slot so all device output is visible in the web app; the raw filter is off by default.
- **Slider value display** — sliders show their current numeric value next to the input and keep it in sync on refresh and while dragging.
- **Deployment package-version compatibility** — package version warnings, embedded file-availability checks, a deploy confirmation gate for outdated packages, and skipping of up-to-date globally-bundled packages.
- **WiFi configuration status** — the device view surfaces a missing WiFi configuration and reports connection status through i18n keys in the runtime settings.

## Bug Fixes

- **Input-control refresh bindings** — input-control payload keys are now included in the refresh bindings, so their force-published values reach the frontend (previously dropped as unmatched keys).
- **Select option defaults** — generator clones merge `inputDefaults` into `controlValues` so select nodes render the correct option values.
- **Frontend value routing** — input-control frontend values are published through the request normalizer, and the client helpers use `POST_REFRESH_ROUTE`.
- **Missing generator registration** — the tile and number-input generators are registered in the package manifest.
- **Firmware artifact fallback** — deployment falls back to `.py` source when a single `.mpy` artifact fetch fails and skips the mpy profile check for globally-bundled node packages.
- **Webview icons** — node icons moved to the correct package icons folder.
- **Server port re-use** — the server reuses a recently freed port faster.
- **Graph panel shortcuts** — keyboard shortcuts are ignored while the graph panel is hidden.

## Refactor

- **`DualInputControl`** — a shared input-control base class centralizes the deterministic handling of dual (user + connector) input across all web-view nodes.
- **Webview generators** — generator modules and their tests restructured for the input-control node set.

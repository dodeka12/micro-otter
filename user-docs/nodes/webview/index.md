# Web view package

Builds a small web UI on the device: pages, layout rows and columns, live displays, input controls and
a value store that survives a reboot. The browser polls the board for deltas, so the page stays live
without a reload.

## Setup

| Requirement | Detail |
|---|---|
| Webserver | the built-in webserver has to be enabled in the Device tab; the view is served from the device's page shell |
| Network | the package requires `wifi` or `ethernet` |
| Companion package | `vars` is required and deployed with the package |
| A root | exactly one `Web Root` node defines the tree; a second root is a graph error |
| Parenting | every element hangs off a `Parent` input, chained from the root down |
| Persistence | `Persist` on a control stores its value in the reserved `_webcontrol` namespace |
| Polling | the page polls `POST /api/webview/refresh` and gets only what changed |

- The tree is built once in the init phase; the graph loop only refreshes element values, so a page
  renders even when the graph has no loop.
- Put the persistence nodes in a separate **Init** graph: `Web Value Store Load` on startup and
  `Web Value Store Save` on a trigger such as a button press.

## Nodes

### Layout

| Node | What it does |
|---|---|
| [Web Root](web-root.md) | defines the tree root and creates the default root page |
| [Web Page](web-page.md) | adds an explicit page under the root |
| [Row](row.md) | a row with four child slots |
| [Column](column.md) | a column with ten child slots |
| [Tile](web-view-tile.md) | a bordered card container |
| [Title Content](title-content.md) | a centred heading at the chosen level |
| [Content](content.md) | a label/value pair whose value can be bound to a store entry |

### Displays

| Node | What it does |
|---|---|
| [Value Table](value-table.md) | up to five label/value rows, each hidden while its value is empty |
| [Radar Display](radar-display.md) | a partial-disk radar with up to 360 slices |
| [Joystick Display](joystick-display.md) | direction and magnitude of two axes, optionally fed by user input |
| [Line Graph](graph-display.md) | a single-series line plot from a `y` array or an `x`/`y` pair |

### Controls

| Node | What it does |
|---|---|
| [Value Input](web-view-number-input.md) | numeric field; the device drives the value, the browser reports edits |
| [Text Input](web-view-string-input.md) | text field with the same two-way contract |
| [Slider](web-view-slider.md) | horizontal slider with min, max and step |
| [Checkbox](web-view-checkbox.md) | boolean toggle |
| [Select](web-view-select.md) | dropdown with up to eight label/value options |
| [Button](web-view-button.md) | a button that reports one cycle of `true` when pressed |

### Value store

| Node | What it does |
|---|---|
| [Web Value Read](web-store-read.md) | reads an entry of the web control store, with a fallback |
| [Web Value Write](web-store-write.md) | writes an entry of the web control store |
| [Web Value Store Save](web-store-save.md) | writes the store to flash on a rising edge |
| [Web Value Store Load](web-store-load.md) | restores the store from flash on a rising edge |

## Shared concepts

- Two values travel on a control: the node's `Value` input is what the device wants to show, and the
  `Value` output is what the user did. Wire the output only where a user edit has to reach your
  logic; `Changed` says whether this pass carries a new one.
- Every control publishes its current value once at startup and the browser confirms with an initial
  sync, so a page never starts with stale fields.
- `Persist` saves the control's value in `_webcontrol` under a per-node key and restores it on the
  next boot. `Select` stores the option index, not the option value, so reordering options reorders
  the restored value.
- The browser backs off when a poll is slow and gives up on a request after five seconds instead of
  freezing the page, so a busy graph shows as lag rather than as a dead UI.

## Related

- [vars package](../vars/index.md) — the store the `_webcontrol` namespace lives in
- [Device view](../../app/device-view.md) — `Enable Webserver` and its port
- [Graph panel](../../app/graph-panel.md) — the `Init` execution type for the persistence nodes

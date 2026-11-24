# Changes since version 1.23.0

## New Features
- **`persist` on webview input controls** — `web-view-number-input`, `web-view-string-input`,
  `web-view-slider`, `web-view-checkbox` and `web-view-select` get a `persist` checkbox (default
  off). When it is on, the loop reads the control's value from the reserved `_webcontrol` store
  before updating the browser and writes the resolved value back afterwards, so the value survives
  a page reload or a control re-creation. The store key is the scoped node id
  (`<graphId>:<nodeId>`); re-adding a node starts from the configured default.
  - Select persists the selected **index** and resolves it against the current option list, so
    duplicated or changed option values cannot select the wrong entry.
  - `persist` off leaves the generated code byte-identical to before.
- **`web-store-read` / `web-store-write` nodes** — two headless data nodes that read from and write
  to the reserved `_webcontrol` store without typing the reserved namespace. They render no markup;
  they only emit `_store.get('_webcontrol', '<name>', <fallback>)` /
  `_store.set('_webcontrol', '<name>', <value>)`.
- **`web-store-save` / `web-store-load` nodes** (titled "Web Value Store Save" and "Web Value Store
  Load") — two headless data nodes that persist the reserved `_webcontrol` store to
  `var_store/_webcontrol.json` and restore it. Like `var-store-save` / `var-store-load` they run in
  the loop phase and trigger on a rising edge of a bool input, but they hard-code the reserved
  namespace, so a graph never has to name `_webcontrol`. All four `web-store-*` nodes use the palette
  color `#837faf`, halfway between the webview (`#bc8fb9`) and vars (`#4a6fa5`) node colors.
- **Package dependencies (`requiredPackages`)** — a package manifest can now declare other packages
  whose MicroPython assets must ship with it. Expansion is transitive and cycle-safe. The `webview`
  package requires `vars`, so dynamic deployments upload `otter_vars/*` even when the collection
  contains no vars node, and embedded deployments report an outdated bundled `vars`.

## Changes
- **`webview` package version** — bumped to `1.33.0` (new node types, new control, new package
  dependency).

## Notes
- `persist` uses the in-memory collection value store. Without a `web-store-save` node (and a
  matching `web-store-load` on startup, or the generic `var-store-save` / `var-store-load` with
  `name = "_webcontrol"`) it does not survive a device reboot.

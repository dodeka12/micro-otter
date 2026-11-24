# Changes since version 1.25.0

## New Features

- **Per-graph "Enabled" flag** — every graph now carries a persisted `enabled` boolean
  (`NodeGraph.getEnabled()` / `setEnabled()`, `NodeGraph.EnabledChanged.v1`). A disabled graph stays
  in the collection, keeps its nodes and connections and is still part of the deployment payload, but
  it is **excluded from transpilation**: no graph function, no `run()` await, no imports and no
  shared-init contributions. Toggling a graph off is a one-click way to park a working graph without
  deleting it.
- **Toolbar toggle in the graph panel** — the panel toolbar leads with an "Enabled" checkbox
  (`graph.toolbar.enabled.label`). It writes through `graph.setEnabled()` and follows the `enabled`
  event, so it stays in sync with every other surface.
- **Same switch in the graph settings view** — `GraphSettingsView` renders the checkbox above the
  name field (`settings.graph.enabled.label`). Toolbar and settings view never talk to each other;
  both mirror through the graph event, exactly like `executionType` / `interval`.
- **Disabled graphs get a muted canvas** — the canvas host now paints its own background and switches
  to `--mo-graph-canvas-bg-disabled` (neutral gray) through the
  `graph-panel-view__canvas--disabled` modifier, so the state is obvious at a glance. No scrim, no
  filter and no render-loop change: the canvas itself is only ever cleared.
- **"Delete Graph" in the main menu** — the hamburger menu offers *Delete Graph* directly after
  *Delete Collection*. It is disabled while the collection holds a single graph, otherwise it asks for
  confirmation and removes the graph through the data layer.
- **`ToolbarView.addControl(control, { className })`** — new view-level API that hosts a
  self-rendering control in a wrapper element and registers its `destroy()` for `clearControls()`,
  instead of every caller hand-building the host `<div>` for `addElement()`.

## Breaking Changes

- **Graph tabs no longer show a close "x"** — graph tabs are registered with `closable: false`.
  Deleting a graph now goes through the main menu (see above). Any layout or automation that relied
  on the tab close control must call `CollectionManager.removeGraph()` / `CollectionView.removeView()`.
- **Transpiling a collection whose graphs are all disabled fails** with
  `Collection has no enabled graphs to transpile` instead of emitting an empty runtime. The graph-less
  case keeps its old message, `Collection has no graphs to transpile`.

## Refactor

- **Graph removal is a data-layer command** — `CollectionManager.removeGraph(collectionId, graphId,
  options)` looks the collection up, enforces the "a collection always has at least one graph"
  invariant (it inserts a replacement *before* removing the last graph) and mutates the model. The
  view no longer re-implements that bookkeeping: `CollectionView._confirmGraphClose()` is gone and
  `_onGraphCloseRequested()` delegates to the command.
- **Graph naming moved into `Collection`** — `Collection.getUniqueGraphName(baseName)` and
  `Collection.getUniqueGraphId()` own the `"<base> <n>"` / `graph-<n>` rules, so a replacement graph
  can be created without a view. `CollectionView._generateUniqueName()` / `_generateUniqueId()` are
  thin delegates.
- **`CollectionView` re-syncs after a data-first removal** — `Collection.removeGraph()` clamps
  `#activeGraphIdx` and `TabbedView.removeView()` picks a fallback tab without emitting an event, so
  the `graphRemoved` handler now re-publishes the active graph (`_onGraphSelected()`), keeping model
  and visible tab aligned.
- **`normalizeGraphEnabled()` treats everything but literal `false` as enabled** — legacy collections
  without the key load as enabled and keep transpiling exactly as before.

## Documentation

- Developer docs updated: graph contract and `enabled` event
  (`docs/dev/core/data-backbone-architecture.md`), the `dirtyPatch` rule for graph settings and the
  fact that undo/redo does not record the flag
  (`docs/dev/core/collection-version-policy.md`, `docs/dev/core/undo-redo-architecture.md`), the
  transpiler filter and its two failure modes plus the untouched deployment path
  (`docs/dev/nodes/transpiler-architecture.md`), the new toolbar control, the canvas background and
  the `--mo-graph-canvas-bg*` variables
  (`docs/dev/view-system/graph-panel-view-architecture.md`,
  `docs/dev/view-system/standard-theme-styling-guide.md`, `docs/dev/view-system/settings-views-guide.md`),
  and the tab-strip/deletion flow plus `ViewManager.showConfirmation()` usage
  (`docs/dev/view-system/collection-view-architecture.md`, `docs/dev/view-system/view-manager.md`,
  `docs/dev/view-system/view-system-overview.md`, `docs/dev/view-system/tabbed-view-hooks.md`).

## Tests

- New: `tests/proc/transpiler-disabled-graphs.test.js`,
  `tests/data/collection-graph-removal.test.js`,
  `tests/views/collection-view-graph-deletion.test.js`,
  `tests/views/workspace-view-menu.test.js`.
- Extended: `tests/data/graph-execution-settings.test.js`,
  `tests/data/node-graph-event-contract.test.js`, `tests/views/toolbar-view.test.js`,
  `tests/views/graph-panel-toolbar.test.js`, `tests/views/graph-panel-layout.test.js`,
  `tests/views/graph-panel-toolbar-mirroring.test.js`,
  `tests/views/settings/graph-settings-view.test.js`.

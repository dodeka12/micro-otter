# Changes since version 1.26.0

## New Features

- **Graph-tab context menu** — right-click or press `Shift+F10` / the `ContextMenu` key on a graph
  tab to open a menu with **Rename Graph**, the graph's **Enabled** toggle and **Delete Graph**. The
  menu is owned by `CollectionView`; `TabbedView` only emits the opt-in `tab-context-menu`
  (`TabbedView.TabContextMenu.v1`) with the tab id, view, viewport anchor and native event.
- **Rename Graph from the tab menu** — selecting Rename Graph opens the same inline editor as
  double-clicking the tab. Both entry points call `TabbedView.beginTabRename()`; the active tab does
  not change, and the rename is validated against the graph collection for empty/duplicate names.
- **Graph actions leave the hamburger menu** — **Delete Graph** is removed from the main menu; graph
  deletion is available only from the graph-tab context menu. The hamburger keeps its three daily
  leaves (`create-collection`, `upload-to-device`, `delete-collection`) and action groups.
- **Enabled moved out of the graph toolbar** — the graph's enabled flag is now edited from the tab
  menu instead of the panel toolbar checkbox. A disabled graph still paints the muted canvas
  background and remains excluded from transpilation.
- **Generic context-menu plumbing** — `TabbedView({ tabContextMenu: true })` supports mouse and
  keyboard invocation without changing the active tab. Consumers without the option keep the native
  browser context menu.

## Fixes

- **The graph fills the pane after a tab is removed** — `TabbedView.removeView()` compared the
  removed view's `container` against its parent to find the `.tabbed-view__view-container` wrapper,
  but `container` *is* that wrapper. The check never matched, so an empty wrapper stayed in the flex
  content area and shared the width with the surviving graph. The new
  `_detachViewContainer()` helper detaches the view and removes the wrapper it owns; `setViews()`
  uses the same helper, closing the same leak when the whole tab set is replaced.

## Tests

- `tests/views/tabbed-view-container-lifecycle.test.js` covers active/inactive removal,
  `setViews()` replacement and removing the last view.
- `tests/views/tabbed-view-context-menu.test.js` covers the payload, right-click without activation,
  `Shift+F10` anchoring and the opt-out path.
- `tests/views/collection-view-tab-context-menu.test.js` covers the graph entries, inline rename
  (including an inactive tab), the double-click path, enable toggle and delete routing.
- `tests/views/workspace-view-menu.test.js` asserts Delete Graph is no longer a hamburger entry.
- Toolbar and mirroring tests now assert the two-control toolbar and canvas updates from settings and
  the graph's `enabled` event.

## Limitations

- The enable toggle is not undoable and is not routed through `HistoryManager`; it persists with the
  graph like any other graph setting.
- The context menu is currently exposed only by `CollectionView`; other `TabbedView` consumers must
  opt in and provide their own entries.

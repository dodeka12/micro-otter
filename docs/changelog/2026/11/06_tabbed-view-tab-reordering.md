# Changes since version 1.26.0

## New Features

- **Graph tabs can be reordered by dragging** — `TabbedView` gains an opt-in `reorderable` mode with a
  4 px activation threshold, an insertion indicator, `Escape`/`pointercancel`/`blur` cancellation and
  an `Alt+Arrow` keyboard equivalent. `CollectionView` enables it for graph tabs.
- **The order is persisted in the collection** — a drop emits `tab-moved`
  (`TabbedView.TabMoved.v1`), `CollectionManager.moveGraph()` mutates `Collection`, and
  `Collection.GraphMoved.v1` re-syncs every open tab strip. `Collection.toData()` already wrote
  `graphs` in array order, so no schema migration is needed and reload/export keep the new order.
- **Pinned tabs stay put** — `movable: false` marks a tab as a wall: drag, keyboard and `moveView()`
  stop before it, so the graph block stays contiguous and future special tabs can trail it.

## Improvements

- **The active graph never changes on a reorder** — `Collection.moveGraph()` remaps
  `#activeGraphIdx` by identity and emits `activeGraphIdx` only when the number changed.
- **Deleting the active graph no longer selects a pinned tab** — the removal path prefers a graph tab
  and republishes the selection.
- **Payload contract checks now scan TypeScript** — `check-payload-jsdoc` and
  `check-event-payload-emissions` cover `.ts` as well as `.js`; both previously skipped every payload
  class in the TS source tree.

## Limitations

- Reordering is persisted immediately and is **not** recorded by `HistoryManager`, so undo/redo does
  not restore a previous tab order.
- No drag ghost image and no edge auto-scroll in this version.

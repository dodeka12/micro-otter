# TabbedView Tab Reordering

## Overview

`TabbedView` supports opt-in, pointer-based drag-to-reorder for its tabs, plus an
`Alt+Arrow` keyboard equivalent. Reordering is gated twice:

- the container must set `reorderable: true` (default `false`), and
- each tab may be pinned with `movable: false` (default `true`).

A movable tab can only move inside the contiguous block of movable tabs around it, so pinned
"special" tabs act as walls. `CollectionView` opts in by default and persists the resulting graph
order through `Collection`; the collection remains the single source of truth for persisted order.

## Flags

| Flag | Where | Default | Effect |
| --- | --- | --- | --- |
| `reorderable` | `TabbedViewOptions`, `TabbedView.reorderable` | `false` | Gates the drag affordance and `Alt+Arrow`. Does **not** gate `moveView()`. |
| `movable` | `TabbedViewEntry.movable`, `addView(..., movable)` | `true` | Structural pin. An immovable tab cannot be moved and stops other tabs. |
| `movable` | `setViewMovable(id, movable)` | `true` | Changes the pin at runtime and re-renders the tab strip. |

`isViewMovable(id)` is the structural predicate. Unknown ids are treated as movable, and the
method is independent of `reorderable`, so code can always ask whether a move is legal.

## API Reference

```ts
moveView(target: TabbedViewEntry | string | number, toIndex: number): boolean
isViewMovable(id: string): boolean
setViewMovable(id: string, movable?: boolean): void
_clampMovableTargetIndex(fromIndex: number, toIndex: number): number
_getMovableBlock(viewId: string): { start: number; end: number } | null
_computeTabDropGap(viewId: string, clientX: number, clientY: number): number | null
```

- `moveView()` accepts an entry, an id, or a current index. `toIndex` is the **final index in the
  resulting array**, not an insertion gap. Out-of-range integers are clamped. A move that cannot
  cross a wall returns `false`.
- `_clampMovableTargetIndex()` performs the stepwise wall check used by `moveView()` and the drag.
- `_getMovableBlock()` returns the inclusive bounds of the contiguous movable block around a tab.
- `_computeTabDropGap()` converts a viewport point into an insertion gap (`block.start` ..
  `block.end + 1`) in the current DOM order.

`moveView()` is safe to call when `reorderable` is `false`. `CollectionView` relies on this to mirror
external `graphMoved` events even if a subclass disables the drag gesture.

## Movable Block Invariant

```text
[v0 movable] [v1 movable] [v2 PINNED] [v3 movable] [v4 movable]
             \___________/             \___________/
               block A                     block B
```

Tabs move stepwise and stop before a pinned tab:

1. Dragging `v1` to index `4` stops at index `1`; it cannot cross `v2`.
2. Dragging `v3` to index `0` stops at index `3`.
3. Removing the pin later makes the two blocks one again; no bookkeeping is needed because
   movability is keyed by id, not by index.

With two movable blocks, `[v0, v1, PIN, v3, v4]`, dragging `v3` to the far left stays at index `3`
and dragging `v0` to the far right stays at index `1`.

## Event Contract

`moveView()` emits `tab-moved` with `TabbedView.TabMoved.v1`:

| Field | Meaning |
| --- | --- |
| `viewId` | Id of the tab that moved. |
| `fromIndex` | Index in the array before the move. |
| `toIndex` | Final index the tab landed on (after wall clamping). |
| `view` | The moved entry (a real view or placeholder). |

The event is emitted **once per successful move**, after `_renderTabs()` so listeners see the final
DOM order, and only after the move has been applied. Rejected and no-op calls emit nothing.

## Drag Lifecycle

```text
pointerdown -> record intent
  -> 4 px Euclidean threshold (click and double-click still work)
  -> is-dragging on the source tab
  -> insertion gap from the movable block
  -> is-drop-before / is-drop-after indicator
  -> pointerup commits moveView()
```

Cancellation paths:

| Trigger | Result |
| --- | --- |
| `Escape` | `_cancelTabDrag()` clears listeners, state and indicators. |
| `pointercancel` | Same cleanup. |
| `window` `blur` | Same cleanup. |
| `beforeDetach()` | Cleanup runs before `_tabsEl` is cleared. |

The implementation uses pointer events and `window` listeners. It deliberately does **not** call
`setPointerCapture` and does not create a ghost element, so the tab strip never needs a second
coordinate system.

## Keyboard and Accessibility

- `Alt+ArrowLeft` / `Alt+ArrowRight` reorder in a horizontal strip.
- `Alt+ArrowUp` / `Alt+ArrowDown` reorder in a vertical strip.
- Plain arrow keys are intentionally unclaimed; the tab strip has no roving-tabindex model.
- Focus follows the tab through `_focusTabById()` after the re-render.
- Movable tabs in a reorderable view get `aria-roledescription="sortable tab"` and an
  `aria-keyshortcuts` value matching the orientation.
- `Enter` and `Space` keep activating the tab.

## Styling Hooks

| Selector / variable | Purpose |
| --- | --- |
| `.tabbed-view__tab--draggable` | Idle affordance (`cursor: grab`, `touch-action`). |
| `.tabbed-view__tab.is-dragging` | Source tab during a drag. |
| `.tabbed-view__tab.is-drop-before` | Insert before this tab (`::before`). |
| `.tabbed-view__tab.is-drop-after` | Insert after the block end (`::after`). |
| `.tabbed-view--dragging` | Host modifier that disables text selection. |
| `--mo-tab-drop-indicator` | Indicator colour, falling back to `--mo-accent`. |

`touch-action: pan-y` on horizontal draggable tabs and `pan-x` on vertical ones keeps the
perpendicular scroll gesture available. The standard theme also disables transitions for the dragged
tab under `prefers-reduced-motion: reduce`.

## Serialization

`TabbedView.serialize()` adds:

```ts
{
  reorderable: boolean,
  tabMovability: Array<{ id: string, movable: boolean }>,
  // ...existing fields
}
```

- Layouts saved before this feature restore as `reorderable: false` with every tab movable.
- `tabMovability` is pruned to the restored view ids; stale entries cannot resurrect a tab.
- The `movable` flag is **not** written into each child view payload. The parallel array is the only
  persisted location, so child `serialize()` shapes stay unchanged.
- Graph order itself is not part of this payload for `CollectionView`; see below.

## `CollectionView` Integration

`CollectionView` constructs its base with `reorderable: true` (and accepts an explicit `false`).
Its graph tabs are always movable; a subclass can pin a special tab with
`addView(special, index, false, false, false)`.

The persistence path is:

```text
user drag -> TabbedView.moveView() -> tab-moved
          -> CollectionView._onTabMoved()
          -> CollectionManager.moveGraph(collectionId, graphId, toIndex)
          -> Collection.moveGraph(graphId, toIndex)
          -> Collection.GraphMoved.v1 + existing autosave
```

`CollectionView` also listens for `Collection.GraphMoved.v1`. When another view, menu action, or
future command changes graph order, `_onCollectionChange()` calls `moveView()` under the
`_syncingGraphOrder` flag. That flag suppresses the `tab-moved` echo, so the data layer is never
asked to move the same graph twice. `Collection.moveGraph()` is the second line of defence: a no-op
move returns `false` and emits nothing.

The graph block stays contiguous and leading:

- new graphs insert before the first tab with `movable: false`,
- removing the active graph selects the collection's active graph (never a pinned special tab),
- `Collection.#graphs` is authoritative; `CollectionView` never persists a competing tab order.

`Collection.toData()` already writes `graphs` in array order, so reload, export and backup keep the
new order without a schema change. `Collection.moveGraph()` marks the **major** version dirty.

## Limitations / Follow-ups

- Reordering is persisted immediately and is **not** recorded by `HistoryManager`; `Ctrl+Z` does not
  restore a previous order. A future `graph-moved` history operation would carry `fromIndex` and
  `toIndex`.
- No drag ghost image and no edge auto-scroll.
- No roving-tabindex arrow navigation beyond `Alt+Arrow` reordering.
- `setPointerCapture()` is intentionally unused; a pointer that leaves the window may rely on the
  browser's `pointercancel`/`blur` behaviour.

## Test Map

| Test file | Invariant |
| --- | --- |
| `tests/data/collection-graph-reorder.test.js` | `Collection.moveGraph()` order, clamping, active identity, events, mapping and persistence. |
| `tests/views/tabbed-view-reorder.test.js` | Flags, movable block, `moveView()`, `tab-moved`, serialization and legacy payloads. |
| `tests/views/tabbed-view-drag.test.js` | Pointer threshold, gap math, indicators, cancellation, keyboard and CSS hooks. |
| `tests/views/collection-view-tab-reorder.test.js` | `tab-moved` → `moveGraph`, `graphMoved` mirroring, anti-feedback and graph-block layout. |

## Related Documentation

- [View System Overview](view-system-overview.md)
- [TabbedView Events](view-events.md)
- [View Serialization](view-serialization.md)
- [CollectionView Architecture](collection-view-architecture.md)
- [Standard Theme Styling Guide](standard-theme-styling-guide.md)
- [Data Backbone Architecture](../core/data-backbone-architecture.md)
- [Collection Version Policy](../core/collection-version-policy.md)


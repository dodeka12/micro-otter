# Menu System (`MenuView` / `MenuWindow`)

## Overview

Three classes cooperate to render a menu, and each of them can be used on its own:

| Class | File | Role |
| --- | --- | --- |
| `MenuView` | `js/views/menu-view.ts` | `ViewBase` that renders the rows (`role="menu"`), owns the entry list, keyboard selection, click-away and the `select` event. It knows nothing about windows or layers. |
| `MenuWindow` | `js/views/menu-window.ts` | `OverlayWindow` subclass that hosts a `MenuView` as the only child view of a frameless, non-draggable, non-resizable window. Adds `anchor` positioning, auto-sizing and the nested-menu plumbing. |
| `computeAnchoredPosition()` | `js/views/overlay-position.ts` | Pure geometry helper (`{ x, y, side }`) that places a panel beside an anchor rectangle with flip and clamp rules. |

A bare `MenuView` can be mounted anywhere a view fits (it is `position: fixed` itself), but the
supported way to show a menu is always

```ts
viewManager.addOverlay(new MenuWindow({ items, onSelect, x, y }));
```

so the menu lands on the overlay layer and is tracked by `ViewManager` (`addOverlay()` returns the
`OverlayWindow`). `MenuWindow` sizes itself from `MenuView.getPreferredSize()`, which renders a
hidden copy of the row markup — the same `_appendRows()` code path that `render()` uses, so measured
and rendered rows can never drift apart.

## Entry model

`items` is an array of `MenuViewEntry`, a union of three shapes:

```ts
{ type: 'separator' }                                      // MenuViewSeparatorEntry
{ id?, label, icon?, shortcut?, disabled?, checked? }      // MenuViewActionEntry  (no `type`)
{ type: 'menuview', id?, label, icon?, disabled?, menu }    // MenuViewSubmenuEntry
```

- **`separator`** — a `role="separator"` line. Never selectable, never hoverable.
- **action** — a clickable leaf. This is the only kind that ever reaches `onSelect`.
- **`menuview`** — a row that opens a side menu (`menu` is a real `MenuView`). The row itself never
  selects anything; the child menu's entries do, and their selection bubbles to the parent's
  `onSelect` (see [Ownership and lifetime](#ownership-and-lifetime)). A level may hold any number of
  `menuview` rows and each may own a full `MenuView`; only how many can be *open* at the same time is
  bounded (one — see [Known limitations](#known-limitations)).

Two module-local guards decide what a row *is* and what a row can *do*, and both must be extended
when a fourth entry kind is added:

```ts
function isActionEntry(item): boolean    // "clickable leaf"   — drives click and Enter/Space
function isSelectableEntry(item): boolean // "focusable row"    — drives Arrow keys, Home/End
```

`isActionEntry()` is deliberately *not* `!separator` alone: it excludes `menuview` rows too, so a
group row can never be treated as an action. `isSelectableEntry()` accepts action **and** `menuview`
rows and only rejects separators and `disabled: true`. A `menuview` row without an installed submenu
opener is rendered disabled (`_isEntryDisabled()`), so it drops out of both paths automatically.

Rows carry the data the rest of the class navigates by:

```html
<div class="menu__item" role="menuitem" tabindex="0" data-index="2" data-item-id="delete-collection">…
<div class="menu__item menu__item--submenu" role="menuitem" aria-haspopup="menu"
     aria-expanded="false" tabindex="0" data-index="6" data-item-id="group-collection">…
```

The rendered rows are the single source of truth for navigation: `_getSelectableRows()` reads
`.menu__item:not(.menu__item--disabled)` from the DOM and `_getEntryForRow()` maps a row back to its
entry through `data-index`. Keyboard code therefore never has to filter `this.items` a second time;
it only ever works with "the selectable row at `_selectedIndex`".

## Recursive menus

`MenuViewSubmenuEntry.menu` is a real `MenuView`, so nesting depth is data, not code: a menu renders
`menuview` rows recursively and a child may itself contain `menuview` rows.

```ts
const menu = new MenuView({
    title: 'menu.navAria',
    items: [
        { id: 'download-json', label: 'menu.item.downloadJSON' },
        {
            type: 'menuview',
            id: 'group-database',
            label: 'menu.group.database',
            menu: new MenuView({
                title: 'menu.group.database', // becomes the child's `aria-label`
                items: [{ id: 'backup-db', label: 'menu.item.backupDB' }],
            }),
        },
    ],
});
```

The child is a full `MenuView`, not a plain entry array, so it owns

- its **entries** (`items`),
- its **callback** (or none — see the bubbling note below),
- its **translations** (`i18nService`, `title` is translated and applied as `aria-label` on the
  `role="menu"` element),
- its **logger** and therefore its own log prefix.

Because labels are translation *keys* resolved through `this.t()`, a group row and its child title
normally use the same key; that keeps the row label and the child's accessible name identical.

## Ownership and lifetime

`MenuView` does not create windows. Two hooks hide that responsibility in `MenuWindow`:

| Hook | Installed by | Purpose |
| --- | --- | --- |
| `MenuView.setSubmenuOpener(opener)` | `MenuWindow` constructor | Turns a `menuview` row into an interactive row. Called once, before attach — rows pick up the flag at render time. Without an opener, `menuview` rows render disabled. |
| `MenuView.setParentHook(hook)` | `MenuWindow._openChildMenu()` | Lets a nested menu report `ArrowLeft` (`'left'`) and `Escape` (`'escape'`) back to its owner. |

`MenuWindow` keeps exactly one `_childWindow` **open** at a time. Opening another `menuview` row of the
same level first closes the open one (`_openChildMenu()` starts with `_closeChildMenu()`), so a level
never shows two flyouts side by side. That is the cascading behaviour of a menu bar, not a limit on how
many submenus a level may declare: the workspace menu has four `menuview` rows at level 1 and opens
whichever one was hovered or clicked last.

The child window is built as a normal `MenuWindow` with an `anchor`:

```ts
const child = new MenuWindow({
    menu: entry.menu,                       // the MenuView owned by the row
    anchor: row.getBoundingClientRect(),    // the row is the anchor
    onSelect: (item) => this.menu.acceptSelectionFromSubmenu(item),
    logger: this._logger,
});
child.attachTo(this._root);                 // same overlay layer element as the parent
```

Consequences worth knowing:

1. **Layer placement.** The child attaches to `OverlayWindow._root`, i.e. the *same overlay layer
   element* the parent window sits in, not to a container inside the parent. Paint order therefore
   follows DOM order plus the overlay z-index counter, and the child is never clipped by the parent.
2. **Not registered.** The child is *not* added to `ViewManager._overlays`, so `closeOverlay()`,
   `focusOverlay()` and `clearOverlays()` never see it. Its lifetime belongs to the `MenuWindow` that
   created it; `MenuWindow.detach()` closes the child before detaching itself, so a child can never be
   orphaned. `MenuView.beforeDetach()` closes its open child as well.
3. **Selection bubbles.** A pre-built menu handed to `MenuWindow` through `menu:` gets the window's
   `onSelect` assigned to its `onSelectCallback`. A child selection is therefore handed to the parent
   via `acceptSelectionFromSubmenu()`, which runs the parent's normal `_selectItem()` path: same
   callback, same `select` event (`MenuView.Select.v1` → relayed as `MenuWindow.Select.v1`), same
   detach cascade. The handler in the application only needs the flat item id — it cannot tell whether
   the row lived in the parent menu or in a child.
4. **Click-away is split on purpose.** The parent exempts the child element from its own click-away
   check (`#openSubmenu.handle.element`), while the child does **not** exempt the parent. A `mousedown`
   anywhere in the parent therefore closes the open child — covering both "click another row" and
   "click outside" — and clicking the owning row again re-opens the child through its `click` handler.

### Hover, keyboard and focus interplay

- Hovering a `menuview` row selects it and schedules the open after `SUBMENU_OPEN_DELAY_MS` (120 ms);
  leaving the row schedules a close after `SUBMENU_CLOSE_DELAY_MS` (200 ms) so the pointer can travel
  diagonally into the child. `_watchChildHover()` cancels the pending close when the pointer enters the
  child and re-schedules it on `mouseleave`.
- A child that closes on its own (click-away inside the parent) reports through the
  `MenuViewSubmenuHandle.onClose` subscription, which resets the owning row to `aria-expanded="false"`;
  without that hook the row would keep `true` and refuse to re-open.
- `ArrowLeft` in a child closes only that level and returns focus with
  `MenuView.focusRowFor(entry)` — the row is re-selected *and* focused, so the keyboard continues where
  the user left it. `Escape` in a child walks `'escape'` up the hook and detaches the **root** menu,
  closing the whole stack.

## Positioning

### `computeAnchoredPosition(anchor, childSize, options)`

Pure function, no DOM reads except the `window.innerWidth/innerHeight` fallback, so it is unit-tested
in JSDOM where every rectangle is zero (`tests/views/overlay-position.test.js`).

```ts
computeAnchoredPosition(
    { left, right, top, bottom },        // anchor rect, e.g. a row's getBoundingClientRect()
    { width, height },                   // size of the panel that opens
    { viewport, gap = 2, margin = 8, placement = 'right' }
) // → { x, y, side: 'right' | 'left' }
```

Rules, in order:

1. Use `placement` when the child fits on that side (`gap` = 2 px from the anchor, `margin` = 8 px from
   the viewport edge).
2. Otherwise flip to the opposite side when it fits there.
3. Otherwise keep the roomier side and push the child back inside the viewport (`x` never negative).
4. `y` follows the anchor `top` and is clamped into `[margin, viewportHeight - height - margin]`.

### `MenuWindow` anchors

`MenuWindow` picks a position in its constructor:

- `anchor` given → `computeAnchoredPosition(anchor, menu.getPreferredSize())`;
- otherwise → plain `x` / `y` (used for pointer menus with `event.clientX/clientY`).

Everything else stays an ordinary `OverlayWindow` API: `getOverlayElement()` for the root node,
`setPosition()` to move it, `close()` / `attachTo()`. `MenuWindow` forces `showHeader: false`,
`draggable: false`, `resizable: false`, `closable: false` and pins `width`/`height`/`minWidth`/
`minHeight` to the measured menu size, because a menu sizes itself from its content.

## Keyboard and ARIA map

`MenuView` listens on `document` in the **capture** phase for both `keydown` and `mousedown`, so a menu
also works when focus never left the triggering button.

| Key | Selection | On a `menuview` row |
| --- | --- | --- |
| `ArrowDown` / `ArrowUp` | Next / previous selectable row, wrapping around | Skips over nothing special: the row is selectable |
| `Home` / `End` | First / last selectable row | Same |
| `ArrowRight` | Closes any open child (never walks into a child of another row) | Opens the child (if not already open) and moves focus into it |
| `ArrowLeft` | Ignored in the root menu | Handled by the **child**: closes that level and returns focus to the owning row |
| `Enter` / `Space` | Runs the action: callback + `select` event + detach | Opens the child and moves focus into it |
| `Escape` | Detaches the menu | In a child: detaches the whole stack (root menu) |

All handled keys call `preventDefault()`. Separators and disabled rows are never selected and never
receive focus (`tabindex="-1"`); a menu whose rows are all disabled ignores the keyboard entirely.

### Why `_ownsKeyboardEvent()` and not `stopPropagation()`

Nested menus share one `document`. `stopPropagation()` does **not** stop other listeners registered on
the same node, so every menu in a stack would see every keystroke and drive its own selection —
`ArrowDown` in a child would also move the highlight in the parent. `MenuView` therefore asks whether
the event belongs to it:

- synthetic events without a target are handled by the root menu (`!parentHook`);
- a key pressed inside the open child belongs to the child, never to the parent;
- a nested menu (`parentHook` installed) only acts while it contains the event target;
- otherwise the root menu handles it, even when focus is outside the menu.

`ArrowRight` and `ArrowLeft` additionally call `stopPropagation()` where the neighbouring level must
not act on the same key (both are still guarded by `_ownsKeyboardEvent()`).

### ARIA contract

| Element / state | Attribute |
| --- | --- |
| Menu container | `role="menu"`, `aria-label` = translated `title` (default key `"Menu"`) |
| Action row | `role="menuitem"`, `tabindex="0"` (`-1` when disabled), `aria-disabled="true"` when disabled |
| `menuview` row | `role="menuitem"`, `aria-haspopup="menu"`, `aria-expanded="false"` → `"true"` while its child is open |
| Selected row | `aria-selected="true"` (single selection, kept on exactly one row) |
| Separator | `role="separator"` |
| Checkbox glyph, icon, shortcut, chevron | `aria-hidden="true"` — the label carries the accessible name |

Rows are addressed by `data-index` (position in `items`, separators included) and `data-item-id`
(the entry `id`, empty string when absent). `aria-expanded` is maintained by `_openSubmenu()` and reset
by both `_closeSubmenu()` and `_handleSubmenuClosed()`, so a child that closed itself also clears the
flag.

## Styling hooks

`styles/standard/menu.css` (`menu.css` in other themes) ships the classes:

| Class | Applied to |
| --- | --- |
| `.menu` | Menu container (surface, border, shadow, `min-width: 180px`, `max-width: 320px`, `max-height: 400px` with scroll) |
| `.menu__item` | Every row; `.menu__item--selected`, `.menu__item:hover`, `.menu__item:focus` share the accent background |
| `.menu__item--disabled` | `opacity: 0.4`, `cursor: not-allowed` |
| `.menu__item--submenu` | Rows rendered from a `menuview` entry |
| `.menu__submenu-arrow` | Trailing `▸` chevron (`margin-left: auto`) |
| `.menu__item--submenu[aria-expanded='true']` | Owning row while its child is open (accent background, chevron at full opacity) |
| `.menu__separator`, `.menu__checkbox`, `.menu__icon`, `.menu__icon-img`, `.menu__label`, `.menu__shortcut` | Row internals |

The expanded state is styled through the ARIA attribute, not an extra class: the DOM already has to
carry `aria-expanded` for screen readers, so a theme gets both from one source.

## Usage example

A context menu with one nested group, opened at the pointer and closed through the overlay layer:

```ts
import { MenuView } from './menu-view.js';
import { MenuWindow } from './menu-window.js';

const menuWindow = new MenuWindow({
    items: [
        { id: 'copy', label: 'contextMenu.copy', icon: IconProvider.contentCopy },
        { id: 'delete', label: 'contextMenu.delete', icon: IconProvider.delete },
        { type: 'separator' },
        {
            type: 'menuview',
            id: 'group-more',
            label: 'contextMenu.more',
            menu: new MenuView({
                title: 'contextMenu.more',
                items: [{ id: 'info', label: 'contextMenu.info' }],
                i18nService: this._i18nService,
                logger: this._logger,
            }),
        },
    ],
    onSelect: (item) => this._handleContextMenuSelect(item), // also receives `info`
    x: event.clientX,
    y: event.clientY,
    i18nService: this._i18nService,
    logger: this._logger,
});

this._viewManager.addOverlay(menuWindow);
```

To anchor beside a DOM element instead of the pointer, pass `anchor: element.getBoundingClientRect()`
and drop `x`/`y`. To host an already-configured `MenuView` (the pattern used by the workspace menu),
pass `menu:` instead of `items:` — `MenuWindow` then reuses that instance and assigns its `onSelect`.

## The workspace main menu

`WorkspaceView._buildMenuItems({ canUpload })` is the single place the hamburger menu tree is defined
(`js/views/workspace-view.ts`), and `_buildMenuGroup({ id, label, icon, items })` is the only helper
that wraps a group:

```ts
_buildMenuGroup({ id, label, icon, items }) {
    return {
        type: 'menuview',
        id,
        label,
        icon,
        menu: new MenuView({ title: label, items, i18nService: this._i18nService, logger: this._logger }),
    };
}
```

It sets `title: label`, so the child's `aria-label` is the same translation key as the row label, and it
deliberately passes **no `onSelect`**: `MenuWindow` assigns the parent callback when it hosts the menu,
which is what makes a child selection arrive at `_handleMenuItemSelect()` as if the row had been clicked
in the parent menu.

The menu is laid out as three leaves, a separator, three action groups, a separator and one info group:

| Row | Id | Label key | Contents |
| --- | --- | --- | --- |
| leaf | `create-collection` | `menu.item.createCollection` | new collection dialog |
| leaf | `upload-to-device` | `menu.item.uploadToDevice` | `disabled` unless a compatible device is connected |
| leaf | `delete-collection` | `menu.item.deleteCollection` | delete the active collection |
| — | — | — | separator |
| group | `group-collection` | `menu.group.collection` | `download-json`, `upload-json` |
| group | `group-database` | `menu.group.database` | `backup-db`, `restore-db` |
| group | `group-target-config` | `menu.group.targetConfig` | `upload-target-config`, `download-target-config-template`, `download-current-target-config`, `backup-target-config-db`, `restore-target-config-db` |
| — | — | — | separator |
| group | `group-info` | `menu.group.info` | `select-language`, `about`, `privacy-notice` |

Contract worth preserving:

- **The item ids are the public contract.** `_handleMenuItemSelect()` is a flat `switch` over `item.id`;
  every leaf id above (including the ids inside the groups) has a `case`. Group ids never reach that
  switch because a `menuview` row is not selectable, and an unknown id falls into the
  `unknown-menu-item` warning branch — a typo in an id shows up in the log instead of doing nothing.
- **Three leaves stay leaves.** The daily actions must stay one click away; only import/export-ish
  actions are grouped.
- **Graph actions live on the graph tab.** Rename Graph and Delete Graph are graph-tab context-menu
  actions owned by `CollectionView`; they are deliberately not hamburger rows.
- **Group labels live in both locales.** `menu.group.collection|database|targetConfig|info` resolve to
  `Collection` / `Database` / `Target Config` / `Info` in `en.json` and `Sammlung` / `Datenbank` /
  `Zielkonfiguration` / `Info` in `de.json`.
- **The About rows are generated, not hard-coded.** `Info → About` renders `OPEN_SOURCE_PACKAGES`
  from `js/core/open-source-packages.generated.js`, which `npm run generate:oss` derives from
  `tools/open-source-package-overrides.json` (npm/CDN packages plus a `vendoredAssets` list for
  downloaded icon sets). See
  [build-and-deployment](../guides/build-and-deployment.md) and
  [adding-icons](../../workflow/adding-icons.md).

## Known limitations

1. **Child overlays are invisible to `ViewManager`.** A submenu window is not in `_overlays`, so
   `clearOverlays()` does not close it directly — it closes because its parent closes. Code that
   enumerates overlays will never see submenus.
2. **A submenu can be left behind by a resize.** `ViewManager.constrainOverlays()` exists but nothing
   calls it, and a child overlay is not tracked anyway, so an open submenu keeps its position after the
   window is resized or the page is zoomed. Closing and re-opening the parent row places it correctly
   again; hosts that live in resizable areas must close menus themselves on resize.
3. **Cascading, not pinned: one child *open* per level.** `MenuView.#openSubmenu` and
   `MenuWindow._childWindow` are single slots, so two sibling flyouts can never be visible at once —
   the rows are unlimited, only the open state is single-valued. A multi-open or "pinned panel" mode
   would need per-entry slots *plus* a stacking rule (every child is anchored to its own row with
   `computeAnchoredPosition()`, which prefers `anchor.right` and only flips left when the viewport has
   no room, so two open siblings would overlap) and a relaxed click-away policy (a child currently
   closes on any `mousedown` in the parent).
4. **Hover timers are real timers.** Tests must let the 120 ms open / 200 ms close delays expire, and a
   real `mousedown` outside is only observed one macrotask after attach because `afterAttach()` registers
   the click-away listener inside `setTimeout(…, 0)`.
5. **`getBoundingClientRect()` is zero in JSDOM**, so anchor geometry, flipping and "the submenu opens to
   the right of the row" are only verifiable in a browser; the unit tests pin the
   `computeAnchoredPosition()` math instead.

## Tests

| File | Covers |
| --- | --- |
| `tests/views/menu-submenu-rendering.test.js` | `menuview` rows: classes, `aria-haspopup`/`aria-expanded`, disabled without an opener, recursion |
| `tests/views/menu-submenu-keyboard.test.js` | ArrowRight/ArrowLeft/Enter/Escape across a parent/child stack, focus return |
| `tests/views/menu-window-submenu.test.js` | Child window ownership: same layer, one open child per level (cascade), bubbling selection |
| `tests/views/menu-window-integration.test.js` | `MenuWindow` + `ViewManager.addOverlay()` lifecycle and `select` relay |
| `tests/views/workspace-view-menu.test.js` | Hamburger menu structure, id → handler contract, submenus through the real `_handleHamburgerClick()` path |
| `tests/views/overlay-position.test.js` | `computeAnchoredPosition()` flip/clamp/gap/margin rules |
| `tests/views/menu-checkbox.test.js` | `checked` glyph rendering |

Run one file with `node --import tsx --test tests/views/menu-submenu-keyboard.test.js`, or the whole
suite with `npm run test:node:js`.

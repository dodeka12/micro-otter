# Changes since version 1.26.0

## New Features

- **Menus can nest** — `MenuViewEntry` gains a third kind, `{ type: 'menuview', label, menu }`:
  the row carries its own `MenuView`, renders a trailing `▸` plus `aria-haspopup="menu"` and
  `aria-expanded`, and opens that menu as a side window. Nesting depth is data, so a child may
  itself contain further `menuview` rows. A bare `MenuView` renders them disabled; only a
  `MenuWindow` installs the opener through `setSubmenuOpener()`.
- **A submenu is a sibling overlay owned by its parent** — `MenuWindow._openChildMenu()` builds
  the child `MenuWindow` with `anchor: row.getBoundingClientRect()` and attaches it to the *same
  overlay layer element* as its parent, so it is never clipped and paints directly above it. The
  child is deliberately **not** registered in `ViewManager._overlays`: its lifetime belongs to the
  parent window, which closes it in `detach()`. A selection inside a child bubbles through
  `acceptSelectionFromSubmenu()`, so the application still sees one flat item id and one `onSelect`.
- **Submenu placement is a pure function** — new `js/views/overlay-position.ts` exports
  `computeAnchoredPosition(anchor, childSize, options)`, which opens beside the row, flips to the
  left near the right viewport edge, keeps a `gap`/`margin` and clamps `y` into the viewport. It
  only reads `window.innerWidth/innerHeight` as a fallback, so the arithmetic is unit-testable in
  JSDOM.
- **The nested stack is keyboard- and screen-reader-navigable** — ArrowRight opens a child (and
  moves focus into it), ArrowLeft closes only that level and returns focus to the owning row,
  Escape closes the whole stack, Enter/Space open a group row, Home/End jump inside the current
  level. Keys are filtered by `_ownsKeyboardEvent()` instead of `stopPropagation()`, so a keystroke
  inside a child can no longer move the parent's selection; hover opens after 120 ms and closes
  after 200 ms so the pointer can travel diagonally into the child.

## Improvements

- **The hamburger menu is grouped into four action groups** — the four daily actions stay leaves
  (`create-collection`, `upload-to-device`, `delete-collection`, `delete-graph`), and everything
  import/export-ish moved behind `Collection`, `Database`, `Target Config` and `Info` rows built
  by the new `_buildMenuGroup()` helper. Item ids are unchanged, so `_handleMenuItemSelect()` keeps
  its flat `switch`; the new label keys `menu.group.collection|database|targetConfig|info` exist in
  `en.json` (`Collection`/`Database`/`Target Config`/`Info`) and `de.json`
  (`Sammlung`/`Datenbank`/`Zielkonfiguration`/`Info`).
- **Tests** — new suites cover the entry model and `aria-*` contract (`menu-submenu-rendering`),
  the keyboard map across a parent/child stack (`menu-submenu-keyboard`), child-window ownership
  (`menu-window-submenu`), the placement math (`overlay-position`) and the reorganised main menu
  including its id → handler contract and the real `_handleHamburgerClick()` path
  (`workspace-view-menu`).
- **Docs** — new `docs/dev/view-system/menu-system.md` (entry model, nesting, ownership,
  positioning, keyboard/ARIA map, main-menu layout, known limitations), plus updates to
  `view-system-overview.md`, `view-manager.md` and `standard-theme-styling-guide.md`, and the
  context-menu example in `graph-panel-view-architecture.md` (it called a non-existent
  `menuWindow.show()`).

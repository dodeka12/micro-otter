# Changes since version 1.26.0

## Improvements

- **The node palette starts sorted by category** — a workspace without a stored palette preference
  now opens the palette grouped by node category instead of as one alphabetical list, so related
  nodes sit together right away. A mode the user picked earlier still wins: the saved
  `nodePalette.organizationMode` is loaded unchanged, and the toolbar buttons (`Alphabetical` /
  `By Package` / `By Category`) behave exactly as before.
- **Palette icons stop growing once the panel is wide enough** — small (icon-only) tiles used to
  take a fixed fifth of the row, so widening the split panel inflated the tiles *and* the icons
  instead of fitting more of them, and a category section never showed more than five icons per
  row. The tile width is now clamped between `32px` and `36px`
  (`--mo-node-palette-small-card-min-width` / `--mo-node-palette-small-card-max-width`), i.e. it is
  little more than the 24 px icon plus its padding; everything beyond that wraps into additional
  columns — about 4 columns at the 200 px minimum, 6 around 300 px and 9 at the palette's 420 px
  maximum. The glyph itself is capped at 24 px (the same size as in the large card) in
  `node-type-ui.css`, so icons never inflate.
- **One shared tile width for every small grid** — favourites, recently used, the alphabetical grid
  and the collapsible package/category sections all read
  `--mo-node-palette-small-card-width`, a single `clamp(...)` declaration on `.node-palette-view`,
  so the three grids cannot drift apart again. Large cards are unchanged.
- **Tests** — `tests/views/node-palette-view.test.js` renders a palette without a stored mode and
  asserts the category groups plus the active toolbar button, verifies that a stored `alphabetical`
  preference is still honoured, and pins the clamped tile width in the stylesheet — including a
  column-count guard that fails if the cap is ever raised back to a five-per-row size.

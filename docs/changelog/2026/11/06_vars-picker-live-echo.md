# Changes since version 1.26.0

## Bug Fixes

- **The picker row follows the text field while you type** — a Store / Name picker sitting on its
  `New store…` / `New variable…` sentinel renders the text of its companion field, but that text
  only reached the row once the deferred rebuild ran when the editor closed. The row now follows
  every keystroke, and the flush after the editor closes requests a repaint, so the canvas can no
  longer keep the frame the placeholder was drawn in.
- **Typing no longer flickers the icon rows** — every `node-updated` of the graph refreshed all its
  nodes, and a refresh dropped and re-created *every* control instance. The icon control reloads its
  webfont glyph on creation, so each keystroke in one node re-painted the icon text of every other
  node before the glyph arrived. `NodeUi._refreshDynamicControls()` now resolves the option lists
  first and rebuilds only when a resolved list, a disabled flag or an echoed sentinel label really
  changed.
- **The store picker survives an external refresh while it is open** — `_initializeInputDefaultControls()`
  now honours the same `_activeEditor` deferral as `_initializeControls()`. The store picker *is* an
  input-row default, so a foreign-graph refresh used to destroy the element the user was picking in.
- **Clicking the `New variable` field edits the variable name** — hit testing built its rows from the
  unresolved control list, which still contained the companions a dynamic picker hides, so every row
  below the picker was addressed one slot off: the click landed on the hidden `New store` field and
  the typed name was stored where neither the field nor the picker could show it. The same offset
  made the store picker row unclickable and the `Default` row open the store editor. `hitTestControl()`
  now takes its rows from the resolved list the renderer paints.

## Internal

- `NodeDropdownControlUi.setOptions(options, disabled?)` replaces the option list of a live instance:
  it updates `_options`, `controlData.options`, the trigger label and rebuilds an already mounted menu
  in place (keeping its open/closed state). No destroy/re-create, so no icon reload.
- `NodeUi` gained `_dynamicOptionSignature()` (resolved option lists + disabled flags of every dynamic
  control and input-row default, computed in one pass that also seeds the values), `_recordDynamicSignature()`,
  `_refreshCompanionPickers(controlId)` and `_applyResolvedOptions()`. `_dynamicControlSignature` is
  cleared by both destroy helpers and left empty while a rebuild is deferred.
- `NodeUi.onControlChanged()` calls `_refreshCompanionPickers()` before the dependency check and routes
  the rebuild through the signature-guarded `_refreshDynamicControls()` instead of rebuilding directly.
- `node-control-dynamic-resolver.ts`: new `SENTINEL_COMPANION_KEYS` and `descriptorEchoesControl()`,
  used to recognise that `customName` / `customStore` / a `newTopicControls` id is a dependency of the
  picker that echoes it.
- `NodeUi._flushPendingControlRefresh()` calls `requestRepaint()` after the deferred rebuild.
- `node-ui-hit-testing.ts`: `NodeUiLike` gained an optional `_getVisibleControls(data)` (the resolved,
  cached row list), and both hit-test passes go through the new `visibleControlsOf()` helper. The
  input-default rows are positioned with the control-section height of that same list, so they line
  up with the drawn connectors again.
- JS/TS only: no `vars` manifests or device assets change, so **no firmware rebuild is required**.

## Documentation

- `docs/dev/view-system/node-ui-module-structure.md` documents the "hit testing walks the drawn
  rows" rule (`visibleControlsOf()`), and the input-default block no longer claims the hidden
  companion still advances the y-offset.
- `docs/dev/nodes/vars-node-system.md` states that only the companion of the selected sentinel is
  drawn and clickable, and that the typed name is what `collectVarNames()` offers elsewhere.

## Tests

- `tests/nodes/node-ui-var-picker-echo.test.js` (new): the name row follows the keystroke and the
  picker instance is never replaced, the echo survives the close with a repaint of the deferred rebuild,
  a typed store namespace echoes on the store picker, a keystroke in a `var-read` node leaves the
  `icon` instance of another node untouched, and clicking the drawn `New variable` row opens the
  companion's editor (storing `customName`, never `customStore`). The last one fails with
  `controlId: 'customStore'` when the hit test falls back to the raw visible-control list.
- `tests/nodes/node-ui-control-editor-refresh.test.js`: the deferral is now driven by a real option-list
  change (an added availability flag node), a keystroke that changes no list schedules no rebuild at all,
  the flush repaints the node, and an unrelated title change keeps every instance.
- `tests/nodes/node-ui-dynamic-controls.test.js`: the re-entrancy test emits a change that really
  extends the topic list, since an unchanged resolution no longer rebuilds.

# Changes since version 1.26.0

## Bug Fixes

- **The Store / Name picker keeps showing what you typed** — after creating a namespace or a
  variable, the picker row used to fall back to its placeholder (`New store…` / `New variable…`)
  while the text only lived in the companion field. The sentinel option now carries a
  `displayLabel` that the dropdown draws on the canvas and on the editor trigger; the menu entry
  keeps its translated label, and the stored value stays `__new__`. The MQTT topic picker
  (`graphTopics`) gets the same treatment.
- **A fresh `var-read` / `var-write` starts on `default`, not on "New store…"** — the store picker
  resolves an unset *or empty* store to the `default` namespace, which is what the generator emits
  anyway. The blank `(not set)` entry is gone (an empty store and `default` are the same
  namespace), and a stored empty string is upgraded when the node is built instead of being kept.
  Names typed while the picker sat on a custom namespace are now visible in the namespace the
  user is actually reading.
- **A variable created in one graph appears in the pickers of another** — a graph tab that had
  already been rendered kept the option list it resolved back then, because only the active graph
  emitted node events. `NodeUi` now also observes the remaining graphs of the collection and
  re-resolves its options when one of them changes.

## Internal

- `ResolvedDynamicOption` / `NodeDropdownOption` / `DropdownOption(Definition|State)` gained an
  optional `displayLabel` (string or i18n map).
  `NodeDropdownControlUi._optionDisplayText()` prefers it over `label` for the trigger and the
  canvas text; the popup menu still renders `label`.
- `node-control-dynamic-resolver.ts`: new `sentinelTypedText()` helper (first id of
  `newStoreControls` / `newNameControls` / `newTopicControls`, read through `controlValue()`), used
  by `varStores`, `varNames` and `graphTopics` to fill the sentinel's `displayLabel`.
- `varStores` resolves `rawCurrent || DEFAULT_VAR_STORE` and returns `default` for an unset store;
  the sentinel is only returned when it is actually stored, so the option list no longer contains
  an empty entry. `NodeUi._resolveInputDefaultOptions()` seeds `undefined`, `null` and `''`.
- `NodeUi` gained `_bindCollection()` / `_unbindCollection()` / `_subscribeForeignGraphs()` /
  `_subscribeGraphNodes()` / `_onCollectionEvent()` with `_collectionUnsubscribe` and
  `_foreignGraphUnsubscribe`; bound in the constructor and in `setGraph()`, torn down in
  `destroy()`, and only active for nodes with a cross-node source (`_hasCrossNodeControl()`).
  `WorkspaceLike.getActiveCollection` is typed as the new `CollectionSourceLike`.
- JS/TS only: no `vars` manifests or device assets change, so **no firmware rebuild is required**.

## Documentation

- `docs/dev/nodes/node-definition-reference.md` documents `displayLabel`, the new `varStores`
  order (default first, no blank entry), the `undefined` / `null` / `''` seeding rule and the
  cross-graph refresh.
- `docs/dev/nodes/vars-node-system.md` describes the `default` preselection and the echoed
  sentinel row.
- `docs/dev/view-system/node-ui-module-structure.md` adds the cross-graph subscription block and
  the sentinel display labels.

## Tests

- `tests/nodes/node-control-dynamic-resolver.test.js`: `varStores` starts on `default`, an empty
  store resolves to `default`, the sentinel list has no blank entry, and `varStores` / `varNames` /
  `graphTopics` echo the typed companion text in `displayLabel` (and only on the sentinel).
- `tests/nodes/node-ui-input-default-dynamic.test.js`: unset store seeds `default`, an empty store
  is upgraded, and both pickers render the typed text on their row.
- `tests/nodes/node-ui-cross-graph-refresh.test.js` (new): a foreign graph's change refreshes the
  name and store pickers, a graph added/removed later is (un)subscribed, a node without a
  cross-node source subscribes to nothing, and `destroy()` drops every subscription.

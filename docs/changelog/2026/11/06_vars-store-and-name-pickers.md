# Changes since version 1.26.0

## New Features

- **`var-read` and `var-write` gain a Store picker** — the `store` input's default control is now
  a dropdown instead of free text. It lists the store namespaces of the whole collection
  (`default` first, then every namespace another node uses, sorted), so a namespace created on any
  graph of the collection is one click away. The value is still stored in
  `inputDefaults.store`, so the input stays wireable from any `string` output and code generation
  is unchanged.
- **A Name picker that follows the selected store** — the `name` control is now a dropdown whose
  list contains the variables of the *selected* namespace only. `VarStore` is namespaced, so the
  same name in two namespaces is two unrelated entries; the cascading list removes the risk of
  reading the wrong one. Picking a store re-resolves the list immediately.
- **"Create new…" on both pickers** — each dropdown ends with a sentinel option (`New store…` /
  `New variable…`, translated) that reveals a text control (`New store` / `New variable`). The
  typed text is what the generator emits, exactly like the MQTT topic dropdown's `__new__`
  contract. An empty new-store text falls back to the `default` namespace.
- **Reserved namespaces stay hidden** — namespaces starting with `_` are package-owned
  (`_webcontrol`) and never offered as options, although a node that already holds one keeps it;
  it is shown first and never rewritten.

## Internal

- New module `src/micro_otter/nodes/html/js/nodes/var-stores.ts` with `collectVarStores()` /
  `collectVarNames()`, the source names `varStores` / `varNames`, the `__new__` sentinel contract
  and `VAR_STORE_INPUTS` (which node type names a namespace in which input). It is the store
  equivalent of `graph-topics.ts` and is package-agnostic: it only looks at node types, control ids
  and control values.
- `node-control-dynamic-resolver.ts` registers the two sources; `DynamicControlResolverArgs.nodeData`
  now also exposes `inputDefaults`, because the store lives in an input row rather than in
  `controlValues`. `node-ui-constants.ts` adds both sources to `CROSS_NODE_DYNAMIC_SOURCES`.
- Input-row default controls can now carry `dynamicOptions`: `NodeUi._resolveInputDefaultOptions()`
  resolves the list without rewriting the stored value, `getVisibleControls(nodeData,
  extraAffectingDropdowns)` receives one synthetic dropdown per dynamic input default so
  `customStore` can be revealed, and `_hasCrossNodeControl()` / `_refreshDynamicControls()` cover
  input defaults as well.
- `vars/node_generators.js` resolves the sentinels: `store === '__new__' → customStore` (empty →
  `default`) and `name === '__new__' → customName`. The transpiler is untouched, so every existing
  graph compiles to the same Python.
- Node packages bumped: `vars` 0.36.0 → 0.38.0 (one minor bump per implementation commit). The
  change is JS/JSON only — no `mpAssets` entry changed, so **no firmware rebuild is required**.

## Documentation

- `docs/dev/nodes/node-definition-reference.md` documents the `varStores` / `varNames` sources, the
  `newStoreControls` / `newNameControls` descriptor keys, the i18n `newLabel` map and the new
  *Dynamic options on an input-row default control* subsection (storage, visibility, refresh,
  hit-testing trade-off).
- `docs/dev/nodes/vars-node-system.md` describes the pickers, the cascading name list, the hidden
  reserved namespaces and the unchanged statement shape.
- `docs/dev/view-system/node-ui-module-structure.md` adds `var-stores.ts` to the module notes and
  documents `getVisibleControls(nodeData, extraAffectingDropdowns)` plus the extended cross-node
  refresh.

## Tests

- `tests/nodes/var-stores.test.js` covers the collectors (happy path, reserved namespaces, both
  sentinels, unknown namespace, missing collection and `null` arguments).
- `tests/nodes/node-control-dynamic-resolver.test.js` covers both resolvers, the `inputDefaults`
  precedence and the sentinel options.
- `tests/nodes/node-ui-input-default-dynamic.test.js` covers the resolved input-row options, the
  reveal of `customStore`, the visibility cache, cross-node detection and the refresh.
- `tests/nodes/input-default-control-isolation.test.js` keeps the isolation guarantee: an input
  default writes only `inputDefaults`, a control only `controlValues`.
- `tests/data/vars-node-definitions.test.js` pins the pickers, the companion controls and the
  unchanged input/control order.
- `tests/proc/vars-generators.test.js` and `tests/proc/vars-transpiler-integration.test.js` cover
  the generators (regression for plain values, both sentinels, empty companion text, wired store
  input) and transpile a graph with both sentinels end to end.

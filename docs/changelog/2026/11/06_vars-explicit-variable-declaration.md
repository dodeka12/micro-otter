# Changes since version 1.26.0

## New Features

- **Variables are declared explicitly** — the Name picker of `var-read` / `var-write` now has three
  states: `(not set)` (empty name), `Declare variable…` (the `__new__` sentinel with the
  `Variable name` companion), or an existing variable of the selected store. A variable exists only
  while exactly one node declares it, so the picker lists only declared names and a declaring node
  never sees its own name. The sentinel label and companion were renamed from `New variable…` /
  `New variable` to `Declare variable…` / `Variable name`.
- **References follow their declaration** — renaming a declared variable rewrites every node that
  uses it, and when a declaration disappears (the node switches to "use", clears the name, changes
  store, or is deleted) every dangling reference is reset to `(not set)`. The reconciliation runs
  across the whole collection on `node-updated` / `node-removed` and once on load, and is grouped
  for a single undo step.
- **Duplicate declarations are flagged** — a second `var-read` / `var-write` declaring the same
  variable in the same store is badged as an error on both declaring nodes
  (`vars-duplicate-declaration` graph rule).

## Internal

- `nodes/var-stores.ts`: `isVarNameDeclaration()` / `declaredVarEntry()`; `collectVarNames()`
  returns only declared names and accepts `excludeNodeId` so a declaration never lists itself.
- `nodes/var-consistency.ts` (new): `declaredVarEntries()`, `danglingVarReferences()`,
  `varReferencePatchesForChange()` (rename detection from the `node-updated` `previous` snapshot)
  and the `VarReferenceReconciler`.
- `nodes/node-control-dynamic-resolver.ts`: the `varNames` resolver no longer seeds an empty name
  onto `__new__`, and passes the resolving node id to `collectVarNames()`.
- `data/collection.ts` + `data/collection-manager.ts`: the reconciler is wired into the active-graph
  bridge (`reconcileVarReferences()`) and the load path.
- `device/node_pkgs/vars/node_capabilities.js`: registers the `vars-duplicate-declaration` rule.
- JS/TS + labels only: the `vars` generator is unchanged, so **no firmware rebuild is required**.

## Documentation

- `docs/dev/nodes/vars-node-system.md` — the declare / use / not-set model, declared-only lists,
  reference reconciliation, and the duplicate-declaration error.
- `docs/dev/view-system/node-ui-module-structure.md` — the "variable consistency" section.
- `docs/dev/nodes/node-validation-architecture.md` — the new package rule and coverage row.

## Tests

- `tests/nodes/var-consistency.test.js` (new): rename propagation, undeclare/delete/load repair,
  cross-graph repair, idempotency, the Collection bridge, and the duplicate-declaration rule.
- Updated `var-stores.test.js`, `node-control-dynamic-resolver.test.js`,
  `node-ui-var-picker-echo.test.js`, `node-ui-cross-graph-refresh.test.js`,
  `node-ui-input-default-dynamic.test.js` and `vars-node-definitions.test.js` for the
  declared-only model and the renamed label.

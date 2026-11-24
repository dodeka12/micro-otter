# Changes since version 1.25.0

## Breaking Changes
- **The `Branching` node is removed** — `core.branching-node` no longer exists; saved graphs that
  reference it will not find the definition.
- **Output input-source typing is `typeInputSources` only** — the singular
  `type_input_source` / `typeInputSource` keys and the plural `type_input_sources` alias are
  retired and ignored.
- **Unconnected union outputs report their declared inputs' primary types** — instead of
  `any`, an unwired union output now resolves to the primary type of each declared source input,
  so it no longer connects to a target those types cannot reach.

## Refactor
- **The transpiler emits one flat topological loop** — branch partitioning, branch subgraph
  emission, and the guard-predicate machinery are removed.
- **`resolveDeclaredInputSources()` is the single parser for declared input sources** — the
  duplicate normalizers in the runtime migration and graph panel now delegate to it.

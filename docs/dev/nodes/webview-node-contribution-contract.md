# Webview Node Contribution Contract

This document defines the node-specific contribution contract used by webview runtime code
generation modularization.

## Scope

This contract governs how node-specific generator modules contribute generated markup and
client-JS update logic while shared orchestration remains centralized.

The contract applies to the webview node package under:

- `src/micro_otter/nodes/device/node_pkgs/webview/`

## Goals

- Keep node-specific generation logic owned by node-specific generator files.
- Keep shared orchestration and cross-node contracts in shared modules.
- Preserve deterministic generated artifacts for identical graph inputs.
- Preserve runtime refresh and artifact contracts.

## Ownership Boundaries

### Node-specific modules own

- Node-kind rendering fragments for generated markup.
- Node-kind client update handlers.
- Optional node-kind client helper snippets required by handlers.
- Node-kind registration into shared contributor registry.

### Shared modules own

- Contributor registry APIs and lookup/validation.
- Layout traversal and page-scope orchestration.
- Client runtime prelude/epilogue, polling loop, and dispatch scaffolding.
- Artifact assembly and helper handoff consumer registration.

## Contribution Shape

Each node-kind contributor must provide a stable object with these optional members:

- `renderMarkup(context) -> string[]`
- `renderClientUpdateHandler(context) -> string[]`
- `renderClientHelpers(context) -> string[]`
- `renderClientInitHooks(context) -> string[]`
- `getWebserverCapabilities() -> object | null`
- `getRefreshTransientKeyPrefixes() -> string[]`
- `getRefreshRequestValueNormalizers() -> string[]`
- `getRefreshHookImports() -> string[]`

Expected behavior:

- Functions must be pure with respect to input context.
- Returned arrays must contain complete source lines (no implicit concatenation rules).
- Empty arrays are valid when a node kind has nothing to contribute for that section.

> **Frontend value submissions:** `renderClientHelpers` code that POSTs user input back to the
> device must use the shared client-side `POST_REFRESH_ROUTE` constant (emitted by the shared
> generator into `webview_client.js`).  Do not hardcode `/refresh` or `/api/webview/refresh` —
> the route is configurable via the `postRefreshRoute` runtime flag.
>
> **Frontend input nodes must register a request value normalizer.**  POSTing user values under
> `frontend:*` keys from `renderClientHelpers` is not enough on its own: the refresh handler only
> stores posted values that a request value normalizer hands back to it.  For each such node kind
> you must also implement:
>
> - `getRefreshTransientKeyPrefixes()` → return the `frontend:*` prefixes the loop will consume,
>   so the refresh handler preserves (instead of delivers) those keys.
> - `getRefreshRequestValueNormalizers()` → return the Python normalizer function name(s) that
>   extract the `frontend:*` values from the POST body.
> - `getRefreshHookImports()` → emit the Python normalizer function definition (deduplicated
>   across node kinds by the shared generator).
>
> Without the normalizer, the refresh handler silently drops the posted `frontend:*` values, so
> `consume_webview_values_keys(...)` in the loop never sees them and the control always reports
> its default value.
>
> **Input controls must pass the sync epoch into `update()`.** Generated loop code for scalar
> input controls and select must call
> `update(..., sync_epoch=WEB_INTERFACE.get_webview_sync_epoch())`. This lets each control
> force-publish its current value once at startup and whenever the frontend sends
> `initialSync: true` (the refresh handler bumps the epoch via `request_webview_sync()`).
> Without it, a freshly-connected frontend keeps showing stale or embedded values.

## Context Contract

Contributor input context must include normalized and deterministic values:

- `nodeKind`: normalized node kind string.
- `element`: normalized layout element record.
- `controls`: normalized control values for the element.
- `bindings`: generated element/payload binding identifiers.
- `layout`: relevant layout metadata required by renderer/update logic.
- `helpers`: shared pure helpers explicitly exposed to contributors.

Contributors must not depend on undocumented fields.

## Deterministic Ordering Rules

- Contributor registration is keyed by node kind.
- Shared assembly must process contributors in sorted node-kind order.
- Section output ordering is fixed:
  1. shared prelude
  2. node helper fragments
  3. node update handlers
  4. shared dispatch/runtime epilogue

Any future section additions must be documented here before use.

## Error Contract

Shared registry and assembly layers must fail fast when:

- a contributor is registered more than once for the same node kind,
- a required contributor is missing for a node kind present in layout generation,
- contributor functions return invalid shapes.

Error messages must include node kind and contract surface that failed.

## Backward Compatibility Rules

- Public generator registration names referenced by node definitions must remain unchanged.
- Generated artifact target paths and refresh contracts must remain unchanged.
- This contract controls ownership and structure, not feature behavior changes.

## Related Documentation

- `docs/dev/nodes/webview-node-system.md`
- `docs/dev/nodes/webview-runtime-generation-contract.md`
- `docs/dev/nodes/transpiler-architecture.md`
- `docs/dev/nodes/node-definition-reference.md`

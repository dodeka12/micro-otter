---
name: document
description: 'Write or update documentation. Use when the user asks to document something, update the docs, write docs for a feature, or when structural changes were just made. Covers three layers: in-code reference docs (docstrings/JSDoc), developer docs under docs/dev/ (organized by domain: guides, core, view-system, nodes, device-communication, deployment, mpy-precompilation, firmware-compile), and user docs under user-docs/ (the MkDocs site). Ask the user which layer(s) to update if not clear.'
---

# Document

## Documentation Layers

The project has three documentation layers. Each serves a distinct audience and purpose:

| Layer | Location | Audience | Focus |
|-------|----------|----------|-------|
| Reference | In source files (docstrings / JSDoc) | Humans + agents reading code | Every public symbol: what it does, parameters, return values, raises |
| Developer | `docs/dev/` | Human developers + agentic tools | System architecture, protocols, contracts, and cross-cutting guides — organized by domain |
| User | `user-docs/` | End users | User-facing guides and behaviour, rendered by MkDocs |

See [Doc Layers](./references/doc-layers.md) for detailed rules per layer and the `docs/dev/` folder map.

> Adjacent top-level doc folders: `docs/general/` (repo/contributor setup), `docs/admin/` (admin guides), `docs/tools/` (tooling reference), and `docs/workflow/` (step-by-step how-tos). Use these only when a change is neither developer nor user documentation.

---

## When to Update Documentation

| Trigger | Layers affected |
|---------|----------------|
| New module, class, or function added | Reference (always), Developer (if structural) |
| Public API or CLI command added/changed | Reference, User |
| Architecture or component interaction changed | Developer |
| New protocol, contract, or integration added | Developer |
| New design decision or cross-cutting guidance identified | Developer |
| Existing behaviour corrected/clarified | Reference and/or Developer |

---

## Procedure

### Step 1 — Identify which layers need updating

If not clear from the request, ask the user. Read the relevant source files and `docs/dev/` to understand the current state before writing anything.

### Step 2 — Update Reference Documentation

For every public function, method, class, and module touched:
- Python: use docstrings (Google style — see [Doc Layers](./references/doc-layers.md))
- TypeScript: use JSDoc comments

Rules:
- Every public symbol must have a docstring/JSDoc
- Describe *what* the symbol does (not *how*)
- Document all parameters, return values, and raised exceptions / thrown errors
- Private symbols (`_name` / `#name`) do **not** require docstrings unless their behaviour is non-obvious

### Step 3 — Update Developer Documentation

Developer docs live in `docs/dev/`, organized by domain. Each subfolder has its own `index.md`; the top-level `index.md` and `README.md` index everything.

Place each doc in the subfolder that owns that area of the codebase:

| Change | Where it goes |
|--------|---------------|
| Cross-cutting guide (coding style, testing, build, architecture overview) | `docs/dev/guides/` |
| Core system, data model, events, i18n, logging, undo/redo, config/version policy, ADR | `docs/dev/core/` |
| View/UI architecture, ViewBase/ViewManager, containers, styling | `docs/dev/view-system/` |
| Node definition, transpiler, code generation, webview nodes | `docs/dev/nodes/` |
| Device protocol, WebSerial, device folder/tooling, device testing | `docs/dev/device-communication/` |
| Deployment system, access control, deployment APIs/integration | `docs/dev/deployment/` |
| `.mpy` precompilation, compile-profile hash | `docs/dev/mpy-precompilation/` |
| Firmware-embedded runtime compile contracts, packaging, metadata | `docs/dev/firmware-compile/` |

See [Doc Layers](./references/doc-layers.md) for the full folder map and indexing rules, and [Doc Templates](./references/doc-templates.md) for per-domain file templates.

When adding or renaming a file, update its subfolder `index.md`, the top-level `docs/dev/index.md`, and (for a new subfolder) `docs/dev/README.md`.

### Step 4 — Update User Documentation

Update user docs when the public API or CLI commands change. Describe:
- What the command/endpoint does
- All options, flags, and arguments
- Example invocations

### Step 5 — Validate

- Every public symbol in changed files has a docstring/JSDoc
- New `docs/dev/` files are indexed in both the subfolder `index.md` and the top-level `docs/dev/index.md`
- Cross-references between doc files are accurate
- No implementation details leak into user docs

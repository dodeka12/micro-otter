# Coding Style Guide

## Overview

This document defines the coding standards for the Micro-Otter project. Consistency in code style improves readability, maintainability, and reduces cognitive load when reviewing or modifying code.

---

## Python

### Style Standard

Follow **[PEP 8 – Style Guide for Python Code](https://peps.python.org/pep-0008/)** for all Python code.

**Key PEP 8 Guidelines:**

- **Indentation**: 4 spaces per level (no tabs)
- **Line Length**: Maximum 100 characters (configured in `pyproject.toml`)
- **Imports**: Grouped in order: standard library, third-party, local application
- **Naming Conventions**:
  - `snake_case` for functions, methods, variables
  - `PascalCase` for classes
  - `UPPER_CASE` for constants
  - Single leading underscore `_name` for non-public methods/attributes

### Critical Rule: Respect Encapsulation

**⚠️ NEVER access private members of other classes.**

```python
# ❌ WRONG - Accessing private members
class ViewManager:
    def __init__(self):
        self._modal_layer = document.createElement('div')

# In another class:
manager._modal_layer.appendChild(dialog)  # WRONG!

# ✅ CORRECT - Use public API
manager.showModal(dialog)  # Correct!
```

**Rationale:**
- Private members (prefixed with `_`) are implementation details
- Direct access breaks encapsulation and makes refactoring brittle
- Public methods provide stable contracts between components

**Enforcement:**
- Code reviews must reject direct access to `_private` members from external classes
- If you need access to internal state, propose a public method or property

---

## TypeScript

### Style Standard

Follow modern TypeScript conventions with consistency across the codebase:

- **Indentation**: 4 spaces per level (no tabs)
- **Line Length**: Maximum 100 characters (enforced by Prettier)
- **Semicolons**: Optional (project uses semicolons for consistency)
- **Quotes**: Single quotes `'string'` for strings (enforced by Prettier)
- **Naming Conventions**:
  - `camelCase` for functions, methods, variables
  - `PascalCase` for classes
  - `UPPER_CASE` for constants
    - Private fields: `#fieldName` (private class fields)
    - Private methods: `_methodName()` or `#methodName()`

### Critical Rule: Respect Encapsulation

**⚠️ NEVER access private members of other classes.**

```ts
// ❌ WRONG - Accessing private members
class ViewManager {
    constructor() {
        this._modalLayer = document.createElement('div');
    }
}

// In another class:
viewManager._modalLayer.appendChild(dialog);  // WRONG!

// ✅ CORRECT - Use public API
viewManager.showModal(dialog);  // Correct!
```

**Why This Matters:**

- **Private fields** (`#field`) are truly private and inaccessible outside the class
- **Underscore-prefixed members** (`_field`) are conventionally private:
  - Not part of the public API
  - May change without notice
  - Accessing them breaks encapsulation

**Examples of Private vs Public:**

```ts
class Workspace {
    #completedSources = new Set();  // Truly private (ES private field)
    _progressListener = null;       // Conventionally private
    splashScreen = null;            // Public property

    constructor() { }

    // ✅ Public method - OK to call from other classes
    load() {
        return this._loadInternal();
    }

    // ❌ Private method - DO NOT call from other classes
    _loadInternal() {
        // Implementation details
    }

    // ✅ Public method for accessing derived state
    isLoadComplete() {
        return this.#completedSources.size === 5;
    }
}

// From another class:
workspace.load();              // ✅ Correct - public API
workspace.isLoadComplete();    // ✅ Correct - public API
workspace._loadInternal();     // ❌ WRONG - private method
workspace._progressListener;   // ❌ WRONG - private property
```

**Enforcement:**
- Code reviews must reject direct access to `_private` or `#private` members from external classes
- If you need access to internal state, propose a public method or getter

### Internal Event Contract Pattern (v2)

For internal app-domain emitters, use the shared `AppEventEmitter` contract consistently:

- Use canonical APIs: `emit(eventName, payload)`, `on(eventName, listener)`, `off(eventName, listener)`, `once(eventName, listener)`
- Use wildcard listeners only when intentionally subscribing to all events: `on('*', listener)`
- Emit typed payloads only: payload objects must be `AppPayload` instances
- Avoid ad-hoc payload literals in emissions (for example `emit('x', { ... })` is not allowed)

Boundary-facing browser/event channels may continue using native `EventTarget`/`CustomEvent` contracts where required by external APIs.

### Exception Handling

Do not type caught exceptions as `any` just to access `.message`.

- Catch as `unknown` (or untyped catch variable in strict mode).
- Normalize thrown values via shared helper: `toErrorMessage(error)` from `js/core/error-utils.ts`.
- Avoid direct `error.message` unless you first narrow with a type guard.

```ts
import { toErrorMessage } from '../core/error-utils.js';

try {
    await doWork();
} catch (error) {
    this._log('operation-failed', { error: toErrorMessage(error) });
}
```

---

## General Principles

### 1. Encapsulation First

**Always prefer public methods over direct property access:**

```ts
// ❌ Avoid
const activeId = workspace.config.activeCollectionId;

// ✅ Prefer
const activeId = workspace.getActiveCollectionId();
```

**Benefits:**
- Method can validate, transform, or compute the value
- Implementation can change without breaking callers
- Clear contract between components

### 2. Minimal Public API

**Keep public APIs small and intentional:**

- Only expose what external code truly needs
- Prefer private by default; make public when necessary
- Document public methods with TSDoc/docstrings

### 3. Consistent Naming

**Private members signal intent:**

- `_helper()` - Internal helper, may change
- `#private` - Truly private, not accessible
- `publicMethod()` - Stable contract

**If a method is public but shouldn't be called by external code, document it:**

```ts
/**
 * Internal method called by ViewFactory during deserialization.
 * External code should use deserialize() instead.
 * @internal
 */
_deserializeInternal(data) { }
```

### 4. Document Public APIs

**All public methods should have clear documentation:**

```python
def get_active_collection(self):
    """
    Get the currently active collection.

    Returns:
        Collection: The active collection instance, or None if no collections exist.
    """
    pass
```

```ts
/**
 * Get the currently active collection.
 * @returns {Collection|null} The active collection instance, or null if no collections exist.
 */
getActiveCollection() { }
```

### 5. Reuse Before Writing

**Search for the existing component and its variant before writing markup or a new class.**

When the codebase already renders the thing, copy its full option set — not a subset:

- The same component (`ToolbarView`, `DataTableView`, `ButtonControl`, …) and the same host/wrapper
  structure the other call sites use.
- The same visual variant. A sibling row built with `style: 'secondary', iconOnly: true` stays
  `secondary, iconOnly`; promoting one copy to `style: 'primary'` because it is "the main action"
  makes it the only button of its kind on screen.
- The same sizing inputs (`height`, `minHeight`) and the same control wrapper class.

**Benefits:**
- Rows built from different call sites keep rendering identically
- One shared-component change improves every row at once
- Reviews compare options, not pixels

### 6. Preserve Approved Design — No Unrequested Redesign

**A code change fixes or extends what was asked; it does not re-express approved design.**

- **No visual invention.** Appearance changes go through the shared component and its documented
  options (`ButtonControl.style`, `ToolbarView.height`, theme variables). Never add a one-off
  variant, a view-scoped override of a shared class, or a hand-rolled flex row to restyle a control.
- **No re-architecting settled layout, API, or protocol.** Once a layout, API, or protocol is agreed
  (a plan phase, a documented contract, a released interface), follow-up work deletes leftovers or
  extends the existing surface. It does not add a container, slot, or signature that expresses the
  same thing differently.
- **Ask, don't redesign.** If a structural change does look warranted, state the trade-off and wait
  for agreement instead of shipping it inside "a small fix".
- **Delete the outlier, do not normalise it.** When a fix touches one copy of a pattern that drifted
  from its siblings (a variant, a height, a wrapper class), the fix makes it match. It does not keep
  the drift and document it.

---

## Logging Best Practices

### Do Not Log in High-Frequency Event Handlers

**Never add logging to event handlers that fire frequently (60+ times per second):**

```ts
// ❌ WRONG - Logging in high-frequency events
onMouseMove(event) {
    this._log('mouse-moved', 'debug', { x: event.clientX, y: event.clientY });
    // ... handle mouse move
}

onResizeObserver(entries) {
    this._log('resize-observed', 'debug', entries[0].contentRect);
    // ... handle resize
}

// ✅ CORRECT - Use browser DevTools for event debugging
onMouseMove(event) {
    // ... handle mouse move (no logging)
}

onResizeObserver(entries) {
    // ... handle resize (no logging)
}
```

**High-frequency events to avoid logging:**
- **Mouse**: `mousemove`, `mouseenter`, `mouseleave`, `mouseover`, `mouseout`
- **Touch**: `touchmove`, drag operations
- **Resize**: `ResizeObserver` callbacks, `scroll` events
- **Animation**: `requestAnimationFrame` callbacks
- **Viewport**: Pan, zoom, transform updates

**Rationale:**
- Creates performance overhead (object allocation, function calls)
- Clutters console output making debugging harder
- Browser DevTools provide better real-time event inspection

### Use Lazy Evaluation for Complex Log Data

Wrap expensive log data in functions to defer evaluation until logging is enabled:

```ts
// ❌ WRONG - Object/array always created even when logging is disabled
this._log('nodes-updated', 'debug', {
    nodes: this._nodes.map(n => n.serialize()),
    connections: this.calculateConnections()
});

// ✅ CORRECT - Lazy evaluation with function
this._log('nodes-updated', 'debug', () => ({
    nodes: this._nodes.map(n => n.serialize()),
    connections: this.calculateConnections()
}));

// ✅ ALSO CORRECT - Guard expensive operations
if (this._logEnabled('nodes-updated', 'debug')) {
    const data = {
        nodes: this._nodes.map(n => n.serialize()),
        connections: this.calculateConnections()
    };
    this._log('nodes-updated', 'debug', data);
}
```

**When to use lazy evaluation:**
- Object literals with computed properties
- Array transformations (`map`, `filter`, `reduce`)
- Method calls that perform calculations
- Nested object serialization
- String concatenation/formatting with many inputs

**When direct values are fine:**
- Simple variables (strings, numbers, booleans)
- Already-existing object references
- Single property accesses (no computation)

### Choose Appropriate Log Levels

Use log levels to indicate severity and enable production filtering:

```ts
// ✅ CORRECT - Use appropriate log levels
this._log('node-created', 'debug', nodeId);           // Development only
this._log('file-loaded', 'info', filename);           // Development only
this._log('deprecated-api', 'warn', methodName);      // Production too
this._log('operation-failed', 'error', errorDetails); // Production too
```

**Log levels:**
- **`debug`**: Detailed diagnostic information (removed in production builds)
- **`info`**: General informational messages (removed in production builds)
- **`warn`**: Warning conditions that should be investigated (kept in production)
- **`error`**: Error conditions that need attention (kept in production)

**Production builds:**
- Debug and info logs are completely eliminated via tree-shaking
- Warn and error logs remain for production debugging
- Results in smaller bundles and zero runtime overhead

### Standard Logging Pattern

Use the standard `_log()` method in all classes:

```ts
class MyClass extends ViewBase {
    someMethod() {
        // Simple values - no lazy evaluation needed
        this._log('button-clicked', 'info', buttonId);
        
        // Complex data - use lazy evaluation
        this._log('state-changed', 'debug', () => ({
            oldState: this._previousState,
            newState: this._currentState,
            delta: this.computeDelta()
        }));
    }
}
```

**See also:** [Logging System Usage Guide](../core/logging-system-usage.md) for comprehensive documentation.

---

## Tooling

### Python

**Linting and Formatting:**
- **Ruff**: Configured in `pyproject.toml` for linting and formatting
- Ruff is a declared dev dependency (`[dependency-groups].dev`), so `uv sync --all-groups`
  installs it and `uv run ruff` works without relying on the pre-commit cache
- Keep the ruff pin in lockstep with the `ruff-pre-commit` rev in `.pre-commit-config.yaml`;
  drifting versions report different findings between the editor, pre-commit and npm scripts
- Run: `npm run lint:python` (lint, equivalent to `uv run ruff check src/ tools/ tests/`)
- Run: `npm run lint:python:fix` (apply safe autofixes)
- Run: `npm run format:python` (format, equivalent to `uv run ruff format src/ tools/ tests/`)
- Run: `npm run lint:all` **before pushing**. It chains `lint` (JavaScript + TypeScript),
  `lint:python` (ruff) and `check:device-syntax` (the `mpy-cross` device gate), so one command
  covers all three trees. `npm run check:ci-local` — and therefore the `pre-push` hook — runs the
  same three gates plus the generated-file checks, which is why `lint:all` is a fast local
  equivalent rather than a separate policy

**Scope — host Python only:**

- Ruff covers host Python (`src/`, `tools/`, and `tests/`).
- `src/micro_otter/nodes/device/` is MicroPython firmware and is excluded through
  `extend-exclude` **and** `force-exclude`. Ruff cannot lint that dialect correctly:
  viper intrinsics such as `ptr16` are undefined names (`F821`), `UP038` rewrites
  `isinstance(x, (X, Y))` into PEP 604 unions that MicroPython rejects, and `B905` adds
  `zip(strict=)` which MicroPython's `zip` does not support. `force-exclude` matters
  because pre-commit passes explicit filenames, for which ruff would otherwise bypass
  exclusions.
- The same reasoning excludes the MicroPython runtime assets staged into the firmware
  (`src/micro_otter/tools/firmware_compile/runtime_assets/`) and the transpiler output
  kept at the repo root (`main_loop.py`, headed "Auto-generated MicroPython code").
- `webserver_hooks_generated.py` is generated output and is excluded for the same reason
  (it is rewritten by the webview hook generator).
- The device tree is gated by the MicroPython compiler instead — `npm run check:device-syntax`
  compiles every device source for both supported architectures (`xtensa`, `xtensawin`), writing
  bytecode to `/dev/null` and nothing into the repository. Exit code `1` means device code is
  broken; exit `2` means the gate itself is (compiler missing, unsupported `-march`, device root
  missing). See [MPY Precompilation](../mpy-precompilation/workflow.md#device-syntax-gate) and
  [the precompilation overview](../mpy-precompilation/index.md).
- Compiling is not the same as being available: `mpy-cross` resolves no attribute access, so a
  method MicroPython lacks (`str.isalnum()`, `Task.exception()`) compiles cleanly and raises
  `AttributeError` on the board. `tests/test_device_micropython_api_guard.py` is the second gate —
  it rejects those calls across the device tree. Any assumed device API must be confirmed against
  the pinned MicroPython source or docs first; see
  [Compiled Is Not Available](../mpy-precompilation/workflow.md#compiled-is-not-available-the-runtime-api-surface).

**Type Checking:**
- Not currently enforced but encouraged for new code
- Consider adding type hints for complex functions

### TypeScript

**Linting and Formatting:**
- **ESLint**: Configured in `eslint.config.js` (ESLint 9 flat config) for linting
- ESLint 9 does not read legacy `.eslintrc.*` files; `eslint.config.js` is the single source of
  truth, so do not reintroduce `.eslintrc.json` (a config test fails if it reappears)
- `@eslint/js`, `globals` and `typescript-eslint` are declared in `devDependencies` rather than
  relied on as hoisted transitive dependencies of `eslint`
- `npm run lint` runs `lint:js` **and** `lint:ts`. `lint:js` covers the frontend sources **and**
  the test files (`src/**/*.js`, `tests/**/*.js`); `lint:ts` covers `src/**/*.ts`. Adding a new
  tree means extending the matching script, not adding a third one
- Test files import sources with TypeScript-style `'.js'` specifiers (`'…/app-event.js'` resolves
  to `app-event.ts`). ESLint resolves them through `eslint-import-resolver-typescript`
  (`import/resolver.typescript` in the flat config), so do not disable `import/no-unresolved`
- `jsdoc/require-jsdoc` is off for test files: tests document behaviour, not an API. The rest of
  the jsdoc preset still applies, so a JSDoc block you do write must be complete
- Bindings that must stay unused (mock signatures, destructured fixtures) are prefixed with `_`
  (`no-unused-vars` is configured with `argsIgnorePattern: '^_'`) instead of deleting the binding
  or widening the rule
- **Prettier**: Configured in `.prettierrc` for formatting
- Run: `npm run lint` (lint)
- Run: `npm run format` (format)

**TypeScript Lint Profile:**

- `typescript-eslint` (the unified package, which bundles the parser and the plugin) applies its
  `recommended` preset to `src/**/*.ts` only. Keep it as one `devDependency`; declaring
  `@typescript-eslint/parser` or `@typescript-eslint/eslint-plugin` separately makes the parser
  version drift, and a mismatched parser mis-parses newer TypeScript syntax
- The TypeScript block is scoped by `files`; `npx eslint --print-config <file>.js` must not show an
  *enabled* `@typescript-eslint/*` rule (a config test pins this). `eslint-config-prettier` still
  lists those rules as `off` for JavaScript files — that is formatting bookkeeping, not a leak
- The core `no-unused-vars` rule is off for TypeScript and replaced by
  `@typescript-eslint/no-unused-vars` (error, `argsIgnorePattern: '^_'`): the core rule does not
  understand type-only usage and would report the same binding twice
- Parameters an override has to keep but does not use get a `_` prefix (`_container`, `_view`,
  `_event`) and the TSDoc `@param` name must follow the parameter name
- Prefer the optional catch binding (`catch { … }`) over `catch (_error) { … }` when the error value
  is unused — it needs no naming convention at all
- `@typescript-eslint/no-explicit-any` is a **warning**, not an error. The baseline is 165 sites;
  converting them to `unknown` is a per-site type decision, not a mechanical rewrite, and raising
  the rule to `error` first would only invite `eslint-disable` comments. Clearing sites is welcome;
  tightening the rule is a deliberate follow-up once the count reaches zero (tracked in the
  [lint tooling plan](../../../ldev/todos/_done/lint-tooling/overview.md))
- Type-aware linting (`recommendedTypeChecked` plus `parserOptions.projectService`) is deliberately
  **not** enabled yet: it builds a TypeScript program on every run. It is recorded as a follow-up
- **Formatting gap (intentional):** `npm run format` formats `src/**/*.js` only. The TypeScript tree
  is *linted* but not *formatted* yet, so rely on your editor's Prettier for `.ts` files. Extending
  Prettier to the 138 TypeScript files would reformat all of them at once and is a separate,
  deliberately scoped change

**Editor Integration:**
- The dev container installs the extensions these settings assume, so a fresh container needs no
  manual installation: `ms-python.python`, `ms-python.vscode-pylance`, `charliermarsh.ruff`,
  `dbaeumer.vscode-eslint`, `esbenp.prettier-vscode`, `ms-playwright.playwright` and
  `mhutchie.git-graph` (see `.devcontainer/devcontainer.json`).
- `charliermarsh.ruff` is the marketplace id, *not* the `astral-sh` GitHub org: the extension
  moved repository, not publisher. `editor.defaultFormatter` must name that id or VS Code cannot
  find the formatter. A config test pins the id and checks the container installs it.
- `.vscode/settings.json` (JSONC, comments allowed) is the single source of editor behaviour:
  Ruff formats and fixes Python on save (`source.organizeImports.ruff`, `source.fixAll.ruff`),
  Prettier formats JavaScript/TypeScript, ESLint applies `source.fixAll.eslint`.
- The editor uses the same `pyproject.toml` / `eslint.config.js` as the npm scripts, so the
  device-tree exclusions apply on save too: opening a MicroPython file will not trigger
  host-Python-only fixes such as `UP038` or `B905`.

**Tooling Follow-Ups (deliberately deferred, not silently missing):**

- **Type-aware TypeScript linting** (`recommendedTypeChecked`, `parserOptions.projectService`)
  is off: it builds a TypeScript program on every run.
- **`npm run format` covers `src/**/*.js` only.** The TypeScript tree is linted but not
  formatted; rely on editor Prettier until a dedicated formatting pass lands.
- **`@typescript-eslint/no-explicit-any` is a warning baseline** (165 sites). Clearing sites is
  welcome; promoting the rule to `error` happens once the count reaches zero.
- **The device gate compiles, it does not lint.** No MicroPython-aware linter exists, so style and
  unused names rely on review and the pytest device tests, while device-only API misuse is caught
  by `tests/test_device_micropython_api_guard.py` (plus on-device smoke runs for whatever the
  table has not been taught yet).
- **The gate covers `src/micro_otter/nodes/device/**` only.** The staged runtime assets under
  `src/micro_otter/tools/firmware_compile/runtime_assets/` compile cleanly through the same tool
  (`--device-root`) but are not wired into `check:device-syntax` yet.

---

## Enforcement

### Code Review Checklist

Reviewers must verify:

- [ ] **No private member access** from external classes
- [ ] **PEP 8 compliance** (Python)
- [ ] **Consistent naming conventions** (both languages)
- [ ] **Public API documented** with TSDoc/docstrings
- [ ] **ESLint/Ruff** passes with no errors (`@typescript-eslint/no-explicit-any` warnings are an
      accepted, documented baseline)
- [ ] **Device-tree changes pass both MicroPython gates** — `npm run check:device-syntax` and
      `pytest tests/test_device_micropython_api_guard.py` — and every newly used device API was
      confirmed against the pinned MicroPython source or docs
- [ ] **New markup reuses the existing component and its exact variant** (component, `style`,
      `iconOnly`, height, wrapper class) — or the deviation is justified in the PR description
- [ ] **No unrequested redesign** — approved layout, APIs, and visual treatment are preserved; no
      one-off variant and no view-scoped override of a shared class was added

### Automated Checks

- **Pre-commit hooks**: Run linters automatically before commits
- **CI/CD**: GitHub Actions run linters on all PRs
- **Editor integration**: Real-time feedback in VS Code

---

## Migration Notes

### Fixing Private Member Access

If you find code accessing private members:

1. **Identify the need**: Why is this access required?
2. **Propose public API**: Create a public method to expose the functionality
3. **Update callers**: Refactor to use the new public method
4. **Document**: Add TSDoc/docstring to the new method

**Example Refactoring:**

```ts
// BEFORE - Direct private access
class ViewManager {
    constructor() {
        this._modalLayer = document.createElement('div');
    }
}

// External code:
viewManager._modalLayer.appendChild(dialog);  // WRONG

// AFTER - Public API added
class ViewManager {
    constructor() {
        this._modalLayer = document.createElement('div');
    }

    /**
     * Display a modal dialog.
     * @param {ViewBase} dialog - Dialog view to display
     */
    showModal(dialog) {
        dialog.attachTo(this._modalLayer);
        this._modalLayer.style.display = 'flex';
    }
}

// External code:
viewManager.showModal(dialog);  // CORRECT
```

---

## Summary

**Key Takeaways:**

- ✅ Follow **PEP 8** for Python, modern conventions for TypeScript
- ✅ **Never access private members** (`_field`, `#field`) from external classes
- ✅ **Use public APIs** exclusively for inter-class communication
- ✅ **Document public methods** with TSDoc/docstrings
- ✅ **Keep public APIs minimal** and intentional
- ✅ **Reuse the existing component and its variant** before writing new markup
- ✅ **No unrequested redesign** — fix or extend what was asked, then stop

**When in doubt:**
- If it starts with `_` or `#`, don't access it from another class
- If you need functionality, propose a public method
- Encapsulation > convenience

---

## Related Documentation

- **[Python PEP 8](https://peps.python.org/pep-0008/)** - Official Python style guide
- **[View System Architecture](../view-system/view-system-architecture.md)** - Public API examples
- **[View-System Reuse Rules](../view-system/view-reuse-rules.md)** - Reuse-first UI, variant parity
- **[Data Backbone Architecture](../core/data-backbone-architecture.md)** - Encapsulation patterns

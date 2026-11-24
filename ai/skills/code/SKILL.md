---
name: code
description: 'Write or modify code in this project. Use when the user asks to implement a feature, write code, add a function, fix a bug, or make any code change. Ensures developer and reference documentation are consulted before coding, that existing components and their exact variants are reused instead of redesigned, and that in-code reference docs are created or updated after. Also flags when developer docs need updating after structural changes.'
---

# Code

## Purpose

This skill ensures that every coding task in this project:
1. Consults existing documentation before writing code
2. Follows the project's coding standards
3. Reuses existing components and their exact variants instead of redesigning them, and leaves
   approved layout, APIs, and visuals intact (see [Change discipline](#change-discipline--reuse-first-no-unrequested-redesign))
4. Verifies that device-tree code only calls APIs MicroPython actually has (`mpy-cross` gate plus
   an existence check against the pinned MicroPython implementation)
5. Produces in-code reference documentation for every public symbol
6. Flags (or updates) developer docs when structural changes are made

---

## Change discipline — reuse first, no unrequested redesign

These rules are part of the [Coding Style Guide](../../../docs/dev/guides/coding-style-guide.md)
(*Reuse Before Writing*, *Preserve Approved Design*). They are mandatory, not advisory.

| Rule | Do | Don't |
|------|----|-------|
| **Reuse before writing** | Search for the existing component and its call sites, then copy the full option set (`style`, `iconOnly`, `height`, wrapper class) | Write a second copy of the same row/control with a different option set |
| **No visual invention** | Change appearance through the shared component's documented options, theme variables, or its stylesheet | Add a one-off variant, a view-scoped override of a shared class, or a hand-rolled flex row |
| **No re-architecting settled layout/API** | Delete leftovers and extend the existing surface | Add a container, slot, or signature that expresses what already works |
| **Ask, don't redesign** | State the trade-off and wait for agreement | Ship a structural change inside "a small fix" |

Additional obligations:

- **Delete the outlier, do not normalise it.** When the code you are touching is the one copy that
  drifted from its siblings (a variant, a height, a wrapper class), the change makes it match.
  Preserving the drift and documenting it is the defect, not the fix.
- **Check parity, then encode it.** When two call sites must render identically, assert it in a test
  (for example comparing the rendered `classList` of both controls) so the next edit cannot drift.
- **Name the reuse target.** In the final report, say which component and variant you reused, so a
  reviewer can confirm it without diffing pixels.

---

## Procedure

### Step 1 — Read the documentation before writing code

Before writing any code, read the relevant documentation:

1. **Developer docs** (`docs/dev/`): Read any docs relevant to the area being changed. They are organized by domain — `guides/`, `core/`, `view-system/`, `nodes/`, `device-communication/`, `deployment/`, `mpy-precompilation/`, `firmware-compile/` (see the `document` skill's [Doc Layers](../document/references/doc-layers.md)). Pay attention to:
   - Component responsibilities and their intended use
   - Dependency direction and encapsulation boundaries
   - Existing patterns and conventions for this area
   - The [Coding Style Guide](../../../docs/dev/guides/coding-style-guide.md)
   - **View-system reuse:** for any UI change, read
     [View-System Reuse Rules](../../../docs/dev/view-system/view-reuse-rules.md) and reuse the
     existing `js/views/*` components + `ViewManager` dialogs. Name the component you reuse. Never
     hand-roll a dialog/overlay/table/toolbar/form, and never attach a dialog to `document.body`.

2. **Reference docs** (in-code): Read the docstrings/JSDoc of modules, classes, and functions you will call or extend. Understand the contracts (parameters, return values, raised errors) before using them.

3. **Related plan files** (the plan tree; see `AGENTS.md` → Planning): If there is an active plan for this work, read it to understand the step's scope and what must not be done yet (later phases).

Do **not** skip this step even for small changes — the developer docs exist precisely to prevent misuse and unintended coupling.

### Step 2 — Implement the code

Follow the project's coding standards:
- [Coding Style Guide](../../../docs/dev/guides/coding-style-guide.md) for naming, formatting, and encapsulation rules
- Never access private members of other classes
- Keep new code consistent with the patterns in the surrounding module
- **Match the neighbouring variant, not just the component.** Read one existing call site and copy
  its whole option set (`style`, `iconOnly`, `height`, wrapper class). A toolbar button that is
  `primary` where every sibling is `secondary` is a defect even when both are a `ButtonControl`.
- **Reuse the view system, don't hand-roll it** (`docs/dev/view-system/view-reuse-rules.md`): dialogs
  via `ViewManager.showConfirmation`/`showError`/`showInfo`/`showModal`, floating UI via
  `ViewManager.addOverlay` + `OverlayWindow`, tables via `DataTableView`, toolbars via `ToolbarView`.
  Creating a new `js/views/*` component is a structural change (Step 5) and must be general/reusable.

### Step 3 — Verify MicroPython compatibility (device tree only)

Everything under `src/micro_otter/nodes/device/` runs on MicroPython, so CPython knowledge is not
evidence that a call exists on the board. `mpy-cross` **compiles** this dialect but does not
resolve attribute access: `'x'.isalnum()` and `task.exception()` compile clean and raise
`AttributeError` at runtime. Both shipped that way and both stopped the runtime on hardware
(runtime 1.50.x, MicroPython v1.29.0, ESP32-S3).

For **every** device-tree change:

1. Run the compile gate: `npm run check:device-syntax` (checks both xtensa ABIs). It must exit
   `0`; exit `1` means device code is broken, exit `2` means the toolchain is. See
   [Device Syntax Gate](../../../docs/dev/mpy-precompilation/workflow.md#device-syntax-gate).
2. For every `str`, `bytes`, `dict`, `list`, `asyncio`, `machine`, `socket`, `time`, `json`, `os`
   or `ssl` member you assume, prove it exists — in **MicroPython**, not in CPython:
   - check the pinned implementation (`py/objstr.c`, `py/objdict.c`, `extmod/asyncio/*` in
     `micropython/micropython` at the firmware's tag), or
   - check the MicroPython documentation for that module, or
   - find an existing use of the call in this device tree or in the vendored packages.
   If none of these confirm it, do not guess: build the behaviour from primitives the runtime
   already uses (`c.isalpha() or c.isdigit()` instead of `c.isalnum()`, `await task` instead of
   `task.exception()`), or guard the call behind `hasattr()`.
3. Encode the finding in code, not in a comment: add the missing signature to `FORBIDDEN_CALLS`
   in `tests/test_device_micropython_api_guard.py` and run
   `pytest tests/test_device_micropython_api_guard.py`, so the same mistake cannot return. A call
   that is correct by design keeps a `micropython-api-ok` marker with the reason on the line.
4. Host-side code (`tools/`, the rest of `src/micro_otter/`, tests) is CPython and needs none of
   this.

This step is mandatory even for a one-line fix: what it prevents is invisible to the compiler and
fatal on the board.

### Step 4 — Write in-code reference documentation

After implementing, add or update docstrings / JSDoc for **every public symbol** touched or created:
- Python: Google-style docstrings (see the `document` skill's [Doc Layers](../document/references/doc-layers.md))
- TypeScript: JSDoc comments

Rules:
- Every public function, method, class, and module must have a docstring/JSDoc
- Every private function and method (`_name` / `#name`) must also have a docstring/JSDoc — private symbols are read by agentic tools (e.g., Cline) to understand internal structure and intent; without docs they are opaque to the agent
- Private class attributes (`_name` / `#name`) require documentation only if their purpose is non-obvious from the name alone
- Describe *what* the symbol does and *why it exists*, not *how* it works
- Document all parameters, return values, and exceptions/errors
- For private symbols, add a brief note on which callers or contexts are expected to use it (e.g., "Called only by `_process_batch` during streaming.")
- Keep private docs concise — one to three sentences is enough unless the logic is subtle

### Step 5 — Check for developer doc updates

After implementing, assess whether structural changes were made:

| Change type | Developer doc update needed? |
|-------------|------------------------------|
| New module, package, or subsystem | Yes — add/update the matching `docs/dev/` domain doc (see the `document` skill's folder map) |
| New public class or major interface | Yes — update the component's doc or add one |
| New protocol, contract, or external integration | Yes — add/update the matching `device-communication/`, `firmware-compile/`, or `deployment/` doc |
| New cross-cutting guidance or design decision | Yes — add/update the relevant `guides/` or `core/` (ADR) doc |
| Internal refactor with no interface change | No |
| Bug fix with no interface change | No |
| New private helper only | No |

If a developer doc update is needed:
- If there is an active plan with a doc update step: note it and leave the update for that step
- Otherwise: update the relevant `docs/dev/` files now, following the `document` skill

### Step 6 — Validate

Before marking work done:
- `npm run check:device-syntax` exits `0` for every device-tree change
- No device-tree symbol relies on a MicroPython API that was not confirmed against the pinned
  MicroPython source or docs (see Step 3), and new findings are encoded in
  `tests/test_device_micropython_api_guard.py`
- Every public symbol in changed files has a docstring/JSDoc
- Every private function and method in changed files has a docstring/JSDoc
- Code follows the style guide (naming, line length, import order, encapsulation)
- No private members of other classes are accessed
- New markup reuses an existing component and copies its neighbour's variant (component, `style`,
  `iconOnly`, height, wrapper class), or the deviation is justified in the change description
- No unrequested redesign: approved layout, APIs, and visual treatment are unchanged, and no one-off
  variant or view-scoped override of a shared class was introduced
- If structural changes were made, developer docs are either updated or a follow-up is clearly noted

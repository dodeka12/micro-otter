---
name: create-plan
description: 'Create implementation plans as Markdown files under the plan tree (see `AGENTS.md` → Planning for the path in this repository). Use when the user asks to plan, create a plan, write a plan, or plan out work. Supports three plan types: short (single file), multi-phase (subfolder with overview + phase files + handoff.md), and iterative (subfolder with per-iteration sub-folders). Multi-phase plans include a per-phase handoff step and a cumulative handoff.md so later phases survive context compaction. Asks the user which type to use before creating anything.'
---

# Create Plan

## When to Use

- User says "plan this", "create a plan", "write a plan", "plan out ...", or similar
- User wants to break down work into ordered implementation steps
- User wants an iterative or phased roadmap

---

## Procedure

### Step 1 — Ask the user which plan type to use

Before creating anything, ask the user to choose a plan type. Use the `ask_followup_question` tool with these three options:

| Option | Label | Description |
|--------|-------|-------------|
| `short` | Short plan | A single Markdown file with ordered implementation steps |
| `multi-phase` | Multi-phase plan | A subfolder with an overview file + one file per phase |
| `iterative` | Iterative plan | A subfolder with an overview + per-iteration subfolders, each containing phase files |

Also ask for (if not already clear from the user's request):
- The plan name (used for the file/folder name — lowercase, hyphen-separated)
- A brief description of the goal
- **Test thoroughness** — how thorough unit tests should be for each step. Present these options:

| Option | Label | Description |
|--------|-------|-------------|
| `none` | No tests | No unit tests required |
| `basic` | Basic tests | A few happy-path tests verifying the core behaviour of each step |
| `standard` | Standard tests | Happy path + key edge cases and error paths |
| `thorough` | Thorough tests | Full coverage: happy path, edge cases, error paths, and boundary conditions |

- **Developer doc updates** — whether to explicitly plan developer documentation updates. Ask:
  - `yes-inline` — include a `**Docs:**` note on each step that introduces structural changes, describing what needs updating
  - `yes-phase` — add a dedicated documentation update phase/step at the end of the plan (or each iteration) covering all structural changes
  - `no` — omit documentation update planning

### Step 2 — Gather ordering context

Before writing any plan content, think through the full scope of the work and determine a dependency order for phases and steps such that:
- No step or phase requires modifying, refactoring, or undoing work done in a prior step or phase
- Foundation work (scaffold, config, schemas, shared interfaces) comes before anything that depends on it
- Integration and wiring steps come last
- Document this ordering rationale explicitly in the overview file(s)

Also identify which steps introduce **structural changes** that require developer documentation updates:
- New module, package, or subsystem
- New public interface or significantly changed one
- New protocol, contract, or external integration
- New cross-cutting guidance, design decision, or ADR
- New `js/views/*` view component (see the view-system reuse rule below)

For **every UI step**, name the exact existing view-system component(s) to reuse — with file paths
(e.g. `ViewManager.showConfirmation` in `view-manager.ts`, `DataTableView` in `data-table-view.ts`,
`ViewManager.addOverlay` + `OverlayWindow` in `overlay-window.ts`). Do not write "use the view
system" generically, and do not plan a new view class or hand-rolled DOM unless no existing component
provides the behaviour — in which case the new component must be general/reusable and is itself a
structural change. See `docs/dev/view-system/view-reuse-rules.md`.

When a step adds to a row/toolbar/tree that already exists, also name the **variant** the new element
must match (for example "`ButtonControl` with `iconOnly: true` and `style: 'secondary'`, matching
`firmware-packages-panel.ts`"). A step must never plan to restyle or re-architect an approved layout:
it deletes leftovers or extends the existing surface. See the [Coding Style Guide](../../../docs/dev/guides/coding-style-guide.md)
sections *Reuse Before Writing* and *Preserve Approved Design*.

For **multi-phase** plans, treat every phase boundary as a context boundary: a fresh agent must be
able to continue from `overview.md` + `handoff.md` + the next phase file alone. Design phases so no
later phase depends on facts that exist only in chat. In particular, identify compaction-sensitive
facts that must be recorded at each phase end: exact test file names, helper/fixture names,
generated-code strings, migration/demo-transpile results, deviations, and the exact commands that
passed. See [Phase Handoff](./references/phase-handoff.md).

Use this list when applying the chosen developer doc update strategy in Step 3.

### Step 3 — Create the plan files

Follow the structure rules for the chosen plan type (see [Plan Structures](./references/plan-structures.md)) and apply the templates from [Plan Templates](./references/plan-templates.md).

Every overview and phase file **must** contain the developer docs reminder block
(see templates), which includes the mandatory **view-system reuse** reminder and the mandatory
**change discipline** callout (reuse the existing component and variant; no unrequested redesign;
the linked Coding Style Guide is imperative, not advisory). `handoff.md` links back to the overview
instead of repeating the block. Every UI step **must** name the exact
component + file path it reuses, plus the variant it must match, per
`docs/dev/view-system/view-reuse-rules.md` and `docs/dev/guides/coding-style-guide.md`.

Every step (in short plan files and phase files) **must** include a `**Tests:**` sub-section describing what unit tests to write for that step, scaled to the chosen test thoroughness level:
- `none` — omit the `**Tests:**` sub-section entirely
- `basic` — describe 1–3 happy-path test cases
- `standard` — describe happy-path + key edge cases and error paths
- `thorough` — describe full test coverage: happy path, edge cases, error paths, and boundary conditions

Apply the chosen developer doc update strategy:
- `yes-inline` — for every step identified in Step 2 as introducing a structural change, add a `**Docs:**` sub-section naming the specific `docs/dev/` files to create or update (using the domain folders: `guides/`, `core/`, `view-system/`, `nodes/`, `device-communication/`, `deployment/`, `mpy-precompilation/`, `firmware-compile/`) and what to cover
- `yes-phase` — add a final dedicated step (short plan) or phase (multi-phase / iterative) titled **"Update Developer Documentation"** that lists all structural changes made in the plan and the `docs/dev/` files to create or update
- `no` — omit documentation planning entirely

For **multi-phase** plans only, additionally:

- Create `handoff.md` in the plan folder using the template in
  [Phase Handoff](./references/phase-handoff.md): a context protocol, a status table listing every
  phase as `Not started`, and empty phase sections.
- Give every phase file an `## Inputs From Previous Phase` section and a final
  `### <N>.<M> — Record phase handoff` step, exactly as specified in that reference.
- Link `handoff.md` from the overview.
- Leave the handoff sections empty; the executor fills them at each phase end. Never pre-fill
  results.

### Step 4 — Validate

After creating all files, confirm:
- All cross-references between files are correct (overview → phase, phase → overview)
- Every overview and phase file contains the developer docs reminder block, including the
  view-system reuse reminder and the change-discipline callout, with relative links that resolve
  from that file's location; `handoff.md` links to the overview instead
- Every UI step names the reusable component, its file path, and the variant to match
- Steps and phases are free of out-of-order dependencies
- File names follow the naming conventions
- Multi-phase plans: `handoff.md` exists and is linked from the overview; every phase file has an
  `## Inputs From Previous Phase` section and a final handoff step; the handoff status table lists
  every phase as `Not started` with no invented results; all relative links (including `handoff.md`)
  resolve

---

## Talking to the user about the plan

The plan files are written for the executing agent, so they carry exact paths, names, and commands.
What you *say* about the plan is not. Ordering rationale, design questions, trade-offs, risks, and the
"here is what I created" summary follow `AGENTS.md` → *Reporting to the user*.

- Lead with what the plan achieves and how many phases it has, then the one or two decisions that need
  agreement. Name a choice as a consequence the user can judge, with its alternatives.
- Put a question to the user as one question with plain-word options — never as file names, module
  names, or commands.
- When a step's scope is a judgement call, describe its effect on the outcome, not the code it touches.
- Ask for a confirmation only when the answer changes the plan; everything else is a decision you
  record in the plan and report.
- Keep the plan reference-rich and the chat reference-free. The plan file and `handoff.md` are the
  durable record; the conversation is the gist.

---
name: implement-plan
description: 'Implement a plan from the plan tree (see `AGENTS.md` → Planning for the path in this repository). Use when the user asks to implement a plan, execute a plan, work through a plan, or carry out planned steps. Reads the plan file(s), asks how much to implement (single step, full phase, or all phases), asks for full-plan runs whether to compact context after each phase or run continuously, then implements each step sequentially — marking it complete, committing after each one, and writing the cumulative handoff.md at each phase end.'
---

# Implement Plan

## When to Use

- User says "implement the plan", "execute the plan", "work through the plan", "carry out step X", or similar
- User wants one or more steps from a plan in the plan tree to be implemented

---

## Procedure

### Step 1 — Locate and read the plan

If the user did not specify a plan file or folder, list the plan tree (`AGENTS.md` → Planning names its
path) and ask them which plan to work on.

Once identified, read the relevant plan file(s):

- **Short plan**: read the single `.md` file
- **Multi-phase plan**: read `overview.md`, `handoff.md` (all completed phase sections), and the relevant phase file(s)
- **Iterative plan**: read the top-level `overview.md`, the relevant iteration `overview.md`, and the relevant phase file(s)

If a multi-phase plan has no `handoff.md` (a plan written before the handoff protocol), do **not**
invent prior results. Initialize the scaffold from the create-plan skill's phase-handoff reference,
mark any already-completed phases from their step markers where they are unambiguous, and ask the
user to confirm anything reconstructed from git history.

Identify all steps that are **not yet marked complete**. A step is complete when its heading line contains a completion marker — see [Completion Marking](./references/completion-marking.md).

### Step 2 — Ask how much to implement

Use the `ask_followup_question` tool to ask the user:

| Option | Label | Description |
|--------|-------|-------------|
| `step` | Single step | Implement one specific step, then stop |
| `phase` | Full phase | Implement every remaining step in one phase |
| `all` | All phases | Implement every remaining step in the entire plan |

If the user chose **single step**, also ask which step to implement (show a list of incomplete steps from the plan).

If the user chose **full phase** and the plan has multiple phases, ask which phase.

### Step 3 — Choose the context strategy (full-plan runs)

If the user chose **all phases**, or any run that will cross at least one phase boundary, ask how to
handle context between phases before starting:

| Option | Label | Description |
|--------|-------|-------------|
| `per-phase-compact` | Compact after each phase | Stop at each phase boundary after the handoff is committed so the user can run `/smol` or `/newtask`, then continue. Safest for long plans. |
| `continuous` | Run continuously | Do not stop at phase boundaries; rely on the harness's auto-compaction. `handoff.md` is still written at each phase end so context can be rebuilt. |

Record the choice and honour it for the whole run. For **single step** and **full phase** scopes, no
question is needed: if a phase completes, write its handoff section, then stop as requested.

### Step 4 — Implement steps sequentially

For each step in scope, follow this loop:

1. **Re-establish context** — at the start of each phase, re-read `overview.md` → **Locked Decisions**, `handoff.md` → completed sections, and the phase file. Do not rely on chat history or a compacted summary for exact contracts.
2. **Read the step** — understand exactly what it requires. Re-read any relevant plan context (goal, ordering rationale, prior steps) to avoid implementing something that conflicts with earlier work.
3. **Consult developer docs and the plan's callouts** — before writing any code, review the relevant `docs/dev/` docs (especially the coding style guide and the domain docs for the area being changed) as instructed in the plan file, and obey that file's **view-system reuse** and **change discipline** callouts: reuse the component and exact variant the step names, and do not redesign approved layout, APIs, or visuals. See the `code` skill.
4. **Implement the step** — make the code changes, create files, run commands, etc., as the step describes.
5. **Verify** — confirm the step's stated goal is met (e.g., run tests, check that the output exists, verify the service starts).
6. **Mark the step complete** — edit the plan file to mark the step done. See [Completion Marking](./references/completion-marking.md).
7. **Commit** — stage all changed files (plan file + implementation files) and create a git commit. See [Commit Convention](./references/commit-convention.md).
8. **Continue** — move to the next step. If a step fails, stop and report the failure; do not mark it complete and do not proceed to subsequent steps.

When the loop reaches the **end of a phase** and more phases remain in scope, perform the phase
boundary procedure:

1. Run the phase's **Validation** gate exactly as written.
2. Write or update the phase section in `handoff.md` (Status, Changed files, Stable contracts, Tests, Deviations, Carry-forward, Open issues).
3. Mark the phase's final `Record phase handoff` step ✓ only after the handoff section is written and committed; mark the overview phase row ✓ only if every step in the phase, including the handoff step, is ✓.
4. Commit the implementation files, plan files, and `handoff.md` together.
5. If the chosen strategy is `per-phase-compact`, ask the user to run `/smol` (continue in this task) or `/newtask` (fresh task), then re-read `overview.md`, `handoff.md`, and the next phase file before continuing.
6. If the chosen strategy is `continuous`, re-read `overview.md`, `handoff.md`, and the next phase file and continue without stopping.

If a phase **fails** validation, write a `blocked` handoff section recording the failing step and
command output, do not mark the handoff step or phase complete, and stop before the next phase.

### Step 5 — Report

After the loop finishes (or stops on failure), summarise:

- Which steps were completed
- Which step failed (if any) and why
- Which phase handoff sections were written and their status
- Whether context was compacted (`/smol`/`/newtask`) and where the run stopped
- What remains to be done

---

## Context Boundaries and Compaction

- Multi-phase plans use `handoff.md` as the durable cross-phase state. It is the authority across context boundaries; chat history is not.
- **Cline**: explicit compaction is user-entered via `/smol` (alias `/compact`) or `/newtask`. The agent cannot invoke these tools. When the strategy is `per-phase-compact`, write and commit the handoff, then ask the user to run one of them and confirm before continuing.
- After compaction or a new task, re-read `overview.md` → **Locked Decisions**, `handoff.md`, and the next phase file before editing. Do not trust a compacted summary.
- If the harness auto-compacts mid-phase, re-read the same three files to restore exact contracts before continuing.

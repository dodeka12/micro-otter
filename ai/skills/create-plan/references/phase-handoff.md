# Phase Handoff

The single, cumulative context bridge for a multi-phase plan. It lets a fresh or compacted context
continue the plan from durable files instead of chat history.

## When it applies

Multi-phase plans only. Short plans have no phase boundary; iterative plans keep their existing
iteration-overview structure.

## Location and lifecycle

```
<plan-tree>/<plan-name>/handoff.md
```

- `create-plan` creates it with a context protocol, a status table listing every phase as
  `Not started`, and no pre-filled results.
- Each phase appends or updates its own `## Phase N — <title>` section at the phase end.
- The executor commits it with the phase-completion commit.
- It moves with the plan to `<plan-tree>/_done/` when the plan completes.

## Reading order (every phase)

1. `overview.md` → **Locked Decisions**
2. `handoff.md` → status table and the completed phase sections
3. the phase file being implemented

Chat history and compacted summaries are not authoritative. If a stable contract from an earlier
phase is missing or unclear, stop and record an open issue rather than guessing.

## `handoff.md` template

```markdown
# <Plan Title> — Phase Handoff

> Context bridge for this plan. Read `overview.md` → **Locked Decisions** first, then the completed
> sections below, then the phase file you are about to implement. Chat history is not authoritative.

## Status

| Phase | State | Notes |
|-------|-------|-------|
| 1 | Not started | |
| 2 | Not started | |
| ... | ... | ... |

## Phase <N> — <Phase Title>

**State:** `complete` | `blocked`

**Changed files:** exact paths created, modified, renamed, or deleted.

**Stable contracts:** exact type ids, function/helper names, generated-code strings, schema shapes,
and file paths a later phase must reuse verbatim.

**Tests:** test file names, fixture/helper names, and the exact commands run with pass/fail/skipped
results.

**Deviations:** any divergence from the plan and why, or `None`.

**Carry-forward:** facts the next phase must use.

**Open issues:** unresolved questions or risks that do not block this phase, or `None`.
```

## Status values

- `Not started` — phase has not begun.
- `In progress` — phase steps are being implemented.
- `Complete` — every step, including the final handoff step, is ✓ and validation passed.
- `Blocked` — validation or a step failed; the failure is recorded in the phase section.

## Phase file additions (`create-plan` must add these)

### `## Inputs From Previous Phase`

Place it between the phase's `## Goal` and `## Steps`.

- Phase 1: no prior phases — read `overview.md` → **Locked Decisions**, then this file.
- Phases 2+: read `overview.md` → **Locked Decisions**, then `handoff.md` → the completed
  Phases 1..N-1 sections, then this file.

Every inputs section must state that chat history is not a source of truth.

### Final `### <N>.<M> — Record phase handoff` step

The last numbered step under `## Steps`, immediately before the `## Validation` section. It must:

1. Run the phase's `## Validation` gate exactly as written.
2. Write or update the phase section in `handoff.md` with every field above.
3. Be marked ✓ only after the handoff section is written and committed.
4. Be left unmarked and the phase marked `blocked` if any validation command fails.

## Writing rules

- Write exact, reusable facts, not narrative. A later agent must be able to resume without redoing
  discovery.
- Record the compaction-sensitive details explicitly: test file names, fixture/helper names,
  generated-code strings, migration/demo-transpile results, deviations, and the exact commands that
  passed.
- Do not invent results. An unrun command or unknown state is recorded as such, never as a pass.
- Do not paste full diffs or logs; link to files and commits.
- Corrections to an earlier section are recorded in the current phase section, not by silently
  editing history.

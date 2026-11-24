# Completion Marking

Steps are marked complete by appending ` ✓` to the step heading line in the plan file.

## Short Plan and Phase File Steps

Before:
```markdown
### 2 — Set up database schema
```

After:
```markdown
### 2 — Set up database schema ✓
```

## Phase Rows in Overview Files

When all steps in a phase are complete, also mark the phase row in the overview table by appending ` ✓` to the phase title cell:

Before:
```markdown
| 2 | [Database Schema](./phase-2-database-schema.md) | Define models and migrations |
```

After:
```markdown
| 2 | [Database Schema](./phase-2-database-schema.md) ✓ | Define models and migrations |
```

## Rules

- Only mark a step complete **after** it has been fully implemented and verified.
- Do **not** mark a step complete if implementation failed or is only partial.
- Mark the step in the file where the step is defined (phase file or short plan file).
- Update the overview table row only when the **entire phase** is complete (all steps in that phase are marked ✓).
- A phase is complete only when its final `Record phase handoff` step is ✓ and its `handoff.md` section records `complete`.
- If validation failed, leave the handoff step unmarked and record `blocked` in `handoff.md`; do not mark the overview row ✓.
- For iterative plans, also update the iteration overview table when the entire phase is done, and the top-level overview iteration row when all phases in that iteration are done.

## Phase Handoff Status

The `handoff.md` status table and each phase section mirror the step markers:

- `Not started` — the phase has not begun.
- `In progress` — its steps are being implemented.
- `Complete` — every step, including the handoff step, is ✓ and validation passed.
- `Blocked` — validation or a step failed; the failure is recorded in the phase section.

Update the status table when a phase begins and when its handoff section is written. The overview
phase row is marked ✓ only when the handoff status is `Complete`.

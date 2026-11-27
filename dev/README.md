# `dev/` — plan scaffold

This directory holds this repository's implementation plans. A plan is a folder under `dev/todos/`:
one `overview.md` stating the goal and the locked decisions, then one file per phase. Finished plans
move to `dev/todos/_done/`. The sibling folders hold pre-plan notes
(`dev/ideas/`), node design documents (`dev/nodes/`), manual test scripts (`dev/manual_tests/`) and
small development utilities (`dev/tools/`).

## Proposing a plan

Open an issue, or open a pull request that adds a plan folder under `dev/todos/`. Keep the change
limited to the new plan; the tracked folders are there to hold it.

## Plan format

The plan format, the three plan shapes, the completion markers, and the phase-handoff rules live in
[`AGENTS.md`](../AGENTS.md) → **Planning**. The
[create-plan skill](../ai/skills/create-plan/SKILL.md) is the authoring guide, and
[implement-plan](../ai/skills/implement-plan/SKILL.md) covers executing one.

## Contents

`dev/ideas/`, `dev/todos/`, `dev/todos/_done/`, `dev/nodes/`, `dev/manual_tests/`, and `dev/tools/`
are tracked folders, most of them holding only a `.gitkeep`. Do not add generated files here.

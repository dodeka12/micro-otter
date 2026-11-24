# `dev/` — plan scaffold

This directory is a **scaffold**, not the maintainers' working plan tree. The maintainers keep their
working plans in the private development repository under `ldev/`; this directory exists so the same
tree layout is published here and every relative link resolves in both repositories. It publishes
verbatim — there is no generator behind it.

## Proposing a plan

Open an issue, or open a pull request that adds a plan file under `dev/todos/`. Keep the change
limited to the new plan; the tracked empty folders are there to hold it.

## Plan format

The plan format, the three plan shapes, the completion markers, and the phase-handoff rules live in
[`AGENTS.md`](../AGENTS.md) → **Planning**.

## Contents

`dev/ideas/`, `dev/todos/`, `dev/todos/_done/`, `dev/nodes/`, `dev/manual_tests/`, and `dev/tools/`
are tracked empty folders (each holding a `.gitkeep`). Do not add generated files here.

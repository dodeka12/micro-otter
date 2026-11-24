# Plan Structures

`<plan-tree>` below is the plan directory of the current repository. `AGENTS.md` → **Planning** names
the path for this tree; both supported layouts (private and published) place plans at
`<plan-tree>/<plan-name>/…`, so the relative link depth below is identical.

## Naming Conventions

- Plan names: lowercase, hyphen-separated (e.g., `email-pipeline`, `auth-module`)
- Phase file names: `phase-<N>-<short-description>.md` (e.g., `phase-1-scaffold.md`)
- Iteration folder names: `iteration-<N>` (e.g., `iteration-1`)

---

## Short Plan

A single Markdown file for small, self-contained work that can be expressed as a flat list of ordered steps.

**Location:** `<plan-tree>/<plan-name>.md`

**Use when:** The work fits in one coherent sequence with no need to split into major phases.

---

## Multi-Phase Plan

A subfolder containing an overview file, a cumulative handoff file, and one file per phase. The
handoff protocol below applies to multi-phase plans only; short and iterative plans keep their
existing structures.

**Location:**
```
<plan-tree>/<plan-name>/
  overview.md
  handoff.md
  phase-1-<description>.md
  phase-2-<description>.md
  ...
```

**Rules:**
- `overview.md` lists all phases in a table, links to each phase file, and links to `handoff.md`
- `handoff.md` is the cumulative context bridge; it is created with a status table and empty phase
  sections, and each phase appends its section at its end (see [Phase Handoff](./phase-handoff.md))
- Each phase file links back to `overview.md` and `handoff.md`
- Every phase file has an `## Inputs From Previous Phase` section and a final
  `### <N>.<M> — Record phase handoff` step
- Phases are ordered by dependency: no phase modifies outputs of a prior phase
- The overview includes an **Ordering Rationale** section explaining why the phases are in this order

---

## Iterative Plan

A subfolder for work that evolves across multiple iterations. The full scope cannot be determined upfront; the overview is updated as the plan develops.

**Location:**
```
<plan-tree>/<plan-name>/
  overview.md
  iteration-1/
    overview.md
    phase-1-<description>.md
    phase-2-<description>.md
    ...
  iteration-2/
    overview.md
    phase-1-<description>.md
    ...
```

**Rules:**
- The top-level `overview.md` describes the overall intent and known goals; it is updated each iteration
- Each `iteration-N/` folder has its own `overview.md` listing the iteration's phases with links to phase files
- Each phase file links back to its iteration overview
- Each iteration overview links back to the top-level overview
- Phases within each iteration are ordered by dependency
- Each iteration overview includes an **Ordering Rationale** section
- Later iterations must not require refactoring outputs of completed iterations

---

## Cross-Reference Requirements

| File | Must link to |
|------|-------------|
| Multi-phase overview | Each phase file, and `handoff.md` |
| `handoff.md` (multi-phase) | Each phase file, and `overview.md` |
| Phase file (multi-phase) | `overview.md`, and `handoff.md` |
| Iterative top-level overview | Each iteration folder's `overview.md` |
| Iteration overview | Each phase file in that iteration, and the top-level `overview.md` |
| Phase file (iterative) | Its iteration's `overview.md` |

# Plan Templates

All plan files must include the **Developer Docs Reminder** block shown below.

---

## Developer Docs Reminder Block

Include this block at the top of every plan file (overview and phase files), immediately after the title:

```markdown
> **Always consider the developer docs** under `docs/dev/` when implementing any step in this plan.  
> In particular: the [Coding Style Guide](../../docs/dev/guides/coding-style-guide.md).  
> Also review any relevant docs found there, organized by domain (guides, core, view-system, nodes, device-communication, deployment, mpy-precompilation, firmware-compile).
>
> **View-system reuse (mandatory for UI steps).** Reuse existing `js/views/*` components and
> `ViewManager` dialogs; name the exact component + file path in every step. Never hand-roll a
> dialog/overlay/table/toolbar, and never attach a dialog to `document.body`. See the
> [View-System Reuse Rules](../../docs/dev/view-system/view-reuse-rules.md).
>
> **Change discipline (mandatory).** Reuse the existing component and its exact variant before
> writing new markup, and do not redesign approved layout, APIs, or visuals: the step changes
> only what it names, and any structural change must be stated in the step itself. The
> [Coding Style Guide](../../docs/dev/guides/coding-style-guide.md) sections *Reuse Before
> Writing* and *Preserve Approved Design* are imperative, not advisory.
```

Adjust the relative path to `docs/dev/` based on the file's location in the plan tree
(`<plan-tree>`; `AGENTS.md` → **Planning** names its path). Every link in the block uses the same
prefix — including both Coding Style Guide links and the view-system link.

| File location | Correct relative path prefix |
|---------------|------------------------------|
| `<plan-tree>/<plan>.md` | `../../docs/dev/` |
| `<plan-tree>/<plan>/overview.md` | `../../../docs/dev/` |
| `<plan-tree>/<plan>/<phase>.md` | `../../../docs/dev/` |
| `<plan-tree>/<plan>/iteration-N/overview.md` | `../../../../docs/dev/` |
| `<plan-tree>/<plan>/iteration-N/<phase>.md` | `../../../../docs/dev/` |

---

## Short Plan Template

```markdown
# <Plan Title>

> **Always consider the developer docs** under `docs/dev/` when implementing any step in this plan.  
> In particular: the [Coding Style Guide](../../docs/dev/guides/coding-style-guide.md).  
> Also review any relevant docs found there, organized by domain (guides, core, view-system, nodes, device-communication, deployment, mpy-precompilation, firmware-compile).
>
> **View-system reuse (mandatory for UI steps).** Reuse existing `js/views/*` components and
> `ViewManager` dialogs; name the exact component + file path in every step. Never hand-roll a
> dialog/overlay/table/toolbar, and never attach a dialog to `document.body`. See the
> [View-System Reuse Rules](../../docs/dev/view-system/view-reuse-rules.md).
>
> **Change discipline (mandatory).** Reuse the existing component and its exact variant before
> writing new markup, and do not redesign approved layout, APIs, or visuals: the step changes
> only what it names, and any structural change must be stated in the step itself. The
> [Coding Style Guide](../../docs/dev/guides/coding-style-guide.md) sections *Reuse Before
> Writing* and *Preserve Approved Design* are imperative, not advisory.

## Goal

<One paragraph describing what this plan delivers and why.>

---

## Steps

### 1 — <Step title>

<What to do and why. Be specific enough that an implementer can act without guessing.>

**Tests:** <Describe what unit tests to write for this step, scaled to the agreed thoroughness level. Omit this sub-section entirely if test thoroughness is `none`.>

**Docs:** <If this step introduces a structural change (new module, interface, protocol, etc.), describe which `docs/dev/` files to create or update and what to cover. Omit if `yes-inline` was not chosen, or if the step has no structural impact.>

### 2 — <Step title>

<...>

**Tests:** <...>

**Docs:** <...>

---

## Ordering Rationale

<Explain why the steps are in this order and confirm that no step requires changes to a prior step's outputs.>
```

---

## Multi-Phase Plan: Overview Template

```markdown
# <Plan Title> — Overview

> **Always consider the developer docs** under `docs/dev/` when implementing any step in this plan.  
> In particular: the [Coding Style Guide](../../../docs/dev/guides/coding-style-guide.md).  
> Also review any relevant docs found there, organized by domain (guides, core, view-system, nodes, device-communication, deployment, mpy-precompilation, firmware-compile).
>
> **View-system reuse (mandatory for UI steps).** Reuse existing `js/views/*` components and
> `ViewManager` dialogs; name the exact component + file path in every step. Never hand-roll a
> dialog/overlay/table/toolbar, and never attach a dialog to `document.body`. See the
> [View-System Reuse Rules](../../../docs/dev/view-system/view-reuse-rules.md).
>
> **Change discipline (mandatory).** Reuse the existing component and its exact variant before
> writing new markup, and do not redesign approved layout, APIs, or visuals: the step changes
> only what it names, and any structural change must be stated in the step itself. The
> [Coding Style Guide](../../../docs/dev/guides/coding-style-guide.md) sections *Reuse Before
> Writing* and *Preserve Approved Design* are imperative, not advisory.

## Goal

<One paragraph describing what this plan delivers and why.>

## Deliverables

- <Deliverable 1>
- <Deliverable 2>

---

## Context Protocol

Each phase ends by recording its outcome in [handoff.md](./handoff.md), the single cumulative
context bridge for this plan. Before implementing any phase, read `overview.md` → **Locked
Decisions**, then the completed sections in `handoff.md`, then the phase file itself. Chat history
is not authoritative across phases.

---

## Phases

| # | Phase | Description |
|---|-------|-------------|
| 1 | [<Phase 1 title>](./phase-1-<description>.md) | <Short description> |
| 2 | [<Phase 2 title>](./phase-2-<description>.md) | <Short description> |

**Context handoff:** [handoff.md](./handoff.md)

---

## Ordering Rationale

<Explain why phases are in this order. Confirm no phase requires modifying outputs of a prior phase.>
```

---

## Multi-Phase Plan: Phase File Template

```markdown
# Phase <N> — <Phase Title>

← [Back to Overview](./overview.md)

> **Always consider the developer docs** under `docs/dev/` when implementing any step in this plan.  
> In particular: the [Coding Style Guide](../../../docs/dev/guides/coding-style-guide.md).  
> Also review any relevant docs found there, organized by domain (guides, core, view-system, nodes, device-communication, deployment, mpy-precompilation, firmware-compile).
>
> **View-system reuse (mandatory for UI steps).** Reuse existing `js/views/*` components and
> `ViewManager` dialogs; name the exact component + file path in every step. Never hand-roll a
> dialog/overlay/table/toolbar, and never attach a dialog to `document.body`. See the
> [View-System Reuse Rules](../../../docs/dev/view-system/view-reuse-rules.md).
>
> **Change discipline (mandatory).** Reuse the existing component and its exact variant before
> writing new markup, and do not redesign approved layout, APIs, or visuals: the step changes
> only what it names, and any structural change must be stated in the step itself. The
> [Coding Style Guide](../../../docs/dev/guides/coding-style-guide.md) sections *Reuse Before
> Writing* and *Preserve Approved Design* are imperative, not advisory.

## Goal

<What this phase delivers. How the system state changes by the end of this phase.>

---

## Inputs From Previous Phase

<Phase 1: no prior phases — read `overview.md` → **Locked Decisions**, then this file. Phases 2+:
read `overview.md` → **Locked Decisions**, then `handoff.md` → the completed Phases 1..N-1 sections,
then this file. Do not rely on chat history.>

---

## Steps

### <N>.1 — <Step title>

<Detailed description of what to implement.>

**Tests:** <Describe what unit tests to write for this step, scaled to the agreed thoroughness level. Omit this sub-section entirely if test thoroughness is `none`.>

**Docs:** <If this step introduces a structural change (new module, interface, protocol, etc.), describe which `docs/dev/` files to create or update and what to cover. Omit if `yes-inline` was not chosen, or if the step has no structural impact.>

### <N>.2 — <Step title>

<...>

**Tests:** <...>

**Docs:** <...>

### <N>.<M> — Record phase handoff

Run the [Validation](#validation) gate below, then update [handoff.md](./handoff.md) with this
phase's section. Do not mark this step complete until the handoff section is written and committed.
If any validation command fails, record the failure and mark the phase `blocked` instead.

Then report the phase to the user in plain language, as `AGENTS.md` → *Reporting to the user*
requires: the outcome first, then what remains. Paths, hashes, and command results stay in the
handoff section.

---

## Validation

- <Exact commands that gate this phase. The handoff step records their results.>
```

The handoff file itself and the exact section fields live in
[Phase Handoff](./phase-handoff.md).

---

## Iterative Plan: Top-Level Overview Template

```markdown
# <Plan Title> — Overview

> **Always consider the developer docs** under `docs/dev/` when implementing any step in this plan.  
> In particular: the [Coding Style Guide](../../../docs/dev/guides/coding-style-guide.md).  
> Also review any relevant docs found there, organized by domain (guides, core, view-system, nodes, device-communication, deployment, mpy-precompilation, firmware-compile).
>
> **View-system reuse (mandatory for UI steps).** Reuse existing `js/views/*` components and
> `ViewManager` dialogs; name the exact component + file path in every step. Never hand-roll a
> dialog/overlay/table/toolbar, and never attach a dialog to `document.body`. See the
> [View-System Reuse Rules](../../../docs/dev/view-system/view-reuse-rules.md).
>
> **Change discipline (mandatory).** Reuse the existing component and its exact variant before
> writing new markup, and do not redesign approved layout, APIs, or visuals: the step changes
> only what it names, and any structural change must be stated in the step itself. The
> [Coding Style Guide](../../../docs/dev/guides/coding-style-guide.md) sections *Reuse Before
> Writing* and *Preserve Approved Design* are imperative, not advisory.

## Goal

<Describe the overall intent and known goals. This file will be updated as the plan develops iteratively.>

---

## Iterations

| # | Iteration | Goal |
|---|-----------|------|
| 1 | [Iteration 1 — <title>](./iteration-1/overview.md) | <Short goal description> |

*This table is updated as new iterations are planned.*
```

---

## Iterative Plan: Iteration Overview Template

```markdown
# Iteration <N> — <Iteration Title>

← [Back to Plan Overview](../overview.md)

> **Always consider the developer docs** under `docs/dev/` when implementing any step in this plan.  
> In particular: the [Coding Style Guide](../../../../docs/dev/guides/coding-style-guide.md).  
> Also review any relevant docs found there, organized by domain (guides, core, view-system, nodes, device-communication, deployment, mpy-precompilation, firmware-compile).
>
> **View-system reuse (mandatory for UI steps).** Reuse existing `js/views/*` components and
> `ViewManager` dialogs; name the exact component + file path in every step. Never hand-roll a
> dialog/overlay/table/toolbar, and never attach a dialog to `document.body`. See the
> [View-System Reuse Rules](../../../../docs/dev/view-system/view-reuse-rules.md).
>
> **Change discipline (mandatory).** Reuse the existing component and its exact variant before
> writing new markup, and do not redesign approved layout, APIs, or visuals: the step changes
> only what it names, and any structural change must be stated in the step itself. The
> [Coding Style Guide](../../../../docs/dev/guides/coding-style-guide.md) sections *Reuse Before
> Writing* and *Preserve Approved Design* are imperative, not advisory.

## Goal

<What this iteration delivers. Each iteration should produce a fully functional increment.>

## Deliverables

- <Deliverable 1>
- <Deliverable 2>

---

## Phases

| # | Phase | Description |
|---|-------|-------------|
| 1 | [<Phase 1 title>](./phase-1-<description>.md) | <Short description> |
| 2 | [<Phase 2 title>](./phase-2-<description>.md) | <Short description> |

---

## Ordering Rationale

<Explain why phases are in this order. Confirm no phase requires modifying outputs of a prior phase.>
```

---

## Iterative Plan: Phase File Template

```markdown
# Phase <N> — <Phase Title>

← [Back to Iteration <N> Overview](./overview.md)

> **Always consider the developer docs** under `docs/dev/` when implementing any step in this plan.  
> In particular: the [Coding Style Guide](../../../../docs/dev/guides/coding-style-guide.md).  
> Also review any relevant docs found there, organized by domain (guides, core, view-system, nodes, device-communication, deployment, mpy-precompilation, firmware-compile).
>
> **View-system reuse (mandatory for UI steps).** Reuse existing `js/views/*` components and
> `ViewManager` dialogs; name the exact component + file path in every step. Never hand-roll a
> dialog/overlay/table/toolbar, and never attach a dialog to `document.body`. See the
> [View-System Reuse Rules](../../../../docs/dev/view-system/view-reuse-rules.md).
>
> **Change discipline (mandatory).** Reuse the existing component and its exact variant before
> writing new markup, and do not redesign approved layout, APIs, or visuals: the step changes
> only what it names, and any structural change must be stated in the step itself. The
> [Coding Style Guide](../../../../docs/dev/guides/coding-style-guide.md) sections *Reuse Before
> Writing* and *Preserve Approved Design* are imperative, not advisory.

## Goal

<What this phase delivers within the iteration.>

---

## Steps

### <N>.1 — <Step title>

<Detailed description.>

**Tests:** <Describe what unit tests to write for this step, scaled to the agreed thoroughness level. Omit this sub-section entirely if test thoroughness is `none`.>

**Docs:** <If this step introduces a structural change (new module, interface, protocol, etc.), describe which `docs/dev/` files to create or update and what to cover. Omit if `yes-inline` was not chosen, or if the step has no structural impact.>

### <N>.2 — <Step title>

<...>

**Tests:** <...>

**Docs:** <...>
```

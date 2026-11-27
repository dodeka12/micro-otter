---
name: implement-plan
description: 'Implement a plan from the plan tree (see `AGENTS.md` → Planning for the path in this repository). Use when the user asks to implement a plan, execute a plan, work through a plan, or carry out planned steps. Reads the plan file(s), asks how much to implement (single step, full phase, or all phases), asks for full-plan runs whether to compact context after each phase or run continuously, then implements each step sequentially — marking it complete, committing after each one, and writing the cumulative handoff.md at each phase end. Reports each phase to the user as a short plain-language gist, keeping paths, hashes, and commands in the handoff.'
---

# Implement Plan

This is the Cline adapter for the harness-agnostic skill. Read the canonical instructions before acting:

- [Canonical skill](../../../ai/skills/implement-plan/SKILL.md)
- [Project AI guidance](../../../AGENTS.md)

The canonical file and its `references/` directory are the source of truth. Update the canonical
skill, not this adapter, except when changing the frontmatter or this link.

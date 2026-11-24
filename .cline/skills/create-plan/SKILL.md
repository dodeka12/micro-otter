---
name: create-plan
description: 'Create implementation plans as Markdown files under the plan tree (see `AGENTS.md` → Planning for the path in this repository). Use when the user asks to plan, create a plan, write a plan, or plan out work. Supports three plan types: short (single file), multi-phase (subfolder with overview + phase files + handoff.md), and iterative (subfolder with per-iteration sub-folders). Multi-phase plans include a per-phase handoff step and a cumulative handoff.md so later phases survive context compaction. Asks the user which type to use before creating anything.'
---

# Create Plan

This is the Cline adapter for the harness-agnostic skill. Read the canonical instructions before acting:

- [Canonical skill](../../../ai/skills/create-plan/SKILL.md)
- [Project AI guidance](../../../AGENTS.md)

The canonical file and its `references/` directory are the source of truth. Update the canonical
skill, not this adapter, except when changing the frontmatter or this link.

---
name: create-skills
description: Workflow for creating high-quality, harness-agnostic AI agent skills in this repository, including canonical ai/skills layout, Cline/Copilot adapters, required SKILL.md frontmatter, and practical validation steps.
license: GPL-3.0-only
---

Use this skill when asked to create or update AI skills or their harness adapters.

## Goals

- Keep one canonical, harness-agnostic source for every skill.
- Make the skill discoverable to Cline and linkable from GitHub Copilot and other harnesses.
- Keep adapters thin so instructions cannot drift apart.
- Keep skills practical, concise, and task-oriented.

## Required structure

1. Put the canonical skill at `ai/skills/<skill-name>/SKILL.md`.
2. Use lowercase, hyphenated directory and skill names.
3. In the canonical `SKILL.md`, include YAML frontmatter with:
   - `name` (required — must exactly match the directory name)
   - `description` (required — max 1024 characters, saying what the skill does and when to use it)
   - `license` (optional)
4. Keep the full guidance and step-by-step instructions in the canonical file. Put helper
   references in the same skill directory, for example `ai/skills/<skill-name>/references/`.
5. Add a Cline adapter at `.cline/skills/<skill-name>/SKILL.md`:
   - Copy the canonical frontmatter exactly.
   - Keep the body limited to a link to `../../../ai/skills/<skill-name>/SKILL.md` and
     `../../../AGENTS.md`.
   - State that the canonical file is the source of truth.
6. Do not create a separate Copilot skill copy. The Copilot adapter
   `.github/copilot-instructions.md` points to `AGENTS.md` and `ai/skills/`.
7. Add the skill to the table in `AGENTS.md` and, if useful, `ai/README.md`.

## Authoring checklist

- Name the skill after the workflow it supports (for example: `release-notes`, `api-contract-checks`).
- Write a `description` that says both what the skill does and when to use it.
- Include explicit do/don't guidance to avoid common mistakes.
- Include minimal examples of commands or file locations when helpful.
- Keep instructions repository-specific when local conventions exist.
- Do not put harness-specific instructions in the canonical file unless they are behind a clearly
  labelled adapter section.

## Validation steps

- Confirm the canonical path exists and is exactly `ai/skills/<name>/SKILL.md`.
- Confirm the Cline adapter exists at `.cline/skills/<name>/SKILL.md`.
- Confirm both files have the same frontmatter.
- Confirm the adapter links `../../../ai/skills/<name>/SKILL.md` and `../../../AGENTS.md`.
- Confirm frontmatter parses correctly and has the required keys.
- Confirm instructions are actionable and not generic filler.
- Run the repository link check over `AGENTS.md`, `ai/`, `.cline/`, and
  `.github/copilot-instructions.md`.

## Example scaffold

Canonical `ai/skills/my-skill/SKILL.md`:

```markdown
---
name: my-skill
description: What this skill does and when an agent should use it.
license: MIT
---

Use this skill when ...

## Goals
- ...

## Workflow
1. ...
2. ...

## Validation
- ...
```

Cline adapter `.cline/skills/my-skill/SKILL.md`:

```markdown
---
name: my-skill
description: What this skill does and when an agent should use it.
license: MIT
---

# My Skill

This is the Cline adapter for the harness-agnostic skill. Read the canonical instructions before acting:

- [Canonical skill](../../../ai/skills/my-skill/SKILL.md)
- [Project AI guidance](../../../AGENTS.md)

The canonical file and its `references/` directory are the source of truth.
```

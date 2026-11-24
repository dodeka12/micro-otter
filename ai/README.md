# AI Support

This directory holds the canonical, harness-agnostic AI guidance for Micro-Otter.

## Source of truth

- [AGENTS.md](../AGENTS.md) — project layout, tooling defaults, documentation map, skills index,
  planning conventions, and critical rules.
- [skills/](skills/) — canonical `SKILL.md` files and their `references/`.

## Harness adapters

Adapters are deliberately thin so the instructions cannot drift apart:

| Harness | Adapter | Behavior |
|---------|---------|----------|
| Cline | [.cline/skills/](../.cline/skills/) | Each `SKILL.md` keeps the frontmatter for discovery and links to the canonical `ai/skills/<name>/SKILL.md`. |
| GitHub Copilot | [.github/copilot-instructions.md](../.github/copilot-instructions.md) | Points to `AGENTS.md` and `ai/skills/`; contains no separate project rules. |
| Other | Add a thin adapter | Link to `AGENTS.md` and the relevant canonical skill. Do not copy the skill body. |

## Adding or changing a skill

Use the [create-skills skill](skills/create-skills/SKILL.md). In short:

1. Put the canonical content in `ai/skills/<name>/SKILL.md`, with any references beside it.
2. Add or update the Cline wrapper at `.cline/skills/<name>/SKILL.md`; keep the same frontmatter and
   link to the canonical file.
3. Update the skills table in [AGENTS.md](../AGENTS.md) when adding or removing a skill.
4. Run the repository link check so the adapter links resolve.

---
name: changelog
description: Create and maintain changelog entries under docs/changelog/YYYY/MM/DD_<name>.md, including the since-relative title, section structure, and docs/changelog/index.md updates. Use when the user asks to add, update, or finalize a changelog entry.
license: GPL-3.0-only
---

Use this skill when asked to create, update, or finalize a changelog entry.

The canonical rules live in `docs/workflow/changelog.md`. Follow it for the complete conventions; this skill summarizes the key steps.

## Goals

- Keep changelog entries consistent and reviewer-friendly.
- Follow the `docs/changelog/YYYY/MM/` storage structure.
- Record a `# Changes since version <last-tag>` title instead of predicting a version.

## Location & naming

- Store entries in `docs/changelog/YYYY/MM/`.
- On a branch: `DD_<branch-name>.md` (replace `/` in the branch name with `-`).
- At PR time: the `DD_<branch-name>.md` filename is kept (no local squash — see the `pull-request-workflow` skill).
- Append all changes for one branch into a single file — do not create a file per commit.

## Title

- Do not predict the release version. Use:

  ```
  # Changes since version <last-tag>
  ```

  where `<last-tag>` comes from `git describe --tags --abbrev=0` with the leading `v` stripped.

## Structure

Use these sections in order, only where applicable:

```markdown
## New Features
- **<Headline>** — one-sentence explanation.

## Breaking Changes
- **<Headline>** — one-sentence explanation.

## Bug Fixes
- **<Headline>** — one-sentence explanation.

## Refactor
- **<Headline>** — one-sentence explanation.
```

## Index update

When finalizing at PR time, add a newest-first entry to `docs/changelog/index.md`:

```markdown
## [Since <last-tag>] — <YYYY-MM-DD>
- <one-line summary> · <more>
→ [Details](YYYY/MM/DD_<branch-name>.md)
```

## Validation

- Confirm the file path matches `docs/changelog/YYYY/MM/DD_<name>.md`.
- Confirm the title uses the current `git describe --tags --abbrev=0` value (without the `v`).
- Confirm the `index.md` entry and details link match the final filename.

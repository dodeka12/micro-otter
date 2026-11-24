---
name: pull-request-workflow
description: Reliable workflow for creating and updating pull requests in this repository, including the backup-branch + squash step, changelog rename, multiline Markdown bodies, and concise behavior-focused summaries.
license: GPL-3.0-only
---

Use this skill when asked to create a branch, commit changes, push, open a pull request, squash a feature branch, or fix pull request text formatting.

The canonical step-by-step workflow lives in `docs/workflow/pull-request.md`. This skill summarizes the key rules.

## Goals

- Create PRs that are concise, accurate, and reviewer-friendly.
- Avoid malformed Markdown (for example literal `\n` in PR bodies).
- Preserve repository workflow expectations and hooks.

## Required workflow

1. Confirm current git status and branch before creating commits.
2. Create a descriptive branch name that matches the fix scope.
3. Stage only intended files.
4. Commit with a concise, imperative (Conventional Commit) message.
5. Run the validation gate before opening a PR:
   - `npm run check:ci-local`
   - `npm run test:node`
   - `npm run typecheck`
   - `uv run pytest -q`
6. Push the branch with upstream tracking (do not squash locally — see note below).
7. Create a PR with a short title and a behavior-focused body.
8. Merge using GitHub's "Squash and merge" so the device manifests keep their accumulated versions.

## PR body formatting

- Do not pass escaped newline sequences inside a single quoted string.
- Prefer one of these safe patterns:
  - `gh pr create --body-file <path-to-markdown>`
  - `gh pr edit --body-file <path-to-markdown>`
  - PowerShell here-string when a file is not practical.
- Keep content concise and user-visible behavior focused.

## Repository-specific note

- This repo runs pre-commit and pre-push hooks that may regenerate files or bump device manifests. If hooks modify files, include those generated updates in the commit when they are part of the workflow output.
- The pre-commit hook may abort once with a "re-run your git commit command" instruction after bumping a manifest; re-run the commit and it succeeds with the staged bump included.
- Do not squash the branch locally (`git reset --soft <base>`): the device version hook bumps each manifest from HEAD's version, so a squash collapses the accumulated version into a single increment (e.g. `1.18.0` → `1.1.0`). Use GitHub's "Squash and merge" instead.

## Suggested PR body structure

Use this structure unless the user requests a different format:

```markdown
## What changed
- <one-line change summary>
- <one-line change summary>

## New behavior
<2-3 sentences on what users will now observe>
```

## Helper script

For body updates from Markdown files in this repo, use:

```powershell
powershell -ExecutionPolicy Bypass -File tools/update-pr-body.ps1 -Number <PR_NUMBER> -BodyFile <MARKDOWN_FILE>
```

Optional for external repos:

```powershell
powershell -ExecutionPolicy Bypass -File tools/update-pr-body.ps1 -Number <PR_NUMBER> -BodyFile <MARKDOWN_FILE> -Repo <OWNER/REPO>
```

## Related workflow docs

- `docs/workflow/pull-request.md` — full pull-request procedure (validation, push, GitHub squash-merge).
- `docs/workflow/changelog.md` — changelog creation/naming (see the `changelog` skill).
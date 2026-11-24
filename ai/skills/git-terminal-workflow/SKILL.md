---
name: git-terminal-workflow
description: Git workflow rules for this repository: run git commands only in the terminal, and wait for user interaction on the first signed commit of the day.
license: GPL-3.0-only
---

Use this skill when performing any git workflow in this repository (status checks, branching, staging, commits, pushes, rebases, and PR-related git actions).

## Mandatory rules

- Use git **only** in the terminal.
- Do not use non-terminal shortcuts for git actions.
- Assume commits are signed and may require interactive user input.
- **Never** commit with `--no-gpg-sign` (or otherwise disable signing), even if signing fails.

## First commit of the day (PGP passphrase)

- On the first commit of a day, pause and wait for the user to enter the PGP passphrase when prompted.
- Do not cancel or retry immediately while waiting for passphrase entry.
- After the prompt is satisfied, continue the normal workflow.

## Non-interactive signing failure (do not bypass)

When the agent runs `git commit` in this devcontainer without an interactive TTY, gpg can fail with `gpg failed to sign the data` and a `pinentry ... not a tty` error. This is expected when the PGP passphrase cannot be entered programmatically.

- Do **not** retry with `--no-gpg-sign` or any other signing bypass.
- Instead, stage the intended files with `git add`, then hand the user the exact command to run themselves in an interactive terminal:

    ```bash
    git commit -S -m "<message>"
    ```

- To re-sign an already-created (unsigned) commit, hand the user:

    ```bash
    git commit --amend -S --no-edit
    ```

- Wait for the user to run the command and confirm success before continuing.

## Workflow checklist

1. Run `git status --short --branch` before making changes.
2. Create/switch branch with terminal git commands.
3. Stage only intended files with `git add`.
4. Commit with a concise message.
5. Wait for user passphrase entry when prompted (especially first commit of day).
6. Push and verify clean status.

## Safety notes

- If a commit appears stalled, check whether it is awaiting passphrase input before treating it as failure.
- Keep git operations explicit and sequential to avoid hidden state.

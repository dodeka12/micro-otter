# Commit Convention

After each step is implemented and marked complete, create a git commit that includes both the implementation changes and the updated plan file. At a phase boundary, the updated `handoff.md` is part of the same commit as the phase's final step.

## Commit Message Format

```
<type>(<scope>): <short description>

Plan: <plan-name> — <phase/step reference>
```

### Fields

| Field | Description |
|-------|-------------|
| `type` | `feat` for new functionality, `fix` for bug fixes, `chore` for scaffolding/config/tooling, `docs` for documentation-only changes |
| `scope` | The component or area being changed (e.g., `mcp-email`, `config`, `cli`, `docker`) — omit if the change spans many areas |
| `short description` | Imperative mood, lowercase, no trailing period, max ~72 chars |
| `Plan:` trailer | References the plan name and the specific step, e.g., `ala-v1 — iteration-1 phase-2 step 2.3` or `auth-module — phase-1 step 1.2` |

### Examples

```
feat(mcp-email): add IMAP connection pool

Plan: ala-v1 — iteration-1 phase-3 step 3.2
```

```
chore(docker): add backend Dockerfile

Plan: email-pipeline — phase-1 step 1.3
```

```
feat: implement database schema migrations

Plan: auth-module — phase-2 step 2.1
```

```
feat(core): add tuple compose and decompose nodes

Plan: tuple-data-type — phase-2 handoff
```

## Staging Rules

- Stage **all files changed by the step implementation** plus the **plan file** in which the step was marked complete.
- At a phase boundary, also stage **`handoff.md`**.
- Do not stage unrelated changes.
- If the working tree contains unrelated modifications, stash them before committing and restore afterward.

## Command

```bash
git add <implementation files> <plan file>
git commit -S -m "<message>"
```

Commits must be signed (`commit.gpgsign=true`). If running in a non-interactive terminal the sign step can fail on the passphrase prompt — do **not** fall back to `--no-gpg-sign`; hand the command to the user to run in an interactive terminal instead (see the `git-terminal-workflow` skill).

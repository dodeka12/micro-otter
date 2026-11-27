# The two-repository model

Micro-Otter lives in **two separate git repositories**. They are not two branches of one history, two
remotes of one repository, or two views of the same storage: they are independent repositories, each
with its own `main`, and only one of them is written by hand.

This page is the mental model. The procedure is in
[../workflow/two-repository-workflow.md](../workflow/two-repository-workflow.md); the guard-by-guard
reference is in [release-sync.md](release-sync.md).

| | Private repository | Public repository (`micro-otter`) |
|---|---|---|
| Remote here | `origin` | `upstream` |
| Visible to | maintainers | everyone |
| Holds | the whole project, **including** `ldev/` plans | product files only; `ldev/` never exists there |
| `main` | normal development history | a linear chain of publication commits |
| Written by | branches, pull requests, merges | `ldev/tools/publish.mjs` only |

## The one idea

**All work happens in the private repository. Publishing is a one-way copy of product files.**

```
 private repository (origin)                    public repository (upstream)
 ───────────────────────────                    ────────────────────────────
 feature branch ─► PR ─► squash merge
                        into private main
                              │
                              │ publish.mjs: copy the product files
                              │ that differ from upstream/main
                              ▼
                       publish/<slug> ─► PR ─► squash merge
                                               into public main
```

Nothing runs automatically. Between "merged privately" and "public" sits exactly one command that you
run on purpose. Until you run it, the public repository does not change at all.

The private repository also *merges* the public `main` (the **sync down** step), so it contains the
public commits. The reverse never happens: the public repository never receives a private commit, only
copies of files.

## Three facts that remove the confusion

1. **A merge in the private repository does not touch the public one.** The private tree can contain
   public commits; the public tree can never contain private ones.
2. **A publication is not a push of your branch.** `publish.mjs` reads the *files* at the private
   `HEAD`, writes the changed product files onto a brand-new branch in the public clone, and commits
   them as one new commit. Your feature branch never reaches the public repository; its commit messages
   never appear there either — only the publication title does.
3. **Nobody selects files by hand.** The split is by path: `ldev/**` is excluded, every other tracked
   file is product. You cannot publish a plan by accident — the *leak* guard fails the publication
   instead.

## What is product and what is private

| Path | Public | Note |
|---|---|---|
| `src/`, `tools/`, `tests/`, `docs/`, `user-docs/`, `ai/`, `.cline/`, `.github/`, `dev/`, root config files | yes | byte-identical in both repositories |
| `.devcontainer/devcontainer.json` | yes | the only declared variant: the published file drops the maintainer's public-clone bind mount ([release sync](release-sync.md#variants)) |
| `ldev/` | no | plans, ideas, node design docs, publication tooling |
| `AGENTS.md` | yes | byte-identical in both repositories; it describes the published repository |
| `agents-local.md` | no | maintainer-only rules: the private plan tree and the publication procedure |
| `.venv/`, `node_modules/`, `_dist/`, generated version files | no | untracked build state |

## The only loop you need

1. **Branch + pull request in the private repository.** Review happens here; this is the only PR you
   write by hand.
2. **Publish, once, from a clean private `main`.** `status` → `prepare` → `publish --create-pr` turns
   *everything* not public yet into one commit and opens the second PR.
3. **Sync down after that PR merges.** `git fetch upstream --tags && git merge upstream/main` rejoins
   the histories so the next publication is a plain comparison.

## Frequently confused points

- *"I squashed in the private repository — why would the public one see it?"* It would not. If the
  public repository changed, either you published, or someone edited it directly.
- *"Should I open a PR against the public repository?"* No. Only publication commits land there; a
  hand-made change there is reverted by the next publication unless it is merged down first.
- *"Can I publish a single file?"* No, and you do not need to: a publication is "everything that is not
  public yet", which is why you publish in small, coherent batches.
- *"What if I never publish?"* Nothing breaks; the public repository is simply older. The dangerous
  direction is the other one — an edit made directly on the public side (guard `sync-down`).
- *"Where do the maintainer-only rules live?"* In `agents-local.md`, which is excluded from every
  publication. `AGENTS.md` is identical in both repositories; the only declared per-repository variant
  is the devcontainer configuration ([release sync](release-sync.md#variants)).

See also: [guides/repository-workflow.md](../dev/guides/repository-workflow.md) for the tool's flags,
the eight guards, and the sdist/wheel contents, and [../workflow/release.md](../workflow/release.md) for
firmware releases.

---
name: two-repository-workflow
description: Routing and publication workflow for this repository's two git repositories — which branch a change belongs on, when to open the private pull request, when to run `node ldev/tools/publish.mjs`, when to open the public publication pull request, and when to sync down. Use when the user asks where a change should go, how to publish, why the public repository changed or did not change, or what the correct pull-request sequence is.
license: GPL-3.0-only
---

Use this skill when a change has to reach the public `micro-otter` repository, or when the user asks
which pull request to open.

The mental model is [docs/admin/two-repository-model.md](../../../docs/admin/two-repository-model.md);
the step-by-step procedure is
[docs/workflow/two-repository-workflow.md](../../../docs/workflow/two-repository-workflow.md). This file is
the summary to act from.

## The one rule

All work lands in the private repository first. Product files reach `micro-otter` only through one
generated publication commit, and `ldev/**` never reaches it at all.

## Order of operations

1. Branch `<type>/<slug>` in the private repository and commit there (signed).
2. Run the gates, open **PR A** against the private `main`, squash-merge it.
3. If the branch contained any product path, publish from a clean private `main`:
   `status` → `prepare --title` → `publish --create-pr`, then merge **PR B** on the public repository.
4. Sync down: `git fetch upstream --tags && git merge -X ours upstream/main`.

## Routing table

| Changed paths | PR A (private) | Publish + PR B (public) |
|---|---|---|
| `ldev/**` only | yes | no — `status` prints *nothing unpublished* |
| any product path | yes | yes — `ldev/` is dropped from the publication |

## Do not

- open a pull request against the public repository by hand;
- publish before PR A is merged, from a feature branch, or with a dirty tree;
- publish to "save" unfinished work — publish one coherent story;
- skip the sync-down merge after PR B merges, or the next publication fails guard `sync-down`;
- hand-edit a publication commit or force-push a public branch with an open pull request.

## Notes

- This skill describes the maintainers' private development repository. In a public clone there is no
  `ldev/` tree and no publication step: changes arrive as ordinary pull requests.
- The tool has no npm script, because `package.json` is itself published; always call
  `node ldev/tools/publish.mjs`.
- Exit code `2` means a guard refused the publication. The guard name on stderr selects the fix; the
  troubleshooting table in the workflow page maps each one to its action.

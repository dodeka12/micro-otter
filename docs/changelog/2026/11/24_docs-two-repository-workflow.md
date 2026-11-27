# Changes since version 1.43.0

## Documentation

- **The two-repository model on one page** —
  [docs/admin/two-repository-model.md](../../../admin/two-repository-model.md) states the principle
  plainly: the private and the public repository are independent, a private merge changes nothing
  public, a publication copies files instead of pushing a branch, and the public/private split follows
  the path (`ldev/**` excluded) instead of a per-file decision. It closes with the points that read as
  magic (why a squash does not "appear" in the other repository, why there is no PR against the public
  repository, what happens if you never publish).
- **A routing procedure for changed files** —
  [docs/workflow/two-repository-workflow.md](../../../workflow/two-repository-workflow.md) turns the
  model into steps: classify the changed paths, branch, PR A, decide whether to publish, run
  `status`/`prepare`/`publish --create-pr` for PR B, then sync down. It carries the decision table
  (`ldev/`-only branches skip publication), the five rules that bite, and a guard-to-fix table for
  `publish.mjs` exit `2`.
- **New `two-repository-workflow` skill** — the canonical skill and its Cline adapter hold the summary
  and the routing table for agents. `AGENTS.md`, `docs/dev/README.md`,
  `docs/admin/release-sync.md`, `docs/dev/guides/repository-workflow.md` and
  `docs/workflow/pull-request.md` now point at the two new documents instead of repeating the model.
- **Agent instructions split public/private** — `AGENTS.md` is now the published, harness-agnostic rule
  set and is byte-identical in both repositories; the maintainer-only rules (the private plan tree and
  the publication procedure) live in `agents-local.md`, which `excludedPaths` keeps out of every
  publication. `ldev/tools/tests/agents-contract.test.mjs` checks both files, the empty `variants` map,
  and the Cline adapter frontmatter.

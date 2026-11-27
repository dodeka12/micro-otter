# Changes since version 1.43.0

## Documentation

- **The README is an index again** — 243 lines became 77: what the project is, a quick start that
  includes the `npm run build` step `micro-otter serve` needs, a *Start here* table pointing at the
  page for each topic, the command table, the repository layout, and the two documentation trees.
- **New dev-container guide** — [docs/dev/guides/devcontainer.md](../../../dev/guides/devcontainer.md)
  carries the first-start steps, the bundled tooling, Windows USB forwarding, in-container GPG signing,
  Cline history persistence and the troubleshooting list that used to sit in the README.
- **New git-hooks guide** — [docs/dev/guides/git-hooks.md](../../../dev/guides/git-hooks.md) documents
  `core.hooksPath hooks`, the `commit-msg` device manifest bump rules (prefix → bump table, the
  abort-and-retry behaviour), the `pre-commit` generated OSS registry refresh, and the `pre-push`
  `check:ci-local` gate.
- **Stale ViewBase lifecycle links fixed** — five references to the removed
  `view-system/viewbase-lifecycle.md` now point at `view-system/view-api-reference.md`.
- **Dead README link removed** — the node-type pointer used to name a `NODE_SYSTEM_README.md` that
  does not exist; it now links the node definition reference, and `CONTRIBUTING.md` links the testing
  guide directly instead of a README anchor that no longer exists.

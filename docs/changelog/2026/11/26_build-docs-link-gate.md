# Changes since version 1.43.0

## Build

- **`npm run check:docs-links` gates every published markdown tree** — `tools/check_docs_links.mjs`
  scans `README.md`, `CONTRIBUTING.md`, `AGENTS.md`, `docs/`, `user-docs/`, `ai/`, `.cline/`, and
  `dev/` (skipping `ldev/` and build output) and fails on a broken relative link, a missing anchor, a
  case-mismatched path, or an unused allowlist entry. The 72-link `docs/` backlog is fixed, and the
  gate runs in `check:ci-local:web` and the `docs` CI job.

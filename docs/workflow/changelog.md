# Workflow: Changelog

How to create and maintain changelog entries for this repository.

## Location & naming

- New changelogs live in `docs/changelog/YYYY/MM/` — one subfolder per year and
  month, e.g. `docs/changelog/2026/10/`.
- **On a feature/fix branch (any branch other than `main`)** name the file
  `DD_<branch-name>.md` inside the year/month folder for the branch's start
  date, e.g. `docs/changelog/2026/10/22_webview-initial-state-sync.md`.
  - Replace `/` in the branch name with `-` (branch names commonly contain
    `/`, which would be read as a path separator in a filename).
  - Integrate **all** changes made on the branch into this single branch
    changelog — append to it as the branch evolves; do **not** create a new
    file per commit.
- **When opening a PR**, the `DD_<branch-name>.md` filename is kept as the
  final name — this repo does not squash locally, so there is no
  squashed-commit hash to rename after (see `docs/workflow/pull-request.md`).

## Title

- Do **not** predict the next release version number — it is assigned later by
  the `bump-version.yml` GitHub workflow (semantic versioning). Hard-coding a
  version here is fragile.
- Use the current-tag-relative form:

  ```
  # Changes since version <last-tag>
  ```

  Determine `<last-tag>` by running (prints the newest package tag reachable from
  the current commit, e.g. `v1.9.5`):

  ```
  git describe --tags --abbrev=0 --match "v[0-9]*"
  ```

  The `--match "v[0-9]*"` filter matters: once M10 cuts `firmware-v1.0.0`, a bare
  `--abbrev=0` could return that tag and produce `# Changes since version
  firmware-v1.0.0` instead of the package version. Strip the leading `v` before
  using it in the title (e.g. `v1.9.5` → `1.9.5`). Do **not** copy a version
  from this document or from another changelog — it must reflect the tag your
  branch actually forked from.

## Structure

Use these sections in this order (only include the sections that apply):

```
# Changes since version <last-tag>

## New Features
- **<Headline>** — one-sentence explanation.

## Breaking Changes
- **<Headline>** — one-sentence explanation.

## Bug Fixes
- **<Headline>** — one-sentence explanation.

## Refactor
- **<Headline>** — one-sentence explanation.
```

Bullet style: `- **Headline** —` followed by a concise sentence. Wrap body text
at ~80 columns. Keep each bullet self-contained (no context from other bullets).

## Index update (`docs/changelog/index.md`)

`docs/changelog/index.md` keeps a top-level, newest-first list of releases.
The entry is added when the PR is opened. When adding a changelog:

1. Add a new entry at the top, directly below `# Changelog`.
2. Head the entry with the same since-relative label as the title:

   ```
   ## [Since <last-tag>] — <YYYY-MM-DD>
   ```

   where `<last-tag>` is the value from `git describe --tags --abbrev=0`
   (without the leading `v`) and `<YYYY-MM-DD>` is the PR submission date.
3. Add a one-line summary of the main features (dot-separated, `·`), a second
   line for breaking/bug highlights if needed, and a details link:

   ```
   - Feature one · feature two · ...
   - Breaking: ...
   → [Details](2026/10/22_<branch-name>.md)
   ```

4. Leave existing (older) entries untouched.

## Release flow (for later)

- When the `bump-version.yml` workflow actually cuts a version/tag, the
  "since <version>" labels may optionally be retrofitted to the concrete
  released version number, but this is a separate step and not done when
  authoring the changelog.

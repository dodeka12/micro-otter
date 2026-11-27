# Repository topology & release sync

> New to this? Read the one-page model first —
> [two-repository-model.md](two-repository-model.md) — then the routing procedure,
> [../workflow/two-repository-workflow.md](../workflow/two-repository-workflow.md).
> This page is the full reference.

Micro-Otter ships from **two** repositories:

- The **private development repository** — `origin` points at it. Its name is deliberately not
  spelled out on this page (see [Artifact prefixes](#7-artifact-prefixes)).
- `micro-otter` — the public repository and the **trunk of record**. `upstream` points at it.

Product work lands here first and reaches `micro-otter` only as one squashed publication commit on a
fresh branch cut from `upstream/main`, opened as a pull request. The public repository is never
hand-edited: a change made there is either reverted by the next publication or has to be merged back
down first (see [Sync down](#5-sync-down)).

Publication is a maintainer action, run by hand with `node ldev/tools/publish.mjs`; no `package.json`
script wraps it, because `package.json` is itself published.

**No public checkout is required.** `prepare` runs entirely in this repository: it stages the product
delta into a scratch `GIT_INDEX_FILE`, writes the tree with `git write-tree`, runs the generators in a
throwaway worktree, and records the result with `git commit-tree` on `refs/heads/publish/<slug>`. No
public working tree is created, copied into, or read anywhere in the loop. That branch ref is local to
this repository until `publish` pushes it; `sync` brings the public `main` back here.

## 1. Topology

| Remote | Repository | Role |
|--------|------------|------|
| `origin` | The private development repository | Private development; every product commit and every plan starts here |
| `upstream` | `micro-otter` | Public trunk of record; receives squashed publication commits only |

Both remotes are configured in the **private** clone, and `publish` / `sync` run there. A second clone
of `micro-otter` is optional and needs no particular remote name, because no command is executed in it.

The published tree is a strict subset of the private tree: `git diff` of the pair is
`:(exclude)ldev` plus the private-only `agents-local.md`, and every shared path is byte-identical
apart from the one declared variant, [`.devcontainer/devcontainer.json`](#variants).

## 2. `dev/` vs `ldev/`

| Path | Tree | Published | Contents |
|------|------|-----------|----------|
| `ldev/todos/` | Private | No | The maintainers' working plan tree; `_done/` holds completed plans |
| `ldev/ideas/`, `ldev/nodes/`, `ldev/manual_tests/`, `ldev/tools/`, `ldev/devcontainer/` | Private | No | Ideas, node design documents, manual tests, the publication tooling, and the publication-side variants of published files |
| `dev/` | Both | Yes, verbatim | A scaffold: `dev/README.md` plus `.gitkeep`-ed `ideas/`, `todos/`, `todos/_done/`, `nodes/`, `manual_tests/`, `tools/` |

- **No new plan is created under `dev/`.** A plan belongs in `ldev/todos/`; `dev/` exists so the
  published tree has the same layout and contributor-facing paths resolve.
- `AGENTS.md` publishes verbatim and is identical in both trees; it describes the published
  repository. The maintainer-only rules — the private plan tree and the publication procedure — live
  in `agents-local.md`, which `excludedPaths` keeps out of every publication. Every other delta path
  must be byte-identical; the single exception is the devcontainer variant below.

### Variants

`variants` in `ldev/tools/publish-config.json` is the only way a published path may differ from this
tree, and it holds exactly one entry:

| Published target | Source (never published) | Difference |
|------------------|--------------------------|------------|
| `.devcontainer/devcontainer.json` | `ldev/devcontainer/devcontainer.public.json` | The development config bind-mounts the maintainer's public clone at `/workspaces/micro-otter`; the published config drops that one mount so a contributor's container stays portable. Every other key is identical. |

`prepare` writes the source blob over the target in the prepared tree, and guard 5 compares that
prepared blob with `git hash-object <source>` instead of with this tree's `HEAD`. The two files cannot
drift silently: `tests/test_devcontainer_bootstrap.py` fails on any difference beyond the mount, and on
a config that stops declaring the variant.

## 3. Commands

`status` is read-only. `prepare` writes one local branch ref (`refs/heads/publish/<slug>`); `publish`
writes the `upstream` repository; `sync` changes this tree with a merge.

```bash
node ldev/tools/publish.mjs status
node ldev/tools/publish.mjs prepare [--dry-run] [--rewrite] [--title <subject>] [--branch <name>]
node ldev/tools/publish.mjs publish [--create-pr] [--rewrite] [--title <subject>] [--branch <name>]
node ldev/tools/publish.mjs sync
node ldev/tools/publish.mjs help
```

- `status` prints the `upstream/main` tip, the pending changes (status + path per line; `V` marks the
  devcontainer variant while its published copy is stale), the unpublished private commit subjects, and
  every guard it can evaluate without a checkout. It changes nothing and exits `0` even when nothing is
  pending.
- `prepare` builds the squashed publication commit **object**: the delta lands in a scratch index, the
  generators run twice in a throwaway worktree, the guards read the resulting tree, and `git
  commit-tree` records it on `refs/heads/publish/<slug>`. The subject is
  `chore(publish): <n> product changes` unless `--title` overrides it, and the body lists the squashed
  private subjects. It ends by printing `prepared <branch> at <sha>` and the exact `publish` line for
  that branch. `--dry-run` runs every step and writes no branch, so neither this tree nor `upstream`
  changes.
- `publish` pushes `refs/heads/<branch>:refs/heads/<branch>` to `upstream` from this repository and,
  with `--create-pr`, opens the pull request with `gh pr create --repo <slug>` and prints its URL. The
  slug is derived from the `upstream` URL; set `remote.upstream.ghrepo` when that URL is a mirror, an
  SSH alias, or a local path. `--rewrite` re-prepares an existing branch and pushes it with
  `--force-with-lease=<ref>:<the sha this run fetched>`; it is refused while the branch has an open pull
  request, so a review in progress is never rewritten.
- `prepare` and `publish` derive the branch name from `--title`, so pass the same `--title` to both or
  reuse the `--branch` printed by `prepare`. Asked for a branch that does not exist, `publish` lists
  the prepared ones and exits `2`.
- `sync` fetches `upstream --prune --tags` and merges `upstream/main` into the current branch,
  fast-forwarding when possible and adding `--allow-unrelated-histories` when the two histories are
  still disjoint. It prints the before/after shas and the product paths the merge pulled in (see
  [Sync down](#5-sync-down)).

Exit codes are the contract: `0` success (including `nothing unpublished`), `2` a guard or config
failure with the offender named on stderr, `1` an unexpected `git`/`gh` failure with the command line
printed. A refused publication never exits `0`.

## 4. Guards

`prepare` runs all eight guards below, in this order, against the prepared tree object. `status` stages
the delta into a scratch index and runs the seven that need no checkout (1–6 and 8), printing `skip`
for 7, so an unprepared tree never looks like a guard failure. Each failure stops the publication with
exit `2` and names the path, string, or command that failed.

1. **Clean private tree** — `git status --porcelain` must be empty. An uncommitted product edit would
   otherwise be published without a record of what it was.
2. **Sync-down** — `git rev-list --count HEAD..upstream/main -- . ':(exclude)ldev'` must be `0`. A
   non-zero count means the public tree has product commits this tree lacks; publishing anyway would
   silently revert them.
3. **Leak** — the prepared tree must not track `ldev/*` or any path under `untrackedPaths`
   (`.venv/`, `node_modules/`, `_dist/`, `_input/`, `_output/`, `_tmp/`, `test-output.txt`,
   `test-visibility.js`, and `tools/mod/`, the retired dev-sync scaffolding that must never come
   back). The delta is produced with `exclusionPathspecs(config.excludedPaths)`, so an excluded path
   never enters the tree; the guard is the check that says so. This protects the public tree from
   private plans and local build state.
4. **Forbidden strings** — every tracked path and every tracked text file is scanned for the
   `forbiddenStrings` in `ldev/tools/publish-config.json`: the private repository's name and its
   absolute workspace path. Matches are reported as `path:line` (this page does not print them — it is
   published, and the scan would reject it). A tracked path starting with `ldev/` also fails. The
   public tree must not name the private repository.
5. **Parity** — for every product path in the delta, the prepared blob id must equal the private
   `HEAD` blob id, and a path deleted in the delta must be absent from the prepared tree; the declared
   devcontainer variant must equal `git hash-object <source>` instead (see [Variants](#variants)). This
   is what makes "byte-identical" a checked fact instead of an intention.
6. **Stale plan-tree references** — `findStaleRefsInRevision()` from `ldev/tools/rewrite-dev-refs.mjs`
   reads the prepared tree and rejects `dev/<plan-folder>` references in published files, so a plan
   link can never leak into the public tree.
7. **Generated files** — the tool runs the generators in a throwaway worktree, stages the result, and
   runs them again; the second pass must leave that worktree unchanged (`git diff` and `git ls-files
   --others --exclude-standard` both empty). A drifted or newly created generated file means the
   commit would be built from output nobody staged.
8. **Device manifests** — the publication commit is made with `git commit-tree`, which runs no hooks,
   so the device version hook never runs. Every `src/micro_otter/nodes/device/**/manifest.json` must
   therefore equal the private `HEAD` blob exactly, which proves the skipped bump changed nothing a
   published consumer would see.

## 5. Sync down

Sync down *before* publishing, never after. A direct fix to a published file (for example
`dev/README.md`) or a security patch applied on the public side is a product commit this tree does not
have, and the next publication would revert it.

```bash
node ldev/tools/publish.mjs sync
```

`sync` fetches `upstream --prune --tags`, refuses a dirty tree, and merges `upstream/main` into the
current branch — fast-forwarding when this branch is an ancestor, and adding
`--allow-unrelated-histories` when the two histories are still disjoint. It prints the before/after
shas and the product paths the merge pulled in. A conflict exits `2`, names the conflicting paths, and
leaves the merge in place; the tool never picks a side.

The manual equivalent is what guard 2 enforces, so `status` is the quick check and the guard is the
gate:

```bash
git fetch upstream --prune --tags
git rev-list --count HEAD..upstream/main -- . ':(exclude)ldev'   # expect 0
git merge upstream/main                                          # when it is not 0
```

Guard 2 refuses to publish while that count is non-zero and names `sync` as the remedy.

A public repository seeded with its own commits (a fresh pair) shares no history with this tree yet.
`git rev-list` still counts those commits, and `git diff <remote>/main...HEAD` has no merge base, so the
first sync down needs `--allow-unrelated-histories`, which `sync` adds on its own:

```bash
git merge --allow-unrelated-histories upstream/main
```

Resolve the add/add conflicts in favor of this tree, which holds the newer product content. After that
merge the two histories are joined, the delta is a normal three-dot comparison, and every later sync
down is a plain merge.

Every later sync down is a plain merge: no shared file differs between the trees, so a clean result is
expected.

```bash
git merge upstream/main
git diff --stat upstream/main HEAD -- . ':(exclude)ldev' ':(exclude)agents-local.md'
```

That diff must be empty. A line in it means the merge dropped or missed a product change; `git merge
-X ours` would hide exactly that, so it is no longer used.

## 6. Tags

- Product tags (`v<version>`) are created in `micro-otter`, not here. The private repository never
  tags a product release of its own.
- Mirror them with `git fetch upstream --tags`; `git describe --tags` then resolves through the public
  tags.
- The private repository carried its own `v*` history before the split (65 tags, up to `v1.42.2`).
  All 65 were retired to `archive/v*` — locally and on `origin` — and the `v*` refs were deleted from
  both. This has to happen *before* the first `git fetch upstream --tags`, because a tag that exists
  in both repositories makes the fetch fail with `would clobber existing tag`.
- `archive/*` is a historical record only: nothing is built, released, or described from it, and
  `git describe --tags --match 'v[0-9]*'` cannot see it.
- The first public tag `v1.43.0` is mirrored (2026-11-24), so `git describe --tags --match
  'v[0-9]*'` resolves through it, at a distance of 1492 commits: the public squash is a single commit
  whose ancestry holds none of the private ones. Plain `git describe --tags` still prefers
  `archive/v1.42.2` (23 commits back) and `tag_regex` accepts it, so this tree reports
  `1.42.3.dev23` while a public clone at the tag reports `1.43.0`. A development tree is a
  development version; the release version comes from the public tag.
- **The tagging job never runs here.** `bump-version.yml` is a `workflow_dispatch` helper that tags a
  publication commit, and a merge in this repository releases nothing: the job's `if:` requires
  `github.repository == 'dodeka12/micro-otter'`. On 2026-11-25 an unguarded run after a documentation
  merge found no `v*` tag
  (`archive/*` is invisible to it), fell back to the action's `0.0.0` baseline and pushed `v0.0.1` onto
  the merge commit. Because that tag sat at distance 0, `git describe --tags --match 'v[0-9]*'` resolved
  to it and `uv build --wheel` produced `micro_otter-0.0.1-py3-none-any.whl` instead of the `1.42.3.devN`
  development version. The tag was deleted locally and on `origin`. The job now also runs a
  `Require a version baseline` step that fails the run when the checkout has no `v*` tag, so a missing
  baseline cannot silently become `v0.0.1` again.
- The guard takes effect here at the next merge, because the `pull_request: closed` run loads the
  workflow from the default branch; the public copy changes only with the publication that carries it.
  The public repository already has `v1.43.0`, so its unguarded copy would bump correctly in the
  meantime — the guard is what keeps a reseeded or freshly created public tree from restarting at
  `0.0.1`.

### First publication (2026-11-24)

- Publication pull request: [#2](https://github.com/dodeka12/micro-otter/pull/2) `chore(publish):
  installation & distribution foundation`, 1888 files, squash-merged as `aa9bb5e6` (signed by GitHub
  web-flow). Pull request #1 carried the same branch before a re-squash and stays closed as
  superseded: GitHub will not reopen a pull request whose branch was force-pushed.
- Required checks: `python`, `docs`, `web`. The first run failed in `web` because `vite build` needs
  `src/micro_otter/_version.py`; the job now sets up `uv` and reinstalls the project before the build
  (`.github/workflows/ci.yml`).
- `bump-version.yml` created `v0.0.1`: the public repository has no tag history, so the action starts
  from `0.0.0`, and the publication title classifies as `chore`. That tag was deleted and `v1.43.0`
  was created on the merge commit as a signed annotated tag and pushed. The `0.0.0` baseline is now a
  hard failure (`Require a version baseline`) and the job runs in the public repository only, so it
  bumps from `v1.43.0` on the next publication instead of restarting at `0.0.1`.
- Release builds must run `uv build --wheel`: plain `uv build` builds the wheel from the sdist, which
  has no `.git`, so hatch-vcs falls back to `0.0.0`. From a clean public clone at `v1.43.0`,
  `uv build --wheel` produces `micro_otter-1.43.0-py3-none-any.whl`.

### Rebaseline pointer (M10)

The two histories are still separate: `aa9bb5e6` is an orphan squash whose ancestry holds none of the
private commits, and this tree carries its pre-cutover history under `archive/v*`. M10 rebaselines the
private tree in place onto the public tree and parks that old history on `archive/pre-cutover`; only
then do `git describe` and the version line agree by construction rather than by `tag_regex`. Two
consequences for M6a, both already documented above:

- A publication commit is always a squash, so every product change reaches the public tree as exactly
  one commit and the delta is computed with `upstream/main...HEAD` once histories are joined.
- The private version stays `1.42.3.devN` until M10. Do not "fix" it here — a private `v*` tag would
  break the mirror, and the release version is defined by the public tag.

## 7. Artifact prefixes

`build_identity.py` names firmware images from `get_repo_name()`, so the image prefix is the
repository name:

| Tree | Image name |
|------|------------|
| Private tree | `<private-repository-name>-<version>.bin` |
| `micro-otter` | `micro-otter-<version>.bin` |

The private repository name is not printed here on purpose: guard 4 (above) rejects it in every
published text file, and this page is published. Read it from `git remote get-url origin` when you
need the exact string.

The difference is expected (decision 76) and is not a leak: the scanner that parses firmware artifact
names is prefix-agnostic, and only test fixtures are neutralized. Do not "fix" the private prefix to
match the public one.

## 8. Rollback

The public repository is never force-pushed, and `main` never takes a direct push.

- **Before the merge:** delete the publication branch on both sides — `git push upstream --delete
  <branch>`, then `git update-ref -d refs/heads/<branch>` in this repository. Nothing reached `main`.
- **After the merge:** revert the merge commit on the public side (a revert pull request), and merge
  the same revert back down here with `node ldev/tools/publish.mjs sync`. The private tree is
  unaffected either way.
- **Rewriting a publication:** re-run `prepare`/`publish --rewrite`, which updates the *branch* with
  `--force-with-lease`. It refuses a branch with an open pull request (the check needs `gh`, and is
  skipped with a notice when it is unavailable), so reviewed history is never silently replaced.

## 9. Security

- Publication is the only path from this tree to `micro-otter`. There is no second copy step, no
  include list, and no manual `git push` to `upstream/main`.
- `docs/dev/`, `docs/workflow/`, `docs/admin/`, `ai/`, and `dev/` are **public** even though the
  documentation site only renders `user-docs/`. Hiding a page from the site does not unpublish it.
  Secrets, internal URLs, machine paths, and customer data do not belong in any of them.
- The forbidden-string guard covers the two private names this repository is allowed to know; review
  intent, not only those strings, when adding a developer document.
- Private plans stay in `ldev/`: the leak guard rejects a tracked `ldev/` path, and the stale-reference
  guard rejects a published file that links into a plan folder.

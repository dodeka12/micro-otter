# Repository topology & release sync

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

**Where the public working tree lives.** `prepare` writes into `defaultRepoPath` (`../micro-otter`,
i.e. `/workspaces/micro-otter` in the devcontainer): a plain `git clone` of `micro-otter` whose only
remote is `upstream`. That clone is not part of the private repository and, unless it is bind-mounted,
it exists only inside the container. The prepared branch is therefore local until `publish` pushes it;
save it (`git -C ../micro-otter bundle create <path> <branch>`) or push it before rebuilding the
container.

## 1. Topology

| Remote | Repository | Role |
|--------|------------|------|
| `origin` | The private development repository | Private development; every product commit and every plan starts here |
| `upstream` | `micro-otter` | Public trunk of record; receives squashed publication commits only |

The published tree is a strict subset of the private tree: `git diff` of the pair is
`:(exclude)ldev`, and every published path is byte-identical **except** the declared variant
(`AGENTS.md`, see [section 2](#2-dev-vs-ldev)).

## 2. `dev/` vs `ldev/`

| Path | Tree | Published | Contents |
|------|------|-----------|----------|
| `ldev/todos/` | Private | No | The maintainers' working plan tree; `_done/` holds completed plans |
| `ldev/ideas/`, `ldev/nodes/`, `ldev/manual_tests/`, `ldev/tools/` | Private | No | Ideas, node design documents, manual tests, and the publication tooling itself |
| `dev/` | Both | Yes, verbatim | A scaffold: `dev/README.md` plus `.gitkeep`-ed `ideas/`, `todos/`, `todos/_done/`, `nodes/`, `manual_tests/`, `tools/` |

- **No new plan is created under `dev/`.** A plan belongs in `ldev/todos/`; `dev/` exists so the
  published tree has the same layout and contributor-facing paths resolve.
- `AGENTS.md` is the single declared per-repository difference. `ldev/tools/publish-config.json` →
  `variants` maps it to `ldev/tools/public-files/AGENTS.md`; the private file explains `dev/` vs
  `ldev/` and the publication rules, the published file describes `dev/` alone. Every other delta
  path must be byte-identical, and the variant path must match its source byte for byte.

## 3. Commands

`status` is read-only. `prepare` and `publish` change the public working tree and the `upstream`
repository.

```bash
node ldev/tools/publish.mjs status [--repo <path>]
node ldev/tools/publish.mjs prepare [--dry-run] [--title <subject>] [--branch <name>] [--repo <path>]
node ldev/tools/publish.mjs publish [--create-pr] [--rewrite] [--repo <path>]
node ldev/tools/publish.mjs help
```

- `status` prints the `upstream/main` tip, the pending changes (status + path per line; `V` marks a
  declared variant whose published copy is stale), the unpublished private commit subjects, and every
  guard's verdict. It changes nothing and exits `0` even when nothing is pending.
- `prepare` fetches `upstream`, copies the product delta into a fresh `publish/<slug>` branch in the
  public working tree, runs the generators, runs the guards, and commits once
  (`chore(publish): <n> product changes` unless `--title` overrides it), with the squashed private
  subjects in the body. It ends by printing `prepared <branch> at <sha>` and the exact `publish` line
  for that branch. `--dry-run` does everything except keep the branch: both working trees are
  unchanged at exit.
- `publish` pushes the prepared branch to `upstream` and, with `--create-pr`, opens the pull request
  and prints its URL. `--rewrite` re-prepares an existing branch with `--force-with-lease`; it is
  refused while the branch has an open pull request, so a review in progress is never rewritten.
- `prepare` and `publish` derive the branch name from `--title`, so pass the same `--title` to both or
  reuse the `--branch` printed by `prepare`. Asked for a branch that does not exist, `publish` lists
  the prepared ones and exits `2`.
- `--repo <path>` points at a public working tree other than `defaultRepoPath`
  (`../micro-otter`).

Exit codes are the contract: `0` success (including `nothing unpublished`), `2` a guard or config
failure with the offender named on stderr, `1` an unexpected `git`/`gh` failure with the command line
printed. A refused publication never exits `0`.

## 4. Guards

`prepare` runs all eight guards below, in this order; `status` runs the five that do not need a
prepared branch (1–4 and 6) and prints `skip` for 5, 7, and 8, so an unprepared tree never looks like
a guard failure. Each failure stops the publication with exit `2` and names the path, string, or
command that failed.

1. **Clean private tree** — `git status --porcelain` must be empty. An uncommitted product edit would
   otherwise be published without a record of what it was.
2. **Sync-down** — `git rev-list --count HEAD..upstream/main -- . ':(exclude)ldev'` must be `0`. A
   non-zero count means the public tree has product commits this tree lacks; publishing anyway would
   silently revert them.
3. **Leak** — the prepared branch must not track `ldev/*` or any path under `untrackedPaths`
   (`.venv/`, `node_modules/`, `_dist/`, `_input/`, `_output/`, `_tmp/`, `test-output.txt`,
   `test-visibility.js`, and `tools/mod/`, the retired dev-sync scaffolding that must never come
   back). This protects the public tree from private plans and local build state.
4. **Forbidden strings** — every tracked path and every tracked text file is scanned for the
   `forbiddenStrings` in `ldev/tools/publish-config.json`: the private repository's name and its
   absolute workspace path. Matches are reported as `path:line` (this page does not print them — it is
   published, and the scan would reject it). A tracked path starting with `ldev/` also fails. The
   public tree must not name the private repository.
5. **Parity with declared variants** — for every product path in the delta, the prepared blob id must
   equal the private `HEAD` blob id; for every `variants` entry, the prepared file must equal
   `git hash-object <source>`. This is what makes "byte-identical except the declared variant" a
   checked fact instead of an intention.
6. **Stale plan-tree references** — `findStaleRefs()` from `ldev/tools/rewrite-dev-refs.mjs` runs over
   the prepared tree and rejects `dev/<plan-folder>` references in published files, so a plan link can
   never leak into the public tree.
7. **Generated files** — the tool stages the tree after the first generator pass and runs the
   generators again; afterwards `git diff` and `git ls-files --others --exclude-standard` must both be
   empty in the public tree. A drifted or newly created generated file means the commit would be built
   from output nobody staged.
8. **Device manifests** — the publication commit uses `--no-verify`, so the device version hook never
   runs. Every `src/micro_otter/nodes/device/**/manifest.json` must therefore equal the private `HEAD`
   blob exactly, which proves the skipped bump changed nothing a published consumer would see.

## 5. Sync down

Sync down *before* publishing, never after. A direct fix to a published file (for example
`dev/README.md`) or a security patch applied on the public side is a product commit this tree does not
have, and the next publication would revert it.

```bash
git fetch upstream
git rev-list --count HEAD..upstream/main -- . ':(exclude)ldev'   # expect 0
git merge upstream/main                                          # when it is not 0
```

Guard 2 enforces the same count, so `status` is the quick check and the guard is the gate.

A public repository seeded with its own commits (a fresh pair) shares no history with this tree yet.
`git rev-list` still counts those commits, and `git diff <remote>/main...HEAD` has no merge base, so the
first sync down has to allow unrelated histories:

```bash
git merge --allow-unrelated-histories upstream/main
```

Resolve the add/add conflicts in favor of this tree, which holds the newer product content. After that
merge the two histories are joined, the delta is a normal three-dot comparison, and every later sync
down is a plain merge.

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
- Until the first public tag is mirrored, `git describe --tags` in this tree resolves through
  `archive/v1.42.2` and `git describe --tags --match 'v[0-9]*'` finds nothing.

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

- **Before the merge:** delete the publication branch. Nothing reached `main`.
- **After the merge:** revert the merge commit on the public side (a revert pull request), and merge
  the same revert back down here. The private tree is unaffected either way.
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

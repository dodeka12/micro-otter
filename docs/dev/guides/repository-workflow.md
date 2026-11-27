# Repository workflow: private tree, public tree, publication

Micro-Otter is developed in a private repository and published to a public one. This page explains the
two trees, where the version comes from, how a publication is prepared and landed, and what each build
artifact contains. Administration details for the public repository (rulesets, secrets, rollback) live
in [docs/admin/release-sync.md](../../admin/release-sync.md).

> Start with the one-page model
> ([../../admin/two-repository-model.md](../../admin/two-repository-model.md)) and the routing
> procedure ([../../workflow/two-repository-workflow.md](../../workflow/two-repository-workflow.md)).
> This page is the detail reference.

## The two trees

| Remote | Repository | Role |
|--------|------------|------|
| `origin` | The private development repository (name deliberately not published) | Private trunk of record; all development happens here |
| `upstream` | `dodeka12/micro-otter` | Public trunk; receives squashed publication commits only |

The private tree carries two things the public tree does not:

- `ldev/` — the maintainers' working plan tree (`ldev/todos/`, `ldev/ideas/`, `ldev/tools/`). It is
  never published; `publish-config.json` lists it under `excludedPaths`.
- `agents-local.md` — the maintainer-only agent rules: the private plan tree and the publication
  procedure. It is excluded the same way, so `AGENTS.md` publishes verbatim and is identical in both
  trees.

`dev/` is different: it is a tracked scaffold that *is* published verbatim — `dev/README.md` plus
empty `ideas/`, `todos/`, `todos/_done/`, `nodes/`, `manual_tests/`, and `tools/` folders. It holds no
plan files and no generated content, so a contributor cloning the public repository sees the same
shape.

Every other tracked file is byte-identical in both trees, except the one declared variant,
`.devcontainer/devcontainer.json`. Two guards keep it that way: the delta builder only ever writes the
delta paths, so `excludedPaths` is structural, and the parity comparison holds the prepared tree's
blobs to the private `HEAD` (and the variant to its source,
`ldev/devcontainer/devcontainer.public.json`).

The tool runs only in the private tree. Both remotes are configured there: `origin` for private work
and `upstream` (`publicRemote`) for fetching and publishing. No public checkout is needed — `prepare`
builds a commit object with git plumbing, and `publish` pushes that ref.

## The version producers

Nothing version-related is tracked. Two build steps write the version, and one fallback covers the rest:

1. **hatch-vcs → `src/micro_otter/_version.py`** at install and build time. `pyproject.toml` sets
   `raw-options` with `fallback_version = "0.0.0"` and a `tag_regex` that accepts both the archived
   private tags (`archive/v1.42.2`) and the public ones (`v1.43.0`). The file is gitignored.
2. **vite `closeBundle` → `_dist/webapp/html/version.json`** at bundle build, written by the
   `micro-otter-version-stamp` plugin in `vite.config.js` from the value `tools/project-version.mjs`
   reads out of `_version.py`. `readProjectVersion()` **throws** with the `uv sync` remediation rather
   than inventing a version.
3. **`importlib.metadata`** as the import-time fallback in `src/micro_otter/__init__.py`, and
   `"0.0.0+unknown"` when the package is not installed at all.

`GET /api/version` and the server capabilities `version` key both report `micro_otter.__version__`, and
`detect_stale_static_root(static_root, package_version)` compares the bundle's stamp with that same
value, so a stale `_dist/webapp` is reported against the package, not against a tracked file.

Because `npm run build` reads `_version.py`, a Node-only machine must run a Python install first
(`uv sync --group dev`) — that is why the CI `web` job sets up `uv` and runs
`uv sync --group dev --reinstall-package micro-otter` before `npm run build`. The explicit reinstall
matters: `uv sync` alone is a no-op once the environment has the project and would not re-run the
hatch-vcs hook.

The version you see in a given checkout follows its tags. The private tree reports
`1.42.3.devN+…` because `git describe` prefers the nearer `archive/v1.42.2`; a public clone at
`v1.43.0` reports `1.43.0`. Release artifacts therefore come from the public tag, not from a
development tree.

## The publication tool

`node ldev/tools/publish.mjs <command>` has four working commands plus `help`, and no npm script,
because `package.json` is itself a published file.

| Command | Flags | What it does |
|---------|-------|--------------|
| `status` | — | Prints the public tip, the product delta, the unpublished subjects, and the guards that need no checkout |
| `prepare` | `--dry-run`, `--rewrite`, `--title <subject>`, `--branch <name>` | Builds the squashed commit object on `refs/heads/publish/<slug>`: scratch index, generator pass in a throwaway worktree, guards, `commit-tree` |
| `publish` | `--create-pr`, `--rewrite`, `--title <subject>`, `--branch <name>` | Pushes the prepared ref to `upstream`, optionally opening the pull request with `gh` |
| `sync` | — | Fetches `upstream` and merges its `main` back into this tree |

Exit codes: `0` success (including `nothing unpublished` and a completed `--dry-run`), `2` usage error,
configuration error, guard failure, or a refused publication, `1` an unexpected `git`/`gh` failure with
the failing command line in the message.

The eight guards, in the order they run:

1. `clean private tree` — no uncommitted or untracked product changes.
2. `sync-down` — the public `main` carries no product commit this tree lacks.
3. `leak` — no `ldev/` path, `_dist/`, `.venv/`, `node_modules/`, or other untracked path in the delta.
4. `forbidden strings` — no private repository name and no private workspace path in published text
   (both literals are declared in `publish-config.json` and deliberately not repeated here).
5. `variant parity` — every product path in the prepared tree carries the private `HEAD` blob, every
   deleted path is absent, and each declared variant equals its source. The devcontainer is the one
   declared variant, so it is the only file compared against a source blob.
6. `stale plan references` — published text names the scaffold's `todos/`, never a `dev/`-prefixed
   plan folder or the private tree.
7. `generated files` — a second generator pass in the throwaway worktree leaves no unstaged edit and
   no untracked file behind.
8. `device manifests` — every device `manifest.json` in the prepared tree equals the private `HEAD`
   blob, because `commit-tree` runs no hook.

`status` stages the delta into a scratch index and runs every guard except `generated files`, printing
`skip` for that one, because it needs files on disk. The devcontainer variant appears as a `V` row
while its published copy is stale. A delta row whose declared variant already equals the published
blob is dropped, and a stale variant the delta does not mention is appended as a `V` row.

`ldev/tools/publish-config.json` is the whole configuration:

```json
{
    "publicRemote": "upstream",
    "branchPrefix": "publish/",
    "excludedPaths": ["ldev/", "agents-local.md"],
    "forbiddenStrings": ["<private repository name>", "<private workspace path>"],
    "untrackedPaths": ["tools/mod/", "_dist/", ".venv/", "node_modules/", "…"],
    "variants": {
        ".devcontainer/devcontainer.json": {
            "source": "ldev/devcontainer/devcontainer.public.json",
            "reason": "…"
        }
    }
}
```

Guard results are tested with the Node test runner over the tool's fixtures:

```bash
node --test 'ldev/tools/tests/**/*.test.mjs'
```

The glob form is required: a positional directory is treated as a module path and fails to load.

### Executed publication sequence

```bash
node ldev/tools/publish.mjs status
node ldev/tools/publish.mjs prepare --title "chore(publish): installation & distribution foundation"
node ldev/tools/publish.mjs publish \
  --branch publish/2026-11-24-chore-publish-installation-distribution \
  --title "chore(publish): installation & distribution foundation" --create-pr
# wait for python/docs/web, then merge and tag (see below)
```

Three operational facts come from the first real run:

- The prepared commit message and the pull-request body are the same text, capped at `60000`
  characters with a `… and N further commit(s) omitted` trailer, because GitHub rejects bodies above
  `65536`. The pull-request **title** is the publication title (the prepared commit's subject or
  `--title`), never a change count, so a squash merge keeps it.
- `prepare --rewrite` refuses a branch with an open pull request. Closing the pull request, rewriting,
  and force-pushing does **not** let you reopen it — GitHub refuses — so a rewrite ends with a fresh
  pull request.
- `main` in the public repository requires one approving review, and GitHub does not allow
  self-approval, so a single maintainer merges with the ruleset bypass:
  `gh pr merge <number> --squash --admin`.

After the merge the tree mirrors the tag with `git fetch upstream --tags` once a tag exists. Tagging is
**manual**: `bump-version.yml` is a `workflow_dispatch` helper only, because a release is assembled by
hand ([release.md](../../workflow/release.md)). The job is guarded to the public repository, because a
merge here releases nothing, and it fails the run when the checkout has no `v*` tag: the action derives
the next version from those tags alone and otherwise falls back to `0.0.0`, which is how `v0.0.1` was
minted twice. `v1.43.0` was seeded by hand as a signed annotated tag; workflow-minted tags are
lightweight. A `v*` tag must never exist in both repositories — the sync-down fetch fails with
`would clobber existing tag`.

Then sync down. No shared file differs between the trees, so the merge should be clean:

```bash
node ldev/tools/publish.mjs sync
git diff --stat upstream/main HEAD -- . ':(exclude)ldev' ':(exclude)agents-local.md'
```

`sync` fetches `upstream --prune --tags`, merges `upstream/main`, and adds
`--allow-unrelated-histories` by itself while the two histories are disjoint; a conflict exits `2` and
leaves the merge in place. That diff must be empty; anything in it means the merge dropped or missed a
product change.

## The plan-tree convention

Plans live in one tree whose path differs per repository. Shared documents therefore never spell it
out: they say *"see `AGENTS.md` → **Planning**"*, and the skill templates use the `<plan-tree>`
placeholder. In the private repository that is `ldev/todos/` (with `ldev/todos/_done/` for finished
plans); in the published repository it is `todos/` under the `dev/` scaffold.

Published text must not name a plan folder through its old `dev/` prefix; the
`stale plan references` guard blocks a publication that would ship one. To see the offenders early, run
`node ldev/tools/rewrite-dev-refs.mjs --check` before preparing a publication.

## Sdist vs wheel

| Artifact | Contents | Use |
|----------|----------|-----|
| sdist (`.tar.gz`) | `src/`, `tests/`, `tools/`, `pyproject.toml`, `README.md`, `LICENSE`, `.gitignore` — no `ldev/`, no `dev/` | Source inspection and downstream packagers |
| wheel (`.whl`) | The installed package, including the generated `micro_otter/_version.py`; no `html/version.json` | **Supported install path**: `uv pip install <wheel>` |

Build a release artifact from a clone at the tag with `uv build --wheel`. Plain `uv build` builds the
wheel *from the sdist*, which has no `.git`, so hatch-vcs falls back to `0.0.0`; the `--wheel` form
builds directly from the checkout and stamps the tag. Final decisions about where artifacts are
published belong to the installation-and-distribution milestone; this page records what the current
build produces.


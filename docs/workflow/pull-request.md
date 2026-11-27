# Workflow: Pull Request

How to open a pull request for a feature/fix branch.

> **Which repository?** This page is PR A — the pull request in the private development repository, the
> only one you write by hand. Product changes reach the public `micro-otter` repository through a
> generated publication commit instead; see
> [two-repository-workflow.md](two-repository-workflow.md).

## Overview

1. Run the full validation gate — all must pass.
2. Write the PR summary to a temp file.
3. Push the branch and create the PR with the `gh` CLI.
4. Merge using GitHub's "Squash and merge".

> **Do not squash locally.** The pre-commit hook (`hooks/device_version_hook.py`)
> derives each device package's `manifest.json` version from the Conventional
> Commit prefix — one bump per commit. A `git reset --soft <base>` squash would
> collapse all those bumps into a single increment and downgrade the manifests
> (e.g. `1.18.0` → `1.1.0`). Push the branch as-is and squash at merge time on
> GitHub instead, which combines the commits' net diff without re-running the
> local hook.

## Prerequisites

- The branch is fully committed locally.
- A branch changelog exists at `docs/changelog/YYYY/MM/DD_<branch-name>.md`
  (see `docs/workflow/changelog.md`).

## Steps

### 1. Run the full validation gate

Run the strict local CI checks, the Node test suite, the TypeScript type check,
and the Python tests, and require all of them to succeed before doing anything
else:

```powershell
npm run check:ci-local
npm run test:node
npm run typecheck
uv run pytest -q
```

- If any check fails, fix it and re-run. Do **not** open the PR with failing
  tests, lint errors, or type errors.
- `npm run check:ci-local` is the same gate the pre-push hook runs (lockfile
  sync, generated webapp version, OSS list, payload docs, event-payload
  emissions, then `npm run lint`, `npm run lint:python` and
  `npm run check:device-syntax`).
- `npm run test:node` runs the Node test suites (both `.test.js` and `.test.ts`
  through the `tsx` loader).
- `npm run typecheck` runs `tsc --noEmit` over the TypeScript sources.
- `uv run pytest -q` runs the Python test suite.

### 2. Write the PR body to a temp file

Write a short summary of the changes to a temporary file. Using a file keeps
the `gh` invocation stable (no argument-length or quoting problems):

```powershell
$body = Join-Path $env:TEMP ("pr_body_" + (Get-Date -Format "yyyyMMdd_HHmmss") + ".md")
@'
## What changed
- Short summary of the changes.

## New behavior
A sentence or two on what users will now observe.
'@ | Set-Content -Path $body -Encoding utf8
```

### 3. Push the branch and create the PR

```powershell
git push -u origin <branch-name>
gh pr create --title "<short summary>" --body-file $body
Remove-Item $body
```

- `--body-file` reads the PR text from the temp file, which is the most stable
  way to pass multi-line text to `gh`.
- Use a Conventional Commit style title. It is what the changelog and the release notes
  are read from; tagging and publishing are manual
  (see [release.md](release.md)), and a merge in the private repository is never released.

### 4. Merge using GitHub's "Squash and merge"

- On the PR page, choose **"Squash and merge"**.
- The PR title becomes the single commit message on `main`.
- GitHub combines the commits' net diff, so the device manifests keep their
  accumulated versions (no downgrade).
- The detailed commits remain on `origin/<branch-name>`; no local backup branch
  is needed because history is not rewritten.

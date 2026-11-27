# GitHub Repository Setup

This document outlines the required GitHub settings and configurations for the micro-otter repository to enforce a standard PR process.

## Branch Protection Rules

Configure these settings under **Settings → Branches → Add rule for `main`**:

### Required Settings

- ✅ **Require a pull request before merging**
    - Require approvals: 1-2 reviewers
    - Dismiss stale pull request approvals when new commits are pushed
- ✅ **Require status checks to pass before merging**
    - Add: `lint-python`
    - Add: `lint-javascript`
- ✅ **Require conversation resolution before merging**
- ✅ **Require linear history**
- ✅ **Include administrators** (enforce rules for everyone)
- ✅ **Do not allow bypassing the above settings**

## General Repository Settings

Configure under **Settings → General → Pull Requests**:

- ✅ Disable "Allow merge commits" (use squash or rebase only)
- ✅ Enable "Automatically delete head branches"
- ✅ Allow squash merging
- ✅ Allow rebase merging

## Understanding Merge Strategies

This section explains the merge strategy settings and what they mean for developers.

### The Three Merge Strategies

#### 1. Merge Commit (DISABLED)

Creates a merge commit that ties together the histories of both branches.

```
main:     A---B---C-------F
                   \     /
feature:            D---E
```

**Result:** All individual commits (D, E) stay visible, plus a merge commit (F). This can make history messy with lots of merge commits.

#### 2. Squash Merge (ENABLED - Recommended)

Combines all your PR commits into one single commit on `main`.

```
main:     A---B---C---D'

feature:            D---E---F (collapsed into D')
```

**Result:** Multiple commits become 1 clean commit on `main`. History stays linear and clean.

#### 3. Rebase Merge (ENABLED)

Replays your commits one-by-one on top of `main`.

```
main:     A---B---C---D---E---F
```

**Result:** Your commits appear as if they were made directly on `main`. Also keeps history linear.

### What Developers Need to Do

**Good news: Your workflow doesn't change!** You continue working normally:

1. Create a branch: `git checkout -b my-feature`
2. Make commits normally: `git commit -s -m "Add feature X"`
3. Make as many commits as needed
4. Push your branch: `git push origin my-feature`
5. Open a pull request on GitHub
6. When ready to merge, use GitHub's dropdown to choose:
    - **"Squash and merge"** (most common - combines all commits into one)
    - **"Rebase and merge"** (keeps commits separate but linear)

The setting just **removes** the "Create a merge commit" option from the dropdown.

### Why Squash/Rebase Only?

Benefits of this approach:

- `main` branch history stays clean and linear
- Easy to read commit history: `git log --oneline`
- Easy to revert: one PR = one commit (with squash)
- Easier to cherry-pick features to other branches
- No "merge branch 'feature' into main" noise

### Example Workflow

```bash
# Your normal workflow (unchanged):
git checkout -b add-new-feature
git commit -s -m "Add database model"
git commit -s -m "Add API endpoint"
git commit -s -m "Add tests"
git push origin add-new-feature

# On GitHub PR page, when ready to merge:
# Click the dropdown next to "Merge pull request"
# Select "Squash and merge"
# Write a clear commit message summarizing all changes
# Click "Confirm squash and merge"
```

You can make as many commits as you want in your branch. GitHub will squash them when merging, keeping `main` clean.

## Developer Certificate of Origin (DCO)

All commits must be signed-off to certify that contributors have the right to submit their code.

### Installation

1. Install the [DCO GitHub App](https://github.com/apps/dco) for your repository
2. The app will automatically check for `Signed-off-by` lines in all commits

### For Contributors

Sign off commits using:

```bash
git commit -s -m "Your commit message"
```

## Code Style Enforcement

The repository enforces code styles through automated CI checks:

### Python

- **black**: Code formatting (line length: 100)
- **ruff**: Linting and import sorting

Run locally:

```bash
black .
ruff check .
```

### JavaScript

- **ESLint**: Code linting
- **Prettier**: Code formatting

Run locally:

```bash
npm run lint
npx prettier --check "**/*.{js,jsx,ts,tsx,json,css,md}"
```

## Continuous Integration

GitHub Actions workflow ([.github/workflows/ci.yml](../../.github/workflows/ci.yml)) runs on:

- All pull requests to `main` in the published repository `dodeka12/micro-otter`
- Direct pushes to `main` of that repository (once disabled via branch protection)
- Manual **Run workflow** in either repository

Every automatic job carries `if: github.repository == 'dodeka12/micro-otter' || github.event_name ==
'workflow_dispatch'`, so a pull request or merge in the development repository skips all jobs and
spends no runner minutes. `tests/test_ci_workflow.py` pins that guard on every automatic job.

### CI Jobs

1. **`python`**: `uv run ruff check src/ tools/ tests/` plus `uv run pytest`
2. **`web`**: `npm ci`, the generated-file and payload gates, ESLint, Prettier, `typecheck`,
   `test:vitest`, and `npm run build` (which needs the Python install that writes
   `src/micro_otter/_version.py`)
3. **`docs`**: `uv run mkdocs build --strict`, `npm run check:docs-links`, uploads `site/`
4. **`packaging`**: `bash deploy/packaging/build-wheel.sh` and `verify-wheel.sh`, uploads the wheel
5. **`docker`**: builds `deploy/docker/Dockerfile.runtime`, smokes the container, validates the
   compose profiles
6. **`windows`**: **manual only** (`if: github.event_name == 'workflow_dispatch'`):
   `pwsh -File deploy/packaging/build-exe.ps1`, smokes the exe, uploads it. The exe is built when a
   release is assembled by hand ([docs/workflow/release.md](../workflow/release.md)), never on a pull
   request; the job id stays in the required-check set, where a skipped job satisfies the check.

`bump-version.yml` is likewise `workflow_dispatch` only: nothing tags a merge any more.

`npm run test:node` is suspended in CI for now; it was 386 s of the ~400 s `web` job. Run it locally
before a publication and before merging anything under `tools/`, `tests/`, `src/micro_otter/` or
`deploy/` — see
[testing-architecture.md](../dev/guides/testing-architecture.md#temporary-ci-split).

The job ids are the required status-check names; the local equivalents are listed in
[CONTRIBUTING.md](../../CONTRIBUTING.md#continuous-integration).

## Configuration Files

The following files configure the code style standards:

- [pyproject.toml](../../pyproject.toml) - Python tools configuration (black, ruff)
- [eslint.config.js](../../eslint.config.js) - JavaScript and TypeScript linting rules
- [.prettierrc](../../.prettierrc) - JavaScript formatting rules
- [.github/PULL_REQUEST_TEMPLATE.md](../../.github/PULL_REQUEST_TEMPLATE.md) - PR template with DCO reminder

## Pull Request Process

1. Fork the repository
2. Create a feature branch
3. Make changes following code style guidelines
4. Sign off all commits: `git commit -s`
5. Push to your fork
6. Open a pull request against `main`
7. Address review comments
8. Wait for CI checks to pass
9. Obtain required approvals
10. Maintainer will merge once approved

## Setting Up Your Environment

### Python Development

```bash
pip install black ruff
```

### JavaScript Development

```bash
npm install --save-dev eslint prettier
```

## Enforcement Timeline

After these settings are applied:

- No direct commits to `main` will be allowed
- All changes must go through pull requests
- All pull requests must pass CI checks
- All pull requests must have at least one approval
- All commits must be signed-off (DCO)

## Questions?

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for contribution guidelines or open an issue if you have questions about the process.

---

## Branch Ruleset Configuration (Modern Approach)

GitHub now offers **Rulesets** as a more flexible alternative to classic branch protection rules. This section documents the recommended configuration for the `main` branch ruleset.

### Essential Rules (Strongly Recommended)

#### ✅ Restrict deletions

- Prevents accidental deletion of the main branch
- Critical for production branches
- Only users with bypass permission can delete the branch

#### ✅ Require a pull request before merging

- Enables code review process
- Aligns with CONTRIBUTING.md guidelines
- Allows discussion and quality checks
- **Configuration:**
    - Require approvals: 1-2 (adjust based on team size)
    - Dismiss stale reviews when new commits pushed

#### ✅ Block force pushes

- Protects commit history from being rewritten
- Prevents accidental history loss
- Essential for collaborative development

#### ✅ Require signed commits

- Verifies commit authenticity via GPG signatures
- See [docs/general/git-gpg-signing.md](../general/git-gpg-signing.md) for setup
- Industry best practice for open source projects

#### ✅ Require status checks to pass

- Prevents broken code from merging into main
- Leverages existing test infrastructure
- **Required checks to configure:**
    - `python` - `uv run ruff check` plus `uv run pytest` (job in `.github/workflows/ci.yml`)
    - `web` - generated-file gates, lint, typecheck, `test:vitest`, and `npm run build`
      (`npm run test:node` is suspended in CI; see [CI Jobs](#ci-jobs))
    - `docs` - `uv run mkdocs build --strict`
    - These are the workflow **job ids**, not the workflow names; the ids are identical in both
      repositories. Only the published repository runs them: the development repository skips every
      job through the repository guard, and skipped checks do not block a merge there.
    - A single maintainer cannot satisfy the one-approval rule for a publication PR (GitHub forbids
      self-approval), so the release procedure merges with the ruleset bypass:
      `gh pr merge <n> --squash --admin`. See
      [release-sync.md](release-sync.md#first-publication-2026-11-24).
- **Options:**
    - ✅ Require branches to be up to date before merging

### Recommended Rules

#### ✅ Restrict updates

- Forces all changes through pull requests
- Prevents direct pushes to main
- Enforces the PR workflow consistently
- Complements "Require a pull request before merging"

#### ⚠️ Require linear history (Optional but recommended)

- Keeps git history clean and easy to follow
- Prevents merge commits from being created
- Use "Rebase and merge" or "Squash and merge" strategies only
- **Caveat:** Requires developers to rebase instead of merge
- **Note:** Already enabled in classic branch protection rules

### Optional Rules

#### ❓ Restrict creations

- Only needed if you want to control who can create new branches named `main`
- Generally not necessary for the main branch itself
- **Recommendation:** Not needed for typical workflows

#### ❓ Require deployments to succeed

- Only useful if you have automated deployment workflows
- Requires deployment environments to be configured first
- **Recommendation:** Skip unless you have CD pipeline

#### ❓ Require code scanning results

- Enable if you set up GitHub Advanced Security
- Catches security vulnerabilities automatically
- Requires GitHub Advanced Security subscription
- **Recommendation:** Enable when ready for security scanning

#### ❓ Require code quality results

- Choose severity levels that should block merges
- Requires code quality analysis tools configured
- **Recommendation:** Enable after establishing baseline

#### ❓ Automatically request Copilot code review

- Nice-to-have if team has Copilot access
- Provides additional automated review feedback
- **Recommendation:** Enable if team uses Copilot
- **Note:** Not a replacement for human review

#### ❓ Manage static analysis tools in Copilot code review

- Includes findings from static analysis in Copilot reviews
- Requires Copilot code review to be enabled
- **Recommendation:** Enable alongside Copilot review

### Recommended Ruleset Configuration

```yaml
Main Branch Ruleset:
├─ ✅ Restrict deletions
├─ ✅ Restrict updates
├─ ✅ Require pull request before merging
│   ├─ Require approvals: 1 (or 2 for sensitive projects)
│   ├─ Dismiss stale reviews when new commits pushed
│   └─ Require conversation resolution before merging
├─ ✅ Require status checks to pass
│   ├─ Require branches to be up to date
│   ├─ Required checks: python
│   ├─ Required checks: web
│   └─ Required checks: docs
├─ ✅ Require signed commits
├─ ✅ Block force pushes
└─ ⚠️ Require linear history
```

Tag rule (separate ruleset, `v*`):

```yaml
Release Tag Ruleset:
├─ Target: tags matching v*
├─ ✅ Restrict deletions
└─ ✅ Restrict updates   # a release tag is never moved
```

### Implementation Order

1. **Start with essential rules** (restrict deletions, PR requirement, block force push, signed commits)
2. **Add status checks** once CI/CD workflows are confirmed working
3. **Enable restrict updates** to enforce PR-only workflow
4. **Add linear history** after team is comfortable with rebasing
5. **Add code scanning** when ready to integrate security tools
6. **Enable Copilot features** if team has access and finds them valuable

### Benefits of This Configuration

- **Security:** Signed commits and deletion protection
- **Code Quality:** PR reviews and status checks
- **Clean History:** Linear history and squash/rebase merges
- **Collaboration:** Enforced review process
- **Flexibility:** Optional rules can be added incrementally

### Classic Branch Protection vs Rulesets

**Rulesets** offer several advantages over classic branch protection:

- More granular control over bypass permissions
- Can apply to multiple branches with patterns
- Better audit logging
- More flexible exception handling
- Modern UI with better organization

**Migration Note:** If you have classic branch protection rules configured, consider migrating to rulesets for better management. The settings documented in this guide complement the existing classic rules.

### Bypass Permissions

Ruleset bypass permissions allow specific users or teams to bypass rules when necessary (e.g., emergency hotfixes).

**Best Practice:** Limit bypass access to:

- Repository administrators only
- Emergency response team (if applicable)
- Never grant blanket bypass permissions

### Tags, artifacts and the two repositories

Two repositories carry this project: the private development repository (the trunk of record) and
`micro-otter` (public, published through squashed publication pull requests). Configure the branch and
tag rulesets described here in **both**; the three required check ids are identical because both run
the same `.github/workflows/ci.yml`. The topology, the publication commands, the guard list and the
sync-down merge are documented in [release-sync.md](release-sync.md) and, for developers, in
[docs/dev/guides/repository-workflow.md](../dev/guides/repository-workflow.md).

Package tags are `v<major>.<minor>.<patch>` and are created **only in `micro-otter`**, as signed
annotated tags on the publication merge commit; the private tree mirrors them with
`git fetch upstream --tags`. Nothing is published from the private repository, so a `v*` tag there
would only compete with the `archive/v*` history that `git describe` already walks. The `v*` ruleset
must therefore block deletion and updates: moving a release tag would invalidate every wheel built from
it. Firmware tags (`firmware-v<base>`) follow the same rule and are documented in
[docs/workflow/release.md](../workflow/release.md).



After applying the ruleset:

1. Monitor the **Insights → Pulse** tab for merge activity
2. Review **Settings → Rulesets → Insights** for rule violations
3. Adjust rules based on team feedback
4. Document exceptions in this file if bypass is used

### Testing the Configuration

Before fully enforcing, test with a practice branch:

1. Create a test branch matching the ruleset pattern
2. Attempt operations that should be blocked
3. Verify status checks trigger correctly
4. Confirm PR approval workflow works as expected
5. Test signed commit verification

Once validated, apply to `main` branch.

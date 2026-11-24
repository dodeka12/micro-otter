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

GitHub Actions workflow ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs on:

- All pull requests to `main`
- Direct pushes to `main` (once disabled via branch protection)

### CI Jobs

1. **lint-python**: Checks Python code with black and ruff
2. **lint-javascript**: Checks JavaScript code with ESLint and Prettier

## Configuration Files

The following files configure the code style standards:

- [pyproject.toml](pyproject.toml) - Python tools configuration (black, ruff)
- [.eslintrc.json](.eslintrc.json) - JavaScript linting rules
- [.prettierrc.json](.prettierrc.json) - JavaScript formatting rules
- [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md) - PR template with DCO reminder

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

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines or open an issue if you have questions about the process.

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
    - `lint-python` - Python code quality
    - `lint-javascript` - JavaScript code quality
    - Test suite (if configured)
    - Build verification (if configured)
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
│   ├─ Required checks: lint-python
│   └─ Required checks: lint-javascript
├─ ✅ Require signed commits
├─ ✅ Block force pushes
└─ ⚠️ Require linear history
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

### Monitoring and Enforcement

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

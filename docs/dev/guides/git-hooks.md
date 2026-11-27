# Git Hooks and Manifest Version Bumps

The repository ships its git hooks in [hooks/](../../../hooks/) instead of `.git/hooks`. Enable them
once per clone:

```bash
git config core.hooksPath hooks
```

The dev container runs this in `post-create.sh`; see [devcontainer.md](devcontainer.md#preconfigured-git-settings).

Commit message format (Conventional Commits, `!`/`BREAKING CHANGE:` for major bumps) is documented in
[CONTRIBUTING.md](../../../CONTRIBUTING.md).

## commit-msg — device version hook

[hooks/commit-msg](../../../hooks/commit-msg) runs
[hooks/device_version_hook.py](../../../hooks/device_version_hook.py) with the managed virtualenv
python when `.venv` exists, else a system interpreter. It inspects the staged paths and bumps the
matching `manifest.json` versions in the same commit:

- any staged file under `src/micro_otter/nodes/device/runtime/<id>/` (excluding that runtime's own
  `manifest.json`) bumps `…/runtime/<id>/manifest.json`;
- any staged file under `src/micro_otter/nodes/device/node_pkgs/<pkg>/` bumps that package's
  `manifest.json`;
- the same rule applies to `device/tools/manifest.json` and the firmware-compile
  `runtime_assets/manifest.json`.

The bump size comes from the commit prefix and the changed file classes
(`micro_otter.tools.firmware_compile.version_identity.decide_runtime_firmware_bump`):

| Commit | Bump |
| --- | --- |
| `feat:` | minor |
| `fix:`, `docs:`, `chore:`, `style:`, `refactor:`, `perf:`, `test:`, `build:`, `ci:`, `revert:` | patch |
| `!` before the colon, or a `BREAKING CHANGE:` footer | major |

A device commit without one of these prefixes is rejected
(`Commit message must use Conventional Commit prefix`), so every firmware change records the semantic
bump it causes. When the hook bumps and stages a manifest, it prints
`[device-version] <path> -> <version> (<type>)` and aborts the commit with
*"Device manifest versions were bumped and staged. Re-run your git commit command…"*; the next
attempt succeeds and includes the staged version.

## pre-commit — generated web metadata

[hooks/pre-commit](../../../hooks/pre-commit) regenerates
`src/micro_otter/nodes/html/js/core/open-source-packages.generated.js` with
`tools/generate-open-source-packages.mjs` and stages it when the content changed, so a commit never
carries a stale OSS attribution list. Node.js must be on `PATH`; the hook fails otherwise.

## pre-push — the full local gate

[hooks/pre-push](../../../hooks/pre-push) runs `npm run check:ci-local` before any non-delete push.
That command chains the lockfile, generated-file and payload checks with the three lint gates
(`npm run lint`, `npm run lint:python`, `npm run check:device-syntax`); a failure blocks the push
instead of showing up in CI. The gates themselves are documented in
[coding-style-guide.md](coding-style-guide.md#tooling) and
[build-and-deployment.md](build-and-deployment.md#repository-ci-baseline).

## Related documentation

- [CONTRIBUTING.md](../../../CONTRIBUTING.md) — commit and pull-request conventions
- [coding-style-guide.md](coding-style-guide.md#tooling) — lint and device-syntax gates
- [build-and-deployment.md](build-and-deployment.md#repository-ci-baseline) — what CI runs and when

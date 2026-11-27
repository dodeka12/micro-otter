# Changes since version 1.43.0

## Build

- **The devcontainer configuration is one file** — `.devcontainer/devcontainer.json` mounts this
  workspace plus the `${HOME}/micro_otter/{opt,cline}` host folders, and every other setting is shared.
  `tests/test_devcontainer_bootstrap.py` fails when the config stops matching those expectations.

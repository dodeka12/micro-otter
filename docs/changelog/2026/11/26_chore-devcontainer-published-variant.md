# Changes since version 1.43.0

## Build

- **The published devcontainer is a declared publication variant** —
  `ldev/tools/publish-config.json` maps `.devcontainer/devcontainer.json` to
  `ldev/devcontainer/devcontainer.public.json`, so `prepare` ships a portable config without the
  maintainer's public-clone bind mount while the development container keeps it.
  `tests/test_devcontainer_bootstrap.py` and `ldev/tools/tests/agents-contract.test.mjs` fail when
  the variant and the development config differ by anything but that mount, or when the declaration
  disappears.

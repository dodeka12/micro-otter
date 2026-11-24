# Deploy Layout (`deploy/`)

Installation and distribution work lives in a single top-level `deploy/` tree. The layout is the
contract that keeps three milestones from creating overlapping install paths:

| Folder | Owner | Owns |
| --- | --- | --- |
| `deploy/toolchain/` | M1 | Host toolchain installation (ESP-IDF, MicroPython, `mpy-cross`) and the shared version pins. |
| `deploy/docker/` | M7 | Runtime and compile container images, compose profiles, entrypoints. |
| `deploy/release/` | M8 | Firmware release builds, release indexes (`index.json`), publish/verification tooling. |
| `deploy/packaging/` | M7 | Wheel and PyInstaller packaging of the local server. |

M1 creates the tree, the toolchain folder, and the platform-agnostic backend seams. `docker/`,
`release/`, and `packaging/` contain a README only until their milestone starts; a structural test
(`tests/test_deploy_layout.py`) fails when a placeholder folder gains unreviewed content.

## Toolchain layout

```text
deploy/toolchain/
├── README.md      # backend-toolchain contract
├── versions.env   # canonical pins shared by every consumer
├── bootstrap.sh   # dispatcher: runs the selected backend bootstrap
├── doctor.sh      # dispatcher: generic host checks, then the backend doctor hook
└── esp-idf/
    ├── bootstrap.sh  # ESP-IDF + MicroPython clone/install
    └── idf.py        # repository-owned idf.py launcher (the only copy)
```

`deploy/toolchain/versions.env` is the single source of pin truth. The devcontainer `Dockerfile`
mirrors those values as `ENV` defaults, and `tests/test_toolchain_scripts.py` fails when the mirror
drifts. See [deploy/toolchain/README.md](../../../deploy/toolchain/README.md) for the
backend-toolchain contract (dispatcher variables, required and optional per-backend scripts, and the
rule that nothing hardcodes a backend's install paths) and
[../guides/updating-micropython-idf-toolchain.md](../guides/updating-micropython-idf-toolchain.md)
for the update procedure.

### The `idf.py` launcher

`deploy/toolchain/esp-idf/idf.py` is the repository's single ESP-IDF launcher. It derives
`IDF_PATH`/`IDF_TOOLS_PATH` from `MICRO_OTTER_TOOLCHAIN_DIR` (falling back to `/opt/esp-idf` and
`/opt/.espressif`), sources `${IDF_PATH}/export.sh` when present, and `exec`s
`${IDF_PATH}/tools/idf.py` with the caller's arguments. An exported `IDF_PATH` always wins, and a
missing checkout exits `127` with a `micro-otter toolchain install` hint.

Two consumers resolve it, and nothing else may hardcode a launcher path:

- `Config.idf_py` (`micro_otter.config`) returns the launcher path without probing `PATH`.
- `Config.toolchain_env()` returns the child-process environment
  (`MICRO_OTTER_TOOLCHAIN_DIR`, `IDF_PATH`, `IDF_TOOLS_PATH`, `MICROPYTHON_ROOT`, plus the launcher
  directory prepended to `PATH`). Build orchestration and the CLI deploy path pass that mapping to
  `idf.py` instead of assembling the variables themselves.

`src/micro_otter/toolchain/assets.py` is the only place that knows where these assets live on disk
(`MICRO_OTTER_TOOLCHAIN_ASSETS`, the checkout copy, then a packaged copy), so M7 can ship them inside
the wheel without touching call sites.

Where `MICRO_OTTER_TOOLCHAIN_DIR`, `IDF_PATH`, `MICROPYTHON_ROOT`, and the `/opt` fallbacks come from —
and which layer wins when they disagree — is documented in the
[Configuration Reference](configuration.md). `micro-otter toolchain status` prints the same resolved
values with their winning source.

### Container parity

The image embeds no launcher copy. `.devcontainer/link-idf-launcher.sh` symlinks
`/usr/local/bin/idf.py` at the repository launcher and runs in `postCreateCommand` between
`deploy/toolchain/bootstrap.sh` and `.devcontainer/post-create.sh`, so `command -v idf.py` resolves
inside the container and a host checkout still works without the shim.

## What stays outside `deploy/`

Node-package source deployment is not a `deploy/` responsibility. The browser app keeps the
collection/deploy fallback that uploads local source for packages reported as `missing` or
`override-required` by the device, in
`src/micro_otter/nodes/html/js/deployment/`. That path is independent of firmware images, of
`BuildBackend`, and of `FlashBackend`: build and flash backends produce and write firmware images,
they never decide which node-package files get uploaded.

`tests/deployment/` continues to cover that source-upload path and is untouched by this iteration.

## Milestone map

- **M1** — this layout, shared pins, toolchain dispatchers, `BuildBackend` / `FlashBackend` seams
  with ESP-IDF and `esptool` adapters, board metadata, backend selection.
- **M7** — container images (`docker/`) and packaging (`packaging/`).
- **M8** — firmware releases and the firmware index (`release/`).

## Related

- [Build-backend contract](../firmware-compile/build-backend-contract.md)
- [Flash-backend contract](../firmware-compile/flash-backend-contract.md)
- [Board catalog contract](../firmware-compile/board-catalog-contract.md)

# Firmware Precompile and Device Deploy Workflow

This workflow shows how to:

1. Build firmware with an embedded Micro-Otter runtime using the implemented backend compile tools.
2. Flash that firmware to a device.
3. Verify embedded mode behavior.
4. Deploy a collection using the existing web deployment flow.

## Prerequisites

Before running the workflow:

1. Activate project environment.
2. Ensure MicroPython source tree exists at /opt/micropython or src/micropython.
3. Ensure runtime/device manifests are present in src/micro_otter/nodes/device/.
4. Ensure board toolchain prerequisites are installed for your target.
5. Ensure idf.py is available for ESP32 deployment.

Optional but recommended:

1. Start with --dry-run to validate paths/manifests.
2. Use the default human-readable output first for quick validation in the terminal.

Windows host note:

1. This devcontainer expects Linux serial devices such as `/dev/ttyUSB0` or `/dev/ttyACM0`.
2. On Linux hosts, the container bind-mounts the host `/dev`, so attached serial devices appear automatically.
3. On Windows hosts, Docker Desktop does not expose Windows COM ports into the container as Linux device nodes automatically.
4. Before running deploy commands from the container on Windows, install `usbipd-win`, share the device with `usbipd bind --busid <BUSID>`, and attach it to the Linux side.
5. If you are using WSL-backed Docker, attach with `usbipd attach --wsl --busid <BUSID>`.
6. If you are using Docker Desktop USB/IP forwarding, attach the device into the Docker host VM first, then verify the devcontainer sees `/dev/ttyUSB*` or `/dev/ttyACM*`.
7. Re-attach after reboot, unplug/replug, or device reset if the serial node disappears.

## Step 1: Validate Inputs With Dry-Run

Run compile-runtime in dry-run mode first:

```bash
mo cr \
  --runtime-id general \
  --board esp32 \
   --dry-run
```

Check in the human-readable output:

1. status is success
2. runtime.id and target.board are correct
3. paths.micropythonRoot and paths.modulesPath are expected
4. staging.conflicts is empty
5. build.exitCode is 0

If status is failed, use:

1. errors[*].category
2. build.exitCode

to resolve the issue before non-dry execution.

## Step 2: Build Firmware With Embedded Runtime

Run full compile:

```bash
mo cr \
  --runtime-id general \
  --board esp32 \
  --clean-staging \
   --clean-build
```

Optional compiled module packaging mode:

```bash
mo cr \
  --runtime-id general \
  --board esp32 \
  --module-packaging-mode compiled-mpy \
  --clean-staging \
   --clean-build
```

From the command output, capture:

1. paths.firmwareArtifact
2. staging.embeddedInventoryPath
3. staging.embeddedInventoryHash
4. metadata.modulePackagingMode
5. metadata.firmwareArtifactHash

## Step 3: Inspect Embedded Metadata (Optional but Recommended)

Validate generated metadata files under modules/otter:

1. embedded_manifest.json
2. embedded_hashes.json

Confirm they match selected runtime and target and include deterministic hash entries.

## Step 4: Flash Firmware To Device

On Windows-hosted devcontainers, verify the Linux serial node exists before flashing:

```bash
find /dev -maxdepth 2 \( -name 'ttyUSB*' -o -name 'ttyACM*' \)
```

If this command prints nothing, the board is not forwarded into the Linux side yet and `--port <PORT>` will not work from the container.

Use the CLI deployment command (ESP32):

```bash
mo deploy-runtime --port <PORT>
```

Short alias:

```bash
mo dr --port <PORT>
```

Optional monitor after flash:

```bash
mo deploy-runtime --port <PORT> --monitor
```

Optional filesystem wipe before flash:

```bash
mo deploy-runtime --port <PORT> --wipe-filesystem
```

ESP32-S3 (for example the ESP32-S3 Mini):

```bash
mo deploy-runtime --board esp32s3 --port <PORT>
```

First-time flash on a blank device (erase before writing is recommended):

```bash
mo deploy-runtime --board esp32s3 --port <PORT> --wipe-filesystem
```


Notes:

1. deploy-runtime expects compile output in the board's default build directory (`build-ESP32_GENERIC` for `esp32`, `build-ESP32_GENERIC_S3` for `esp32s3`) unless --build-dir is provided.
2. deploy-runtime supports --board esp32 and --board esp32s3.
3. Board parameters (chip, build directory, flash offset, accepted aliases) come from `src/micro_otter/nodes/device/firmware/boards.json`.
4. --wipe-filesystem runs `idf.py erase-flash` before flashing and removes prior filesystem data.
5. For custom board flashing layouts, you can still use board-specific esptool/idf.py flows directly.

Alternatively, use the interactive menu (`mo fw`) to pick a board and choose build or deploy
interactively; it remembers the last board, action, port, and wipe/monitor selections.

## Step 5: Verify Embedded Runtime Mode In Web App

After flashing and connecting the device in Micro-Otter:

1. Confirm runtime mode reports embedded.
2. Confirm runtime identity/version is shown from device metadata.
3. Confirm runtime reinstall-style actions are disabled for embedded mode.
4. Confirm collection deployment controls remain available.

## Step 6: Deploy Collection

Deploy a representative collection.

Expected behavior:

1. Collection artifacts under app/ and collection/ are updated as needed.
2. Library uploads are skipped when effective inventory already provides required files.
3. Embedded-path overrides occur only with explicit override input.

## Step 7: Validate Runtime Execution

On device, validate that:

1. Startup shim main.py invokes libs.micro_otter_main.run().
2. Collection runtime executes correctly.
3. Nodes requiring included package assets run without missing-module errors.

## Rollout Notes

Use staged rollout discipline:

1. Keep compile-runtime usage behind explicit developer-facing rollout controls.
2. Validate one reference board/runtime pair first.
3. Expand to additional boards/runtimes only after baseline stability.
4. Treat exit-code categories as rollout gates for triage and rollback decisions.

The precompile step now always passes `-march` for target builds (derived from the board), so
`@micropython.native`/`@micropython.viper` decorators compile in both the `COMPILED_MPY` firmware
path and the `__mpycache__` deploy path — not only the firmware freeze path.

## Troubleshooting Quick Map

Map failure category to likely action:

1. input-validation (2)
   1. Check CLI arguments and path scope rules.
2. manifest-resolution (3)
   1. Check runtime/tools/package manifests.
3. staging-conflict (4)
   1. Resolve duplicate canonical target mapping.
4. micropython-config (5)
   1. Check MicroPython root/modules tree and board selection.
5. build-toolchain-invocation (6)
   1. Verify required build tools are installed and runnable.
6. build-command-failed (7)
   1. Inspect compiler/build logs.
7. artifact-verification (8)
   1. Verify generated firmware artifact exists and is non-empty.
8. unexpected-internal (9)
   1. Capture full command output and logs for diagnosis.

## Related References

1. firmware-compile-reference.md
2. ../dev/firmware-compile/backend-compile-interface-contract.md
3. ../dev/firmware-compile/build-pipeline-integration.md
4. ../dev/deployment/deployment-system-architecture.md

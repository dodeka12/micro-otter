# MPY Runtime Workflow

This guide explains how to use the MPY workflow to:

1. Probe a connected MicroPython device for compatibility values.
2. Compile manifest-defined runtime and node package Python files into .mpy files.
3. Build hash-specific output folders keyed by compiler compatibility settings.
4. Deploy compiled .mpy files to the device and optionally remove matching .py files.

## Commands

The workflow uses these commands:

1. `mo compile-mpy` (alias: `mo cmpy`)
2. [tools/deploy_runtime_mpy_profile.py](../../tools/deploy_runtime_mpy_profile.py)

Related firmware flashing command:

1. `mo deploy-runtime` (alias: `mo dr`) flashes compiled firmware images (for example ESP32).

Implementation note:

1. `mo compile-mpy` is implemented in the package under
   `src/micro_otter/tools/firmware_compile/` and does not depend on the helper scripts in `tools/`.

## Prerequisites

1. Device connected and reachable via mpremote alias or port selector.
2. mpremote available in PATH or in project venv at .venv/bin/mpremote.
3. mpy-cross built and available:
   1. PATH, or
   2. src/micropython/mpy-cross/build/mpy-cross.

## 1) Probe + Compile (Recommended)

Use this to probe values from installed firmware, infer compile settings, and compile in one step.

```bash
mo compile-mpy --from-device --clean
```

Short alias:

```bash
mo cmpy --from-device --clean
```

JSON output for automation:

```bash
mo compile-mpy --from-device --json-output
```

Typical probed values include:

1. MicroPython version
2. mpy ABI (sys.implementation._mpy)
3. platform and machine
4. word bits / small_int_bits
5. Recommended compile settings

Optional compile overrides:

```bash
mo compile-mpy \
   --emit native \
   --small-int-bits 31 \
   --march xtensawin \
   --clean
```

JSON spec input:

```bash
mo compile-mpy --spec-file ./mpy-spec.json --clean
```

Minimal `mpy-spec.json` example:

```json
{
  "emit": "native",
  "smallIntBits": 31,
  "march": "xtensawin",
  "marchFlags": ""
}
```

Notes:

1. Source selection comes from runtime `filesystem` entries and node package `mpAssets` entries.
2. Output goes next to each source file in `__mpycache__/<hash>/`.
3. The hash is derived from compile parameters and mpy-cross version.
4. Each runtime manifest gets/updates `mpyCompileProfiles` mapping hash to parameters.
5. The ESP32 native arch is `xtensawin` (windowed ABI), not `xtensa` (the ESP8266 ABI).
   `@micropython.native`/`@micropython.viper` decorators require `-march` to compile — even when
   the default emitter is `bytecode`.

This generates/updates `__mpycache__/<hash>/` folders next to compiled sources.

## 4) Deploy a Compiled Profile to Device

Deploy latest profile (auto-selected), keep .py files:

```bash
/workspaces/micro-otter/.venv/bin/python tools/deploy_runtime_mpy_profile.py
```

Deploy and remove matching .py files:

```bash
/workspaces/micro-otter/.venv/bin/python tools/deploy_runtime_mpy_profile.py --remove-py
```

Deploy specific profile:

```bash
/workspaces/micro-otter/.venv/bin/python tools/deploy_runtime_mpy_profile.py \
   --profile <profile_name_or_hash> \
  --remove-py
```

Safe preview mode:

```bash
/workspaces/micro-otter/.venv/bin/python tools/deploy_runtime_mpy_profile.py --dry-run --remove-py
```

Behavior:

1. Performs soft-reset before filesystem changes.
2. Creates required directories on device.
3. Uploads all .mpy files with progress output.
4. Optionally removes matching .py files.

## Full End-to-End Commands

```bash
mo compile-mpy --from-device --clean
/workspaces/micro-otter/.venv/bin/python tools/deploy_runtime_mpy_profile.py --remove-py
```

## Troubleshooting

1. mpremote not found:
   1. Activate venv: source .venv/bin/activate
   2. Or pass --mpremote /path/to/mpremote
2. mpy-cross not found:
   1. Build at src/micropython/mpy-cross/build/mpy-cross
   2. Or pass --mpy-cross /path/to/mpy-cross
3. Import errors after deploy:
   1. Re-check probe values
   2. Recompile with matching settings using `mo compile-mpy --from-device`
4. Device file operations interrupted:
   1. Re-run deploy with --dry-run first
   2. Then run real deploy again

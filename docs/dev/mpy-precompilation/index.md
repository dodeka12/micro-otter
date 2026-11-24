# MPY Precompilation Documentation

This folder contains developer documentation for MicroPython `.mpy` precompilation in Micro-Otter.

## Scope

Use these documents when working on compile tooling, cache layout, compile profile metadata, and cross-language hash consistency.

## Documents

- [workflow.md](workflow.md) - Developer workflow for probing compatibility, compiling, and validating precompiled artifacts.
- [hash-spec.md](hash-spec.md) - Canonical compile-profile hash specification shared by Python tooling and frontend JavaScript.

## Device Syntax Gate

Precompilation needs a compiler on the host, so the device tree also gets a cheap correctness
gate from the same toolchain: `tools/check_device_syntax.py` (`npm run check:device-syntax`)
compiles every file under `src/micro_otter/nodes/device/**` with `mpy-cross` for both supported
architectures, and reports every file that fails to compile instead of stopping at the first.

This gate is *not* a second precompile step. It writes bytecode to `/dev/null` and produces no
artefacts; artefact generation stays with `tools/compile_runtime_mpy.py` and the firmware build.
See [workflow.md](workflow.md#device-syntax-gate) for the command, exit codes, and the reason
the device tree is intentionally not ruff-linted.

## Device API Subset Gate

`mpy-cross` compiles calls it cannot resolve — it does not know whether `str.isalnum()` or
`Task.exception()` exist in MicroPython, so both compiled fine and then raised `AttributeError` on
the board (runtime 1.50.0). `tests/test_device_micropython_api_guard.py` closes that gap: it scans
the device tree for CPython-only calls and fails the suite, with a `micropython-api-ok` marker for
documented exceptions. See
[workflow.md](workflow.md#compiled-is-not-available-the-runtime-api-surface) for the rule and how
to add a newly proven-missing call. The `code` skill requires both gates for device-tree changes.

## Related Sources

- [../../../tools/check_device_syntax.py](../../../tools/check_device_syntax.py)
- [../../../tests/test_device_micropython_api_guard.py](../../../tests/test_device_micropython_api_guard.py)
- [../../../src/micro_otter/tools/firmware_compile/mpy_precompile.py](../../../src/micro_otter/tools/firmware_compile/mpy_precompile.py)
- [../../../src/micro_otter/tools/firmware_compile/mpy_precompile_device.py](../../../src/micro_otter/tools/firmware_compile/mpy_precompile_device.py)
- [../../../src/micro_otter/tools/firmware_compile/mpy_probe.py](../../../src/micro_otter/tools/firmware_compile/mpy_probe.py)
- [../../../src/micro_otter/nodes/device/runtime/manifest.json](../../../src/micro_otter/nodes/device/runtime/manifest.json)

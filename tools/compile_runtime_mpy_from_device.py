#!/usr/bin/env python3
"""Probe device settings via mpremote and compile runtime .py files to .mpy.

This script reads compatibility values from the connected device, derives
recommended compiler parameters, and invokes tools/compile_runtime_mpy.py.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PROBE_SCRIPT = REPO_ROOT / "tools" / "probe_micropython_mpy.py"
COMPILE_SCRIPT = REPO_ROOT / "tools" / "compile_runtime_mpy.py"
DEFAULT_DEVICE_ROOT = REPO_ROOT / "src" / "micro_otter" / "nodes" / "device"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Probe device and compile manifest-driven .mpy artifacts with "
            "hash-based profiles."
        )
    )
    parser.add_argument("--port", default="u0", help="mpremote port selector (default: u0).")
    parser.add_argument(
        "--mpremote",
        default="mpremote",
        help="Path to mpremote executable for probe script (default: mpremote).",
    )
    parser.add_argument(
        "--mpy-cross",
        default=None,
        help="Path to mpy-cross executable for compile script.",
    )
    parser.add_argument(
        "--device-root",
        default=str(DEFAULT_DEVICE_ROOT),
        help="Optional override for nodes/device root folder.",
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Delete all __mpycache__ folders under runtime and node_pkgs before compile.",
    )
    parser.add_argument(
        "--emit",
        choices=("bytecode", "native", "viper"),
        default=None,
        help="Override emit mode (default: recommendation from probe).",
    )
    parser.add_argument(
        "--march",
        default=None,
        help="Override march value (default: recommendation for native/viper).",
    )
    parser.add_argument(
        "--print-commands",
        action="store_true",
        help="Print probe/compile commands before execution.",
    )
    return parser.parse_args()


def run_probe(args: argparse.Namespace) -> dict:
    command = [
        sys.executable,
        str(PROBE_SCRIPT),
        "--json",
        "--port",
        args.port,
        "--mpremote",
        args.mpremote,
    ]

    if args.print_commands:
        print("probe command:", " ".join(command))

    result = subprocess.run(command, check=False, capture_output=True, text=True)
    if result.returncode != 0:
        if result.stdout:
            print(result.stdout, file=sys.stderr, end="")
        if result.stderr:
            print(result.stderr, file=sys.stderr, end="")
        raise RuntimeError("probe script failed")

    try:
        return json.loads(result.stdout)
    except Exception as exc:
        print(result.stdout, file=sys.stderr, end="")
        raise RuntimeError(f"failed to parse probe JSON: {exc}") from exc


def run_compile(args: argparse.Namespace, values: dict) -> int:
    emit = args.emit or values.get("recommended_emit") or "bytecode"
    small_int_bits = values.get("recommended_small_int_bits")
    march_default = values.get("recommended_march") if emit in ("native", "viper") else None
    march = args.march if args.march is not None else march_default

    command = [sys.executable, str(COMPILE_SCRIPT), "--device-root", str(args.device_root)]
    if args.clean:
        command.append("--clean")
    if args.mpy_cross:
        command.extend(["--mpy-cross", args.mpy_cross])

    command.extend(["--emit", emit])

    if isinstance(small_int_bits, int):
        command.extend(["--small-int-bits", str(small_int_bits)])

    if march:
        command.extend(["--march", str(march)])

    if args.print_commands:
        print("compile command:", " ".join(command))

    print("Using emit:", emit)
    print("Using small_int_bits:", small_int_bits)
    print("Using march:", march)

    result = subprocess.run(command, check=False)
    return result.returncode


def main() -> int:
    if not PROBE_SCRIPT.is_file():
        print(f"Probe script not found: {PROBE_SCRIPT}", file=sys.stderr)
        return 1
    if not COMPILE_SCRIPT.is_file():
        print(f"Compile script not found: {COMPILE_SCRIPT}", file=sys.stderr)
        return 1

    args = parse_args()

    try:
        probe_values = run_probe(args)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    print("Device values: version={}.{}.{} abi={} platform={} small_int_bits={}".format(
        probe_values.get("version_major"),
        probe_values.get("version_minor"),
        probe_values.get("version_patch"),
        probe_values.get("mpy_abi"),
        probe_values.get("platform"),
        probe_values.get("recommended_small_int_bits"),
    ))

    return run_compile(args, probe_values)


if __name__ == "__main__":
    raise SystemExit(main())

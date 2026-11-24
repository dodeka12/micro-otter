#!/usr/bin/env python3
"""Probe MicroPython runtime compatibility values via mpremote.

This helper runs a MicroPython snippet on the device and returns values useful for
building compatible .mpy files.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

PREFIX = "OTTER_PROBE"

MICROPY_SNIPPET = """
import sys

try:
    import os
except Exception:
    os = None

impl = getattr(sys, 'implementation', None)
version = getattr(impl, 'version', ()) if impl else ()
mpy_abi = getattr(impl, '_mpy', None) if impl else None
platform = getattr(sys, 'platform', None)
maxsize = getattr(sys, 'maxsize', None)

word_bits = 0
if isinstance(maxsize, int):
    n = maxsize
    while n:
        word_bits += 1
        n //= 2

machine = None
release = None
if os is not None:
    try:
        uname = os.uname()
        machine = getattr(uname, 'machine', None)
        release = getattr(uname, 'release', None)
    except Exception:
        pass


def emit(key, value):
    print('%s %s=%s' % ('OTTER_PROBE', key, value))


emit('version_major', version[0] if len(version) > 0 else '')
emit('version_minor', version[1] if len(version) > 1 else '')
emit('version_patch', version[2] if len(version) > 2 else '')
emit('version_suffix', version[3] if len(version) > 3 else '')
emit('mpy_abi', mpy_abi)
emit('platform', platform)
emit('maxsize', maxsize)
emit('word_bits', word_bits)
emit('small_int_bits', word_bits)
emit('machine', machine)
emit('release', release)
""".strip()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Probe installed MicroPython values needed for .mpy compatibility."
    )
    parser.add_argument(
        "--port",
        default="u0",
        help="mpremote port selector (default: u0).",
    )
    parser.add_argument(
        "--mpremote",
        default="mpremote",
        help="Path to mpremote executable (default: mpremote from PATH).",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit JSON only.",
    )
    return parser.parse_args()


def resolve_mpremote(explicit_value: str) -> str:
    if explicit_value != "mpremote":
        return explicit_value

    from_path = shutil.which("mpremote")
    if from_path:
        return from_path

    repo_root = Path(__file__).resolve().parents[1]
    local_venv = repo_root / ".venv" / "bin" / "mpremote"
    if local_venv.is_file():
        return str(local_venv)

    return explicit_value


def _to_int(value: str) -> int | None:
    text = value.strip()
    if text in ("", "None"):
        return None
    try:
        return int(text)
    except Exception:
        return None


def _to_text(value: str) -> str | None:
    text = value.strip()
    if text in ("", "None"):
        return None
    return text


def parse_probe_output(output: str) -> dict[str, Any]:
    values: dict[str, Any] = {}

    pattern = re.compile(r"^" + re.escape(PREFIX) + r"\s+([a-zA-Z0-9_]+)=(.*)$")
    for raw_line in output.splitlines():
        line = raw_line.strip()
        match = pattern.match(line)
        if not match:
            continue
        key, raw_value = match.group(1), match.group(2)
        values[key] = raw_value

    parsed: dict[str, Any] = {}
    parsed["version_major"] = _to_int(values.get("version_major", ""))
    parsed["version_minor"] = _to_int(values.get("version_minor", ""))
    parsed["version_patch"] = _to_int(values.get("version_patch", ""))
    parsed["version_suffix"] = _to_text(values.get("version_suffix", ""))
    parsed["mpy_abi"] = _to_int(values.get("mpy_abi", ""))
    parsed["platform"] = _to_text(values.get("platform", ""))
    parsed["maxsize"] = _to_int(values.get("maxsize", ""))
    parsed["word_bits"] = _to_int(values.get("word_bits", ""))
    parsed["small_int_bits"] = _to_int(values.get("small_int_bits", ""))
    parsed["machine"] = _to_text(values.get("machine", ""))
    parsed["release"] = _to_text(values.get("release", ""))

    major = parsed["version_major"]
    minor = parsed["version_minor"]
    patch = parsed["version_patch"]
    if None not in (major, minor, patch):
        parsed["recommended_mpy_cross_tag"] = f"v{major}.{minor}.{patch}"
    else:
        parsed["recommended_mpy_cross_tag"] = None

    parsed["recommended_emit"] = "bytecode"
    parsed["recommended_small_int_bits"] = parsed["small_int_bits"]
    parsed["recommended_march"] = infer_march(parsed.get("platform"), parsed.get("machine"))

    return parsed


def infer_march(platform: str | None, machine: str | None) -> str | None:
    platform_l = (platform or "").lower()
    machine_l = (machine or "").lower()

    # ESP32 defaults to Xtensa except C3/C6/H2 families (RISC-V).
    if "esp32" in platform_l or "esp32" in machine_l:
        if any(token in machine_l for token in ("c3", "c6", "h2")):
            return "rv32imc"
        return "xtensawin"

    if "rp2" in platform_l or "rpi pico" in machine_l:
        return "armv6m"

    return None


def run_probe(mpremote_exe: str, port: str) -> subprocess.CompletedProcess[str]:
    command = [mpremote_exe, port, "exec", MICROPY_SNIPPET]
    return subprocess.run(command, check=False, capture_output=True, text=True)


def print_text_report(values: dict[str, Any]) -> None:
    print("MicroPython Probe Results")
    print("version: {}.{}.{}{}".format(
        values.get("version_major", "?"),
        values.get("version_minor", "?"),
        values.get("version_patch", "?"),
        values.get("version_suffix") or "",
    ))
    print("mpy_abi:", values.get("mpy_abi"))
    print("platform:", values.get("platform"))
    print("machine:", values.get("machine"))
    print("release:", values.get("release"))
    print("maxsize:", values.get("maxsize"))
    print("word_bits:", values.get("word_bits"))
    print("small_int_bits:", values.get("small_int_bits"))

    print("")
    print("Recommended compile settings")
    print("mpy-cross tag:", values.get("recommended_mpy_cross_tag"))
    print("emit:", values.get("recommended_emit"))
    print("small_int_bits:", values.get("recommended_small_int_bits"))
    print("march (native/viper only):", values.get("recommended_march"))


def main() -> int:
    args = parse_args()
    mpremote_exe = resolve_mpremote(args.mpremote)
    result = run_probe(mpremote_exe, args.port)

    if result.returncode != 0:
        print(f"mpremote executable: {mpremote_exe}", file=sys.stderr)
        if result.stdout:
            print(result.stdout, file=sys.stderr, end="")
        if result.stderr:
            print(result.stderr, file=sys.stderr, end="")
        return result.returncode

    values = parse_probe_output(result.stdout)
    if not values:
        print("No probe values detected in mpremote output.", file=sys.stderr)
        if result.stdout:
            print(result.stdout, file=sys.stderr, end="")
        return 2

    if args.json:
        print(json.dumps(values, sort_keys=True))
    else:
        print_text_report(values)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""MicroPython compatibility probe helpers for .mpy precompile workflows."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_PREFIX = "OTTER_PROBE"

_MICROPY_SNIPPET = """
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


@dataclass(frozen=True)
class MpyProbeRequest:
    """Device probe request for deriving recommended .mpy compile parameters."""

    port: str = "u0"
    mpremote: str = "mpremote"


@dataclass(frozen=True)
class MpyProbeResult:
    """Parsed probe values and recommendation fields."""

    values: dict[str, Any]


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


def infer_march(platform: str | None, machine: str | None) -> str | None:
    """Infer a conservative mpy-cross -march value from device identity fields."""

    platform_l = (platform or "").lower()
    machine_l = (machine or "").lower()

    if "esp32" in platform_l or "esp32" in machine_l:
        if any(token in machine_l for token in ("c3", "c6", "h2")):
            return "rv32imc"
        return "xtensawin"

    if "rp2" in platform_l or "rpi pico" in machine_l:
        return "armv6m"

    return None


def resolve_mpremote_executable(mpremote: str) -> str:
    """Resolve mpremote executable path, preferring PATH and local venv."""

    if mpremote != "mpremote":
        return mpremote

    from_path = shutil.which("mpremote")
    if from_path:
        return from_path

    repo_root = Path(__file__).resolve().parents[4]
    local_venv = repo_root / ".venv" / "bin" / "mpremote"
    if local_venv.is_file():
        return str(local_venv)

    return mpremote


def run_probe(request: MpyProbeRequest) -> subprocess.CompletedProcess[str]:
    """Execute the probe snippet on the target device via mpremote."""

    mpremote_exe = resolve_mpremote_executable(request.mpremote)
    command = [mpremote_exe, request.port, "exec", _MICROPY_SNIPPET]
    return subprocess.run(command, check=False, capture_output=True, text=True)


def parse_probe_output(output: str) -> dict[str, Any]:
    """Parse tagged probe output into normalized and recommended values."""

    values: dict[str, Any] = {}
    pattern = re.compile(r"^" + re.escape(_PREFIX) + r"\s+([a-zA-Z0-9_]+)=(.*)$")
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


def probe_device_mpy_compatibility(request: MpyProbeRequest) -> MpyProbeResult:
    """Probe device values and return normalized compatibility fields."""

    result = run_probe(request)
    if result.returncode != 0:
        details = []
        if result.stdout:
            details.append(result.stdout.strip())
        if result.stderr:
            details.append(result.stderr.strip())
        detail_text = "\n".join(detail for detail in details if detail)
        raise RuntimeError(
            f"mpremote probe failed (exit {result.returncode})\n{detail_text}".strip()
        )

    values = parse_probe_output(result.stdout)
    if not values:
        raise RuntimeError("No probe values detected in mpremote output")

    return MpyProbeResult(values=values)


def render_probe_values_json(result: MpyProbeResult) -> str:
    """Render probe values as compact deterministic JSON."""

    return json.dumps(result.values, sort_keys=True, separators=(",", ":"), ensure_ascii=True)

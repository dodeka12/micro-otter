#!/usr/bin/env python3
"""Compile every MicroPython device source with mpy-cross as a syntax gate.

``src/micro_otter/nodes/device/**`` is MicroPython firmware and is excluded from ruff
(``extend-exclude`` plus ``force-exclude`` in ``pyproject.toml``), because ruff cannot lint
that dialect correctly: viper intrinsics such as ``ptr16`` are undefined names (F821),
``UP038`` rewrites ``isinstance(x, (int, float))`` into PEP 604 unions that MicroPython
rejects, and ``B905`` adds ``zip(strict=)`` which MicroPython's ``zip`` does not accept.

This gate restores - and improves on - the coverage that the exclusion removed by compiling
every device file with ``mpy-cross``, the same compiler and version the firmware build uses,
for each architecture of the two supported boards (``xtensa`` for the ESP32, ``xtensawin``
for the ESP32-S3). It is a syntax/compile check, not a precompile step: output goes to
``os.devnull`` and nothing is written inside the repository. ``tools/compile_runtime_mpy.py``
and the firmware build own ``__mpycache__`` artefact generation.

Exit codes are distinct so CI can tell the two failure modes apart:

* ``0`` - every file compiled for every requested architecture;
* ``1`` - at least one compile failure (the report names file, architecture and compiler
  output for every failure, not just the first one);
* ``2`` - the gate itself is broken: compiler not found, unsupported ``-march``, missing
  device root or an empty source selection.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from micro_otter.config import SYSTEM_PREFIX, ConfigError, load_config

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DEVICE_ROOT = REPO_ROOT / "src" / "micro_otter" / "nodes" / "device"

# The ABI variants of the two boards in firmware/boards.json: ESP32 -> xtensa,
# ESP32-S3 -> xtensawin. Both are checked by default so neither board can rot.
DEFAULT_ARCHES = ("xtensa", "xtensawin")

# Same default location as .devcontainer/Dockerfile and the other mpy-cross tools.
# This is the pre-resolver location, kept as the last static candidate.
LEGACY_COMPILER_PATH = SYSTEM_PREFIX / "micropython" / "mpy-cross" / "build" / "mpy-cross"

SKIP_DIR_NAMES = frozenset({"__pycache__", "__mpycache__"})

EXIT_OK = 0
EXIT_COMPILE_FAILURE = 1
EXIT_TOOLCHAIN_ERROR = 2

# viper code forces mpy-cross to resolve -march, so an unsupported architecture is reported
# once here instead of once per device file (which would look like 77 broken sources).
ARCH_PROBE_SOURCE = """\
# Architecture probe for tools/check_device_syntax.py.

@micropython.viper
def probe_words(buffer: ptr16, count: int):
    buffer[0] = count
"""


class ToolchainError(RuntimeError):
    """The gate cannot run: compiler, device root or architecture problem."""


@dataclass(frozen=True)
class CompileFailure:
    """One failed compilation of one source file for one architecture."""

    source: Path
    march: str
    output: str


def resolve_arches(values: Sequence[str] | None) -> tuple[str, ...]:
    """Return the architectures to check, de-duplicated and in the requested order."""
    requested = values if values else DEFAULT_ARCHES
    arches = tuple(dict.fromkeys(value.strip() for value in requested if value.strip()))
    if not arches:
        raise ToolchainError("No architecture given: pass --march=<arch> at least once.")
    return arches


def collect_device_sources(device_root: Path) -> list[Path]:
    """Return every ``*.py`` file below ``device_root``, skipping cache directories."""
    if not device_root.is_dir():
        raise ToolchainError(f"Device root not found: {device_root}")

    sources = sorted(
        path
        for path in device_root.rglob("*.py")
        if not SKIP_DIR_NAMES.intersection(path.relative_to(device_root).parts)
    )
    if not sources:
        # An empty selection is a configuration problem, never a pass: it usually means the
        # device root moved, and succeeding silently would hide the whole tree.
        raise ToolchainError(f"No Python sources found under: {device_root}")
    return sources


def _is_usable(binary: Path) -> bool:
    return binary.is_file() and os.access(binary, os.X_OK)


def compiler_candidates() -> tuple[Path, ...]:
    """Return the mpy-cross locations to try, most specific first.

    The first two candidates hang off the *resolved* MicroPython root
    (:func:`micro_otter.config.load_config`), so a toolchain installed under
    ``MICRO_OTTER_TOOLCHAIN_DIR`` or a checkout named by
    ``MICRO_OTTER_MICROPYTHON_ROOT`` is preferred over the system build. The
    pre-resolver ``/opt/micropython/mpy-cross/build/mpy-cross`` location stays
    last, and is de-duplicated when the resolved root already is that path.

    A broken ``micro-otter.toml`` must never break the syntax gate, so
    :class:`micro_otter.config.ConfigError` degrades to the legacy location.
    """

    resolved: list[Path] = []
    try:
        micropython_root = load_config().micropython_root
    except ConfigError:
        micropython_root = None
    if micropython_root is not None:
        resolved.append(micropython_root / "mpy-cross" / "build" / "mpy-cross")
        resolved.append(micropython_root / "mpy-cross" / "mpy-cross")
    resolved.append(LEGACY_COMPILER_PATH)
    return tuple(dict.fromkeys(resolved))


PRIMARY_COMPILER_PATH = str(compiler_candidates()[0])
"""The first candidate, used in diagnostics (``--help`` text and error messages)."""


def resolve_mpy_cross(explicit_path: str | None) -> Path:
    """Return the mpy-cross binary: ``--mpy-cross``, ``$MPY_CROSS``, candidates, PATH.

    The first two are explicit requests, so a wrong value is an error instead of a silent
    fallback to a different compiler than the caller asked for.
    """
    requested = (("--mpy-cross", explicit_path), ("$MPY_CROSS", os.environ.get("MPY_CROSS")))
    for origin, raw in requested:
        if not raw or not raw.strip():
            continue
        candidate = Path(raw.strip()).expanduser()
        if not _is_usable(candidate):
            raise ToolchainError(
                f"mpy-cross not found or not executable: {candidate} (from {origin})"
            )
        return candidate.resolve()

    attempted: list[Path] = []
    for candidate in compiler_candidates():
        attempted.append(candidate)
        if _is_usable(candidate):
            return candidate.resolve()

    from_path = shutil.which("mpy-cross")
    if from_path:
        return Path(from_path).resolve()

    tried = ", ".join(str(path) for path in attempted)
    raise ToolchainError(
        "Could not locate mpy-cross. Pass --mpy-cross, set $MPY_CROSS, "
        "run `micro-otter toolchain install`, or put it on PATH. "
        f"Tried: {tried or '(no configured candidates)'}."
    )


def _run_mpy_cross(mpy_cross: Path, march: str, source: Path) -> subprocess.CompletedProcess[str]:
    """Compile one source for one architecture, writing the bytecode to ``os.devnull``."""
    return subprocess.run(
        [str(mpy_cross), f"-march={march}", "-o", os.devnull, str(source)],
        capture_output=True,
        text=True,
        check=False,
    )


def _compiler_output(result: subprocess.CompletedProcess[str]) -> str:
    parts = [result.stdout.strip(), result.stderr.strip()]
    text = "\n".join(part for part in parts if part)
    return text or f"(mpy-cross exited {result.returncode} without output)"


def probe_architecture(mpy_cross: Path, march: str) -> None:
    """Fail the gate when the compiler cannot target ``march`` at all."""
    with tempfile.TemporaryDirectory(prefix="otter-device-arch-probe-") as tmp:
        probe = Path(tmp) / "arch_probe.py"
        probe.write_text(ARCH_PROBE_SOURCE, encoding="utf-8")
        result = _run_mpy_cross(mpy_cross, march, probe)
    if result.returncode != 0:
        raise ToolchainError(
            f"mpy-cross cannot compile for -march={march} (exit {result.returncode}):\n"
            f"{_compiler_output(result)}"
        )


def display_path(path: Path) -> str:
    """Render ``path`` relative to the repository when possible, to keep reports short."""
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def format_failure(failure: CompileFailure) -> str:
    body = "\n".join(f"    {line}" for line in failure.output.splitlines())
    return f"FAIL {display_path(failure.source)} [-march={failure.march}]\n{body}"


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="check_device_syntax.py",
        description=(
            "Compile the MicroPython device tree with mpy-cross for each supported "
            "architecture. Nothing is written: bytecode output goes to os.devnull."
        ),
    )
    parser.add_argument(
        "--device-root",
        default=str(DEFAULT_DEVICE_ROOT),
        help=f"Device tree to check (default: {DEFAULT_DEVICE_ROOT}).",
    )
    parser.add_argument(
        "--march",
        action="append",
        default=None,
        metavar="ARCH",
        help=f"mpy-cross -march to check; repeatable (default: {' and '.join(DEFAULT_ARCHES)}).",
    )
    parser.add_argument(
        "--mpy-cross",
        default=None,
        help=f"Path to mpy-cross (default: $MPY_CROSS, {PRIMARY_COMPILER_PATH}, then PATH).",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="List every compiled file instead of only the summary.",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    device_root = Path(args.device_root).expanduser().resolve()

    try:
        arches = resolve_arches(args.march)
        sources = collect_device_sources(device_root)
        mpy_cross = resolve_mpy_cross(args.mpy_cross)
        for arch in arches:
            probe_architecture(mpy_cross, arch)
    except ToolchainError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return EXIT_TOOLCHAIN_ERROR

    if args.verbose:
        print(f"mpy-cross: {mpy_cross}")
        print(f"device root: {device_root}")

    failures: list[CompileFailure] = []
    for arch in arches:
        for source in sources:
            result = _run_mpy_cross(mpy_cross, arch, source)
            if result.returncode == 0:
                if args.verbose:
                    print(f"ok   {display_path(source)} [-march={arch}]")
                continue
            failures.append(
                CompileFailure(source=source, march=arch, output=_compiler_output(result))
            )

    total = len(sources) * len(arches)
    if failures:
        for failure in failures:
            print(format_failure(failure), file=sys.stderr)
        broken_files = len({failure.source for failure in failures})
        print(
            f"device syntax gate FAILED: {len(failures)} of {total} compilations failed "
            f"({broken_files} file(s), architectures: {', '.join(arches)})",
            file=sys.stderr,
        )
        return EXIT_COMPILE_FAILURE

    print(
        f"device syntax gate OK: {len(sources)} files x {len(arches)} architectures "
        f"({', '.join(arches)}) = {total} compilations"
    )
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())

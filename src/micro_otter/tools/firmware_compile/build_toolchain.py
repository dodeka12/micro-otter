"""Deterministic build command boundary types for firmware toolchain integration."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .build_profile import BuildProfile


@dataclass(frozen=True)
class BuildCommandSpec:
    """Immutable command specification for one toolchain invocation."""

    argv: tuple[str, ...]
    cwd: Path


def _is_port_directory(candidate: Path) -> bool:
    """Return True when *candidate* is a real MicroPython port directory.

    MicroPython port directories always ship a ``Makefile``. Requiring it keeps
    stray staging artifacts (for example ``ports/<board>/modules``) from being
    mistaken for a port when a board id collides with a directory name.
    """

    return candidate.is_dir() and (candidate / "Makefile").is_file()


def build_micropython_command(*, profile: BuildProfile, micropython_root: Path) -> BuildCommandSpec:
    """Build a deterministic MicroPython make command for the given profile."""

    root = micropython_root.resolve()
    board_text = profile.board.strip()

    ports_root = root / "ports"
    direct_target = ports_root / board_text
    lower_target = ports_root / board_text.lower()

    target_dir: Path
    board_arg: str | None = None
    if _is_port_directory(direct_target):
        target_dir = direct_target
    elif _is_port_directory(lower_target):
        target_dir = lower_target
    else:
        target_hint = board_text.split("_", 1)[0].lower()
        hinted_target = ports_root / target_hint
        if hinted_target.is_dir():
            target_dir = hinted_target
            board_arg = board_text
        else:
            raise ValueError(f"Unknown MicroPython target/board: {board_text}")

    args: list[str] = ["make"]
    if board_arg is not None:
        args.append(f"BOARD={board_arg}")

    if profile.optimization_level is not None:
        args.append(f"OTTER_OPT_LEVEL={profile.optimization_level}")

    args.append(f"OTTER_PACKAGING_MODE={profile.packaging_mode.value}")

    cmd = tuple(args)
    return BuildCommandSpec(argv=cmd, cwd=target_dir)


def prepend_clean_target(command: BuildCommandSpec) -> BuildCommandSpec:
    """Return a deterministic command variant that runs clean before build."""

    if command.argv and command.argv[0] == "make":
        # Keep-going mode lets us proceed to `all` even if stale build metadata
        # prevents `clean` from completing.
        return BuildCommandSpec(
            argv=("make", "-k", "clean", "all") + command.argv[1:],
            cwd=command.cwd,
        )
    return command

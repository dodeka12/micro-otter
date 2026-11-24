"""Toolchain preflight checks for phase-4 build execution."""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from .build_profile import BuildProfile, ModulePackagingMode
from .mpy_precompile import resolve_mpy_cross_executable


@dataclass(frozen=True)
class BuildPreflightResult:
    """Result of build preflight checks."""

    warnings: tuple[str, ...] = field(default_factory=tuple)


def _tracked_module_files(micropython_root: Path, port: str) -> tuple[str, ...] | None:
    """Return the tracked files under ``ports/<port>/modules`` from git, or ``None``.

    ``None`` means the check cannot run: no ``git`` on ``PATH``, a non-zero exit
    (for example a released tarball with no ``.git`` directory), or an empty
    listing. Callers treat ``None`` as "skip with a warning", never as a failure.
    """

    if shutil.which("git") is None:
        return None

    result = subprocess.run(
        ["git", "-C", str(micropython_root), "ls-files", "--", f"ports/{port}/modules"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return None

    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    return tuple(lines) if lines else None


def find_stock_module_problems(*, micropython_root: Path, port: str) -> tuple[str, ...]:
    """Return problems with tracked stock modules in ``ports/<port>/modules``.

    A tracked ``.py`` missing from disk is a problem: when a ``<stem>.mpy`` sibling
    exists the stock module was compiled and its source deleted — the ``.mpy`` is
    frozen under an absolute name and is unreachable (*shadowed*); otherwise the
    module was simply deleted. An empty tuple means the checkout is intact (or
    cannot be checked). Callers may inspect ``_tracked_module_files`` to tell the
    two apart.
    """

    tracked = _tracked_module_files(micropython_root, port)
    if tracked is None:
        return ()

    modules_root = micropython_root.resolve() / "ports" / port / "modules"
    prefix = f"ports/{port}/modules/"
    problems: list[str] = []
    for tracked_path in tracked:
        if not tracked_path.endswith(".py"):
            continue
        rel_name = (
            tracked_path[len(prefix) :]
            if tracked_path.startswith(prefix)
            else tracked_path
        )
        source = modules_root / rel_name
        if source.is_file():
            continue
        mpy_name = rel_name[: -len(".py")] + ".mpy"
        if (modules_root / mpy_name).is_file():
            problems.append(
                f"{tracked_path} is shadowed by {mpy_name} (frozen under an absolute name)"
            )
        else:
            problems.append(f"{tracked_path} is missing")
    return tuple(problems)


def run_build_preflight(
    *,
    profile: BuildProfile,
    micropython_root: Path,
    port: str | None = None,
) -> BuildPreflightResult:
    """Validate build prerequisites before toolchain invocation.

    ``port`` enables the stock-module integrity check on ``ports/<port>/modules``;
    ``None`` skips it (a caller without a port has no modules tree to inspect).
    """

    return run_build_preflight_with_mode(
        profile=profile,
        micropython_root=micropython_root,
        strict=False,
        port=port,
    )


def run_build_preflight_with_mode(
    *,
    profile: BuildProfile,
    micropython_root: Path,
    strict: bool,
    port: str | None = None,
) -> BuildPreflightResult:
    """Validate build prerequisites with strict or warning-only behavior.

    The stock-module integrity check raises regardless of ``strict``: a shadowed
    stock module always produces an unbootable image. ``strict`` stays about
    missing prerequisites (toolchain, ports directory, ``make``).
    """

    root = micropython_root.resolve()
    warnings: list[str] = []

    if not root.exists() or not root.is_dir():
        message = f"Invalid MicroPython root: {root}"
        if strict:
            raise ValueError(message)
        return BuildPreflightResult(warnings=(message,))

    if not (root / "ports").exists():
        message = f"MicroPython ports directory not found: {root / 'ports'}"
        if strict:
            raise ValueError(message)
        warnings.append(message)

    if shutil.which("make") is None:
        message = "Required tool not found: make"
        if strict:
            raise OSError(message)
        warnings.append(message)

    if port is not None and (root / "ports").is_dir():
        if _tracked_module_files(root, port) is None:
            warnings.append(
                f"Stock module integrity check skipped for ports/{port}/modules "
                "(git unavailable or not a git checkout)"
            )
        else:
            problems = find_stock_module_problems(micropython_root=root, port=port)
            if problems:
                problem_lines = "\n".join(f"- {problem}" for problem in problems)
                raise ValueError(
                    f"MicroPython stock modules are damaged in ports/{port}/modules:\n"
                    f"{problem_lines}\n"
                    f"Hint: git -C {root} checkout -- ports/{port}/modules && "
                    f"git -C {root} clean -fdx ports/{port}/modules"
                )

    if profile.packaging_mode == ModulePackagingMode.COMPILED_MPY:
        try:
            resolve_mpy_cross_executable(None, micropython_root=root)
        except FileNotFoundError as exc:
            warnings.append(str(exc))

    return BuildPreflightResult(warnings=tuple(warnings))

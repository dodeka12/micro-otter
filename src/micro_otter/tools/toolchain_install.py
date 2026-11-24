"""Thin wrapper around ``deploy/toolchain/bootstrap.sh`` for ``micro-otter toolchain install``.

Toolchain provisioning stays owned by the shell scripts under ``deploy/toolchain``;
this module only resolves the script, assembles the child environment through
:meth:`micro_otter.config.Config.toolchain_env`, and reports what happened. It
never clones or downloads anything itself, so there is exactly one implementation
of the install procedure.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

from micro_otter.config import Config, load_config

BOOTSTRAP_RELATIVE_PATH = Path("deploy") / "toolchain" / "bootstrap.sh"
"""Location of the backend-dispatching bootstrap script inside the workspace."""

TAIL_LINES = 40
"""How many trailing output lines to keep for the CLI to display."""


class ToolchainInstallError(RuntimeError):
    """The installer cannot run: the bootstrap script is missing from the workspace."""


@dataclass(frozen=True)
class InstallResult:
    """Outcome of one ``toolchain install`` invocation."""

    command: tuple[str, ...]
    """Exact argv that was (or, for a dry run, would be) executed."""

    returncode: int
    """Child exit code; ``-1`` signals a dry run that never spawned the script."""

    stdout_tail: str = ""
    """Last :data:`TAIL_LINES` lines of the child's standard output."""

    stderr_tail: str = ""
    """Last :data:`TAIL_LINES` lines of the child's standard error."""

    @property
    def dry_run(self) -> bool:
        """Return ``True`` when the command was only assembled, never executed."""

        return self.returncode == -1


def toolchain_script_path(config: Config | None = None) -> Path:
    """Return the ``bootstrap.sh`` path inside the resolved workspace.

    Raises :class:`ToolchainInstallError` with the expected location when the
    workspace has no toolchain scripts, which usually means the CLI is being run
    against a directory that is not a Micro-Otter checkout.
    """

    effective = load_config() if config is None else config
    script = (effective.workspace_root / BOOTSTRAP_RELATIVE_PATH).resolve()
    if not script.is_file():
        raise ToolchainInstallError(
            f"toolchain bootstrap script not found: {script} "
            "(run from a Micro-Otter checkout or set MICRO_OTTER_WORKSPACE)"
        )
    return script


def install_env_overrides(
    *, backend: str | None = None, toolchain_dir: Path | None = None
) -> dict[str, str]:
    """Return the environment variables an install invocation overrides.

    The overrides apply to the child process only; ``os.environ`` is never
    mutated, so `--dir` / `--backend` cannot leak into a later command in the same
    process.
    """

    overrides: dict[str, str] = {}
    if backend:
        overrides["MICRO_OTTER_BUILD_BACKEND"] = backend
    if toolchain_dir is not None:
        overrides["MICRO_OTTER_TOOLCHAIN_DIR"] = str(Path(toolchain_dir))
    return overrides


def _tail(text: str) -> str:
    """Return the last :data:`TAIL_LINES` lines of *text* without trailing blanks."""

    lines = text.rstrip("\n").splitlines()
    return "\n".join(lines[-TAIL_LINES:])


def install_toolchain(
    *,
    backend: str | None = None,
    toolchain_dir: Path | None = None,
    dry_run: bool = False,
    force: bool = False,
    config: Config | None = None,
) -> InstallResult:
    """Run the toolchain bootstrap for *backend* and return its result.

    The child process inherits the resolver-built environment
    (:meth:`micro_otter.config.Config.toolchain_env`), so it sees exactly the
    ``IDF_PATH`` / ``IDF_TOOLS_PATH`` / ``MICROPYTHON_ROOT`` values the rest of the
    CLI uses. *backend* and *toolchain_dir* are forwarded to the child through
    :func:`install_env_overrides`; *force* is forwarded as ``--force``. With
    *dry_run* the command is returned with ``returncode == -1`` and nothing runs.
    """

    effective = load_config() if config is None else config
    script = toolchain_script_path(effective)

    extra_args = ("--force",) if force else ()
    command = ("bash", str(script), *extra_args)
    if dry_run:
        return InstallResult(command=command, returncode=-1)

    env = effective.toolchain_env()
    env.update(install_env_overrides(backend=backend, toolchain_dir=toolchain_dir))

    completed = subprocess.run(
        command,
        cwd=str(effective.workspace_root),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    return InstallResult(
        command=command,
        returncode=completed.returncode,
        stdout_tail=_tail(completed.stdout or ""),
        stderr_tail=_tail(completed.stderr or ""),
    )


__all__ = [
    "BOOTSTRAP_RELATIVE_PATH",
    "TAIL_LINES",
    "InstallResult",
    "ToolchainInstallError",
    "install_env_overrides",
    "install_toolchain",
    "toolchain_script_path",
]

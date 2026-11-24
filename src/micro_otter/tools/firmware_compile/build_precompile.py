"""Optional module precompile phase for compiled-mpy packaging mode."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .build_profile import BuildProfile, ModulePackagingMode
from .mpy_precompile import (
    build_mpy_cross_args,
    compile_sources_to_sibling_mpy,
    resolve_mpy_cross_executable,
)
from .mpy_probe import infer_march


@dataclass(frozen=True)
class PrecompileResult:
    """Result summary for optional module precompile phase."""

    files_compiled: int
    compiler_path: Path | None
    sources_removed: int = 0


def _select_compilable_sources(
    *,
    modules_path: Path,
    source_excludes: tuple[str, ...],
    staged_paths: tuple[str, ...] | None,
) -> list[Path]:
    """Return the ``.py`` sources to compile, minus manifest-declared excludes.

    When *staged_paths* is given, only those staged relative paths are considered
    (and only when they still exist and end in ``.py``), so MicroPython's own
    modules in ``ports/<port>/modules`` are never compiled or deleted. ``None``
    keeps the legacy full-tree walk for direct callers that have no staging
    report; the backend always passes the staged tuple.
    """

    excluded = set(source_excludes)
    if staged_paths is None:
        return [
            source
            for source in sorted(modules_path.rglob("*.py"))
            if source.relative_to(modules_path).as_posix() not in excluded
        ]

    selected: list[Path] = []
    for rel_path in staged_paths:
        if not rel_path.endswith(".py") or rel_path in excluded:
            continue
        source = modules_path / rel_path
        if source.is_file():
            selected.append(source)
    return selected


def _remove_compiled_sources(source_files: list[Path]) -> int:
    """Delete each compiled ``.py`` whose non-empty ``.mpy`` sibling exists."""

    removed = 0
    for source in source_files:
        mpy_sibling = source.with_suffix(".mpy")
        if not mpy_sibling.is_file() or mpy_sibling.stat().st_size == 0:
            raise RuntimeError(f"mpy output missing for {source}")
        source.unlink()
        removed += 1
    return removed


def run_optional_mpy_precompile(
    *,
    profile: BuildProfile,
    micropython_root: Path,
    modules_path: Path,
    dry_run: bool,
    source_excludes: tuple[str, ...] = (),
    staged_paths: tuple[str, ...] | None = None,
) -> PrecompileResult:
    """Compile staged module sources to mpy-only modules when compiled mode is selected.

    ``source_excludes`` names staged paths that must stay ``.py`` (for example the
    boot path modules). ``staged_paths`` is the sorted tuple of staged relative
    paths the backend collected; ``None`` keeps the legacy full-tree walk for
    direct callers with no staging report. Every other compiled ``.py`` source is
    deleted once its ``.mpy`` sibling is verified to exist, so the module tree is
    mpy-only.
    """

    if profile.packaging_mode != ModulePackagingMode.COMPILED_MPY:
        return PrecompileResult(files_compiled=0, compiler_path=None)

    compiler = resolve_mpy_cross_executable(None, micropython_root=micropython_root)
    if dry_run:
        return PrecompileResult(files_compiled=0, sources_removed=0, compiler_path=compiler)

    source_files = _select_compilable_sources(
        modules_path=modules_path,
        source_excludes=source_excludes,
        staged_paths=staged_paths,
    )
    files_compiled = compile_sources_to_sibling_mpy(
        source_files=source_files,
        mpy_cross=compiler,
        mpy_cross_args=build_mpy_cross_args(
            emit="bytecode",
            small_int_bits=None,
            march=infer_march(profile.board, profile.board),
            march_flags=None,
        ),
        source_root=modules_path,
    )
    sources_removed = _remove_compiled_sources(source_files)

    return PrecompileResult(
        files_compiled=files_compiled,
        sources_removed=sources_removed,
        compiler_path=compiler,
    )

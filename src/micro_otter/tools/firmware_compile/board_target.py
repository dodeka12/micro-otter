"""Backend-typed board identity value object and resolution.

A :class:`BoardTarget` is the single, typed description of one buildable board
that travels through the compile pipeline. It replaces the bare ``board: str``
that previously reached the toolchain, so a stage can no longer confuse a
catalog id with a MicroPython board name.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path

from .board_registry import (
    BOARD_CATALOG_DEFAULT_PATH,
    BoardSpec,
    find_board,
    load_board_catalog,
    slug,
)
from .target_mapping import CompileTargetResolution, resolve_compile_target_resolution


@dataclass(frozen=True)
class BoardTarget:
    """Backend-typed identity for one buildable board.

    ``name`` is the toolchain's canonical board name; ``slug`` is the
    filename/registry form. ``build_params`` and ``flash_params`` are opaque,
    backend-owned mappings interpreted only by the backend named by
    ``build_backend`` / ``flash_backend``.
    """

    name: str
    slug: str
    build_backend: str
    flash_backend: str
    chip: str | None
    build_params: Mapping[str, str]
    flash_params: Mapping[str, str]
    target_id: str | None = None
    mapping: CompileTargetResolution | None = None

    @classmethod
    def from_spec(
        cls,
        spec: BoardSpec,
        *,
        target_id: str | None = None,
        mapping: CompileTargetResolution | None = None,
    ) -> BoardTarget:
        """Build a target from a catalog row, carrying its recipe verbatim."""

        return cls(
            name=spec.name,
            slug=spec.slug,
            build_backend=spec.build_backend,
            flash_backend=spec.flash_backend,
            chip=spec.chip,
            build_params=spec.build_params,
            flash_params=spec.flash_params,
            target_id=target_id,
            mapping=mapping,
        )

    @classmethod
    def from_board_name(
        cls,
        name: str,
        *,
        port: str,
        build_backend: str = "esp-idf",
        flash_backend: str = "esptool",
    ) -> BoardTarget:
        """Synthesize a target for a raw MicroPython board name (off-catalog)."""

        return cls(
            name=name,
            slug=slug(name),
            build_backend=build_backend,
            flash_backend=flash_backend,
            chip=None,
            build_params={"port": port, "board": name},
            flash_params={},
        )


def resolve_board_target(
    *,
    name: str,
    target_id: str | None = None,
    runtime_id: str,
    workspace_root: Path,
    micropython_root: Path,
    backends: Iterable[object] = (),
) -> BoardTarget:
    """Resolve *name* to a :class:`BoardTarget`.

    The name resolves through the board catalog by exact match; otherwise each
    *backend* is offered the name via ``resolve_name`` (the backend-owned
    off-catalog fallback). Raises ``ValueError`` when nothing resolves the name.
    """

    normalized = name.strip()
    if not normalized:
        raise ValueError("board name must not be empty")

    catalog = load_board_catalog((workspace_root / BOARD_CATALOG_DEFAULT_PATH).resolve())
    spec = find_board(normalized, catalog)
    if spec is not None:
        mapping = resolve_compile_target_resolution(
            workspace_root=workspace_root.resolve(),
            runtime_id=runtime_id,
            board=spec.name,
        )
        return BoardTarget.from_spec(spec, target_id=target_id, mapping=mapping)

    for backend in backends:
        resolver = getattr(backend, "resolve_name", None)
        if resolver is None:
            continue
        resolved = resolver(normalized, micropython_root=micropython_root)
        if resolved is not None:
            return resolved

    raise ValueError(f"Unknown MicroPython target/board: {normalized}")


__all__ = ["BoardTarget", "resolve_board_target", "slug"]

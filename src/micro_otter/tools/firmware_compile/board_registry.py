"""Board catalog registry: loads boards.json and resolves board names to recipes."""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any

BOARD_CATALOG_DEFAULT_PATH = Path("src/micro_otter/nodes/device/firmware/boards.json")

DEFAULT_BUILD_BACKEND = "esp-idf"
DEFAULT_FLASH_BACKEND = "esptool"

_SLUG_UNSAFE = re.compile(r"[^a-z0-9_]+")

_REQUIRED_FIELDS = (
    "name",
    "slug",
    "displayName",
    "buildBackend",
    "flashBackend",
    "chip",
    "build",
    "flash",
)


class BoardCatalogError(ValueError):
    """Raised when the board catalog is missing or invalid."""


def slug(name: str) -> str:
    """Return the canonical filename/registry form of a board name.

    Lowercases and replaces every run of non-alphanumeric/underscore characters
    (for example an Arduino FQBN's ``:``) with ``_``.
    """

    normalized = _SLUG_UNSAFE.sub("_", name.strip().lower()).strip("_")
    return normalized or "board"


@dataclass(frozen=True)
class BoardSpec:
    """Normalized board catalog entry used by compile and deploy tooling."""

    name: str
    slug: str
    display_name: str
    chip: str | None
    build_backend: str
    flash_backend: str
    build_params: Mapping[str, str]
    flash_params: Mapping[str, str]


def _normalize_text(value: object, *, field: str) -> str:
    if not isinstance(value, str):
        raise BoardCatalogError(f"board {field} must be a string")
    normalized = value.strip()
    if not normalized:
        raise BoardCatalogError(f"board {field} must not be empty")
    return normalized


def _optional_text(entry: dict[str, Any], key: str, *, index: int) -> str | None:
    """Return a validated optional non-empty string, or ``None`` when absent."""

    if key not in entry:
        return None
    return _normalize_text(entry[key], field=f"entry {index} {key}")


def _validate_params(value: object, *, field: str) -> Mapping[str, str]:
    """Validate a backend-owned ``build``/``flash`` object of strings."""

    if not isinstance(value, dict):
        raise BoardCatalogError(f"board {field} must be an object of strings")
    normalized: dict[str, str] = {}
    for key, item in value.items():
        if not isinstance(key, str) or not key.strip():
            raise BoardCatalogError(f"board {field} keys must be non-empty strings")
        if not isinstance(item, str):
            raise BoardCatalogError(f"board {field} values must be strings")
        normalized[key] = item
    return MappingProxyType(normalized)


def _validate_entry(entry: dict[str, Any], index: int) -> BoardSpec:
    for required_field in _REQUIRED_FIELDS:
        if required_field not in entry:
            raise BoardCatalogError(
                f"board entry {index} is missing required field {required_field!r}"
            )

    name = _normalize_text(entry["name"], field=f"entry {index} name")
    entry_slug = _normalize_text(entry["slug"], field=f"entry {index} slug")
    if entry_slug != slug(name):
        raise BoardCatalogError(
            f"board entry {index} slug {entry_slug!r} must equal the canonical "
            f"slug of its name ({slug(name)!r})"
        )

    return BoardSpec(
        name=name,
        slug=entry_slug,
        display_name=_normalize_text(entry["displayName"], field=f"entry {index} displayName"),
        chip=_optional_text(entry, "chip", index=index),
        build_backend=_normalize_text(entry["buildBackend"], field=f"entry {index} buildBackend"),
        flash_backend=_normalize_text(entry["flashBackend"], field=f"entry {index} flashBackend"),
        build_params=_validate_params(entry["build"], field=f"entry {index} build"),
        flash_params=_validate_params(entry["flash"], field=f"entry {index} flash"),
    )


def load_board_catalog(path: Path) -> list[BoardSpec]:
    """Load and validate the board catalog at *path*."""

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise BoardCatalogError(f"Board catalog not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise BoardCatalogError(f"Invalid JSON in {path}: {exc}") from exc

    if not isinstance(payload, dict):
        raise BoardCatalogError(f"Expected object at root in {path}")

    schema_version = payload.get("schemaVersion")
    if schema_version != 2:
        raise BoardCatalogError(f"board catalog schemaVersion must be 2; got {schema_version!r}")

    boards_value = payload.get("boards")
    if not isinstance(boards_value, list):
        raise BoardCatalogError("board catalog must contain a 'boards' array")

    specs: list[BoardSpec] = []
    seen_names: set[str] = set()
    for index, entry in enumerate(boards_value):
        if not isinstance(entry, dict):
            raise BoardCatalogError(f"board entry {index} must be an object")
        spec = _validate_entry(entry, index)
        if spec.name in seen_names:
            raise BoardCatalogError(f"duplicate board name in catalog: {spec.name!r}")
        seen_names.add(spec.name)
        specs.append(spec)

    return specs


def find_board(name: str, catalog: Sequence[BoardSpec]) -> BoardSpec | None:
    """Return the catalog entry whose ``name`` matches *name*, or ``None``."""

    normalized = name.strip()
    if not normalized:
        return None
    return next((spec for spec in catalog if spec.name == normalized), None)


def find_board_by_slug(catalog: Sequence[BoardSpec], board_slug: str) -> BoardSpec | None:
    """Return the catalog row whose slug matches *board_slug* (case-insensitive), or ``None``.

    ``mo firmware menu`` compares lowercase board ids, while compile-target mapping
    matches the catalog's board *name* case-sensitively. This lookup is the bridge
    between the two, so a caller holding a slug can recover the name the mapping
    rules speak. An unknown or empty slug yields ``None``; the function never raises.
    """

    normalized = board_slug.strip().lower()
    if not normalized:
        return None
    return next(
        (spec for spec in catalog if spec.slug.strip().lower() == normalized),
        None,
    )


__all__ = [
    "BOARD_CATALOG_DEFAULT_PATH",
    "BoardCatalogError",
    "BoardSpec",
    "DEFAULT_BUILD_BACKEND",
    "DEFAULT_FLASH_BACKEND",
    "find_board",
    "find_board_by_slug",
    "load_board_catalog",
    "slug",
]

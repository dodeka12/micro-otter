"""Central configuration resolver for Micro-Otter.

Every toolchain, firmware, build, server, and state path is resolved here so the
CLI and the local server behave the same inside and outside the devcontainer.

Precedence, highest first::

    CLI flag > environment > TOML config > platform default

Environment variables (first match wins; an empty value means "unset")::

    home                  MICRO_OTTER_HOME
    workspace_root        MICRO_OTTER_WORKSPACE
    toolchain_dir         MICRO_OTTER_TOOLCHAIN_DIR
    firmware_dir          MICRO_OTTER_FIRMWARE_DIR
    build_dir             MICRO_OTTER_BUILD_DIR
    addons_dir            MICRO_OTTER_ADDONS_DIR
    micropython_root      MICRO_OTTER_MICROPYTHON_ROOT, MICROPYTHON_ROOT
    idf_path              MICRO_OTTER_IDF_PATH, IDF_PATH
    idf_tools_path        MICRO_OTTER_IDF_TOOLS_PATH, IDF_TOOLS_PATH
    build_backend         MICRO_OTTER_BUILD_BACKEND
    flash_backend         MICRO_OTTER_FLASH_BACKEND
    enable_compile        MICRO_OTTER_ENABLE_COMPILE
    enable_deploy         MICRO_OTTER_ENABLE_DEPLOY
    host                  MICRO_OTTER_HOST
    port                  MICRO_OTTER_PORT
    open_browser          MICRO_OTTER_OPEN_BROWSER
    max_build_jobs        MICRO_OTTER_MAX_BUILD_JOBS
    build_timeout_seconds MICRO_OTTER_BUILD_TIMEOUT
    state directory       MICRO_OTTER_STATE_DIR (see :func:`state_dir`)
    config file           MICRO_OTTER_CONFIG

``micro-otter.toml`` uses three optional tables whose keys map one-to-one onto
the accessors::

    [paths]
    home = "~/.micro-otter"
    workspace = "."
    toolchain_dir = "~/.micro-otter/toolchain"
    firmware_dir = "~/.micro-otter/firmware"
    build_dir = "~/.micro-otter/build"
    addons_dir = "~/.micro-otter/addons"
    micropython_root = ""
    idf_path = ""
    idf_tools_path = ""

    [build]
    backend = "auto"
    flash_backend = "auto"
    enable_compile = true
    enable_deploy = true
    max_jobs = 1
    timeout_seconds = 3600

    [server]
    host = "127.0.0.1"
    port = 8000
    open_browser = false

``/opt`` discovery rule: ``/opt/micropython``, ``/opt/esp-idf``, ``/opt/.espressif``
and ``/opt/micro_otter/firmware`` are probed **only** while building the platform
default layer. They can never override an explicit CLI, environment, or TOML
value, so the devcontainer keeps working while a plain host works without it.

Nothing here creates directories, downloads anything, or probes the network:
resolving configuration is a read-only operation.
"""

from __future__ import annotations

import functools
import os
import re
import sys
import tomllib
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from types import MappingProxyType
from typing import Any

from micro_otter.toolchain import launcher_path

CONFIG_FILENAME = "micro-otter.toml"
"""Default configuration file name used for implicit discovery."""

ENV_PREFIX = "MICRO_OTTER_"
"""Prefix shared by every configuration environment variable."""

SYSTEM_PREFIX = Path("/opt")
"""System-wide install prefix probed by the platform-default layer."""

_TRUE_VALUES = frozenset({"1", "true", "yes", "on"})
_FALSE_VALUES = frozenset({"0", "false", "no", "off"})

PATH_ACCESSORS = (
    "home",
    "workspace_root",
    "toolchain_dir",
    "firmware_dir",
    "build_dir",
    "addons_dir",
    "micropython_root",
    "idf_path",
    "idf_tools_path",
)
"""Accessors resolved to absolute :class:`Path` values."""

INT_ACCESSORS = ("port", "max_build_jobs", "build_timeout_seconds")
"""Accessors resolved to :class:`int` values."""

BOOL_ACCESSORS = ("enable_compile", "enable_deploy", "open_browser")
"""Accessors resolved to :class:`bool` values."""

STR_ACCESSORS = ("build_backend", "flash_backend", "host")
"""Accessors resolved to plain strings."""

ACCESSORS = PATH_ACCESSORS + INT_ACCESSORS + BOOL_ACCESSORS + STR_ACCESSORS
"""Every configurable accessor name, in documentation order."""

_TOOLCHAIN_SUBDIRS: Mapping[str, str] = MappingProxyType(
    {
        "micropython_root": "micropython",
        "idf_path": "esp-idf",
        "idf_tools_path": ".espressif",
    }
)
"""Accessors defaulted to a subdirectory of the resolved toolchain directory."""


_ENV_VARS: Mapping[str, tuple[str, ...]] = MappingProxyType(
    {
        "home": ("MICRO_OTTER_HOME",),
        "workspace_root": ("MICRO_OTTER_WORKSPACE",),
        "toolchain_dir": ("MICRO_OTTER_TOOLCHAIN_DIR",),
        "firmware_dir": ("MICRO_OTTER_FIRMWARE_DIR",),
        "build_dir": ("MICRO_OTTER_BUILD_DIR",),
        "addons_dir": ("MICRO_OTTER_ADDONS_DIR",),
        "micropython_root": ("MICRO_OTTER_MICROPYTHON_ROOT", "MICROPYTHON_ROOT"),
        "idf_path": ("MICRO_OTTER_IDF_PATH", "IDF_PATH"),
        "idf_tools_path": ("MICRO_OTTER_IDF_TOOLS_PATH", "IDF_TOOLS_PATH"),
        "build_backend": ("MICRO_OTTER_BUILD_BACKEND",),
        "flash_backend": ("MICRO_OTTER_FLASH_BACKEND",),
        "enable_compile": ("MICRO_OTTER_ENABLE_COMPILE",),
        "enable_deploy": ("MICRO_OTTER_ENABLE_DEPLOY",),
        "host": ("MICRO_OTTER_HOST",),
        "port": ("MICRO_OTTER_PORT",),
        "open_browser": ("MICRO_OTTER_OPEN_BROWSER",),
        "max_build_jobs": ("MICRO_OTTER_MAX_BUILD_JOBS",),
        "build_timeout_seconds": ("MICRO_OTTER_BUILD_TIMEOUT",),
    }
)
"""Environment variables honoured per accessor, in first-match-wins order."""

_TOML_KEYS: Mapping[str, Mapping[str, str]] = MappingProxyType(
    {
        "paths": MappingProxyType(
            {
                "home": "home",
                "workspace": "workspace_root",
                "toolchain_dir": "toolchain_dir",
                "firmware_dir": "firmware_dir",
                "build_dir": "build_dir",
                "addons": "addons_dir",
                "micropython_root": "micropython_root",
                "idf_path": "idf_path",
                "idf_tools_path": "idf_tools_path",
            }
        ),
        "build": MappingProxyType(
            {
                "backend": "build_backend",
                "flash_backend": "flash_backend",
                "enable_compile": "enable_compile",
                "enable_deploy": "enable_deploy",
                "max_jobs": "max_build_jobs",
                "timeout_seconds": "build_timeout_seconds",
            }
        ),
        "server": MappingProxyType(
            {
                "host": "host",
                "port": "port",
                "open_browser": "open_browser",
            }
        ),
    }
)
"""Accepted TOML tables and the accessor each key maps onto."""

_VARIABLE_PATTERN = re.compile(
    r"\$(?:\{(?P<braced>[A-Za-z_][A-Za-z0-9_]*)\}|(?P<plain>[A-Za-z_][A-Za-z0-9_]*))"
)
"""Matches ``$VAR`` and ``${VAR}`` references inside path values."""


class ConfigError(ValueError):
    """Raised when configuration is *invalid*.

    A missing implicit config file is not an error; only unparsable TOML,
    unknown keys, out-of-range values, and an explicitly requested file that
    does not exist raise this error. ``hint`` carries an actionable next step
    that the CLI error panel and ``micro-otter doctor`` print next to the
    message.
    """

    def __init__(self, message: str, *, hint: str | None = None) -> None:
        """Store the message together with the optional actionable hint."""

        super().__init__(message)
        self.hint = hint


@dataclass(frozen=True)
class Config:
    """Fully resolved Micro-Otter configuration.

    Every path attribute is absolute. ``config_path`` is the file that was
    actually read (``None`` when only defaults, environment, and flags
    applied), and ``sources`` records which layer won for each accessor:
    ``"cli"``, ``"env"``, ``"toml"``, or ``"default"``.
    """

    home: Path
    """Micro-Otter home directory (toolchain, firmware, and build roots)."""

    workspace_root: Path
    """Repository checkout root holding ``pyproject.toml`` and ``src/micro_otter``."""

    toolchain_dir: Path
    """Root of user-installed toolchains (ESP-IDF, MicroPython, esptool)."""

    firmware_dir: Path
    """Firmware publish root scanned for prebuilt board images."""

    build_dir: Path
    """Scratch directory for build artefacts."""

    addons_dir: Path
    """Root for installed third-party node packages (one folder per package id)."""

    micropython_root: Path
    """MicroPython checkout used to build the ESP32 port."""

    idf_path: Path
    """ESP-IDF checkout."""

    idf_tools_path: Path
    """ESP-IDF tools and Python environment root (``IDF_TOOLS_PATH``)."""

    build_backend: str
    """Selected firmware build backend id, or ``"auto"``."""

    flash_backend: str
    """Selected firmware flash backend id, or ``"auto"``."""

    enable_compile: bool
    """Firmware build flag; never disables collection or package deploys."""

    enable_deploy: bool
    """Firmware flash flag; never disables collection or package deploys."""

    host: str
    """Host the local server binds to."""

    port: int
    """Port the local server binds to."""

    open_browser: bool
    """Whether ``serve`` opens a browser window on start."""

    max_build_jobs: int
    """Maximum number of parallel build jobs."""

    build_timeout_seconds: int
    """Wall-clock timeout for a single firmware build."""

    config_path: Path | None = None
    """Configuration file that was actually read, if any."""

    sources: Mapping[str, str] = field(default_factory=dict)
    """Winning layer per accessor (``cli``/``env``/``toml``/``default``)."""

    def source_of(self, accessor: str) -> str:
        """Return the layer that supplied *accessor* (``"default"`` when unknown)."""

        return self.sources.get(accessor, "default")

    @property
    def idf_py(self) -> Path:
        """Return the repository-owned ``idf.py`` launcher.

        This answers "which launcher does the repository own" and never probes
        ``PATH``; callers decide whether to fall back to a ``PATH`` lookup.
        """

        return launcher_path()

    def toolchain_env(self, base: Mapping[str, str] | None = None) -> dict[str, str]:
        """Return the child-process environment for toolchain commands.

        This is the **only** supported way to build that environment: it sets
        ``MICRO_OTTER_TOOLCHAIN_DIR``, ``IDF_PATH``, ``IDF_TOOLS_PATH``, and
        ``MICROPYTHON_ROOT`` from this configuration and prepends the launcher
        directory to ``PATH`` so a bare ``idf.py`` also resolves to the
        repository launcher. Backends must accept it instead of assembling
        these variables themselves; *base* defaults to a copy of ``os.environ``.
        """

        env = dict(os.environ if base is None else base)
        launcher = self.idf_py
        env["MICRO_OTTER_TOOLCHAIN_DIR"] = str(self.toolchain_dir)
        env["IDF_PATH"] = str(self.idf_path)
        env["IDF_TOOLS_PATH"] = str(self.idf_tools_path)
        env["MICROPYTHON_ROOT"] = str(self.micropython_root)

        launcher_dir = str(launcher.parent)
        existing = env.get("PATH", "")
        env["PATH"] = f"{launcher_dir}{os.pathsep}{existing}" if existing else launcher_dir
        return env


def _expand_variables(value: str, environment: Mapping[str, str]) -> str:
    """Expand ``$VAR`` and ``${VAR}`` references using *environment*."""

    def replace(match: re.Match[str]) -> str:
        name = match.group("braced") or match.group("plain")
        return environment.get(name, match.group(0))

    return _VARIABLE_PATTERN.sub(replace, value)


def _text_value(value: object, *, origin: str) -> str | None:
    """Return *value* as stripped text, or ``None`` when it means "unset"."""

    if value is None:
        return None
    if isinstance(value, int | float) and not isinstance(value, bool):
        value = str(value)
    if not isinstance(value, str):
        raise ConfigError(
            f"invalid value for {origin}: expected a string, got {type(value).__name__}",
            hint="quote string values in micro-otter.toml",
        )
    stripped = value.strip()
    return stripped or None


def _path_value(
    value: object,
    environment: Mapping[str, str],
    *,
    origin: str,
    base: Path | None = None,
) -> Path | None:
    """Return *value* as an absolute path with variables and ``~`` expanded.

    Relative values are resolved against *base* (the config file directory)
    when one is supplied, otherwise against the process working directory.
    """

    if isinstance(value, Path):
        candidate = value.expanduser()
        if not candidate.is_absolute() and base is not None:
            candidate = base / candidate
        return candidate.resolve()

    text = _text_value(value, origin=origin)
    if text is None:
        return None
    expanded = _expand_variables(text, environment)
    try:
        candidate = Path(expanded).expanduser()
        if not candidate.is_absolute() and base is not None:
            candidate = base / candidate
        return candidate.resolve()
    except (OSError, RuntimeError) as exc:  # pragma: no cover - defensive
        raise ConfigError(f"invalid path for {origin}: {text} ({exc})") from exc


def _bool_value(value: object, *, origin: str) -> bool | None:
    """Return *value* as a bool, or ``None`` when it means "unset"."""

    if isinstance(value, bool):
        return value
    text = _text_value(value, origin=origin)
    if text is None:
        return None
    lowered = text.lower()
    if lowered in _TRUE_VALUES:
        return True
    if lowered in _FALSE_VALUES:
        return False
    raise ConfigError(
        f"invalid boolean for {origin}: {text!r}",
        hint="use 1/0, true/false, yes/no, or on/off",
    )


def _int_value(
    value: object,
    *,
    origin: str,
    minimum: int,
    maximum: int | None = None,
) -> int | None:
    """Return *value* as an int inside ``minimum..maximum``, or ``None`` when unset."""

    if isinstance(value, bool):
        raise ConfigError(f"invalid integer for {origin}: expected a number, got a boolean")
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    if isinstance(value, int):
        number = value
    else:
        text = _text_value(value, origin=origin)
        if text is None:
            return None
        try:
            number = int(text, 10)
        except ValueError as exc:
            raise ConfigError(
                f"invalid integer for {origin}: {text!r}", hint="use a whole number"
            ) from exc

    if number < minimum or (maximum is not None and number > maximum):
        bound = f">= {minimum}" if maximum is None else f"between {minimum} and {maximum}"
        raise ConfigError(f"{origin} out of range: {number} (expected {bound})")
    return number


def _backend_value(value: object, accessor: str, *, origin: str) -> str | None:
    """Return a validated backend id, or ``None`` when unset."""

    text = _text_value(value, origin=origin)
    if text is None:
        return None
    normalized = text.lower()
    if normalized == "auto":
        return normalized
    known = _known_backend_ids(accessor)
    if normalized not in known:
        available = ", ".join(("auto", *known))
        raise ConfigError(
            f"unknown {accessor} {text!r} in {origin}",
            hint=f"available values: {available}",
        )
    return normalized


def _known_backend_ids(accessor: str) -> tuple[str, ...]:
    """Return the backend ids registered for *accessor*.

    Imported lazily so that importing the resolver never drags in the compile
    or flash backend stacks (and never creates an import cycle).
    """

    if accessor == "flash_backend":
        from micro_otter.tools.firmware_compile.flash.registry import known_flash_backend_ids

        return known_flash_backend_ids()

    from micro_otter.tools.firmware_compile.backends import known_backend_ids

    return known_backend_ids()


def _coerce(
    accessor: str,
    value: object,
    environment: Mapping[str, str],
    *,
    origin: str,
    base: Path | None = None,
) -> Any:
    """Coerce *value* to the type of *accessor*, honouring ``None`` for "unset"."""

    if accessor in PATH_ACCESSORS:
        return _path_value(value, environment, origin=origin, base=base)
    if accessor in BOOL_ACCESSORS:
        return _bool_value(value, origin=origin)
    if accessor == "port":
        return _int_value(value, origin=origin, minimum=1, maximum=65535)
    if accessor == "max_build_jobs":
        return _int_value(value, origin=origin, minimum=1)
    if accessor == "build_timeout_seconds":
        return _int_value(value, origin=origin, minimum=1)
    if accessor in ("build_backend", "flash_backend"):
        return _backend_value(value, accessor, origin=origin)
    return _text_value(value, origin=origin)


def _discover_workspace_root(start: Path) -> Path:
    """Return the nearest ancestor of *start* holding the project markers."""

    current = Path(start).resolve()
    for candidate in (current, *current.parents):
        has_project = (candidate / "pyproject.toml").is_file()
        has_package = (candidate / "src" / "micro_otter").is_dir()
        if has_project and has_package:
            return candidate
    return current


def _default_home(environment: Mapping[str, str]) -> Path:
    """Return the Micro-Otter home directory before explicit overrides."""

    override = _path_value(
        environment.get("MICRO_OTTER_HOME"), environment, origin="MICRO_OTTER_HOME"
    )
    if override is not None:
        return override
    return (Path.home() / ".micro-otter").resolve()


def _system_path(*parts: str) -> Path | None:
    """Return ``SYSTEM_PREFIX`` joined with *parts* when that directory exists."""

    candidate = SYSTEM_PREFIX.joinpath(*parts)
    return candidate.resolve() if candidate.is_dir() else None


def _platform_defaults(environment: Mapping[str, str], cwd: Path) -> dict[str, object]:
    """Return the lowest-priority layer: platform defaults plus ``/opt`` probes.

    Paths that live *inside* the toolchain directory are not resolved here; see
    :func:`_toolchain_defaults`, which needs the merged ``toolchain_dir`` first.
    """

    home = _default_home(environment)

    return {
        "home": home,
        "workspace_root": _discover_workspace_root(cwd),
        "toolchain_dir": home / "toolchain",
        "firmware_dir": _system_path("micro_otter", "firmware") or home / "firmware",
        "build_dir": home / "build",
        "addons_dir": home / "addons",
        "build_backend": "auto",
        "flash_backend": "auto",
        "enable_compile": True,
        "enable_deploy": True,
        "host": "127.0.0.1",
        "port": 8000,
        "open_browser": False,
        "max_build_jobs": 1,
        "build_timeout_seconds": 3600,
    }


def _toolchain_defaults(toolchain_dir: Path, explicit: frozenset[str]) -> dict[str, object]:
    """Return defaults that hang off the resolved toolchain directory.

    ``explicit`` holds the accessors supplied by a TOML, environment, or CLI
    layer; those already won and are never overwritten here. The ``/opt``
    probes only apply while ``toolchain_dir`` itself is still the platform
    default, so pointing ``toolchain_dir`` elsewhere keeps the derived paths
    inside it.
    """

    probe_system = "toolchain_dir" not in explicit
    derived: dict[str, object] = {}
    for accessor, subdir in _TOOLCHAIN_SUBDIRS.items():
        if accessor in explicit:
            continue
        probe = _system_path(subdir) if probe_system else None
        derived[accessor] = probe or toolchain_dir / subdir
    return derived


def _discover_config_path(
    config_path: Path | None,
    environment: Mapping[str, str],
    cwd: Path,
) -> Path | None:
    """Return the configuration file to read, or ``None`` when none applies."""

    hint = "omit --config to use the platform defaults"
    if config_path is not None:
        explicit = _path_value(config_path, environment, origin="--config")
        if explicit is None or not explicit.is_file():
            raise ConfigError(f"configuration file not found: {config_path}", hint=hint)
        return explicit

    env_value = environment.get("MICRO_OTTER_CONFIG")
    from_env = _path_value(env_value, environment, origin="MICRO_OTTER_CONFIG")
    if from_env is not None:
        if not from_env.is_file():
            raise ConfigError(f"configuration file not found: {from_env}", hint=hint)
        return from_env

    for candidate in (Path(cwd) / CONFIG_FILENAME, _default_home(environment) / CONFIG_FILENAME):
        if candidate.is_file():
            return candidate.resolve()
    return None


def _toml_layer(
    config_path: Path | None,
    environment: Mapping[str, str],
) -> dict[str, object]:
    """Return the TOML layer for *config_path* (empty when there is no file)."""

    if config_path is None:
        return {}
    try:
        payload = tomllib.loads(config_path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise ConfigError(
            f"invalid TOML in {config_path}: {exc}",
            hint="fix the TOML syntax; `micro-otter doctor` reports the offending file",
        ) from exc
    except OSError as exc:
        raise ConfigError(f"cannot read configuration file {config_path}: {exc}") from exc

    layer: dict[str, object] = {}
    for table, table_values in payload.items():
        accepted = _TOML_KEYS.get(table)
        if accepted is None:
            raise ConfigError(
                f"unknown table [{table}] in {config_path}",
                hint=f"accepted tables: {', '.join(sorted(_TOML_KEYS))}",
            )
        if not isinstance(table_values, dict):
            raise ConfigError(f"[{table}] in {config_path} must be a table")
        for key, raw_value in table_values.items():
            accessor = accepted.get(key)
            if accessor is None:
                raise ConfigError(
                    f"unknown key {table}.{key} in {config_path}",
                    hint=f"accepted keys in [{table}]: {', '.join(sorted(accepted))}",
                )
            origin = f"{config_path} [{table}] {key}"
            value = _coerce(
                accessor, raw_value, environment, origin=origin, base=config_path.parent
            )
            if value is not None:
                layer[accessor] = value
    return layer


def _env_layer(environment: Mapping[str, str]) -> dict[str, object]:
    """Return the environment layer built from the documented variables."""

    layer: dict[str, object] = {}
    for accessor, names in _ENV_VARS.items():
        for name in names:
            raw_value = environment.get(name)
            if raw_value is None:
                continue
            value = _coerce(accessor, raw_value, environment, origin=name)
            if value is not None:
                layer[accessor] = value
                break
    return layer


def _override_layer(
    overrides: Mapping[str, object] | None,
    environment: Mapping[str, str],
) -> dict[str, object]:
    """Return the CLI layer built from explicitly supplied flags."""

    if not overrides:
        return {}

    layer: dict[str, object] = {}
    for accessor, raw_value in overrides.items():
        if accessor not in ACCESSORS:
            raise ConfigError(
                f"unknown configuration override {accessor!r}",
                hint=f"accepted overrides: {', '.join(ACCESSORS)}",
            )
        origin = f"--{accessor.replace('_', '-')}"
        value = _coerce(accessor, raw_value, environment, origin=origin)
        if value is not None:
            layer[accessor] = value
    return layer


def _merge_layers(
    layers: tuple[tuple[str, Mapping[str, object]], ...],
) -> tuple[dict[str, Any], dict[str, str]]:
    """Merge *layers* from low to high priority, recording the winning layer."""

    values: dict[str, Any] = {}
    sources: dict[str, str] = {}
    for name, layer in layers:
        for accessor, value in layer.items():
            values[accessor] = value
            sources[accessor] = name
    return values, sources


def load_config(
    *,
    config_path: Path | None = None,
    env: Mapping[str, str] | None = None,
    overrides: Mapping[str, object] | None = None,
    cwd: Path | None = None,
) -> Config:
    """Resolve the effective configuration.

    Layers are merged ``default < toml < env < cli``. ``env`` and ``cwd``
    default to :data:`os.environ` and :func:`Path.cwd` so tests can inject a
    synthetic environment; ``overrides`` maps accessor names to already
    type-checked values taken from Typer options, where ``None`` means "flag
    not supplied". ``config_path`` forces a specific TOML file and must exist.
    """

    environment = dict(os.environ if env is None else env)
    start_dir = Path(cwd) if cwd is not None else Path.cwd()
    resolved_path = _discover_config_path(config_path, environment, start_dir)

    values, sources = _merge_layers(
        (
            ("default", _platform_defaults(environment, start_dir)),
            ("toml", _toml_layer(resolved_path, environment)),
            ("env", _env_layer(environment)),
            ("cli", _override_layer(overrides, environment)),
        )
    )
    explicit = frozenset(name for name, layer in sources.items() if layer != "default")
    for accessor, value in _toolchain_defaults(values["toolchain_dir"], explicit).items():
        values[accessor] = value
        sources.setdefault(accessor, "default")

    return Config(
        home=values["home"],
        workspace_root=values["workspace_root"],
        toolchain_dir=values["toolchain_dir"],
        firmware_dir=values["firmware_dir"],
        build_dir=values["build_dir"],
        addons_dir=values["addons_dir"],
        micropython_root=values["micropython_root"],
        idf_path=values["idf_path"],
        idf_tools_path=values["idf_tools_path"],
        build_backend=values["build_backend"],
        flash_backend=values["flash_backend"],
        enable_compile=values["enable_compile"],
        enable_deploy=values["enable_deploy"],
        host=values["host"],
        port=values["port"],
        open_browser=values["open_browser"],
        max_build_jobs=values["max_build_jobs"],
        build_timeout_seconds=values["build_timeout_seconds"],
        config_path=resolved_path,
        sources=MappingProxyType(sources),
    )


@functools.lru_cache(maxsize=1)
def _cached_config() -> Config:
    """Return the process-wide configuration, reading the environment once."""

    return load_config()


def get_config() -> Config:
    """Return the cached configuration for CLI use.

    The cache keeps repeated lookups cheap inside a single command. Tests and
    any code path that re-reads flags must call :func:`clear_config_cache`
    first; the CLI does so before every invocation.
    """

    return _cached_config()


def clear_config_cache() -> None:
    """Drop the cached configuration returned by :func:`get_config`."""

    _cached_config.cache_clear()


def _platform_state_default(
    environment: Mapping[str, str],
    home_dir: Path,
    platform: str,
) -> Path:
    """Return the platform state directory for *platform*.

    ``platform`` is passed explicitly (instead of reading :data:`sys.platform`)
    so tests stay platform-independent.
    """

    if platform.startswith("win"):
        local_app_data = _text_value(environment.get("LOCALAPPDATA"), origin="LOCALAPPDATA")
        base = Path(local_app_data) if local_app_data else home_dir / "AppData" / "Local"
        return base / "micro-otter"

    if platform == "darwin":
        return home_dir / "Library" / "Application Support" / "micro-otter"

    xdg_state_home = _text_value(environment.get("XDG_STATE_HOME"), origin="XDG_STATE_HOME")
    if xdg_state_home:
        return Path(xdg_state_home) / "micro-otter"

    return home_dir / ".local" / "state" / "micro-otter"


def state_dir(config: Config | None = None) -> Path:
    """Return the directory holding persistent CLI state.

    ``MICRO_OTTER_STATE_DIR`` wins; otherwise the platform default applies.
    ``config`` is accepted so callers can pass the resolved configuration
    through unchanged; state stays *user*-scoped, so the user home comes from
    the platform rather than from :attr:`Config.home`.
    """

    environment = os.environ
    override = _path_value(
        environment.get("MICRO_OTTER_STATE_DIR"), environment, origin="MICRO_OTTER_STATE_DIR"
    )
    if override is not None:
        return override
    del config  # Accepted for call-site symmetry; state is user-scoped.
    return _platform_state_default(environment, Path.home(), sys.platform)


def state_path(config: Config | None = None) -> Path:
    """Return the state file path inside :func:`state_dir`.

    Phase 5 rewires ``cli/state.py::_default_state_path`` onto these helpers;
    the JSON payload and its schema do not change.
    """

    return state_dir(config) / "state.json"


def resolve_micropython_root(
    workspace_root: Path,
    *,
    fallback: Path | None = None,
    config: Config | None = None,
) -> Path:
    """Return the MicroPython checkout used to build the ESP32 port.

    Resolution order (first match wins):

    1. an explicit ``micropython_root`` from a CLI flag, an environment
       variable (``MICRO_OTTER_MICROPYTHON_ROOT``/``MICROPYTHON_ROOT``), or
       ``micro-otter.toml`` - an explicit request always wins, even when the
       directory does not exist yet;
    2. the resolved root when ``toolchain_dir`` itself was set explicitly and
       that root exists, which is what ``micro-otter toolchain install``
       produces;
    3. *fallback* when it is an existing directory. Call sites pass their
       documented ``/opt`` discovery fallback (``SYSTEM_MICROPYTHON_ROOT``)
       here, so a caller that knows the system layer keeps deciding it - this
       is also what keeps those call sites patchable in tests;
    4. the resolved default root when no *fallback* was supplied, so a library
       caller still sees the platform ``/opt`` probe;
    5. ``workspace_root/src/micropython``, the historical in-repo clone.

    ``/opt`` therefore enters only through the default layer or through
    *fallback*; it can never override an explicit request. Returns a resolved
    absolute path in every branch. ``config`` lets tests inject a
    configuration; when omitted :func:`load_config` is called (never
    :func:`get_config`, so a cached CLI configuration cannot leak into library
    calls).
    """

    effective = load_config() if config is None else config
    if effective.source_of("micropython_root") != "default":
        return effective.micropython_root.resolve()

    installed = effective.micropython_root
    if effective.source_of("toolchain_dir") != "default" and installed.is_dir():
        return installed.resolve()

    if fallback is not None:
        if fallback.is_dir():
            return fallback.resolve()
    elif installed.is_dir():
        return installed.resolve()

    return (Path(workspace_root) / "src" / "micropython").resolve()


def resolve_firmware_publish_root(
    *,
    fallback: Path | None = None,
    config: Config | None = None,
) -> Path:
    """Return the directory holding published firmware artifacts.

    Resolution order (first match wins):

    1. an explicit ``firmware_dir`` from a CLI flag, an environment variable
       (``MICRO_OTTER_FIRMWARE_DIR``), or ``micro-otter.toml``;
    2. *fallback* when it is an existing directory - the documented
       ``/opt/micro_otter/firmware`` discovery constant
       (``SYSTEM_FIRMWARE_PUBLISH_ROOT``) that call sites pass in;
    3. the resolved default root, returned even when it does not exist yet
       because publishing creates it and scanning simply finds nothing.

    ``/opt`` therefore enters only through the default layer or through
    *fallback*. Returns a resolved absolute path in every branch. ``config``
    lets tests inject a configuration; when omitted :func:`load_config` is
    called (never :func:`get_config`).
    """

    effective = load_config() if config is None else config
    if effective.source_of("firmware_dir") != "default":
        return effective.firmware_dir.resolve()
    if fallback is not None and fallback.is_dir():
        return fallback.resolve()
    return effective.firmware_dir.resolve()


__all__ = [
    "CONFIG_FILENAME",
    "SYSTEM_PREFIX",
    "Config",
    "ConfigError",
    "clear_config_cache",
    "get_config",
    "load_config",
    "resolve_firmware_publish_root",
    "resolve_micropython_root",
    "state_dir",
    "state_path",
]

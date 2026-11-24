"""Tests for the central configuration resolver."""

from __future__ import annotations

import dataclasses
import os
import re
import textwrap
from pathlib import Path

import pytest

from micro_otter import config as config_module
from micro_otter.config import (
    ConfigError,
    clear_config_cache,
    get_config,
    load_config,
    state_dir,
    state_path,
)


def _write_toml(path: Path, text: str) -> Path:
    """Write dedented TOML *text* to *path* and return it."""

    path.write_text(textwrap.dedent(text).strip() + "\n", encoding="utf-8")
    return path


def _isolated_env(tmp_path: Path, **values: str) -> dict[str, str]:
    """Return an environment dict rooted in *tmp_path* with extra overrides."""

    env = {"MICRO_OTTER_HOME": str(tmp_path / "home")}
    env.update(values)
    return env


PATCHED_OPT = Path("/nonexistent/opt")


@pytest.fixture(autouse=True)
def _no_system_prefix(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep ``/opt`` probes from leaking the devcontainer layout into tests."""

    monkeypatch.setattr(config_module, "SYSTEM_PREFIX", PATCHED_OPT)
    clear_config_cache()


def test_load_config_returns_platform_defaults(tmp_path: Path) -> None:
    config = load_config(env=_isolated_env(tmp_path), cwd=tmp_path)

    home = tmp_path / "home"
    assert config.home == home
    assert config.workspace_root == tmp_path.resolve()
    assert config.toolchain_dir == home / "toolchain"
    assert config.firmware_dir == home / "firmware"
    assert config.build_dir == home / "build"
    assert config.addons_dir == home / "addons"
    assert config.micropython_root == home / "toolchain" / "micropython"
    assert config.idf_path == home / "toolchain" / "esp-idf"
    assert config.idf_tools_path == home / "toolchain" / ".espressif"
    assert config.build_backend == "auto"
    assert config.flash_backend == "auto"
    assert config.enable_compile is True
    assert config.enable_deploy is True
    assert config.host == "127.0.0.1"
    assert config.port == 8000
    assert config.open_browser is False
    assert config.max_build_jobs == 1
    assert config.build_timeout_seconds == 3600
    assert config.config_path is None


def test_config_dataclass_is_frozen(tmp_path: Path) -> None:
    config = load_config(env=_isolated_env(tmp_path), cwd=tmp_path)

    assert dataclasses.is_dataclass(config)
    with pytest.raises(dataclasses.FrozenInstanceError):
        config.port = 9999  # type: ignore[misc]


def test_sources_records_winning_layer(tmp_path: Path) -> None:
    toml_path = _write_toml(
        tmp_path / "micro-otter.toml",
        """
        [server]
        port = 9100
        host = "10.0.0.1"
        """,
    )
    config = load_config(
        config_path=toml_path,
        env=_isolated_env(tmp_path, MICRO_OTTER_PORT="9200"),
        overrides={"open_browser": True},
        cwd=tmp_path,
    )

    assert config.port == 9200
    assert config.host == "10.0.0.1"
    assert config.open_browser is True
    assert config.source_of("port") == "env"
    assert config.source_of("host") == "toml"
    assert config.source_of("open_browser") == "cli"
    assert config.source_of("build_dir") == "default"
    assert config.source_of("unknown_accessor") == "default"
    assert config.config_path == toml_path.resolve()


def test_cli_override_beats_env_toml_and_default(tmp_path: Path) -> None:
    toml_path = _write_toml(
        tmp_path / "micro-otter.toml",
        """
        [paths]
        firmware_dir = "/from/toml"
        """,
    )
    config = load_config(
        config_path=toml_path,
        env=_isolated_env(tmp_path, MICRO_OTTER_FIRMWARE_DIR="/from/env"),
        overrides={"firmware_dir": "/from/cli"},
        cwd=tmp_path,
    )

    assert config.firmware_dir == Path("/from/cli")
    assert config.source_of("firmware_dir") == "cli"


def test_env_beats_toml(tmp_path: Path) -> None:
    toml_path = _write_toml(
        tmp_path / "micro-otter.toml",
        """
        [paths]
        build_dir = "/from/toml"
        """,
    )
    config = load_config(
        config_path=toml_path,
        env=_isolated_env(tmp_path, MICRO_OTTER_BUILD_DIR="/from/env"),
        cwd=tmp_path,
    )

    assert config.build_dir == Path("/from/env")
    assert config.source_of("build_dir") == "env"


def test_toml_beats_platform_default(tmp_path: Path) -> None:
    toml_path = _write_toml(
        tmp_path / "micro-otter.toml",
        """
        [build]
        max_jobs = 4
        """,
    )
    config = load_config(config_path=toml_path, env=_isolated_env(tmp_path), cwd=tmp_path)

    assert config.max_build_jobs == 4
    assert config.source_of("max_build_jobs") == "toml"


def test_empty_env_value_falls_through_to_next_layer(tmp_path: Path) -> None:
    toml_path = _write_toml(
        tmp_path / "micro-otter.toml",
        """
        [paths]
        firmware_dir = "/from/toml"
        """,
    )
    config = load_config(
        config_path=toml_path,
        env=_isolated_env(tmp_path, MICRO_OTTER_FIRMWARE_DIR=""),
        cwd=tmp_path,
    )

    assert config.firmware_dir == Path("/from/toml")
    assert config.source_of("firmware_dir") == "toml"


def test_invalid_env_boolean_raises_config_error(tmp_path: Path) -> None:
    with pytest.raises(ConfigError) as excinfo:
        load_config(env=_isolated_env(tmp_path, MICRO_OTTER_ENABLE_COMPILE="maybe"), cwd=tmp_path)

    assert "MICRO_OTTER_ENABLE_COMPILE" in str(excinfo.value)
    assert excinfo.value.hint is not None


def test_tilde_and_variable_expansion_in_paths(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    home = tmp_path / "userhome"
    monkeypatch.setenv("HOME", str(home))
    env = {
        "HOME": str(home),
        "MICRO_OTTER_HOME": str(home / ".micro-otter"),
        "MICRO_OTTER_FIRMWARE_DIR": "$HOME/firmware",
        "MICRO_OTTER_BUILD_DIR": "${HOME}/build-${EXTRA}",
        "EXTRA": "dir",
    }
    config = load_config(env=env, cwd=tmp_path)

    assert config.firmware_dir == home / "firmware"
    assert config.build_dir == home / "build-dir"


def test_toml_layer_maps_all_tables(tmp_path: Path) -> None:
    toml_path = _write_toml(
        tmp_path / "micro-otter.toml",
        """
        [paths]
        home = "~/custom-home"
        workspace = "."
        toolchain_dir = "~/custom-toolchain"
        firmware_dir = "~/custom-firmware"
        build_dir = "~/custom-build"
        micropython_root = "~/custom-mpy"
        idf_path = "~/custom-idf"
        idf_tools_path = "~/custom-espressif"

        [build]
        backend = "auto"
        flash_backend = "auto"
        enable_compile = false
        enable_deploy = false
        max_jobs = 3
        timeout_seconds = 120

        [server]
        host = "0.0.0.0"
        port = 8123
        open_browser = true
        """,
    )
    home = Path.home()
    config = load_config(config_path=toml_path, env={}, cwd=tmp_path)

    assert config.home == (home / "custom-home").resolve()
    assert config.workspace_root == tmp_path.resolve()
    assert config.toolchain_dir == (home / "custom-toolchain").resolve()
    assert config.firmware_dir == (home / "custom-firmware").resolve()
    assert config.build_dir == (home / "custom-build").resolve()
    assert config.micropython_root == (home / "custom-mpy").resolve()
    assert config.idf_path == (home / "custom-idf").resolve()
    assert config.idf_tools_path == (home / "custom-espressif").resolve()
    assert config.build_backend == "auto"
    assert config.flash_backend == "auto"
    assert config.enable_compile is False
    assert config.enable_deploy is False
    assert config.max_build_jobs == 3
    assert config.build_timeout_seconds == 120
    assert config.host == "0.0.0.0"
    assert config.port == 8123
    assert config.open_browser is True
    assert config.source_of("port") == "toml"


def test_missing_explicit_config_path_raises(tmp_path: Path) -> None:
    missing = tmp_path / "missing.toml"

    with pytest.raises(ConfigError) as excinfo:
        load_config(config_path=missing, env={}, cwd=tmp_path)

    assert "configuration file not found" in str(excinfo.value)
    assert excinfo.value.hint == "omit --config to use the platform defaults"


def test_missing_env_config_path_raises(tmp_path: Path) -> None:
    env = {"MICRO_OTTER_CONFIG": str(tmp_path / "nope.toml")}

    with pytest.raises(ConfigError) as excinfo:
        load_config(env=env, cwd=tmp_path)

    assert "configuration file not found" in str(excinfo.value)


def test_implicit_config_path_missing_is_not_an_error(tmp_path: Path) -> None:
    config = load_config(env=_isolated_env(tmp_path), cwd=tmp_path)

    assert config.config_path is None
    assert config.port == 8000


def test_implicit_config_path_prefers_cwd(tmp_path: Path) -> None:
    _write_toml(
        tmp_path / "micro-otter.toml",
        """
        [server]
        port = 8300
        """,
    )
    config = load_config(env=_isolated_env(tmp_path), cwd=tmp_path)

    assert config.config_path == (tmp_path / "micro-otter.toml").resolve()
    assert config.port == 8300


def test_invalid_toml_raises_config_error_with_path(tmp_path: Path) -> None:
    toml_path = tmp_path / "micro-otter.toml"
    toml_path.write_text("[server\nport = 1\n", encoding="utf-8")

    with pytest.raises(ConfigError) as excinfo:
        load_config(config_path=toml_path, env={}, cwd=tmp_path)

    assert "invalid TOML" in str(excinfo.value)
    assert str(toml_path) in str(excinfo.value)


def test_unknown_toml_key_raises_with_hint(tmp_path: Path) -> None:
    toml_path = _write_toml(
        tmp_path / "micro-otter.toml",
        """
        [build]
        max_job = 2
        """,
    )

    with pytest.raises(ConfigError) as excinfo:
        load_config(config_path=toml_path, env={}, cwd=tmp_path)

    assert "build.max_job" in str(excinfo.value)
    hint = excinfo.value.hint
    assert hint is not None
    assert "max_jobs" in hint


def test_unknown_toml_table_raises(tmp_path: Path) -> None:
    toml_path = _write_toml(
        tmp_path / "micro-otter.toml",
        """
        [toolchain]
        flavor = "esp-idf"
        """,
    )

    with pytest.raises(ConfigError) as excinfo:
        load_config(config_path=toml_path, env={}, cwd=tmp_path)

    assert "unknown table [toolchain]" in str(excinfo.value)
    assert excinfo.value.hint is not None


def test_unknown_backend_name_lists_available_backends(tmp_path: Path) -> None:
    toml_path = _write_toml(
        tmp_path / "micro-otter.toml",
        """
        [build]
        backend = "platformio"
        """,
    )

    with pytest.raises(ConfigError) as excinfo:
        load_config(config_path=toml_path, env={}, cwd=tmp_path)

    assert "platformio" in str(excinfo.value)
    hint = excinfo.value.hint
    assert hint is not None
    assert "auto" in hint
    assert "esp-idf" in hint


def test_out_of_range_integers_raise_config_error(tmp_path: Path) -> None:
    with pytest.raises(ConfigError) as port_error:
        load_config(env=_isolated_env(tmp_path, MICRO_OTTER_PORT="0"), cwd=tmp_path)
    assert "MICRO_OTTER_PORT" in str(port_error.value)

    toml_path = _write_toml(
        tmp_path / "micro-otter.toml",
        """
        [build]
        max_jobs = 0
        """,
    )
    with pytest.raises(ConfigError) as jobs_error:
        load_config(config_path=toml_path, env=_isolated_env(tmp_path), cwd=tmp_path)
    assert "max_jobs" in str(jobs_error.value)
    toml_path.unlink()

    with pytest.raises(ConfigError) as timeout_error:
        load_config(env=_isolated_env(tmp_path, MICRO_OTTER_BUILD_TIMEOUT="-5"), cwd=tmp_path)
    assert "MICRO_OTTER_BUILD_TIMEOUT" in str(timeout_error.value)


def test_non_integer_env_value_raises_config_error(tmp_path: Path) -> None:
    with pytest.raises(ConfigError) as excinfo:
        load_config(env=_isolated_env(tmp_path, MICRO_OTTER_MAX_BUILD_JOBS="two"), cwd=tmp_path)

    assert "MICRO_OTTER_MAX_BUILD_JOBS" in str(excinfo.value)


def test_opt_paths_win_default_layer_when_present(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    system = tmp_path / "opt"
    for relative in ("micropython", "esp-idf", ".espressif", "micro_otter/firmware"):
        (system / relative).mkdir(parents=True)
    monkeypatch.setattr(config_module, "SYSTEM_PREFIX", system)

    config = load_config(env=_isolated_env(tmp_path), cwd=tmp_path)

    assert config.micropython_root == (system / "micropython").resolve()
    assert config.idf_path == (system / "esp-idf").resolve()
    assert config.idf_tools_path == (system / ".espressif").resolve()
    assert config.firmware_dir == (system / "micro_otter" / "firmware").resolve()
    assert config.toolchain_dir == tmp_path / "home" / "toolchain"


def test_opt_never_overrides_explicit_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    system = tmp_path / "opt"
    (system / "micropython").mkdir(parents=True)
    monkeypatch.setattr(config_module, "SYSTEM_PREFIX", system)
    explicit = tmp_path / "my-micropython"

    config = load_config(
        env=_isolated_env(tmp_path, MICRO_OTTER_MICROPYTHON_ROOT=str(explicit)),
        cwd=tmp_path,
    )

    assert config.micropython_root == explicit
    assert config.source_of("micropython_root") == "env"


def test_home_defaults_follow_micro_otter_home(tmp_path: Path) -> None:
    custom = tmp_path / "custom-home"

    config = load_config(env={"MICRO_OTTER_HOME": str(custom)}, cwd=tmp_path)

    assert config.home == custom
    assert config.toolchain_dir == custom / "toolchain"
    assert config.build_dir == custom / "build"
    assert config.firmware_dir == custom / "firmware"


def test_workspace_root_discovers_pyproject_marker(tmp_path: Path) -> None:
    project = tmp_path / "project"
    nested = project / "src" / "micro_otter"
    nested.mkdir(parents=True)
    (project / "pyproject.toml").write_text("[project]\nname = 'demo'\n", encoding="utf-8")

    config = load_config(env=_isolated_env(tmp_path), cwd=nested)

    assert config.workspace_root == project.resolve()


def test_workspace_root_falls_back_to_cwd(tmp_path: Path) -> None:
    start = tmp_path / "plain"
    start.mkdir()

    config = load_config(env=_isolated_env(tmp_path), cwd=start)

    assert config.workspace_root == start.resolve()


def test_defaults_do_not_create_directories(tmp_path: Path) -> None:
    home = tmp_path / "home"

    config = load_config(env={"MICRO_OTTER_HOME": str(home)}, cwd=tmp_path)

    assert not home.exists()
    assert not config.toolchain_dir.exists()
    assert not config.build_dir.exists()
    assert not config.addons_dir.exists()
    assert not config.firmware_dir.exists()


def test_addons_dir_defaults_to_home_addons(tmp_path: Path) -> None:
    """The addons root follows ``MICRO_OTTER_HOME`` without a ``/opt`` probe."""
    home = tmp_path / "home"

    config = load_config(env={"MICRO_OTTER_HOME": str(home)}, cwd=tmp_path)

    assert config.addons_dir == home / "addons"
    assert config.source_of("addons_dir") == "default"


def test_addons_dir_env_override_wins(tmp_path: Path) -> None:
    """``MICRO_OTTER_ADDONS_DIR`` selects a different root."""
    addons = tmp_path / "elsewhere" / "addons"

    config = load_config(
        env=_isolated_env(tmp_path, MICRO_OTTER_ADDONS_DIR=str(addons)),
        cwd=tmp_path,
    )

    assert config.addons_dir == addons.resolve()
    assert config.source_of("addons_dir") == "env"


def test_addons_dir_honours_toml_paths_table(tmp_path: Path) -> None:
    """``[paths] addons`` is accepted and resolved like every other path."""
    toml_path = _write_toml(
        tmp_path / "micro-otter.toml",
        """
        [paths]
        addons = "custom-addons"
        """,
    )

    config = load_config(config_path=toml_path, env=_isolated_env(tmp_path), cwd=tmp_path)

    assert config.addons_dir == (tmp_path / "custom-addons").resolve()
    assert config.source_of("addons_dir") == "toml"


def test_addons_dir_is_not_created(tmp_path: Path) -> None:
    """Resolving configuration never creates the addons folder."""
    config = load_config(env=_isolated_env(tmp_path), cwd=tmp_path)

    assert not config.addons_dir.exists()



def test_get_config_is_cached_until_cleared(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MICRO_OTTER_HOME", str(tmp_path / "first"))
    clear_config_cache()
    first = get_config()
    monkeypatch.setenv("MICRO_OTTER_HOME", str(tmp_path / "second"))
    assert get_config() is first

    clear_config_cache()
    assert get_config() is not first
    assert get_config().home == tmp_path / "second"


def test_state_dir_honours_micro_otter_state_dir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = tmp_path / "state"
    monkeypatch.setenv("MICRO_OTTER_STATE_DIR", str(target))

    assert state_dir() == target
    assert state_path() == target / "state.json"


def test_state_dir_uses_xdg_state_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MICRO_OTTER_STATE_DIR", raising=False)
    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path / "xdg"))

    assert state_dir() == tmp_path / "xdg" / "micro-otter"


def test_state_dir_uses_localappdata_for_windows(tmp_path: Path) -> None:
    home = tmp_path / "home"
    env = {"LOCALAPPDATA": str(tmp_path / "AppData" / "Local")}

    result = config_module._platform_state_default(env, home, "win32")

    assert result == tmp_path / "AppData" / "Local" / "micro-otter"


def test_state_dir_uses_application_support_for_macos(tmp_path: Path) -> None:
    home = tmp_path / "home"

    result = config_module._platform_state_default({}, home, "darwin")

    assert result == home / "Library" / "Application Support" / "micro-otter"


def test_state_dir_falls_back_to_local_state(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("MICRO_OTTER_STATE_DIR", raising=False)
    monkeypatch.delenv("XDG_STATE_HOME", raising=False)
    home = tmp_path / "userhome"
    monkeypatch.setenv("HOME", str(home))

    assert state_dir() == home / ".local" / "state" / "micro-otter"


def test_state_path_appends_state_json(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MICRO_OTTER_STATE_DIR", str(tmp_path / "state"))

    assert state_path().name == "state.json"
    assert state_path().parent == tmp_path / "state"


def test_public_surface_exports_expected_names() -> None:
    assert set(config_module.__all__) == {
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
    }


def test_unknown_override_accessor_raises(tmp_path: Path) -> None:
    with pytest.raises(ConfigError) as excinfo:
        load_config(env=_isolated_env(tmp_path), overrides={"nonsense": 1}, cwd=tmp_path)

    assert "unknown configuration override" in str(excinfo.value)


REPO_ROOT = Path(__file__).resolve().parents[1]


def test_idf_py_points_at_repository_launcher(tmp_path: Path) -> None:
    config = load_config(env=_isolated_env(tmp_path), cwd=tmp_path)

    assert config.idf_py == REPO_ROOT / "deploy" / "toolchain" / "esp-idf" / "idf.py"
    assert config.idf_py.is_file()


def test_toolchain_dir_override_rederives_toolchain_paths(tmp_path: Path) -> None:
    toolchain_dir = tmp_path / "toolchain"

    config = load_config(
        env=_isolated_env(tmp_path, MICRO_OTTER_TOOLCHAIN_DIR=str(toolchain_dir)),
        cwd=tmp_path,
    )

    assert config.toolchain_dir == toolchain_dir.resolve()
    assert config.idf_path == toolchain_dir.resolve() / "esp-idf"
    assert config.idf_tools_path == toolchain_dir.resolve() / ".espressif"
    assert config.micropython_root == toolchain_dir.resolve() / "micropython"
    assert config.source_of("idf_path") == "default"


def test_opt_probes_apply_only_while_toolchain_dir_is_default(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    system_prefix = tmp_path / "opt"
    (system_prefix / "esp-idf").mkdir(parents=True)
    monkeypatch.setattr(config_module, "SYSTEM_PREFIX", system_prefix)

    default = load_config(env=_isolated_env(tmp_path), cwd=tmp_path)
    relocated = load_config(
        env=_isolated_env(tmp_path, MICRO_OTTER_TOOLCHAIN_DIR=str(tmp_path / "tc")),
        cwd=tmp_path,
    )

    assert default.idf_path == (system_prefix / "esp-idf").resolve()
    assert relocated.idf_path == (tmp_path / "tc").resolve() / "esp-idf"


def test_explicit_idf_path_wins_over_toolchain_dir_default(tmp_path: Path) -> None:
    explicit = tmp_path / "custom-idf"

    config = load_config(
        env=_isolated_env(
            tmp_path,
            MICRO_OTTER_TOOLCHAIN_DIR=str(tmp_path / "tc"),
            MICRO_OTTER_IDF_PATH=str(explicit),
        ),
        cwd=tmp_path,
    )

    assert config.idf_path == explicit.resolve()
    assert config.source_of("idf_path") == "env"
    assert config.idf_tools_path == (tmp_path / "tc").resolve() / ".espressif"


def test_toolchain_env_sets_idf_and_micropython_variables(tmp_path: Path) -> None:
    toolchain_dir = tmp_path / "toolchain"
    config = load_config(
        env=_isolated_env(tmp_path, MICRO_OTTER_TOOLCHAIN_DIR=str(toolchain_dir)),
        cwd=tmp_path,
    )

    env = config.toolchain_env(base={"PATH": "/usr/bin", "KEEP": "1"})

    assert env["KEEP"] == "1"
    assert env["MICRO_OTTER_TOOLCHAIN_DIR"] == str(toolchain_dir.resolve())
    assert env["IDF_PATH"] == str(toolchain_dir.resolve() / "esp-idf")
    assert env["IDF_TOOLS_PATH"] == str(toolchain_dir.resolve() / ".espressif")
    assert env["MICROPYTHON_ROOT"] == str(toolchain_dir.resolve() / "micropython")


def test_toolchain_env_prepends_launcher_dir_to_path(tmp_path: Path) -> None:
    config = load_config(env=_isolated_env(tmp_path), cwd=tmp_path)

    env = config.toolchain_env(base={"PATH": "/usr/bin"})

    assert env["PATH"] == f"{config.idf_py.parent}{os.pathsep}/usr/bin"

    empty_path = config.toolchain_env(base={})

    assert empty_path["PATH"] == str(config.idf_py.parent)


def test_toolchain_env_does_not_mutate_os_environ(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("IDF_PATH", "/already/exported")
    monkeypatch.setenv("SENTINEL", "1")
    config = load_config(env=_isolated_env(tmp_path), cwd=tmp_path)

    env = config.toolchain_env()

    assert env["SENTINEL"] == "1"
    assert env["IDF_PATH"] == str(config.idf_path)
    assert os.environ["IDF_PATH"] == "/already/exported"
    assert os.environ["SENTINEL"] == "1"

def test_resolve_micropython_root_prefers_explicit_config(tmp_path: Path) -> None:
    explicit = tmp_path / "explicit-micropython"
    fallback = tmp_path / "opt" / "micropython"
    fallback.mkdir(parents=True)
    config = load_config(
        env=_isolated_env(tmp_path, MICRO_OTTER_MICROPYTHON_ROOT=str(explicit)),
        cwd=tmp_path,
    )

    resolved = config_module.resolve_micropython_root(
        tmp_path, fallback=fallback, config=config
    )

    assert resolved == explicit.resolve()
    assert config.source_of("micropython_root") == "env"


def test_resolve_micropython_root_prefers_toolchain_install(tmp_path: Path) -> None:
    toolchain_dir = tmp_path / "toolchain"
    installed = toolchain_dir / "micropython"
    installed.mkdir(parents=True)
    fallback = tmp_path / "opt" / "micropython"
    fallback.mkdir(parents=True)
    config = load_config(
        env=_isolated_env(tmp_path, MICRO_OTTER_TOOLCHAIN_DIR=str(toolchain_dir)),
        cwd=tmp_path,
    )

    resolved = config_module.resolve_micropython_root(
        tmp_path, fallback=fallback, config=config
    )

    assert resolved == installed.resolve()


def test_resolve_micropython_root_uses_existing_fallback(tmp_path: Path) -> None:
    fallback = tmp_path / "opt" / "micropython"
    fallback.mkdir(parents=True)
    config = load_config(env=_isolated_env(tmp_path), cwd=tmp_path)

    resolved = config_module.resolve_micropython_root(
        tmp_path, fallback=fallback, config=config
    )

    assert resolved == fallback.resolve()


def test_resolve_micropython_root_falls_back_to_workspace_clone(tmp_path: Path) -> None:
    (tmp_path / "home" / "toolchain" / "micropython").mkdir(parents=True)
    config = load_config(env=_isolated_env(tmp_path), cwd=tmp_path)

    resolved = config_module.resolve_micropython_root(
        tmp_path, fallback=tmp_path / "missing-opt-micropython", config=config
    )

    assert resolved == (tmp_path / "src" / "micropython").resolve()


def test_resolve_firmware_publish_root_prefers_explicit_firmware_dir(tmp_path: Path) -> None:
    explicit = tmp_path / "published-firmware"
    fallback = tmp_path / "opt" / "firmware"
    fallback.mkdir(parents=True)
    config = load_config(
        env=_isolated_env(tmp_path, MICRO_OTTER_FIRMWARE_DIR=str(explicit)),
        cwd=tmp_path,
    )

    resolved = config_module.resolve_firmware_publish_root(fallback=fallback, config=config)

    assert resolved == explicit.resolve()
    assert config.source_of("firmware_dir") == "env"


def test_resolve_firmware_publish_root_uses_existing_fallback(tmp_path: Path) -> None:
    fallback = tmp_path / "opt" / "firmware"
    fallback.mkdir(parents=True)
    config = load_config(env=_isolated_env(tmp_path), cwd=tmp_path)

    resolved = config_module.resolve_firmware_publish_root(fallback=fallback, config=config)

    assert resolved == fallback.resolve()


def test_resolve_firmware_publish_root_returns_default_when_nothing_exists(
    tmp_path: Path,
) -> None:
    config = load_config(env=_isolated_env(tmp_path), cwd=tmp_path)

    resolved = config_module.resolve_firmware_publish_root(
        fallback=tmp_path / "missing-opt-firmware", config=config
    )

    assert resolved == config.firmware_dir.resolve()


def test_no_hardcoded_opt_paths_outside_config() -> None:
    """``/opt`` must enter only through the resolver, never as a literal elsewhere."""
    source_root = Path(config_module.__file__).resolve().parents[1]

    offenders = sorted(
        str(path.relative_to(source_root))
        for path in source_root.rglob("*.py")
        if path != Path(config_module.__file__).resolve()
        and "/opt/" in path.read_text(encoding="utf-8")
    )

    assert offenders == [], (
        "hardcoded /opt paths must live behind micro_otter.config: " + ", ".join(offenders)
    )

_DOC_ENV_PATTERN = re.compile(r"\b((?:MICRO_OTTER|IDF|MICROPYTHON)_[A-Z0-9_]+)\b")
"""Environment variable names as they appear in the configuration page."""

_DOC_ENV_HANDLED_OUTSIDE_LOAD_CONFIG = frozenset({"MICRO_OTTER_CONFIG", "MICRO_OTTER_STATE_DIR"})
"""Documented variables read by config-file discovery and :func:`state_dir` instead."""

_DOC_ENV_PROBES = ("esptool", "false", "1234", "esp-idf")
"""Values tried per documented variable, covering path, bool, int, and backend ids."""

_TOML_KEY_LINE = re.compile(r"^\s*[A-Za-z_][A-Za-z0-9_]*\s*=")
"""Matches an uncommented ``key = value`` line."""


def test_documented_env_vars_match_resolver(tmp_path: Path) -> None:
    """Every environment variable the configuration page names is honoured."""
    page = REPO_ROOT / "docs" / "dev" / "deployment" / "configuration.md"
    documented = sorted(set(_DOC_ENV_PATTERN.findall(page.read_text(encoding="utf-8"))))
    assert documented, "the configuration page must document the MICRO_OTTER_* variables"

    baseline_env = {"MICRO_OTTER_HOME": str(tmp_path / "home")}
    for name in documented:
        if name in _DOC_ENV_HANDLED_OUTSIDE_LOAD_CONFIG:
            continue
        without = dict(baseline_env)
        without.pop(name, None)
        baseline = load_config(env=without, cwd=tmp_path)
        config = None
        for probe in (*_DOC_ENV_PROBES, str(tmp_path / "fake-value")):
            try:
                config = load_config(
                    env={**without, name: probe}, cwd=tmp_path
                )
            except ConfigError:
                continue
            break
        assert config is not None, (
            f"{name} is documented but the resolver rejects every probe value"
        )
        gained = {
            accessor
            for accessor, layer in config.sources.items()
            if layer == "env" and baseline.sources.get(accessor) != "env"
        }
        assert gained, f"{name} is documented but the resolver ignores it"


def test_repo_example_toml_parses_and_is_all_comments(tmp_path: Path) -> None:
    """The shipped example documents the schema without configuring anything."""
    example = REPO_ROOT / "micro-otter.toml"
    text = example.read_text(encoding="utf-8")

    assert "docs/dev/deployment/configuration.md" in text
    assert [line for line in text.splitlines() if _TOML_KEY_LINE.match(line)] == []

    config = load_config(config_path=example, env={}, cwd=REPO_ROOT)

    assert config.config_path == example.resolve()
    assert set(config.sources.values()) == {"default"}


def test_enable_flags_are_read_only_by_firmware_commands() -> None:
    """Only the resolver, the firmware menu, and the capability payload read the flags.

    ``server_capabilities`` belongs in the list because advertising ``firmware-compile`` /
    ``firmware-deploy`` is exactly what the flags are for. The read stays advertisement-only: the
    payload is never consulted to decide whether an explicit command may run.
    """
    allowed = {
        "micro_otter/cli/app.py",
        "micro_otter/config.py",
        "micro_otter/tools/server_capabilities.py",
    }
    source_root = Path(config_module.__file__).resolve().parents[1]

    offenders = sorted(
        str(path.relative_to(source_root))
        for path in source_root.rglob("*.py")
        if str(path.relative_to(source_root)) not in allowed
        and (
            "enable_compile" in path.read_text(encoding="utf-8")
            or "enable_deploy" in path.read_text(encoding="utf-8")
        )
    )

    assert offenders == [], (
        "enable_compile/enable_deploy may only be read by cli/app.py, config.py and the "
        "capability payload in tools/server_capabilities.py: " + ", ".join(offenders)
    )


def test_deployment_tree_has_no_python_coupling() -> None:
    """Node-package source upload stays in the web app, never in firmware Python."""
    firmware_root = Path(config_module.__file__).resolve().parents[1] / "tools" / "firmware_compile"

    offenders = sorted(
        str(path.relative_to(firmware_root))
        for path in firmware_root.rglob("*.py")
        if "js/deployment" in path.read_text(encoding="utf-8")
        or "sourceUpload" in path.read_text(encoding="utf-8")
    )

    assert offenders == [], "firmware Python must not reach into the deploy web app: " + ", ".join(
        offenders
    )

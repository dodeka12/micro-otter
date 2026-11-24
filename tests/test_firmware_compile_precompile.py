import json
from pathlib import Path
from unittest import mock

import pytest

from micro_otter.tools.firmware_compile import (
    BuildProfile,
    ModulePackagingMode,
    run_optional_mpy_precompile,
)
from micro_otter.tools.firmware_compile.mpy_precompile import (
    clean_mpycache_dirs,
    compile_sources_to_sibling_mpy,
    gather_sources_from_manifests,
    normalize_mpy_source_excludes,
    resolve_package_dir,
)


def test_run_optional_mpy_precompile_skips_source_mode(tmp_path: Path):
    profile = BuildProfile(runtime_id="general", board="esp32")

    result = run_optional_mpy_precompile(
        profile=profile,
        micropython_root=tmp_path,
        modules_path=tmp_path,
        dry_run=False,
    )

    assert result.files_compiled == 0
    assert result.compiler_path is None


def test_run_optional_mpy_precompile_dry_run_uses_existing_compiler_lookup(tmp_path: Path):
    profile = BuildProfile(
        runtime_id="general",
        board="esp32",
        packaging_mode=ModulePackagingMode.COMPILED_MPY,
    )

    with mock.patch(
        "micro_otter.tools.firmware_compile.build_precompile.resolve_mpy_cross_executable",
        return_value=tmp_path / "mpy-cross",
    ):
        result = run_optional_mpy_precompile(
            profile=profile,
            micropython_root=tmp_path,
            modules_path=tmp_path,
            dry_run=True,
        )

    assert result.files_compiled == 0
    assert result.compiler_path == (tmp_path / "mpy-cross")


def test_normalize_mpy_source_excludes_strips_prefixes():
    excludes = normalize_mpy_source_excludes(
        {
            "mpySourceExcludes": [
                "main.py",
                "./app/main_loop.py",
                "/otter_main.py",
                "libs\\win\\helpers.py",
                "main.py",
                "",
                7,
            ]
        }
    )

    assert excludes == ("main.py", "app/main_loop.py", "otter_main.py", "libs/win/helpers.py")


def test_normalize_mpy_source_excludes_defaults_to_empty():
    assert normalize_mpy_source_excludes({}) == ()
    assert normalize_mpy_source_excludes({"mpySourceExcludes": "main.py"}) == ()


def _write_json(path: Path, payload: object) -> None:
    """Write *payload* as JSON to *path*, creating parents."""

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _device_root(tmp_path: Path) -> Path:
    """Create a minimal device tree with one built-in package and one local package."""

    device_root = tmp_path / "device"
    _write_json(device_root / "runtime" / "manifest.json", {"runtimes": {"general": "general"}})
    _write_json(
        device_root / "runtime" / "general" / "manifest.json",
        {
            "id": "general",
            "version": "1.0.0",
            "nodePackages": {"global": ["core"], "local": ["local_pkg"]},
        },
    )
    _write_json(device_root / "tools" / "manifest.json", {"files": ["tool.py"]})
    (device_root / "tools" / "tool.py").write_text("# tool\n", encoding="utf-8")
    _write_json(
        device_root / "node_pkgs" / "index.json",
        {"version": 1, "packages": [{"id": "core", "manifest": "core/manifest.json"}]},
    )
    _write_json(
        device_root / "node_pkgs" / "core" / "manifest.json",
        {
            "id": "core",
            "version": "1.0.0",
            "manifestVersion": 2,
            "variants": {"py": {"mpAssets": {"*": ["otter_core/__init__.py"]}}},
        },
    )
    core_module = device_root / "node_pkgs" / "core" / "otter_core" / "__init__.py"
    core_module.parent.mkdir(parents=True, exist_ok=True)
    core_module.write_text("# core\n", encoding="utf-8")
    _write_json(
        device_root / "runtime" / "general" / "node_pkgs" / "local_pkg" / "manifest.json",
        {
            "id": "local_pkg",
            "version": "1.0.0",
            "manifestVersion": 2,
            "variants": {"py": {"mpAssets": {"*": ["otter_local/x.py"]}}},
        },
    )
    local_module = (
        device_root / "runtime" / "general" / "node_pkgs" / "local_pkg" / "otter_local" / "x.py"
    )
    local_module.parent.mkdir(parents=True, exist_ok=True)
    local_module.write_text("# local\n", encoding="utf-8")
    return device_root


def _addon(addons_root: Path, package_id: str = "sample_addon") -> Path:
    """Create one installed add-on package and return its directory."""

    package_dir = addons_root / package_id
    _write_json(
        package_dir / "manifest.json",
        {
            "id": package_id,
            "version": "2.0.0",
            "manifestVersion": 2,
            "variants": {"py": {"mpAssets": {"*": [f"moa_{package_id}/__init__.py"]}}},
        },
    )
    module = package_dir / f"moa_{package_id}" / "__init__.py"
    module.parent.mkdir(parents=True, exist_ok=True)
    module.write_text("# addon\n", encoding="utf-8")
    return package_dir


def test_gather_sources_without_addons_is_the_shipped_tree(tmp_path: Path):
    device_root = _device_root(tmp_path)

    sources, runtime_map, package_map, tools_map, warnings = gather_sources_from_manifests(
        device_root
    )

    assert {path.name for path in sources} == {"__init__.py", "x.py", "tool.py"}
    assert set(runtime_map) == {"general"}
    assert set(tools_map) == {"device-tools"}
    assert all(key.startswith(("core:", "local_pkg:")) for key in package_map)
    assert warnings == []


def test_gather_sources_covers_installed_addons(tmp_path: Path):
    device_root = _device_root(tmp_path)
    addons_root = tmp_path / "addons"
    package_dir = _addon(addons_root)

    sources, _runtime_map, package_map, _tools_map, warnings = gather_sources_from_manifests(
        device_root, addons_root=addons_root
    )

    addon_module = package_dir / "moa_sample_addon" / "__init__.py"
    assert addon_module.resolve() in sources
    assert f"sample_addon:{(package_dir / 'manifest.json')}" in package_map
    assert warnings == []


def test_gather_sources_with_addons_root_none_equals_default(tmp_path: Path):
    device_root = _device_root(tmp_path)

    assert gather_sources_from_manifests(device_root, addons_root=None) == (
        gather_sources_from_manifests(device_root)
    )


def test_resolve_package_dir_precedence(tmp_path: Path):
    device_root = _device_root(tmp_path)
    addons_root = tmp_path / "addons"
    addon_dir = _addon(addons_root, "local_pkg")
    runtime_dir = device_root / "runtime" / "general"
    node_pkgs_root = device_root / "node_pkgs"

    # Built-in wins over an add-on with the same id.
    assert (
        resolve_package_dir(
            "core",
            runtime_dir=runtime_dir,
            global_node_pkgs_root=node_pkgs_root,
            prefer_local=False,
            addons_root=addons_root,
        )
        == (node_pkgs_root / "core").resolve()
    )

    # An add-on beats a runtime-local shadow at the same id.
    assert (
        resolve_package_dir(
            "local_pkg",
            runtime_dir=runtime_dir,
            global_node_pkgs_root=node_pkgs_root,
            prefer_local=False,
            addons_root=addons_root,
        )
        == addon_dir.resolve()
    )

    # ``prefer_local`` keeps its old meaning for runtime-declared local packages.
    assert (
        resolve_package_dir(
            "local_pkg",
            runtime_dir=runtime_dir,
            global_node_pkgs_root=node_pkgs_root,
            prefer_local=True,
            addons_root=addons_root,
        )
        == (runtime_dir / "node_pkgs" / "local_pkg").resolve()
    )

    assert (
        resolve_package_dir(
            "ghost",
            runtime_dir=runtime_dir,
            global_node_pkgs_root=node_pkgs_root,
            prefer_local=False,
            addons_root=addons_root,
        )
        is None
    )


def test_clean_mpycache_dirs_covers_addons_but_not_staging(tmp_path: Path):
    device_root = _device_root(tmp_path)
    addons_root = tmp_path / "addons"
    package_dir = _addon(addons_root)
    addon_cache = package_dir / "__mpycache__" / "profile"
    addon_cache.mkdir(parents=True)
    staging_cache = addons_root / ".staging" / "install-x" / "__mpycache__" / "profile"
    staging_cache.mkdir(parents=True)
    core_cache = device_root / "node_pkgs" / "core" / "__mpycache__" / "profile"
    core_cache.mkdir(parents=True)

    clean_mpycache_dirs(device_root, addons_root=addons_root)

    assert not (package_dir / "__mpycache__").exists()
    assert not (device_root / "node_pkgs" / "core" / "__mpycache__").exists()
    assert staging_cache.is_dir()


def test_clean_mpycache_dirs_without_addons_root_leaves_addons_alone(tmp_path: Path):
    device_root = _device_root(tmp_path)
    addons_root = tmp_path / "addons"
    package_dir = _addon(addons_root)
    addon_cache = package_dir / "__mpycache__" / "profile"
    addon_cache.mkdir(parents=True)

    clean_mpycache_dirs(device_root)

    assert addon_cache.is_dir()


def test_compile_sources_to_sibling_mpy_embeds_relative_source_name(tmp_path: Path):
    modules = tmp_path / "modules"
    nested = modules / "pkg" / "demo.py"
    nested.parent.mkdir(parents=True)
    nested.write_text("x = 1\n", encoding="utf-8")
    top = modules / "top.py"
    top.write_text("y = 2\n", encoding="utf-8")

    argv_seen: list[list[str]] = []

    def fake_run(command, check):
        del check
        argv_seen.append([str(part) for part in command])
        # Emit each sibling so the caller can verify outputs without a real compiler.
        Path(command[-1]).with_suffix(".mpy").write_bytes(b"mpy")

    with mock.patch(
        "micro_otter.tools.firmware_compile.mpy_precompile.subprocess.run",
        side_effect=fake_run,
    ):
        compiled = compile_sources_to_sibling_mpy(
            source_files=[nested, top],
            mpy_cross=tmp_path / "mpy-cross",
            mpy_cross_args=(),
            source_root=modules,
        )

    assert compiled == 2
    nested_argv, top_argv = argv_seen
    assert nested_argv[nested_argv.index("-s") + 1] == "pkg/demo.py"
    assert nested_argv.index("-s") < nested_argv.index("-o")
    assert top_argv[top_argv.index("-s") + 1] == "top.py"
    assert (modules / "pkg" / "demo.mpy").is_file()
    assert (modules / "top.mpy").is_file()


def test_compile_sources_to_sibling_mpy_rejects_source_outside_root(tmp_path: Path):
    modules = tmp_path / "modules"
    modules.mkdir(parents=True)
    outside = tmp_path / "outside" / "demo.py"
    outside.parent.mkdir(parents=True)
    outside.write_text("x = 1\n", encoding="utf-8")

    with mock.patch(
        "micro_otter.tools.firmware_compile.mpy_precompile.subprocess.run",
    ) as run_mock:
        with pytest.raises(ValueError, match="outside source root"):
            compile_sources_to_sibling_mpy(
                source_files=[outside],
                mpy_cross=tmp_path / "mpy-cross",
                mpy_cross_args=(),
                source_root=modules,
            )

    run_mock.assert_not_called()

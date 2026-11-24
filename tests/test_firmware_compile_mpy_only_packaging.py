"""End-to-end coverage for mpy-only module packaging of the staged tree."""

import json
import shutil
import subprocess
from pathlib import Path
from unittest import mock

import pytest

from micro_otter.tools.firmware_compile import (
    BuildProfile,
    ModulePackagingMode,
    PrecompileResult,
    run_optional_mpy_precompile,
)
from micro_otter.tools.firmware_compile.staging_runner import run_staging

PRECOMPILE_MODULE = "micro_otter.tools.firmware_compile.build_precompile"


def _build_modules_tree(tmp_path: Path) -> tuple[Path, Path]:
    """Create a staged module tree with boot-path and package sources."""

    modules_path = tmp_path / "src" / "micropython" / "ports" / "esp32" / "modules"
    files = {
        "main.py": "print('boot')\n",
        "app/main_loop.py": "print('loop')\n",
        "otter_core/system.py": "x = 1\n",
        "otter_stdmo/motor.py": "y = 2\n",
    }
    for rel_path, content in files.items():
        target = modules_path / rel_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")

    asset = modules_path / "otter_core" / "data.json"
    asset.write_text("{}\n", encoding="utf-8")

    micropython_root = tmp_path / "src" / "micropython"
    micropython_root.mkdir(parents=True, exist_ok=True)
    return modules_path, micropython_root


def _fake_compile(
    sources_seen: list[Path],
    roots_seen: list[Path] | None = None,
    *,
    fail_on: int | None = None,
):
    """Build a fake ``compile_sources_to_sibling_mpy`` recording its inputs."""

    def fake_compile_sources_to_sibling_mpy(
        *, source_files, mpy_cross, mpy_cross_args, source_root
    ):
        del mpy_cross, mpy_cross_args
        if roots_seen is not None:
            roots_seen.append(source_root)
        for index, source in enumerate(source_files, start=1):
            sources_seen.append(source)
            if fail_on == index:
                raise subprocess.CalledProcessError(1, ["mpy-cross", str(source)])
            source.with_suffix(".mpy").write_bytes(b"mpy")
        return len(source_files)

    return fake_compile_sources_to_sibling_mpy


def _compiled_profile() -> BuildProfile:
    """Return a compiled-mpy build profile for the staging target."""

    return BuildProfile(
        runtime_id="general",
        board="esp32",
        packaging_mode=ModulePackagingMode.COMPILED_MPY,
    )


def test_excluded_sources_are_not_compiled(tmp_path: Path):
    modules_path, micropython_root = _build_modules_tree(tmp_path)
    sources_seen: list[Path] = []
    roots_seen: list[Path] = []

    with mock.patch(
        f"{PRECOMPILE_MODULE}.resolve_mpy_cross_executable",
        return_value=tmp_path / "mpy-cross",
    ), mock.patch(
        f"{PRECOMPILE_MODULE}.compile_sources_to_sibling_mpy",
        side_effect=_fake_compile(sources_seen, roots_seen),
    ):
        run_optional_mpy_precompile(
            profile=_compiled_profile(),
            micropython_root=micropython_root,
            modules_path=modules_path,
            dry_run=False,
            source_excludes=("main.py", "app/main_loop.py"),
        )

    compiled_relative = {path.relative_to(modules_path).as_posix() for path in sources_seen}
    assert compiled_relative == {"otter_core/system.py", "otter_stdmo/motor.py"}
    assert roots_seen == [modules_path]


def test_compiled_sources_are_removed(tmp_path: Path):
    modules_path, micropython_root = _build_modules_tree(tmp_path)
    sources_seen: list[Path] = []

    with mock.patch(
        f"{PRECOMPILE_MODULE}.resolve_mpy_cross_executable",
        return_value=tmp_path / "mpy-cross",
    ), mock.patch(
        f"{PRECOMPILE_MODULE}.compile_sources_to_sibling_mpy",
        side_effect=_fake_compile(sources_seen),
    ):
        result = run_optional_mpy_precompile(
            profile=_compiled_profile(),
            micropython_root=micropython_root,
            modules_path=modules_path,
            dry_run=False,
            source_excludes=("main.py", "app/main_loop.py"),
        )

    assert result.files_compiled == 2
    assert result.sources_removed == 2
    assert not (modules_path / "otter_core" / "system.py").exists()
    assert not (modules_path / "otter_stdmo" / "motor.py").exists()
    assert (modules_path / "otter_core" / "system.mpy").is_file()
    assert (modules_path / "otter_stdmo" / "motor.mpy").is_file()
    assert (modules_path / "main.py").is_file()
    assert (modules_path / "app" / "main_loop.py").is_file()
    assert not (modules_path / "main.mpy").exists()
    assert (modules_path / "otter_core" / "data.json").is_file()


def test_mpy_written_before_source_removal(tmp_path: Path):
    modules_path, micropython_root = _build_modules_tree(tmp_path)
    sources_seen: list[Path] = []

    with mock.patch(
        f"{PRECOMPILE_MODULE}.resolve_mpy_cross_executable",
        return_value=tmp_path / "mpy-cross",
    ), mock.patch(
        f"{PRECOMPILE_MODULE}.compile_sources_to_sibling_mpy",
        side_effect=_fake_compile(sources_seen, fail_on=3),
    ):
        with pytest.raises(subprocess.CalledProcessError):
            run_optional_mpy_precompile(
                profile=_compiled_profile(),
                micropython_root=micropython_root,
                modules_path=modules_path,
                dry_run=False,
            )

    for rel_path in ("main.py", "app/main_loop.py", "otter_core/system.py", "otter_stdmo/motor.py"):
        assert (modules_path / rel_path).is_file(), rel_path
    assert (modules_path / "app" / "main_loop.mpy").is_file()
    assert (modules_path / "main.mpy").is_file()
    assert not (modules_path / "otter_core" / "system.mpy").exists()


def test_empty_mpy_output_keeps_source(tmp_path: Path):
    modules_path, micropython_root = _build_modules_tree(tmp_path)

    def zero_byte_compile(*, source_files, mpy_cross, mpy_cross_args, source_root):
        """Write empty ``.mpy`` siblings to probe the verification guard."""

        del mpy_cross, mpy_cross_args, source_root
        for source in source_files:
            source.with_suffix(".mpy").write_bytes(b"")
        return len(source_files)

    with mock.patch(
        f"{PRECOMPILE_MODULE}.resolve_mpy_cross_executable",
        return_value=tmp_path / "mpy-cross",
    ), mock.patch(
        f"{PRECOMPILE_MODULE}.compile_sources_to_sibling_mpy",
        side_effect=zero_byte_compile,
    ):
        with pytest.raises(RuntimeError, match="mpy output missing"):
            run_optional_mpy_precompile(
                profile=_compiled_profile(),
                micropython_root=micropython_root,
                modules_path=modules_path,
                dry_run=False,
            )

    assert (modules_path / "main.py").is_file()
    assert (modules_path / "otter_core" / "system.py").is_file()


def test_dry_run_touches_nothing(tmp_path: Path):
    modules_path, micropython_root = _build_modules_tree(tmp_path)

    with mock.patch(
        f"{PRECOMPILE_MODULE}.resolve_mpy_cross_executable",
        return_value=tmp_path / "mpy-cross",
    ), mock.patch(
        f"{PRECOMPILE_MODULE}.compile_sources_to_sibling_mpy",
    ) as compile_mock:
        result = run_optional_mpy_precompile(
            profile=_compiled_profile(),
            micropython_root=micropython_root,
            modules_path=modules_path,
            dry_run=True,
            source_excludes=("main.py",),
        )

    compile_mock.assert_not_called()
    assert result.files_compiled == 0
    assert result.sources_removed == 0
    assert result.compiler_path == tmp_path / "mpy-cross"
    assert sorted(path.name for path in modules_path.rglob("*.mpy")) == []
    assert (modules_path / "otter_core" / "system.py").is_file()


def test_source_py_mode_leaves_tree_unchanged(tmp_path: Path):
    modules_path, micropython_root = _build_modules_tree(tmp_path)

    with mock.patch(
        f"{PRECOMPILE_MODULE}.resolve_mpy_cross_executable",
    ) as resolve_mock:
        result = run_optional_mpy_precompile(
            profile=BuildProfile(runtime_id="general", board="esp32"),
            micropython_root=micropython_root,
            modules_path=modules_path,
            dry_run=False,
        )

    resolve_mock.assert_not_called()
    assert result.files_compiled == 0
    assert result.sources_removed == 0
    assert result.compiler_path is None
    assert sorted(path.name for path in modules_path.rglob("*.mpy")) == []
    assert (modules_path / "otter_core" / "system.py").is_file()




def _write_json(path: Path, payload: dict) -> None:
    """Write a JSON fixture file, creating parent directories as needed."""

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _setup_staging_fixture(workspace: Path) -> Path:
    """Create a minimal device tree for staging runs with a precompile hook."""

    device_root = workspace / "src" / "micro_otter" / "nodes" / "device"
    (workspace / "src" / "micropython" / "ports" / "esp32" / "modules").mkdir(parents=True)

    _write_json(
        device_root / "targets" / "compile_target_mappings.json",
        {
            "schemaVersion": 1,
            "rules": [
                {
                    "id": "esp32-default",
                    "webTargetId": "esp32_wroom",
                    "runtimeIdInclude": ["general"],
                    "runtimeIdExclude": [],
                    "compile": {"board": "esp32", "port": "esp32"},
                    "priority": 100,
                }
            ],
        },
    )
    _write_json(device_root / "runtime" / "manifest.json", {"runtimes": {"general": "general"}})
    _write_json(
        device_root / "runtime" / "general" / "manifest.json",
        {
            "id": "general",
            "name": "Micro-Otter",
            "description": "Generated runtime fixture",
            "version": "1.11.0",
            "filesystem": ["app/main_loop.py"],
            "nodePackages": {"global": ["core"], "local": []},
            "deviceTargets": {"include": [], "exclude": []},
            "mpySourceExcludes": ["otter_main.py"],
        },
    )
    _write_json(device_root / "tools" / "manifest.json", {"files": ["wifi_manager.py"]})
    _write_json(
        device_root / "node_pkgs" / "index.json",
        {"packages": [{"id": "core", "manifest": "core/manifest.json"}]},
    )
    _write_json(
        device_root / "node_pkgs" / "core" / "manifest.json",
        {
            "id": "core",
            "version": "1.0.1",
            "mpAssets": {"*": ["otter_core/system.py"]},
        },
    )

    files = {
        device_root / "runtime" / "general" / "app" / "main_loop.py": "print('loop')\n",
        device_root / "runtime" / "general" / "otter_main.py": "def run():\n    pass\n",
        device_root / "tools" / "wifi_manager.py": "# wifi\n",
        device_root / "node_pkgs" / "core" / "otter_core" / "system.py": "x = 1\n",
    }
    for path, content in files.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    capabilities_src = (
        Path(__file__).resolve().parent.parent
        / "src"
        / "micro_otter"
        / "nodes"
        / "device"
        / "capabilities"
    )
    shutil.copytree(capabilities_src, device_root / "capabilities")

    return device_root


def _mpy_only_hook(excludes_seen: list[tuple[str, ...]]):
    """Build a staging precompile hook that emulates mpy-only conversion."""

    def hook(
        modules_path: Path,
        source_excludes: tuple[str, ...],
        staged_paths: tuple[str, ...],
    ) -> PrecompileResult:
        del staged_paths
        excludes_seen.append(source_excludes)
        excluded = set(source_excludes)
        compiled = 0
        for source in sorted(modules_path.rglob("*.py")):
            if source.relative_to(modules_path).as_posix() in excluded:
                continue
            source.with_suffix(".mpy").write_bytes(b"mpy")
            compiled += 1

        removed = 0
        for source in sorted(modules_path.rglob("*.py")):
            if source.relative_to(modules_path).as_posix() in excluded:
                continue
            source.unlink()
            removed += 1

        return PrecompileResult(
            files_compiled=compiled,
            sources_removed=removed,
            compiler_path=modules_path / "mpy-cross",
        )

    return hook


def test_hash_records_reference_mpy_paths(tmp_path: Path):
    workspace = tmp_path
    _setup_staging_fixture(workspace)
    excludes_seen: list[tuple[str, ...]] = []

    report = run_staging(
        workspace_root=workspace,
        runtime_id="general",
        target="esp32",
        dry_run=False,
        mpy_precompile_hook=_mpy_only_hook(excludes_seen),
    )

    assert excludes_seen == [("otter_main.py",)]
    assert report.precompile is not None
    assert report.precompile.files_compiled > 0
    assert report.precompile.sources_removed == report.precompile.files_compiled
    assert report.embedded_hashes_path is not None

    payload = json.loads(report.embedded_hashes_path.read_text(encoding="utf-8"))
    paths = [entry["path"] for entry in payload["files"]]
    assert "otter_main.py" in paths
    assert "app/main_loop.py" in [path.replace(".mpy", ".py") for path in paths]

    modules_root = report.modules_path
    for path in paths:
        assert (modules_root / path).is_file(), path
        if path != "otter_main.py":
            assert path.endswith(".mpy"), path

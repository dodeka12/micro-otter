import json
import shutil
from pathlib import Path
from unittest import mock

from micro_otter.tools.firmware_compile.build_precompile import PrecompileResult
from micro_otter.tools.firmware_compile.staging_models import StagingConflict
from micro_otter.tools.firmware_compile.staging_runner import run_staging


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _write_target_mapping(workspace: Path) -> None:
    _write_json(
        workspace
        / "src"
        / "micro_otter"
        / "nodes"
        / "device"
        / "targets"
        / "compile_target_mappings.json",
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
                },
                {
                    "id": "generic-fallback",
                    "webTargetId": "generic_micropython",
                    "runtimeIdInclude": ["*"],
                    "runtimeIdExclude": [],
                    "compile": {"board": "*", "port": "*"},
                    "priority": 10,
                },
            ],
        },
    )


def _setup_fixture(workspace: Path) -> Path:
    device_root = workspace / "src" / "micro_otter" / "nodes" / "device"
    micropython_modules = workspace / "src" / "micropython" / "ports" / "esp32" / "modules"
    micropython_modules.mkdir(parents=True)
    _write_target_mapping(workspace)

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
            "manifestVersion": 2,
            "variants": {"py": {"mpAssets": {"*": ["otter_core/system.py"]}}},
        },
    )

    files = {
        device_root / "runtime" / "general" / "app" / "main_loop.py": "print('loop')\n",
        device_root / "runtime" / "general" / "otter_main.py": "def run():\n    pass\n",
        device_root / "tools" / "wifi_manager.py": "# wifi\n",
        device_root / "node_pkgs" / "core" / "otter_core" / "system.py": "x=1\n",
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


def test_run_staging_dry_run_reports_without_writes(tmp_path: Path):
    workspace = tmp_path
    _setup_fixture(workspace)

    report = run_staging(
        workspace_root=workspace,
        runtime_id="general",
        target="esp32",
        dry_run=True,
    )

    assert report.dry_run is True
    assert report.files_discovered > 0
    assert report.embedded_manifest_path is not None
    assert not report.embedded_manifest_path.exists()


def test_hook_receives_excludes_and_staged_paths(tmp_path: Path):
    workspace = tmp_path
    device_root = _setup_fixture(workspace)

    runtime_manifest = device_root / "runtime" / "general" / "manifest.json"
    manifest_payload = json.loads(runtime_manifest.read_text(encoding="utf-8"))
    manifest_payload["mpySourceExcludes"] = ["main.py", "./app/main_loop.py"]
    runtime_manifest.write_text(json.dumps(manifest_payload), encoding="utf-8")

    calls: list[tuple[Path, tuple[str, ...], tuple[str, ...]]] = []

    def hook(
        modules_path: Path,
        source_excludes: tuple[str, ...],
        staged_paths: tuple[str, ...],
    ) -> PrecompileResult:
        """Record the hook arguments and report a no-op precompile."""

        calls.append((modules_path, source_excludes, staged_paths))
        return PrecompileResult(files_compiled=0, sources_removed=0, compiler_path=None)

    report = run_staging(
        workspace_root=workspace,
        runtime_id="general",
        target="esp32",
        dry_run=False,
        mpy_precompile_hook=hook,
    )

    expected_modules = (
        workspace / "src" / "micropython" / "ports" / "esp32" / "modules"
    ).resolve()
    assert len(calls) == 1
    modules_path, source_excludes, staged_paths = calls[0]
    assert modules_path == expected_modules
    assert source_excludes == ("main.py", "app/main_loop.py")
    assert staged_paths == tuple(sorted(staged_paths))
    assert "main.py" in staged_paths
    assert "otter_main.py" in staged_paths
    assert "app/main_loop.py" in staged_paths
    assert "otter_core/system.py" in staged_paths
    assert report.precompile is not None
    assert report.precompile.files_compiled == 0


def test_hook_skipped_on_dry_run_and_conflicts(tmp_path: Path):
    workspace = tmp_path
    _setup_fixture(workspace)
    calls: list[Path] = []

    def hook(
        modules_path: Path,
        source_excludes: tuple[str, ...],
        staged_paths: tuple[str, ...],
    ) -> PrecompileResult:
        """Record invocation so the test can prove the hook was skipped."""

        del source_excludes, staged_paths
        calls.append(modules_path)
        return PrecompileResult(files_compiled=0, sources_removed=0, compiler_path=None)

    dry_report = run_staging(
        workspace_root=workspace,
        runtime_id="general",
        target="esp32",
        dry_run=True,
        mpy_precompile_hook=hook,
    )

    assert calls == []
    assert dry_report.precompile is None

    conflict = StagingConflict(
        target_rel_path="main.py",
        first_source=workspace / "a.py",
        second_source=workspace / "b.py",
    )
    with mock.patch(
        "micro_otter.tools.firmware_compile.staging_runner.build_staging_preflight",
        return_value=mock.Mock(entries=[], conflicts=[conflict]),
    ):
        conflict_report = run_staging(
            workspace_root=workspace,
            runtime_id="general",
            target="esp32",
            dry_run=False,
            mpy_precompile_hook=hook,
        )

    assert calls == []
    assert conflict_report.precompile is None
    assert conflict_report.conflicts == [conflict]


def test_run_staging_full_run_writes_outputs(tmp_path: Path):
    workspace = tmp_path
    _setup_fixture(workspace)

    report = run_staging(
        workspace_root=workspace,
        runtime_id="general",
        target="esp32",
        dry_run=False,
    )

    assert report.conflicts == []
    assert report.files_copied >= 1
    assert report.files_startup_written == 2
    assert report.embedded_manifest_path is not None
    assert report.embedded_manifest_path.exists()
    assert report.embedded_hashes_path is not None
    assert report.embedded_hashes_path.exists()

    payload_module = (
        workspace
        / "src"
        / "micropython"
        / "ports"
        / "esp32"
        / "modules"
        / "otter_runtime"
        / "embedded_metadata_payload.py"
    )
    templates_module = (
        workspace
        / "src"
        / "micropython"
        / "ports"
        / "esp32"
        / "modules"
        / "otter_runtime"
        / "bootstrap_setup_templates.py"
    )
    contract_module = (
        workspace
        / "src"
        / "micropython"
        / "ports"
        / "esp32"
        / "modules"
        / "otter_runtime"
        / "bootstrap_setup_contract.py"
    )
    startup_module = (
        workspace
        / "src"
        / "micropython"
        / "ports"
        / "esp32"
        / "modules"
        / "otter_runtime"
        / "bootstrap_setup_startup.py"
    )
    api_module = (
        workspace
        / "src"
        / "micropython"
        / "ports"
        / "esp32"
        / "modules"
        / "otter_runtime"
        / "embedded_metadata_api.py"
    )
    assert payload_module.exists()
    assert templates_module.exists()
    assert contract_module.exists()
    assert startup_module.exists()
    assert api_module.exists()

    text = payload_module.read_text(encoding="utf-8")
    assert "'mode': 'embedded'" in text
    assert "'id': 'general'" in text
    assert "'targetId': 'esp32_wroom'" not in text
    assert "'id': 'esp32_wroom'" not in text
    assert "'compile': {'board': 'esp32', 'port': 'esp32'}" in text
    assert "'version': '1.11.0'" in text
    assert "null" not in text
    assert "None" in text
    compile(text, str(payload_module), "exec")

    templates_text = templates_module.read_text(encoding="utf-8")
    assert "build_manifest_template" in templates_text
    assert "RUNTIME_IDENTITY_MODE_SUMMARY" in templates_text
    assert "from otter_runtime.embedded_metadata_payload import" not in templates_text
    compile(templates_text, str(templates_module), "exec")

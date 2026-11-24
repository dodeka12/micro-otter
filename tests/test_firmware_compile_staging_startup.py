from pathlib import Path

from micro_otter.tools.firmware_compile.staging_models import RuntimePayload
from micro_otter.tools.firmware_compile.staging_paths import resolve_staging_paths
from micro_otter.tools.firmware_compile.staging_startup import (
    render_main_py_shim,
    stage_startup_files,
)


def _setup_paths_and_payload(tmp_path: Path):
    modules = tmp_path / "src" / "micropython" / "ports" / "esp32" / "modules"
    modules.mkdir(parents=True)

    runtime_root = tmp_path / "src" / "micro_otter" / "nodes" / "device" / "runtime" / "general"
    startup_source = runtime_root / "otter_main.py"
    startup_source.parent.mkdir(parents=True, exist_ok=True)
    startup_source.write_text("def run():\n    return 1\n", encoding="utf-8")

    payload = RuntimePayload(
        runtime_id="general",
        runtime_version="1.11.0",
        runtime_root=runtime_root,
        runtime_files=(),
        tools_files=(),
        package_assets=(),
    )
    paths = resolve_staging_paths(workspace_root=tmp_path, target="esp32")

    return paths, payload


def test_render_main_py_shim_is_deterministic():
    assert render_main_py_shim() == (
        "try:\n"
        "    import otter_runtime.bootstrap_setup_startup as _bootstrap_setup_startup\n"
        "    import otter_main as _micro_otter_main\n"
        "except Exception as _boot_import_error:\n"
        "    print(\n"
        '        "[error] boot: runtime import failed ({})".format(\n'
        '            str(_boot_import_error).replace("\\n", " ")\n'
        "        )\n"
        "    )\n"
        "else:\n"
        "    try:\n"
        "        _bootstrap_setup_startup.run_bootstrap_setup_from_startup(\n"
        "            _bootstrap_setup_startup.STARTUP_ADAPTER_TARGET_ENTRYPOINT\n"
        "        )\n"
        "    except Exception as _bootstrap_setup_error:\n"
        "        print(\n"
        '            "[error] boot: bootstrap setup trigger failed ({})".format(\n'
        '                str(_bootstrap_setup_error).replace("\\n", " ")\n'
        "            )\n"
        "        )\n"
        "\n"
        "    _micro_otter_main.run()\n"
    )


def test_render_main_py_shim_contains_no_tabs():
    assert "\t" not in render_main_py_shim()


def test_runtime_main_py_matches_generated_shim():
    runtime_main = (
        Path(__file__).resolve().parents[1]
        / "src"
        / "micro_otter"
        / "nodes"
        / "device"
        / "runtime"
        / "general"
        / "main.py"
    )
    source = runtime_main.read_text(encoding="utf-8")
    lines = [line for line in source.splitlines() if not line.lstrip().startswith("#")]
    while lines and lines[0].strip() == "":
        lines.pop(0)
    normalized = "\n".join(line.expandtabs(4) for line in lines)

    assert normalized.splitlines() == render_main_py_shim().splitlines()


def test_stage_startup_files_writes_startup_artifacts(tmp_path: Path):
    paths, payload = _setup_paths_and_payload(tmp_path)

    result = stage_startup_files(paths=paths, payload=payload)

    assert result.files_discovered == 2
    assert result.files_written == 2
    assert (paths.modules_path / "otter_main.py").exists()
    assert (paths.modules_path / "main.py").read_text(encoding="utf-8") == render_main_py_shim()


def test_stage_startup_files_dry_run(tmp_path: Path):
    paths, payload = _setup_paths_and_payload(tmp_path)

    result = stage_startup_files(paths=paths, payload=payload, dry_run=True)

    assert result.dry_run is True
    assert result.files_written == 2
    assert not (paths.modules_path / "main.py").exists()

from pathlib import Path
from unittest import mock

from typer.testing import CliRunner

from micro_otter.cli import app
from micro_otter.tools.firmware_compile import CompileRuntimeExecutionResult, CompileRuntimeRequest

runner = CliRunner()


def test_compile_runtime_delegates_to_package_entrypoint(tmp_path: Path):
    execution_result = CompileRuntimeExecutionResult(
        exit_code=0,
        payload={"status": "success", "errors": []},
    )
    with mock.patch("pathlib.Path.cwd", return_value=tmp_path), mock.patch(
        "micro_otter.cli.app.execute_compile_runtime_request",
        return_value=execution_result,
    ) as run_mock:
        result = runner.invoke(
            app,
            [
                "compile-runtime",
                "--runtime-id",
                "general",
                "--board",
                "esp32",
                "--dry-run",
            ],
        )

    assert result.exit_code == 0
    run_mock.assert_called_once()
    request = run_mock.call_args.args[0]
    assert isinstance(request, CompileRuntimeRequest)
    assert request.runtime_id == "general"
    assert request.board == "esp32"
    assert request.workspace_root == tmp_path
    assert request.dry_run is True


def test_compile_runtime_passes_optional_contract_flags(tmp_path: Path):
    execution_result = CompileRuntimeExecutionResult(
        exit_code=0,
        payload={"status": "success", "errors": []},
    )
    with mock.patch("pathlib.Path.cwd", return_value=tmp_path), mock.patch(
        "micro_otter.cli.app.execute_compile_runtime_request",
        return_value=execution_result,
    ) as run_mock:
        result = runner.invoke(
            app,
            [
                "compile-runtime",
                "--runtime-id",
                "general",
                "--board",
                "esp32",
                "--micropython-root",
                str(tmp_path / "mpy"),
                "--modules-path",
                str(tmp_path / "modules"),
                "--device-root",
                str(tmp_path / "device"),
                "--build-dir",
                str(tmp_path / "build"),
                "--clean-staging",
                "--clean-build",
                "--module-packaging-mode",
                "compiled-mpy",
                "--json-output",
                "--embedded-inventory-output",
                str(tmp_path / "inv" / "embedded.json"),
                "--verbose",
                "--request-id",
                "req-123",
                "--timeout-seconds",
                "45",
            ],
        )

    assert result.exit_code == 0
    run_mock.assert_called_once()
    request = run_mock.call_args.args[0]
    assert request.micropython_root == (tmp_path / "mpy")
    assert request.modules_path == (tmp_path / "modules")
    assert request.device_root == (tmp_path / "device")
    assert request.build_dir == (tmp_path / "build")
    assert request.clean_staging is True
    assert request.clean_build is True
    assert request.module_packaging_mode == "compiled-mpy"
    assert request.json_output is True
    assert request.embedded_inventory_output == (tmp_path / "inv" / "embedded.json")
    assert request.verbose is True
    assert request.request_id == "req-123"
    assert request.timeout_seconds == 45


def test_compile_runtime_parses_package_ids(tmp_path: Path):
    execution_result = CompileRuntimeExecutionResult(
        exit_code=0,
        payload={"status": "success", "errors": []},
    )
    with mock.patch("pathlib.Path.cwd", return_value=tmp_path), mock.patch(
        "micro_otter.cli.app.execute_compile_runtime_request",
        return_value=execution_result,
    ) as run_mock:
        result = runner.invoke(
            app,
            [
                "compile-runtime",
                "--runtime-id",
                "general",
                "--board",
                "esp32",
                "--dry-run",
                "--package-ids",
                " core , boss ,core ",
            ],
        )

    assert result.exit_code == 0
    request = run_mock.call_args.args[0]
    assert request.package_ids == ("core", "boss", "core")


def test_compile_runtime_parses_package_variants(tmp_path: Path):
    execution_result = CompileRuntimeExecutionResult(
        exit_code=0,
        payload={"status": "success", "errors": []},
    )
    with mock.patch("pathlib.Path.cwd", return_value=tmp_path), mock.patch(
        "micro_otter.cli.app.execute_compile_runtime_request",
        return_value=execution_result,
    ) as run_mock:
        result = runner.invoke(
            app,
            [
                "compile-runtime",
                "--runtime-id",
                "general",
                "--board",
                "esp32",
                "--dry-run",
                "--package-variants",
                "pulse=viper, audio=viper",
            ],
        )

    assert result.exit_code == 0
    request = run_mock.call_args.args[0]
    assert request.package_variants == {"pulse": "viper", "audio": "viper"}


def test_compile_runtime_package_variants_last_wins(tmp_path: Path):
    execution_result = CompileRuntimeExecutionResult(
        exit_code=0,
        payload={"status": "success", "errors": []},
    )
    with mock.patch("pathlib.Path.cwd", return_value=tmp_path), mock.patch(
        "micro_otter.cli.app.execute_compile_runtime_request",
        return_value=execution_result,
    ) as run_mock:
        result = runner.invoke(
            app,
            [
                "compile-runtime",
                "--runtime-id",
                "general",
                "--board",
                "esp32",
                "--dry-run",
                "--package-variants",
                "pulse=a,pulse=b",
            ],
        )

    assert result.exit_code == 0
    assert run_mock.call_args.args[0].package_variants == {"pulse": "b"}


def test_compile_runtime_rejects_a_bad_package_variant_pair(tmp_path: Path):
    execution_result = CompileRuntimeExecutionResult(
        exit_code=0,
        payload={"status": "success", "errors": []},
    )
    with mock.patch("pathlib.Path.cwd", return_value=tmp_path), mock.patch(
        "micro_otter.cli.app.execute_compile_runtime_request",
        return_value=execution_result,
    ):
        result = runner.invoke(
            app,
            [
                "compile-runtime",
                "--runtime-id",
                "general",
                "--board",
                "esp32",
                "--dry-run",
                "--package-variants",
                "pulse",
            ],
        )

    assert result.exit_code == 2


def test_compile_runtime_without_package_ids_is_none(tmp_path: Path):
    execution_result = CompileRuntimeExecutionResult(
        exit_code=0,
        payload={"status": "success", "errors": []},
    )
    with mock.patch("pathlib.Path.cwd", return_value=tmp_path), mock.patch(
        "micro_otter.cli.app.execute_compile_runtime_request",
        return_value=execution_result,
    ) as run_mock:
        result = runner.invoke(
            app,
            ["compile-runtime", "--runtime-id", "general", "--board", "esp32", "--dry-run"],
        )

    assert result.exit_code == 0
    request = run_mock.call_args.args[0]
    assert request.package_ids is None


def test_compile_runtime_empty_package_ids_option_is_none(tmp_path: Path):
    execution_result = CompileRuntimeExecutionResult(
        exit_code=0,
        payload={"status": "success", "errors": []},
    )
    with mock.patch("pathlib.Path.cwd", return_value=tmp_path), mock.patch(
        "micro_otter.cli.app.execute_compile_runtime_request",
        return_value=execution_result,
    ) as run_mock:
        result = runner.invoke(
            app,
            [
                "compile-runtime",
                "--runtime-id",
                "general",
                "--board",
                "esp32",
                "--dry-run",
                "--package-ids",
                "",
            ],
        )

    assert result.exit_code == 0
    request = run_mock.call_args.args[0]
    assert request.package_ids is None


def test_compile_runtime_maps_value_error_to_exit_code_2():
    execution_result = CompileRuntimeExecutionResult(
        exit_code=2,
        payload={
            "status": "failed",
            "errors": [
                {"category": "input-validation", "message": "invalid args"},
            ],
        },
    )
    with mock.patch(
        "micro_otter.cli.app.execute_compile_runtime_request",
        return_value=execution_result,
    ):
        result = runner.invoke(
            app,
            ["compile-runtime", "--runtime-id", "general", "--board", "esp32"],
        )

    assert result.exit_code == 2
    assert "invalid args" in result.stderr


def test_compile_runtime_timeout_validation_maps_to_exit_code_2(tmp_path: Path):
    (tmp_path / "src" / "micro_otter" / "nodes" / "device" / "firmware").mkdir(
        parents=True, exist_ok=True
    )
    (tmp_path / "src" / "micro_otter" / "nodes" / "device" / "firmware" / "boards.json").write_text(
        '{"schemaVersion": 2, "boards": [{"name": "esp32", "slug": "esp32", '
        '"displayName": "ESP32", "buildBackend": "esp-idf", "flashBackend": "esptool", '
        '"chip": "esp32", "build": {"port": "esp32", "board": "esp32", '
        '"buildDirName": "build-ESP32_GENERIC"}, "flash": {"offset": "0x1000"}}]}',
        encoding="utf-8",
    )

    with mock.patch("pathlib.Path.cwd", return_value=tmp_path):
        result = runner.invoke(
            app,
            [
                "compile-runtime",
                "--runtime-id",
                "general",
                "--board",
                "esp32",
                "--timeout-seconds",
                "0",
            ],
        )

    assert result.exit_code == 2
    assert "timeout-seconds" in result.stderr


def test_compile_runtime_maps_missing_file_to_exit_code_3():
    execution_result = CompileRuntimeExecutionResult(
        exit_code=3,
        payload={
            "status": "failed",
            "errors": [
                {"category": "manifest-resolution", "message": "missing manifest"},
            ],
        },
    )
    with mock.patch(
        "micro_otter.cli.app.execute_compile_runtime_request",
        return_value=execution_result,
    ):
        result = runner.invoke(
            app,
            ["compile-runtime", "--runtime-id", "general", "--board", "esp32"],
        )

    assert result.exit_code == 3
    assert "missing manifest" in result.stderr


def test_compile_runtime_json_output_writes_payload_to_stdout(tmp_path: Path):
    execution_result = CompileRuntimeExecutionResult(
        exit_code=0,
        payload={
            "schemaVersion": 1,
            "status": "success",
            "errors": [],
        },
    )
    with mock.patch("pathlib.Path.cwd", return_value=tmp_path), mock.patch(
        "micro_otter.cli.app.execute_compile_runtime_request",
        return_value=execution_result,
    ):
        result = runner.invoke(
            app,
            [
                "compile-runtime",
                "--runtime-id",
                "general",
                "--board",
                "esp32",
                "--json-output",
            ],
        )

    assert result.exit_code == 0
    assert "\"schemaVersion\":1" in result.stdout


def test_compile_runtime_human_output_renders_summary_tables(tmp_path: Path):
    execution_result = CompileRuntimeExecutionResult(
        exit_code=0,
        payload={
            "status": "success",
            "runtime": {"id": "general", "version": "1.11.0"},
            "target": {"board": "esp32"},
            "paths": {
                "micropythonRoot": "/tmp/micropython",
                "modulesPath": "/tmp/modules",
                "firmwareArtifact": None,
            },
            "staging": {"embeddedInventoryPath": "/tmp/modules/otter/embedded_manifest.json"},
            "build": {
                "exitCode": 0,
                "durationMs": 12,
                "command": "make BOARD=esp32 OTTER_PACKAGING_MODE=compiled-mpy",
            },
            "metadata": {"modulePackagingMode": "compiled-mpy"},
            "warnings": ["demo warning"],
            "errors": [],
        },
    )
    with mock.patch("pathlib.Path.cwd", return_value=tmp_path), mock.patch(
        "micro_otter.cli.app.execute_compile_runtime_request",
        return_value=execution_result,
    ):
        result = runner.invoke(
            app,
            ["compile-runtime", "--runtime-id", "general", "--board", "esp32"],
        )

    assert result.exit_code == 0
    assert "Compile runtime succeeded" in result.stdout
    assert "Summary" in result.stdout
    assert "Paths" in result.stdout
    assert "compiled-mpy" in result.stdout
    assert "demo warning" in result.stdout


def test_cr_alias_delegates_to_compile_runtime(tmp_path: Path):
    execution_result = CompileRuntimeExecutionResult(
        exit_code=0,
        payload={"status": "success", "errors": []},
    )
    with mock.patch("pathlib.Path.cwd", return_value=tmp_path), mock.patch(
        "micro_otter.cli.app.execute_compile_runtime_request",
        return_value=execution_result,
    ) as run_mock:
        result = runner.invoke(
            app,
            [
                "cr",
                "--runtime-id",
                "general",
                "--board",
                "esp32",
                "--dry-run",
            ],
        )

    assert result.exit_code == 0
    run_mock.assert_called_once()
    request = run_mock.call_args.args[0]
    assert isinstance(request, CompileRuntimeRequest)
    assert request.runtime_id == "general"
    assert request.board == "esp32"
    assert request.workspace_root == tmp_path
    assert request.dry_run is True


def test_compile_runtime_resolves_workspace_root_from_nested_cwd(tmp_path: Path):
    workspace_root = tmp_path / "repo"
    nested_cwd = workspace_root / "src" / "micro_otter"
    (workspace_root / "src" / "micro_otter").mkdir(parents=True, exist_ok=True)
    (workspace_root / "pyproject.toml").write_text("[project]\nname='demo'\n", encoding="utf-8")

    execution_result = CompileRuntimeExecutionResult(
        exit_code=0,
        payload={"status": "success", "errors": []},
    )
    with mock.patch("pathlib.Path.cwd", return_value=nested_cwd), mock.patch(
        "micro_otter.cli.app.execute_compile_runtime_request",
        return_value=execution_result,
    ) as run_mock:
        result = runner.invoke(
            app,
            [
                "compile-runtime",
                "--runtime-id",
                "general",
                "--board",
                "esp32",
                "--dry-run",
            ],
        )

    assert result.exit_code == 0
    request = run_mock.call_args.args[0]
    assert request.workspace_root == workspace_root.resolve()

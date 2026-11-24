from pathlib import Path
from unittest import mock

from typer.testing import CliRunner

from micro_otter.cli import app
from micro_otter.tools.firmware_compile import CompileRuntimeExecutionResult

runner = CliRunner()

_MOCK_TARGET = "micro_otter.cli.app.execute_compile_runtime_request"


def test_compile_runtime_cli_parses_required_args_and_executes(tmp_path: Path):
    execution_result = CompileRuntimeExecutionResult(
        exit_code=0,
        payload={
            "status": "success",
            "errors": [],
            "runtime": {"id": "general", "version": "1.11.0"},
            "target": {
                "board": "esp32",
                "port": "esp32",
                "webTargetId": None,
                "mappingRuleId": None,
                "mappingSource": None,
                "mappingConfidence": None,
            },
            "paths": {
                "micropythonRoot": str(tmp_path),
                "modulesPath": None,
                "firmwareArtifact": None,
                "firmwarePublishedArtifact": None,
                "latestVersionsRegistry": None,
            },
            "staging": {
                "filesDiscovered": 0,
                "filesCopied": 0,
                "filesByPackage": {},
                "conflicts": [],
                "detailedFiles": [],
                "embeddedInventoryPath": None,
                "embeddedInventoryHash": None,
                "embeddedMetadataRoot": "otter/",
                "staticAssetFilesEmbedded": 0,
                "staticAssetRawBytes": 0,
                "staticAssetCompressedBytes": 0,
            },
            "build": {
                "startedAt": None,
                "finishedAt": None,
                "durationMs": 0,
                "command": "staging-only",
                "exitCode": None,
            },
            "metadata": {
                "embeddedMode": True,
                "packagesIncluded": [],
                "sourceRevision": None,
                "modulePackagingMode": "source-py",
                "buildProfile": {
                    "runtimeId": "general",
                    "board": "esp32",
                    "packagingMode": "source-py",
                    "optimizationLevel": None,
                    "includeAllCompatiblePackages": False,
                },
                "precompiledFiles": 0,
                "firmwarePublishStatus": "not-run",
            },
            "warnings": [],
        },
    )

    with (
        mock.patch(_MOCK_TARGET, return_value=execution_result) as execute_mock,
        mock.patch("micro_otter.cli.app._resolve_workspace_root", return_value=tmp_path),
    ):
        result = runner.invoke(
            app, ["cr", "--runtime-id", "general", "--board", "esp32", "--dry-run"]
        )

    assert result.exit_code == 0
    execute_mock.assert_called_once()
    request = execute_mock.call_args.args[0]
    assert request.runtime_id == "general"
    assert request.board == "esp32"
    assert request.workspace_root == tmp_path
    assert request.dry_run is True


def test_compile_runtime_cli_json_output_emits_compact_payload(tmp_path: Path):
    execution_result = CompileRuntimeExecutionResult(
        exit_code=0,
        payload={"schemaVersion": 1, "status": "success", "errors": []},
    )

    with (
        mock.patch(_MOCK_TARGET, return_value=execution_result),
        mock.patch("micro_otter.cli.app._resolve_workspace_root", return_value=tmp_path),
    ):
        result = runner.invoke(
            app,
            [
                "cr",
                "--runtime-id",
                "general",
                "--board",
                "esp32",
                "--json-output",
                "--dry-run",
            ],
        )

    assert result.exit_code == 0
    assert '"schemaVersion":1' in result.output


def test_compile_runtime_cli_force_overwrite_flag_wires_to_request(tmp_path: Path):
    execution_result = CompileRuntimeExecutionResult(
        exit_code=0,
        payload={"status": "success", "errors": []},
    )

    with (
        mock.patch(_MOCK_TARGET, return_value=execution_result) as execute_mock,
        mock.patch("micro_otter.cli.app._resolve_workspace_root", return_value=tmp_path),
    ):
        result = runner.invoke(
            app,
            [
                "cr",
                "--runtime-id",
                "general",
                "--board",
                "esp32",
                "--dry-run",
                "--force-overwrite",
            ],
        )

    assert result.exit_code == 0
    request = execute_mock.call_args.args[0]
    assert request.force_overwrite is True


def test_compile_runtime_cli_prompts_user_when_firmware_already_published(tmp_path: Path):
    already_published_result = CompileRuntimeExecutionResult(
        exit_code=9,
        payload={
            "status": "failed",
            "errors": [{
                "code": "FIRMWARE_ALREADY_PUBLISHED",
                "category": "firmware-already-published",
                "message": "already exists",
                "details": {
                    "existingPath": "/opt/micro_otter/firmware/micro-otter-1.27.0.bin",
                    "fullVersion": "1.27.0-esp32-general-0.1.0",
                },
            }],
        },
    )
    rebuilt_result = CompileRuntimeExecutionResult(
        exit_code=0,
        payload={"status": "success", "errors": []},
    )

    with (
        mock.patch(
            _MOCK_TARGET, side_effect=[already_published_result, rebuilt_result]
        ) as execute_mock,
        mock.patch("micro_otter.cli.app._resolve_workspace_root", return_value=tmp_path),
    ):
        # CliRunner input="y\n" simulates the user confirming the prompt
        result = runner.invoke(
            app, ["cr", "--runtime-id", "general", "--board", "esp32"], input="y\n"
        )

    assert result.exit_code == 0
    assert execute_mock.call_count == 2
    second_request = execute_mock.call_args_list[1].args[0]
    assert second_request.force_overwrite is True
    assert "already published" in result.output.lower()


def test_compile_runtime_cli_cancels_when_user_declines_rebuild(tmp_path: Path):
    already_published_result = CompileRuntimeExecutionResult(
        exit_code=9,
        payload={
            "status": "failed",
            "errors": [{
                "code": "FIRMWARE_ALREADY_PUBLISHED",
                "category": "firmware-already-published",
                "message": "already exists",
                "details": {
                    "existingPath": "/opt/micro_otter/firmware/micro-otter-1.27.0.bin",
                    "fullVersion": "1.27.0-esp32-general-0.1.0",
                },
            }],
        },
    )

    with (
        mock.patch(_MOCK_TARGET, return_value=already_published_result) as execute_mock,
        mock.patch("micro_otter.cli.app._resolve_workspace_root", return_value=tmp_path),
    ):
        result = runner.invoke(
            app, ["cr", "--runtime-id", "general", "--board", "esp32"], input="n\n"
        )

    assert result.exit_code == 9
    assert execute_mock.call_count == 1
    assert "cancelled" in result.output.lower()


def test_compile_runtime_cli_json_output_returns_exit_9_without_prompting(tmp_path: Path):
    already_published_result = CompileRuntimeExecutionResult(
        exit_code=9,
        payload={
            "status": "failed",
            "errors": [{
                "code": "FIRMWARE_ALREADY_PUBLISHED",
                "category": "firmware-already-published",
                "message": "already exists",
                "details": {
                    "existingPath": "/opt/micro_otter/firmware/micro-otter-1.27.0.bin",
                    "fullVersion": "1.27.0-esp32-general-0.1.0",
                },
            }],
        },
    )

    with mock.patch(_MOCK_TARGET, return_value=already_published_result) as execute_mock, \
         mock.patch("micro_otter.cli.app._resolve_workspace_root", return_value=tmp_path):
        result = runner.invoke(
            app, ["cr", "--runtime-id", "general", "--board", "esp32", "--json-output"]
        )

    assert result.exit_code == 9
    assert execute_mock.call_count == 1
    assert "FIRMWARE_ALREADY_PUBLISHED" in result.output


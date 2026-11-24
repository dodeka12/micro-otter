from pathlib import Path
from unittest import mock

from typer.testing import CliRunner

from micro_otter.cli import app
from micro_otter.tools.firmware_compile import (
    BuildOrchestrationPlan,
    BuildProfile,
    ModulePackagingMode,
    build_micropython_command,
)

runner = CliRunner()


def test_toolchain_builder_uses_argument_arrays_not_shell_strings(tmp_path: Path):
    profile = BuildProfile(runtime_id="general", board="esp32")
    (tmp_path / "ports" / "esp32").mkdir(parents=True, exist_ok=True)

    command = build_micropython_command(profile=profile, micropython_root=tmp_path)

    assert isinstance(command.argv, tuple)
    assert all(isinstance(arg, str) for arg in command.argv)


def test_cli_delegates_into_package_entrypoint(tmp_path: Path):
    with mock.patch(
        "micro_otter.cli.app.execute_compile_runtime_request",
        return_value=mock.Mock(exit_code=0, payload={"status": "success", "errors": []}),
    ) as execute_mock, mock.patch(
        "micro_otter.cli.app._resolve_workspace_root", return_value=tmp_path
    ):
        result = runner.invoke(
            app, ["cr", "--runtime-id", "general", "--board", "esp32", "--dry-run"]
        )

    assert result.exit_code == 0
    execute_mock.assert_called_once()


def test_orchestration_plan_preserves_profile_boundary(tmp_path: Path):
    profile = BuildProfile(
        runtime_id="general",
        board="esp32",
        packaging_mode=ModulePackagingMode.COMPILED_MPY,
    )
    (tmp_path / "ports" / "esp32").mkdir(parents=True, exist_ok=True)
    command = build_micropython_command(profile=profile, micropython_root=tmp_path)

    plan = BuildOrchestrationPlan(profile=profile, command=command)

    assert plan.profile.packaging_mode == ModulePackagingMode.COMPILED_MPY
    assert plan.command.argv[0] == "make"

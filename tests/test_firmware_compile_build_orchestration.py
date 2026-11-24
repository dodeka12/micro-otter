from __future__ import annotations

import sys
import threading
import time
from pathlib import Path
from unittest import mock

import pytest

from micro_otter.tools.firmware_compile import (
    BuildCommandSpec,
    BuildOrchestrationPlan,
    BuildOrchestrationResult,
    BuildPreflightResult,
    ModulePackagingMode,
    PrecompileResult,
    StagingExecutionReport,
    run_build_orchestration,
)
from micro_otter.tools.firmware_compile.backends.base import BuildRequest
from micro_otter.tools.firmware_compile.backends.esp_idf import EspIdfBackend
from micro_otter.tools.firmware_compile.board_target import BoardTarget
from micro_otter.tools.firmware_compile.build_orchestration import BuildCancelled, BuildTimeout
from micro_otter.tools.firmware_compile.resolved_contents import ResolvedContents

ESP_IDF_MODULE = "micro_otter.tools.firmware_compile.backends.esp_idf"
ORCH_MODULE = "micro_otter.tools.firmware_compile.build_orchestration"


def _make_request(tmp_path: Path, *, board: str = "esp32", dry_run: bool = True, **overrides):
    """Build a minimal request with a backend-typed target and empty contents."""

    target = BoardTarget.from_board_name(board, port="esp32")
    contents = ResolvedContents(
        runtime_id="general",
        runtime_version="1.11.0",
        file_entries=(),
        node_packages={},
        not_embedded_packages=(),
        constituent_versions=None,
        git_source=None,
    )
    kwargs = dict(
        target=target,
        contents=contents,
        workspace_root=tmp_path,
        micropython_root=tmp_path,
        device_root=tmp_path,
        packaging_mode=ModulePackagingMode.SOURCE_PY,
        optimization_level=None,
        modules_path=None,
        embedded_inventory_output=None,
        clean_build=False,
        dry_run=dry_run,
    )
    kwargs.update(overrides)
    return BuildRequest(**kwargs)


def _fake_report(tmp_path: Path) -> StagingExecutionReport:
    """Return a dry-run staging report with no conflicts."""

    return StagingExecutionReport(
        dry_run=True,
        runtime_id="general",
        runtime_version="1.11.0",
        target="esp32",
        modules_path=tmp_path / "ports" / "esp32" / "modules",
        files_discovered=0,
        files_copied=0,
        files_startup_written=0,
        conflicts=[],
        embedded_manifest_path=None,
        embedded_hashes_path=None,
    )


def test_esp_idf_pipeline_executes_in_expected_sequence(tmp_path: Path):
    request = _make_request(tmp_path)
    report = _fake_report(tmp_path)
    sequence: list[str] = []

    def fake_command(profile, micropython_root):
        sequence.append("command")
        return BuildCommandSpec(argv=("make",), cwd=tmp_path)

    def fake_preflight(profile, micropython_root, port=None):
        sequence.append("preflight")
        return BuildPreflightResult(warnings=())

    def fake_staging(**kwargs):
        sequence.append("staging")
        hook = kwargs["mpy_precompile_hook"]
        report.precompile = hook(report.modules_path, (), ())
        return report

    def fake_precompile(**kwargs):
        sequence.append("precompile")
        return PrecompileResult(files_compiled=0, compiler_path=None)

    with (
        mock.patch(f"{ESP_IDF_MODULE}.build_micropython_command", side_effect=fake_command),
        mock.patch(f"{ESP_IDF_MODULE}._require_idf_launcher"),
        mock.patch(f"{ESP_IDF_MODULE}.run_build_preflight", side_effect=fake_preflight),
        mock.patch(f"{ESP_IDF_MODULE}.run_staging", side_effect=fake_staging),
        mock.patch(f"{ESP_IDF_MODULE}.run_optional_mpy_precompile", side_effect=fake_precompile),
    ):
        result = EspIdfBackend().build(request)

    assert sequence == ["command", "preflight", "staging", "precompile"]
    assert result.exit_code == 0
    assert isinstance(result.orchestration, BuildOrchestrationResult)


def test_esp_idf_pipeline_runs_the_subprocess_when_not_dry_run(tmp_path: Path):
    request = _make_request(tmp_path, dry_run=False)
    report = _fake_report(tmp_path)

    with (
        mock.patch(
            f"{ESP_IDF_MODULE}.build_micropython_command",
            return_value=BuildCommandSpec(argv=("make", "BOARD=esp32"), cwd=tmp_path),
        ),
        mock.patch(f"{ESP_IDF_MODULE}._require_idf_launcher"),
        mock.patch(
            f"{ESP_IDF_MODULE}.run_build_preflight", return_value=BuildPreflightResult(warnings=())
        ),
        mock.patch(f"{ESP_IDF_MODULE}.run_staging", return_value=report),
        mock.patch(f"{ESP_IDF_MODULE}.run_streamed_process", return_value=0) as run_mock,
    ):
        result = EspIdfBackend().build(request)

    run_mock.assert_called_once()
    assert result.exit_code == 0


def test_esp_idf_pipeline_streams_log_output(tmp_path: Path):
    report = _fake_report(tmp_path)
    script = "import sys; print('out-line'); sys.stderr.write('err-line\\n')"
    lines: list[tuple[str, str]] = []

    request = _make_request(
        tmp_path,
        dry_run=False,
        log_callback=lambda stream, text: lines.append((stream, text)),
    )

    with (
        mock.patch(
            f"{ESP_IDF_MODULE}.build_micropython_command",
            return_value=BuildCommandSpec(argv=(sys.executable, "-c", script), cwd=tmp_path),
        ),
        mock.patch(f"{ESP_IDF_MODULE}._require_idf_launcher"),
        mock.patch(
            f"{ESP_IDF_MODULE}.run_build_preflight", return_value=BuildPreflightResult(warnings=())
        ),
        mock.patch(f"{ESP_IDF_MODULE}.run_staging", return_value=report),
    ):
        result = EspIdfBackend().build(request)

    assert result.exit_code == 0
    assert ("stdout", "out-line\n") in lines
    assert ("stderr", "err-line\n") in lines


def test_esp_idf_pipeline_cancel_terminates_the_build(tmp_path: Path):
    report = _fake_report(tmp_path)
    cancel_event = threading.Event()
    script = "import time; time.sleep(30)"

    request = _make_request(
        tmp_path,
        dry_run=False,
        cancel_event=cancel_event,
        log_callback=lambda stream, text: None,
    )

    def trigger_cancel() -> None:
        time.sleep(0.3)
        cancel_event.set()

    canceller = threading.Thread(target=trigger_cancel, daemon=True)
    canceller.start()

    with (
        mock.patch(
            f"{ESP_IDF_MODULE}.build_micropython_command",
            return_value=BuildCommandSpec(argv=(sys.executable, "-c", script), cwd=tmp_path),
        ),
        mock.patch(f"{ESP_IDF_MODULE}._require_idf_launcher"),
        mock.patch(
            f"{ESP_IDF_MODULE}.run_build_preflight", return_value=BuildPreflightResult(warnings=())
        ),
        mock.patch(f"{ESP_IDF_MODULE}.run_staging", return_value=report),
    ):
        begin = time.monotonic()
        with pytest.raises(BuildCancelled):
            EspIdfBackend().build(request)
        elapsed = time.monotonic() - begin

    canceller.join(timeout=2)
    assert elapsed < 5


def test_esp_idf_pipeline_timeout_raises_build_timeout(tmp_path: Path):
    report = _fake_report(tmp_path)
    script = "import time; time.sleep(30)"

    request = _make_request(
        tmp_path,
        dry_run=False,
        timeout_seconds=0.3,
        log_callback=lambda stream, text: None,
    )

    with (
        mock.patch(
            f"{ESP_IDF_MODULE}.build_micropython_command",
            return_value=BuildCommandSpec(argv=(sys.executable, "-c", script), cwd=tmp_path),
        ),
        mock.patch(f"{ESP_IDF_MODULE}._require_idf_launcher"),
        mock.patch(
            f"{ESP_IDF_MODULE}.run_build_preflight", return_value=BuildPreflightResult(warnings=())
        ),
        mock.patch(f"{ESP_IDF_MODULE}.run_staging", return_value=report),
    ):
        begin = time.monotonic()
        with pytest.raises(BuildTimeout) as excinfo:
            EspIdfBackend().build(request)

    assert time.monotonic() - begin < 5
    assert excinfo.value.timeout_seconds == 0.3


def test_run_build_orchestration_delegates_to_the_selected_backend(tmp_path: Path):
    captured = {}
    orchestration = BuildOrchestrationResult(
        plan=BuildOrchestrationPlan(
            profile=mock.Mock(),
            command=BuildCommandSpec(argv=("make",), cwd=tmp_path),
        ),
        preflight=BuildPreflightResult(warnings=()),
        staging_report=_fake_report(tmp_path),
        precompile=PrecompileResult(files_compiled=0, compiler_path=None),
        build_exit_code=0,
    )

    class _RecordingBackend:
        id = "fake"

        def embedding(self):
            return "mpy-freeze"

        def build(self, request, on_event=None):
            captured["request"] = request
            return mock.Mock(orchestration=orchestration)

    with (
        mock.patch(
            f"{ORCH_MODULE}.resolve_board_target",
            return_value=BoardTarget.from_board_name("esp32", port="esp32"),
        ),
        mock.patch(f"{ORCH_MODULE}.select_backend", return_value=_RecordingBackend()),
        mock.patch(f"{ORCH_MODULE}.resolve_runtime_payload", return_value=object()),
        mock.patch(f"{ORCH_MODULE}.build_resolved_contents", return_value=object()),
    ):
        result = run_build_orchestration(
            profile=mock.Mock(
                board="esp32",
                runtime_id="general",
                packaging_mode=ModulePackagingMode.SOURCE_PY,
                optimization_level=None,
            ),
            runtime_id="general",
            target="esp32",
            workspace_root=tmp_path,
            micropython_root=tmp_path,
            modules_path=None,
            device_root=tmp_path,
            embedded_inventory_output=None,
            clean_build=False,
            dry_run=True,
        )

    assert result is orchestration
    assert captured["request"].target.name == "esp32"
    assert captured["request"].contents is not None

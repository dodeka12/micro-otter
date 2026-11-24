"""Tests for the firmware build backend seam.

Covers the protocol contract, registry selection precedence, entry-point
discovery, and the ESP-IDF adapter over the existing orchestration path.
"""

from __future__ import annotations

import logging
import subprocess
import sys
from dataclasses import replace
from pathlib import Path
from unittest import mock

import pytest

from micro_otter.tools import firmware_compile
from micro_otter.tools.firmware_compile import (
    ArtifactVerificationError,
    BoardTarget,
    BuildCommandSpec,
    BuildPreflightResult,
    ModulePackagingMode,
    PrecompileResult,
    ResolvedContents,
    StagingExecutionReport,
)
from micro_otter.tools.firmware_compile.backends import (
    BUILD_BACKEND_ENV_VAR,
    BackendStatus,
    BuildBackend,
    BuildBackendUnavailableError,
    BuildEvent,
    BuildRequest,
    BuildResult,
    NoAvailableBuildBackendError,
    UnknownBuildBackendError,
    UnsupportedBuildTargetError,
    get_backend,
    register_backend,
    reset_registry,
    select_backend,
    select_backend_for_board,
)
from micro_otter.tools.firmware_compile.backends.esp_idf import (
    SUPPORTED_TARGETS,
    EspIdfBackend,
    _resolve_idf_py,
)
from micro_otter.tools.firmware_compile.board_registry import BoardSpec

ORCHESTRATION_MODULE = "micro_otter.tools.firmware_compile.build_orchestration"
ESP_IDF_MODULE = "micro_otter.tools.firmware_compile.backends.esp_idf"
REPO_ROOT = Path(__file__).resolve().parents[1]
REPO_LAUNCHER = REPO_ROOT / "deploy" / "toolchain" / "esp-idf" / "idf.py"


class _FakeBackend:
    """Configurable in-memory backend used by the contract and registry tests."""

    def __init__(
        self,
        backend_id: str = "fake",
        *,
        available: bool = True,
        targets: tuple[str, ...] = ("esp32",),
        exit_code: int = 0,
        embedding_mode: str = "mpy-freeze",
    ) -> None:
        self.id = backend_id
        self.available = available
        self.targets = targets
        self.exit_code = exit_code
        self.embedding_mode = embedding_mode
        self.requests: list[BuildRequest] = []
        self.events: list[BuildEvent] = []

    def status(self) -> BackendStatus:
        """Report the configured availability without touching the environment."""

        return BackendStatus(backend_id=self.id, available=self.available, detail="fake backend")

    def supported_targets(self) -> tuple[str, ...]:
        """Return the configured target tuple."""

        return self.targets

    def embedding(self) -> str:
        """Return the configured embedding mode (``mpy-freeze`` by default)."""

        return self.embedding_mode

    def resolve_name(self, name: str, *, micropython_root):
        """Return None: the fake backend has no off-catalog naming convention."""

        return None

    def build(
        self,
        request: BuildRequest,
        on_event=None,
    ) -> BuildResult:
        """Record the request and emit one fake status event."""

        self.requests.append(request)
        event = BuildEvent(kind="status", message="fake build")
        self.events.append(event)
        if on_event is not None:
            on_event(event)
        return BuildResult(exit_code=self.exit_code, backend_id=self.id)


class _FakeEntryPoint:
    """Stand-in for ``importlib.metadata.EntryPoint`` in discovery tests."""

    def __init__(self, name: str, loaded: object, *, broken: bool = False) -> None:
        self.name = name
        self.value = f"tests.fake:{name}"
        self._loaded = loaded
        self._broken = broken

    def load(self) -> object:
        """Return the payload or fail like a broken distribution would."""

        if self._broken:
            raise ImportError(f"broken build backend entry point: {self.name}")
        return self._loaded


@pytest.fixture(autouse=True)
def _isolated_registry():
    """Keep programmatic backend registrations local to each test."""

    reset_registry()
    yield
    reset_registry()


def _patch_entry_points(
    monkeypatch: pytest.MonkeyPatch,
    entry_points: list[_FakeEntryPoint],
) -> None:
    """Replace entry-point discovery with a fixed in-memory list."""

    def fake_entry_points(*, group: str):
        assert group == "micro_otter.build_backends"
        return list(entry_points)

    monkeypatch.setattr("importlib.metadata.entry_points", fake_entry_points)


def _patch_builtin_status(
    monkeypatch: pytest.MonkeyPatch,
    *,
    available: bool,
    detail: str | None = None,
) -> None:
    """Give the real ESP-IDF backend a deterministic availability answer."""

    def fake_status(self) -> BackendStatus:
        return BackendStatus(backend_id=self.id, available=available, detail=detail)

    monkeypatch.setattr(EspIdfBackend, "status", fake_status)


def _sample_request(tmp_path: Path) -> BuildRequest:
    """Return a minimal request object for contract and adapter tests."""

    target = BoardTarget.from_board_name("esp32", port="esp32")
    contents = ResolvedContents(
        runtime_id="general",
        runtime_version="1.11.0",
        file_entries=(),
        node_packages={},
        not_embedded_packages=(),
        constituent_versions=None,
        git_source=None,
    )
    return BuildRequest(
        target=target,
        contents=contents,
        workspace_root=tmp_path,
        micropython_root=tmp_path / "micropython",
        device_root=tmp_path / "device",
        packaging_mode=ModulePackagingMode.SOURCE_PY,
        optimization_level=None,
    )


def _staging_report(tmp_path: Path) -> StagingExecutionReport:
    """Return a successful non-dry-run staging report."""

    return StagingExecutionReport(
        dry_run=False,
        runtime_id="general",
        runtime_version="1.11.0",
        target="esp32",
        modules_path=tmp_path / "ports" / "esp32" / "modules",
    )


def _run_staging_with_hook(
    kwargs: dict,
    report: StagingExecutionReport,
) -> StagingExecutionReport:
    """Emulate staging's precompile hook contract for orchestration tests.

    Real staging skips the hook on dry runs; this fake mirrors that so stage event
    ordering assertions stay faithful.
    """

    hook = kwargs.get("mpy_precompile_hook")
    if hook is not None and not kwargs.get("dry_run", False):
        report.precompile = hook(report.modules_path, (), ())
    return report


def _patch_orchestration(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    *,
    report: StagingExecutionReport,
    idf_py: str | None = "/usr/bin/idf.py",
) -> list[tuple[list[str], Path, bool, object]]:
    """Patch orchestration collaborators so adapter tests run without a toolchain."""

    monkeypatch.setattr(f"{ESP_IDF_MODULE}._resolve_idf_py", lambda: idf_py)
    monkeypatch.setattr(
        f"{ESP_IDF_MODULE}.build_micropython_command",
        lambda *, profile, micropython_root: BuildCommandSpec(
            argv=("make", f"BOARD={profile.board}"),
            cwd=tmp_path,
        ),
    )
    monkeypatch.setattr(
        f"{ESP_IDF_MODULE}.run_build_preflight",
        lambda *, profile, micropython_root, port=None: BuildPreflightResult(warnings=()),
    )
    monkeypatch.setattr(
        f"{ESP_IDF_MODULE}.run_staging",
        lambda **kwargs: _run_staging_with_hook(kwargs, report),
    )
    monkeypatch.setattr(
        f"{ESP_IDF_MODULE}.run_optional_mpy_precompile",
        lambda **kwargs: PrecompileResult(files_compiled=0, compiler_path=None),
    )

    recorded: list[tuple[list[str], Path, float | None, object]] = []

    def fake_run(*, argv, cwd=None, env=None, log_callback=None, timeout_seconds=None, **_kwargs):
        recorded.append((argv, cwd, timeout_seconds, env))
        return 0

    monkeypatch.setattr(f"{ESP_IDF_MODULE}.run_streamed_process", fake_run)
    return recorded


# --- 2.1 contract types -------------------------------------------------------


def test_fake_backend_satisfies_runtime_checkable_protocol():
    assert isinstance(_FakeBackend(), BuildBackend)


def test_esp_idf_backend_satisfies_runtime_checkable_protocol():
    assert isinstance(EspIdfBackend(), BuildBackend)


def test_build_request_defaults(tmp_path: Path):
    request = _sample_request(tmp_path)

    assert request.modules_path is None
    assert request.embedded_inventory_output is None
    assert request.clean_build is False
    assert request.dry_run is False
    assert request.constituent_versions is None
    assert request.device_root == tmp_path / "device"


def test_build_result_defaults():
    result = BuildResult(exit_code=0, backend_id="fake")

    assert result.artifact_path is None
    assert result.orchestration is None


def test_event_callback_receives_backend_events(tmp_path: Path):
    backend = _FakeBackend()
    received: list[BuildEvent] = []

    backend.build(_sample_request(tmp_path), received.append)

    assert len(received) == 1
    assert received[0] is backend.events[0]
    assert received[0].kind == "status"
    assert received[0].payload is None


# --- 2.2 registry and selection ----------------------------------------------


def test_auto_selects_available_builtin_backend(monkeypatch: pytest.MonkeyPatch):
    _patch_entry_points(monkeypatch, [])
    _patch_builtin_status(monkeypatch, available=True)

    backend = select_backend(target="esp32")

    assert isinstance(backend, EspIdfBackend)
    assert backend.id == "esp-idf"


def test_auto_skips_unavailable_backend_and_picks_next(monkeypatch: pytest.MonkeyPatch):
    _patch_entry_points(monkeypatch, [_FakeEntryPoint("custom", _FakeBackend("custom"))])
    _patch_builtin_status(monkeypatch, available=False, detail="idf.py missing")

    backend = select_backend(target="esp32")

    assert backend.id == "custom"


def test_unknown_explicit_backend_raises(monkeypatch: pytest.MonkeyPatch):
    _patch_entry_points(monkeypatch, [])

    with pytest.raises(UnknownBuildBackendError) as excinfo:
        select_backend(target="esp32", requested="does-not-exist")

    assert "does-not-exist" in str(excinfo.value)


def test_unsupported_target_for_explicit_backend_raises(monkeypatch: pytest.MonkeyPatch):
    _patch_entry_points(monkeypatch, [])
    _patch_builtin_status(monkeypatch, available=True)

    with pytest.raises(UnsupportedBuildTargetError) as excinfo:
        select_backend(target="rp2040", requested="esp-idf")

    assert "rp2040" in str(excinfo.value)
    assert excinfo.value.supported_targets == SUPPORTED_TARGETS


def test_unavailable_explicit_backend_raises(monkeypatch: pytest.MonkeyPatch):
    _patch_entry_points(monkeypatch, [])
    _patch_builtin_status(monkeypatch, available=False, detail="idf.py missing")

    with pytest.raises(BuildBackendUnavailableError) as excinfo:
        select_backend(target="esp32", requested="esp-idf")

    assert "idf.py missing" in str(excinfo.value)


def test_auto_without_available_backend_names_target(monkeypatch: pytest.MonkeyPatch):
    _patch_entry_points(monkeypatch, [])
    _patch_builtin_status(monkeypatch, available=False)

    with pytest.raises(NoAvailableBuildBackendError) as excinfo:
        select_backend(target="esp32")

    assert "esp32" in str(excinfo.value)


def test_concrete_environment_selection_beats_board_default(monkeypatch: pytest.MonkeyPatch):
    _patch_entry_points(monkeypatch, [_FakeEntryPoint("custom", _FakeBackend("custom"))])
    _patch_builtin_status(monkeypatch, available=True)
    monkeypatch.setenv(BUILD_BACKEND_ENV_VAR, "esp-idf")

    backend = select_backend(target="esp32", board_default="custom")

    assert backend.id == "esp-idf"


def test_explicit_request_beats_environment_and_board_default(
    monkeypatch: pytest.MonkeyPatch,
):
    _patch_entry_points(monkeypatch, [_FakeEntryPoint("custom", _FakeBackend("custom"))])
    _patch_builtin_status(monkeypatch, available=True)
    monkeypatch.setenv(BUILD_BACKEND_ENV_VAR, "custom")

    backend = select_backend(target="esp32", requested="esp-idf", board_default="custom")

    assert backend.id == "esp-idf"


def test_auto_defers_to_board_default_before_resolving_availability(
    monkeypatch: pytest.MonkeyPatch,
):
    _patch_entry_points(monkeypatch, [_FakeEntryPoint("custom", _FakeBackend("custom"))])
    _patch_builtin_status(monkeypatch, available=True)
    monkeypatch.setenv(BUILD_BACKEND_ENV_VAR, "auto")

    backend = select_backend(target="esp32", board_default="custom")

    assert backend.id == "custom"


def test_board_default_falls_through_to_auto_when_unavailable(
    monkeypatch: pytest.MonkeyPatch,
):
    unavailable = _FakeBackend("custom", available=False)
    _patch_entry_points(monkeypatch, [_FakeEntryPoint("custom", unavailable)])
    _patch_builtin_status(monkeypatch, available=True)

    backend = select_backend(target="esp32", board_default="custom")

    assert backend.id == "esp-idf"


def test_broken_entry_point_is_skipped_with_diagnostic(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
):
    _patch_entry_points(
        monkeypatch,
        [
            _FakeEntryPoint("broken", None, broken=True),
            _FakeEntryPoint("custom", _FakeBackend("custom")),
        ],
    )
    _patch_builtin_status(monkeypatch, available=False)

    with caplog.at_level(logging.WARNING):
        backend = select_backend(target="esp32")

    assert backend.id == "custom"
    assert "broken" in caplog.text


def test_registered_backend_overrides_lookup(monkeypatch: pytest.MonkeyPatch):
    _patch_entry_points(monkeypatch, [])
    backend = _FakeBackend("lab")

    register_backend(backend)

    assert get_backend("lab") is backend


def test_importing_the_seam_does_not_load_the_esp_idf_adapter():
    script = (
        "import sys\n"
        "import micro_otter.tools.firmware_compile.backends as backends\n"
        "adapter = 'micro_otter.tools.firmware_compile.backends.esp_idf'\n"
        "assert adapter not in sys.modules\n"
        "assert backends.known_backend_ids() == ('esp-idf',)\n"
        "assert adapter not in sys.modules, 'listing ids must stay lazy'\n"
        "assert backends.get_backend('esp-idf').id == 'esp-idf'\n"
        "assert adapter in sys.modules\n"
    )

    completed = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr


# --- 2.3 ESP-IDF adapter -----------------------------------------------------


def test_esp_idf_backend_build_uses_micropython_make_command(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    report = _staging_report(tmp_path)
    recorded = _patch_orchestration(monkeypatch, tmp_path, report=report)

    result = EspIdfBackend().build(_sample_request(tmp_path))

    assert recorded == [(["make", "BOARD=esp32"], tmp_path, None, mock.ANY)]
    assert result.backend_id == "esp-idf"
    assert result.exit_code == 0
    assert result.artifact_path is None
    assert result.orchestration is not None
    assert result.orchestration.staging_report is report


def test_esp_idf_backend_reports_stage_events_in_order(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    _patch_orchestration(monkeypatch, tmp_path, report=_staging_report(tmp_path))
    events: list[BuildEvent] = []

    EspIdfBackend().build(_sample_request(tmp_path), events.append)

    stages = [event.message for event in events if event.kind == "stage"]
    assert stages == ["preflight", "staging", "precompile", "build-start", "build-finish"]
    assert events[-1].kind == "stage"
    assert events[-1].payload == {"exit_code": 0}


def test_esp_idf_backend_dry_run_skips_subprocess(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    recorded = _patch_orchestration(monkeypatch, tmp_path, report=_staging_report(tmp_path))
    request = replace(_sample_request(tmp_path), dry_run=True)
    events: list[BuildEvent] = []

    result = EspIdfBackend().build(request, events.append)

    assert recorded == []
    stages = [event.message for event in events if event.kind == "stage"]
    assert stages == ["preflight", "staging", "build-skip"]
    assert result.exit_code == 0


def test_esp_idf_backend_verifies_frozen_names_after_success(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    report = _staging_report(tmp_path)
    _patch_orchestration(monkeypatch, tmp_path, report=report)

    artifact = tmp_path / "build-esp32" / "firmware.bin"
    artifact.parent.mkdir(parents=True)
    artifact.write_bytes(b"bin")
    (artifact.parent / "frozen_content.c").write_text(
        'MICROPY_FROZEN_LIST_ITEM("main")\n'
        'MICROPY_FROZEN_LIST_ITEM("otter_main")\n',
        encoding="utf-8",
    )
    monkeypatch.setattr(f"{ESP_IDF_MODULE}._discover_artifact", lambda request: artifact)

    result = EspIdfBackend().build(_sample_request(tmp_path))

    assert result.artifact_path == artifact


def test_esp_idf_backend_rejects_absolute_frozen_names(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    report = _staging_report(tmp_path)
    _patch_orchestration(monkeypatch, tmp_path, report=report)

    artifact = tmp_path / "build-esp32" / "firmware.bin"
    artifact.parent.mkdir(parents=True)
    artifact.write_bytes(b"bin")
    (artifact.parent / "frozen_content.c").write_text(
        'MICROPY_FROZEN_LIST_ITEM("main")\n'
        'MICROPY_FROZEN_LIST_ITEM("/opt/micropython/ports/esp32/modules/_boot")\n',
        encoding="utf-8",
    )
    monkeypatch.setattr(f"{ESP_IDF_MODULE}._discover_artifact", lambda request: artifact)

    with pytest.raises(ArtifactVerificationError):
        EspIdfBackend().build(_sample_request(tmp_path))


def test_esp_idf_backend_dry_run_never_verifies_frozen_names(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    _patch_orchestration(monkeypatch, tmp_path, report=_staging_report(tmp_path))
    request = replace(_sample_request(tmp_path), dry_run=True)

    with mock.patch(f"{ESP_IDF_MODULE}._discover_artifact") as discover_mock:
        result = EspIdfBackend().build(request)

    discover_mock.assert_not_called()
    assert result.artifact_path is None
    assert result.exit_code == 0


def test_esp_idf_backend_emits_error_event_before_reraising(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    _patch_orchestration(monkeypatch, tmp_path, report=_staging_report(tmp_path), idf_py=None)
    events: list[BuildEvent] = []

    with pytest.raises(OSError):
        EspIdfBackend().build(_sample_request(tmp_path), events.append)

    assert len(events) == 1
    assert events[0].kind == "error"
    assert events[0].payload == {"exception": "OSError"}


def test_esp_idf_backend_status_reports_missing_idf_py(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(f"{ESP_IDF_MODULE}._resolve_idf_py", lambda: None)

    status = EspIdfBackend().status()

    assert status.backend_id == "esp-idf"
    assert status.available is False
    assert status.missing_requirements == ("idf.py",)
    assert "micro-otter toolchain install" in status.detail


def test_esp_idf_backend_status_reports_the_resolved_launcher(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The reported detail is whatever the shared resolver returned."""

    monkeypatch.setattr(
        f"{ESP_IDF_MODULE}._resolve_idf_py", lambda: "/repo/deploy/toolchain/esp-idf/idf.py"
    )

    status = EspIdfBackend().status()

    assert status.available is True
    assert status.detail == "/repo/deploy/toolchain/esp-idf/idf.py"


def test_resolve_idf_py_prefers_the_repository_launcher(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The checkout launcher wins over a ``PATH`` entry from another install."""

    monkeypatch.setattr(f"{ESP_IDF_MODULE}.shutil.which", lambda tool: "/usr/bin/idf.py")

    assert _resolve_idf_py() == str(REPO_LAUNCHER)


def test_resolve_idf_py_falls_back_to_path(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Without a repository launcher the resolver still honours ``PATH``."""

    monkeypatch.setenv("MICRO_OTTER_TOOLCHAIN_ASSETS", str(tmp_path))
    monkeypatch.setattr(f"{ESP_IDF_MODULE}.shutil.which", lambda tool: "/usr/bin/idf.py")

    assert _resolve_idf_py() == "/usr/bin/idf.py"


def test_resolve_idf_py_returns_none_without_a_launcher(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """No repository launcher and no ``PATH`` entry resolves to ``None``."""

    monkeypatch.setenv("MICRO_OTTER_TOOLCHAIN_ASSETS", str(tmp_path))
    monkeypatch.setattr(f"{ESP_IDF_MODULE}.shutil.which", lambda tool: None)

    assert _resolve_idf_py() is None


def test_esp_idf_backend_status_reads_pinned_version(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    (tmp_path / "version.txt").write_text("v5.4.1\n", encoding="utf-8")
    monkeypatch.setenv("IDF_PATH", str(tmp_path))
    monkeypatch.setattr(f"{ESP_IDF_MODULE}._resolve_idf_py", lambda: "/usr/bin/idf.py")

    status = EspIdfBackend().status()

    assert status.available is True
    assert status.version == "v5.4.1"
    assert status.detail == "/usr/bin/idf.py"


def test_esp_idf_backend_build_keeps_missing_idf_py_error(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    _patch_orchestration(monkeypatch, tmp_path, report=_staging_report(tmp_path), idf_py=None)

    with pytest.raises(OSError) as excinfo:
        EspIdfBackend().build(_sample_request(tmp_path))

    assert "idf.py" in str(excinfo.value)


def test_unknown_board_default_falls_through_to_auto(monkeypatch: pytest.MonkeyPatch):
    _patch_entry_points(monkeypatch, [])
    _patch_builtin_status(monkeypatch, available=True)

    backend = select_backend(target="esp32", board_default="does-not-exist")

    assert backend.id == "esp-idf"


def test_board_default_with_an_unsupported_target_falls_through_to_auto(
    monkeypatch: pytest.MonkeyPatch,
):
    unsupported = _FakeBackend("custom", targets=("esp32s3",))
    _patch_entry_points(monkeypatch, [_FakeEntryPoint("custom", unsupported)])
    _patch_builtin_status(monkeypatch, available=True)

    backend = select_backend(target="esp32", board_default="custom")

    assert backend.id == "esp-idf"


def _board_spec(*, chip: str = "esp32", build_backend: str = "esp-idf"):
    """Return a minimal board catalog entry for board-selection tests."""

    return BoardSpec(
        name=chip,
        slug=chip.lower(),
        display_name=chip.upper(),
        chip=chip,
        build_backend=build_backend,
        flash_backend="esptool",
        build_params={"port": "esp32", "board": chip, "buildDirName": f"build-{chip.upper()}"},
        flash_params={"offset": "0x1000"},
    )


def test_select_backend_for_board_prefers_the_catalog_default(
    monkeypatch: pytest.MonkeyPatch,
):
    _patch_entry_points(monkeypatch, [_FakeEntryPoint("custom", _FakeBackend("custom"))])
    _patch_builtin_status(monkeypatch, available=True)

    backend = select_backend_for_board(_board_spec(build_backend="custom"))

    assert backend.id == "custom"


def test_select_backend_for_board_honors_an_explicit_request(
    monkeypatch: pytest.MonkeyPatch,
):
    _patch_entry_points(monkeypatch, [_FakeEntryPoint("custom", _FakeBackend("custom"))])
    _patch_builtin_status(monkeypatch, available=True)

    backend = select_backend_for_board(
        _board_spec(build_backend="custom"),
        requested="esp-idf",
    )

    assert backend.id == "esp-idf"


def test_select_backend_for_board_honors_a_concrete_environment_value(
    monkeypatch: pytest.MonkeyPatch,
):
    _patch_entry_points(monkeypatch, [_FakeEntryPoint("custom", _FakeBackend("custom"))])
    _patch_builtin_status(monkeypatch, available=True)
    monkeypatch.setenv(BUILD_BACKEND_ENV_VAR, "custom")

    backend = select_backend_for_board(_board_spec(build_backend="esp-idf"))

    assert backend.id == "custom"


def test_select_backend_for_board_defaults_the_target_to_the_chip(
    monkeypatch: pytest.MonkeyPatch,
):
    custom = _FakeBackend("custom", targets=("esp32s3",))
    _patch_entry_points(monkeypatch, [_FakeEntryPoint("custom", custom)])
    _patch_builtin_status(monkeypatch, available=True)

    backend = select_backend_for_board(_board_spec(chip="esp32s3", build_backend="custom"))

    assert backend.id == "custom"


def test_select_backend_for_board_falls_back_when_the_default_is_unknown(
    monkeypatch: pytest.MonkeyPatch,
):
    _patch_entry_points(monkeypatch, [])
    _patch_builtin_status(monkeypatch, available=True)

    backend = select_backend_for_board(_board_spec(build_backend="does-not-exist"))

    assert backend.id == "esp-idf"


def test_stage_callback_alias_is_exported_from_the_package():
    """The orchestration stage callback type is part of the package API."""

    assert "StageCallback" in firmware_compile.__all__
    assert firmware_compile.StageCallback is not None


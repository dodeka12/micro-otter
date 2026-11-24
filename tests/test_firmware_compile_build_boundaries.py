from pathlib import Path

from micro_otter.tools.firmware_compile import (
    BuildOrchestrationPlan,
    BuildProfile,
    ModulePackagingMode,
    build_micropython_command,
    default_build_profile,
    normalize_artifact_path,
    normalize_build_profile,
    prepend_clean_target,
)


def test_default_build_profile_is_source_first():
    profile = default_build_profile(runtime_id="general", board="ESP32_GENERIC")

    assert profile.runtime_id == "general"
    assert profile.board == "ESP32_GENERIC"
    assert profile.packaging_mode == ModulePackagingMode.SOURCE_PY
    assert profile.include_all_compatible_packages is True


def test_build_command_is_deterministic_for_identical_inputs(tmp_path: Path):
    profile = BuildProfile(runtime_id="general", board="ESP32_GENERIC")

    (tmp_path / "ports" / "esp32").mkdir(parents=True, exist_ok=True)

    first = build_micropython_command(profile=profile, micropython_root=tmp_path)
    second = build_micropython_command(profile=profile, micropython_root=tmp_path)

    assert first.argv == (
        "make",
        "BOARD=ESP32_GENERIC",
        "OTTER_PACKAGING_MODE=source-py",
    )
    assert first == second
    assert first.cwd == (tmp_path / "ports" / "esp32").resolve()


def test_orchestration_plan_wraps_profile_and_command(tmp_path: Path):
    profile = BuildProfile(runtime_id="general", board="ESP32_GENERIC")
    (tmp_path / "ports" / "esp32").mkdir(parents=True, exist_ok=True)
    command = build_micropython_command(profile=profile, micropython_root=tmp_path)

    plan = BuildOrchestrationPlan(profile=profile, command=command)

    assert plan.profile.runtime_id == "general"
    assert plan.command.argv[0] == "make"


def test_normalize_artifact_path_resolves_absolute(tmp_path: Path):
    relative = tmp_path / ".." / tmp_path.name / "firmware.bin"

    resolved = normalize_artifact_path(relative)

    assert resolved.is_absolute()
    assert resolved.name == "firmware.bin"


def test_normalize_build_profile_defaults_to_source_mode():
    profile = normalize_build_profile(runtime_id=" general ", board=" esp32 ")

    assert profile.runtime_id == "general"
    assert profile.board == "esp32"
    assert profile.packaging_mode == ModulePackagingMode.SOURCE_PY


def test_normalize_build_profile_accepts_mode_aliases():
    profile = normalize_build_profile(
        runtime_id="general",
        board="esp32",
        packaging_mode="mpy",
    )

    assert profile.packaging_mode == ModulePackagingMode.COMPILED_MPY


def test_build_command_includes_optimization_level(tmp_path: Path):
    profile = normalize_build_profile(
        runtime_id="general",
        board="ESP32_GENERIC",
        optimization_level=3,
    )

    (tmp_path / "ports" / "esp32").mkdir(parents=True, exist_ok=True)
    command = build_micropython_command(profile=profile, micropython_root=tmp_path)

    assert "OTTER_OPT_LEVEL=3" in command.argv


def test_prepend_clean_target_adds_clean_after_make(tmp_path: Path):
    profile = default_build_profile(runtime_id="general", board="ESP32_GENERIC")
    (tmp_path / "ports" / "esp32").mkdir(parents=True, exist_ok=True)
    command = build_micropython_command(profile=profile, micropython_root=tmp_path)

    cleaned = prepend_clean_target(command)

    assert cleaned.argv[0:4] == ("make", "-k", "clean", "all")


def test_build_command_ignores_non_port_board_directory(tmp_path: Path):
    profile = BuildProfile(runtime_id="general", board="ESP32_GENERIC_S3")

    (tmp_path / "ports" / "esp32").mkdir(parents=True, exist_ok=True)
    (tmp_path / "ports" / "esp32" / "Makefile").write_text("all:\n", encoding="utf-8")
    # A stray staging artifact named after the lowercased board, but not a port.
    (tmp_path / "ports" / "esp32_generic_s3" / "modules").mkdir(parents=True, exist_ok=True)

    command = build_micropython_command(profile=profile, micropython_root=tmp_path)

    assert command.argv == (
        "make",
        "BOARD=ESP32_GENERIC_S3",
        "OTTER_PACKAGING_MODE=source-py",
    )
    assert command.cwd == (tmp_path / "ports" / "esp32").resolve()


import json
import subprocess
from pathlib import Path
from unittest import mock

import pytest

from micro_otter.tools.firmware_compile import CompileRuntimeRequest
from micro_otter.tools.firmware_compile.build_artifact import ArtifactVerificationError
from micro_otter.tools.firmware_compile.compile_command import (
    _default_micropython_root,
    _firmware_version_is_recorded,
    _map_failure_to_exit_code,
    _normalize_package_ids,
    _normalize_package_variants,
    _normalize_runtime_semver,
    _resolve_pre_build_publish_target,
    execute_compile_runtime_request,
    normalize_compile_runtime_request,
    render_result_json,
    run_compile_runtime_command,
)
from micro_otter.tools.firmware_compile.package_resolver import (
    VariantCapabilitiesUnsatisfiedError,
    VariantUnknownError,
)
from micro_otter.tools.firmware_compile.staging_models import (
    StagingConflict,
    StagingExecutionReport,
)
from micro_otter.tools.firmware_compile.staging_resolver import (
    PackageNotStagedError,
    UnknownPackageIdError,
)
from micro_otter.tools.firmware_compile.version_identity import MicropythonVersionError
from micro_otter.tools.firmware_compile.version_registry import RUNTIME_LINEAGE_DEFAULT_PATH


def _fake_report(
    tmp_path: Path, *, conflicts: list[StagingConflict] | None = None
) -> StagingExecutionReport:
    return StagingExecutionReport(
        dry_run=True,
        runtime_id="general",
        runtime_version="1.11.0",
        target="esp32",
        modules_path=(tmp_path / "src" / "micropython" / "ports" / "esp32" / "modules"),
        files_discovered=5,
        files_copied=5,
        files_startup_written=2,
        conflicts=conflicts or [],
        embedded_manifest_path=None,
        embedded_hashes_path=None,
    )


def _fake_orchestration(
    tmp_path: Path,
    report: StagingExecutionReport,
    *,
    command: tuple[str, ...] = ("make", "OTTER_PACKAGING_MODE=source-py"),
    command_cwd: Path | None = None,
    warnings: tuple[str, ...] = (),
    precompiled_files: int = 0,
    compiler_path: Path | None = None,
    build_exit_code: int | None = 0,
    sources_removed: int = 0,
    artifact_path: Path | None = None,
):
    selected_cwd = command_cwd or (tmp_path / "src" / "micropython" / "ports" / "esp32")
    return mock.Mock(
        plan=mock.Mock(command=mock.Mock(argv=command, cwd=selected_cwd)),
        preflight=mock.Mock(warnings=warnings),
        staging_report=report,
        precompile=mock.Mock(
            files_compiled=precompiled_files,
            compiler_path=compiler_path,
            sources_removed=sources_removed,
        ),
        build_exit_code=build_exit_code,
        artifact_path=artifact_path,
    )


def _write_target_mapping(workspace: Path) -> None:
    mapping_path = (
        workspace
        / "src"
        / "micro_otter"
        / "nodes"
        / "device"
        / "targets"
        / "compile_target_mappings.json"
    )
    mapping_path.parent.mkdir(parents=True, exist_ok=True)
    mapping_path.write_text(
        '{"schemaVersion":1,"rules":[{"id":"esp32-default","webTargetId":"esp32_wroom","runtimeIdInclude":["general"],"runtimeIdExclude":[],"compile":{"board":"esp32","port":"esp32"},"priority":100},{"id":"generic-fallback","webTargetId":"generic_micropython","runtimeIdInclude":["*"],"runtimeIdExclude":[],"compile":{"board":"*","port":"*"},"priority":10}]}',
        encoding="utf-8",
    )
    _write_board_catalog(workspace)


def _write_board_catalog(workspace: Path) -> None:
    """Write a minimal schema-v2 board catalog for normalize/target resolution."""

    catalog_path = (
        workspace / "src" / "micro_otter" / "nodes" / "device" / "firmware" / "boards.json"
    )
    catalog_path.parent.mkdir(parents=True, exist_ok=True)
    catalog_path.write_text(
        json.dumps(
            {
                "schemaVersion": 2,
                "boards": [
                    {
                        "name": "esp32",
                        "slug": "esp32",
                        "displayName": "ESP32",
                        "buildBackend": "esp-idf",
                        "flashBackend": "esptool",
                        "chip": "esp32",
                        "build": {
                            "port": "esp32",
                            "board": "esp32",
                            "buildDirName": "build-ESP32_GENERIC",
                        },
                        "flash": {"offset": "0x1000"},
                    },
                    {
                        "name": "ESP32_GENERIC_S3",
                        "slug": "esp32_generic_s3",
                        "displayName": "ESP32-S3",
                        "buildBackend": "esp-idf",
                        "flashBackend": "esptool",
                        "chip": "esp32s3",
                        "build": {
                            "port": "esp32",
                            "board": "ESP32_GENERIC_S3",
                            "buildDirName": "build-ESP32_GENERIC_S3",
                        },
                        "flash": {"offset": "0"},
                    },
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def _write_release_manifest(workspace: Path) -> None:
    """Write the committed release.json the tag-derived identity falls back to."""
    path = workspace / "src" / "micro_otter" / "nodes" / "device" / "firmware" / "release.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "releaseVersion": "1.0.0",
                "kind": "stable",
                "releasedAtUtc": None,
                "tag": "firmware-v1.0.0",
            }
        ),
        encoding="utf-8",
    )


@pytest.fixture(autouse=True)
def _workspace_fixtures(tmp_path: Path) -> None:
    """Write the target mapping and board catalog each test can resolve against."""

    _write_target_mapping(tmp_path)
    _write_release_manifest(tmp_path)


def _write_runtime_lineage(
    workspace: Path,
    *,
    target_key: str = "esp32-general",
    firmware_version: str = "0.1.0",
) -> Path:
    lineage_path = workspace / RUNTIME_LINEAGE_DEFAULT_PATH
    lineage_path.parent.mkdir(parents=True, exist_ok=True)
    lineage_path.write_text(
        json.dumps(
            {
                "schemaVersion": 2,
                "lineage": {
                    target_key: {
                        firmware_version: {
                            "micropythonVersion": "1.27.0",
                            "runtimeSourceVersion": "1.11.0",
                            "deviceToolsVersion": "0.0.0",
                            "nodePackages": {},
                            "runtimeAssetsVersion": "1.2.2",
                            "createdAtUtc": "2026-11-02T00:00:00Z",
                        }
                    }
                },
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    return lineage_path


def test_normalize_compile_runtime_request_applies_defaults(tmp_path: Path):
    _write_target_mapping(tmp_path)

    request = CompileRuntimeRequest(
        runtime_id="  general  ", board=" esp32 ", workspace_root=tmp_path
    )
    with mock.patch(
        "micro_otter.tools.firmware_compile.compile_command.SYSTEM_MICROPYTHON_ROOT",
        tmp_path / "missing-opt-micropython",
    ):
        normalized = normalize_compile_runtime_request(request)

    assert normalized.runtime_id == "general"
    assert normalized.board == "esp32"
    assert normalized.micropython_root == (tmp_path / "src" / "micropython").resolve()
    assert normalized.build_profile.runtime_id == "general"
    assert normalized.build_profile.board == "esp32"
    assert normalized.target_resolution.web_target_id is None
    assert normalized.target_resolution.allowed_web_target_ids == ("esp32_wroom",)
    assert normalized.target_resolution.compile_board == "esp32"
    assert normalized.target_resolution.compile_port == "esp32"


def test_normalize_compile_runtime_request_carries_the_board_target(tmp_path: Path):
    request = CompileRuntimeRequest(
        runtime_id="general", board="ESP32_GENERIC_S3", workspace_root=tmp_path
    )

    normalized = normalize_compile_runtime_request(request)

    assert normalized.board == "ESP32_GENERIC_S3"
    assert normalized.slug == "esp32_generic_s3"
    assert normalized.target.name == "ESP32_GENERIC_S3"
    assert normalized.target.slug == "esp32_generic_s3"
    assert normalized.target.build_backend == "esp-idf"
    assert normalized.target.flash_backend == "esptool"


def test_normalize_compile_runtime_request_prefers_opt_micropython_when_available(tmp_path: Path):
    system_root = tmp_path / "opt" / "micropython"
    system_root.mkdir(parents=True, exist_ok=True)
    request = CompileRuntimeRequest(runtime_id="general", board="esp32", workspace_root=tmp_path)

    with mock.patch(
        "micro_otter.tools.firmware_compile.compile_command.SYSTEM_MICROPYTHON_ROOT",
        system_root,
    ):
        normalized = normalize_compile_runtime_request(request)

    assert normalized.micropython_root == system_root.resolve()


def test_normalize_compile_runtime_request_rejects_unknown_packaging_mode(tmp_path: Path):
    request = CompileRuntimeRequest(
        runtime_id="general",
        board="esp32",
        workspace_root=tmp_path,
        module_packaging_mode="unknown-mode",
    )

    with pytest.raises(ValueError, match="packaging mode"):
        normalize_compile_runtime_request(request)


def test_package_ids_normalizes_and_dedupes():
    normalized = _normalize_package_ids((" core ", "boss", "core", "", "  ", "pins"))

    assert normalized == ("core", "boss", "pins")


def test_package_ids_none_when_empty():
    assert _normalize_package_ids(None) is None
    assert _normalize_package_ids(()) is None
    assert _normalize_package_ids(("", "   ")) is None


def test_package_ids_rejects_non_string_entries():
    with pytest.raises(ValueError, match="package identifiers"):
        _normalize_package_ids(("core", 7))  # type: ignore[arg-type]


def test_package_variants_normalizes_and_drops_blanks():
    normalized = _normalize_package_variants({"pulse": " viper ", "audio": "  ", "x": ""})

    assert normalized == {"pulse": "viper"}


def test_package_variants_none_when_empty():
    assert _normalize_package_variants(None) is None
    assert _normalize_package_variants({}) is None
    assert _normalize_package_variants({"pulse": "  "}) is None


def test_variant_errors_map_to_exit_code_2():
    unknown = VariantUnknownError(package_id="pulse", requested="cobra", known=["viper"])
    exit_code, payload = _map_failure_to_exit_code(unknown)

    assert exit_code == 2
    assert payload["code"] == "variant-unknown"
    assert payload["category"] == "package-selection"

    unsatisfied = VariantCapabilitiesUnsatisfiedError(
        package_id="pulse", variant="viper", missing=[["viper"]]
    )
    exit_code, payload = _map_failure_to_exit_code(unsatisfied)

    assert exit_code == 2
    assert payload["code"] == "variant-capabilities-unsatisfied"
    assert payload["details"]["missing"] == [["viper"]]


def test_normalize_compile_runtime_request_keeps_package_selection(tmp_path: Path):
    _write_target_mapping(tmp_path)

    request = CompileRuntimeRequest(
        runtime_id="general",
        board="esp32",
        workspace_root=tmp_path,
        package_ids=(" core ", "core"),
    )

    with mock.patch(
        "micro_otter.tools.firmware_compile.compile_command.SYSTEM_MICROPYTHON_ROOT",
        tmp_path / "missing-opt-micropython",
    ):
        normalized = normalize_compile_runtime_request(request)

    assert normalized.package_ids == ("core",)


def test_normalize_compile_runtime_request_carries_addons_root(tmp_path: Path):
    _write_target_mapping(tmp_path)
    addons_root = tmp_path / "addons"

    request = CompileRuntimeRequest(
        runtime_id="general",
        board="esp32",
        workspace_root=tmp_path,
        addons_root=addons_root,
    )

    with mock.patch(
        "micro_otter.tools.firmware_compile.compile_command.SYSTEM_MICROPYTHON_ROOT",
        tmp_path / "missing-opt-micropython",
    ):
        normalized = normalize_compile_runtime_request(request)

    assert normalized.addons_root == addons_root.resolve()


def test_normalize_compile_runtime_request_defaults_addons_root_to_none(tmp_path: Path):
    _write_target_mapping(tmp_path)

    request = CompileRuntimeRequest(runtime_id="general", board="esp32", workspace_root=tmp_path)

    with mock.patch(
        "micro_otter.tools.firmware_compile.compile_command.SYSTEM_MICROPYTHON_ROOT",
        tmp_path / "missing-opt-micropython",
    ):
        normalized = normalize_compile_runtime_request(request)

    assert normalized.addons_root is None


def test_run_compile_runtime_command_uses_normalized_request(tmp_path: Path):
    request = CompileRuntimeRequest(
        runtime_id=" general ",
        board=" esp32 ",
        workspace_root=tmp_path,
        dry_run=True,
    )
    orchestration = _fake_orchestration(tmp_path, _fake_report(tmp_path))

    with mock.patch(
        "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
        return_value=orchestration,
    ) as run_orchestration:
        exit_code = run_compile_runtime_command(request)

    assert exit_code == 0
    run_orchestration.assert_called_once()
    kwargs = run_orchestration.call_args.kwargs
    assert kwargs["runtime_id"] == "general"
    assert kwargs["target"] == "esp32"
    assert kwargs["dry_run"] is True


def test_execute_compile_runtime_request_success_payload(tmp_path: Path):
    _write_target_mapping(tmp_path)

    report = _fake_report(tmp_path)
    manifest_path = tmp_path / "otter" / "embedded_manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text("{}", encoding="utf-8")
    report.embedded_manifest_path = manifest_path

    request = CompileRuntimeRequest(runtime_id="general", board="esp32", workspace_root=tmp_path)
    orchestration = _fake_orchestration(
        tmp_path,
        report,
        command=("make", "OTTER_PACKAGING_MODE=source-py"),
        artifact_path=tmp_path / "firmware.bin",
    )

    with (
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
            return_value=orchestration,
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.verify_firmware_artifact",
            return_value=mock.Mock(
                path=tmp_path / "firmware.bin", size_bytes=2, sha256="sha256:abc"
            ),
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.publish_firmware_artifact",
            return_value=mock.Mock(
                path=tmp_path / "published" / "1.11.0-esp32-general-1.11.0.bin",
                size_bytes=2,
                sha256="sha256:abc",
                created=True,
            ),
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.append_firmware_history",
            return_value=tmp_path / "firmware_history.json",
        ),
    ):
        result = execute_compile_runtime_request(request)

    assert result.exit_code == 0
    assert result.payload["schemaVersion"] == 1
    assert result.payload["status"] == "success"
    assert result.payload["build"]["command"].startswith("make")
    assert result.payload["target"]["board"] == "esp32"
    assert result.payload["target"]["port"] == "esp32"
    assert result.payload["target"]["webTargetId"] is None
    assert result.payload["target"]["mappingRuleId"] == "esp32-default"
    assert result.payload["staging"]["filesDiscovered"] == 5
    assert result.payload["staging"]["detailedFiles"] == []
    assert result.payload["metadata"]["buildProfile"]["runtimeId"] == "general"
    assert result.payload["metadata"]["firmwarePublishStatus"] == "published"
    assert result.payload["paths"]["firmwarePublishedArtifact"] is not None
    assert result.payload["paths"]["firmwareHistory"] == str(tmp_path / "firmware_history.json")
    assert "latestVersionsRegistry" not in result.payload["paths"]
    assert "firmwareHistory" in result.payload["paths"]


def _write_device_json(path: Path, payload: object) -> None:
    """Write *payload* as JSON under the temp device tree, creating parents."""

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _write_two_variant_device(workspace: Path, *, viper: bool) -> None:
    """Write a device tree whose single package ships ``py`` and ``viper`` variants."""

    device = workspace / "src" / "micro_otter" / "nodes" / "device"
    _write_device_json(
        device / "node_pkgs" / "index.json",
        {"version": 2, "packages": [{"id": "pulse", "manifest": "pulse/manifest.json"}]},
    )
    _write_device_json(
        device / "node_pkgs" / "pulse" / "manifest.json",
        {
            "id": "pulse",
            "version": "1.0.0",
            "manifestVersion": 2,
            "variants": {
                "py": {
                    "precedence": 0,
                    "requiredCapabilities": [],
                    "mpAssets": {"*": ["moa_pulse/__init__.py"]},
                },
                "viper": {
                    "precedence": 10,
                    "requiredCapabilities": ["viper"],
                    "mpAssets": {"*": ["moa_pulse_viper/__init__.py"]},
                },
            },
        },
    )
    _write_device_json(
        device / "capabilities" / "index.json",
        {"version": 1, "files": ["general.json"]},
    )
    _write_device_json(
        device / "capabilities" / "general.json",
        {"capabilities": [{"id": "viper", "domain": "general"}]},
    )
    _write_device_json(
        device / "targets" / "esp32_wroom.json",
        {"generalCapabilities": {"viper": {"supported": viper}}},
    )
    _write_device_json(
        device / "runtime" / "general" / "manifest.json",
        {
            "version": "1.11.0",
            "nodePackages": {"global": ["pulse"], "local": []},
        },
    )
    _write_device_json(device / "tools" / "manifest.json", {"version": "0.2.1"})


def test_execute_compile_runtime_request_accepts_a_two_variant_package(tmp_path: Path):
    """A package with two manifests no longer fails the post-build identity."""

    _write_two_variant_device(tmp_path, viper=True)
    request = CompileRuntimeRequest(
        runtime_id="general",
        board="esp32",
        workspace_root=tmp_path,
        package_variants={"pulse": "viper"},
    )
    orchestration = _fake_orchestration(
        tmp_path, _fake_report(tmp_path), artifact_path=tmp_path / "firmware.bin"
    )

    with (
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
            return_value=orchestration,
        ) as run_orchestration,
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.verify_firmware_artifact",
            return_value=mock.Mock(
                path=tmp_path / "firmware.bin", size_bytes=2, sha256="sha256:abc"
            ),
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.publish_firmware_artifact",
            return_value=mock.Mock(
                path=tmp_path / "published" / "image.bin",
                size_bytes=2,
                sha256="sha256:abc",
                created=True,
            ),
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.append_firmware_history",
            return_value=tmp_path / "firmware_history.json",
        ) as append_history,
    ):
        result = execute_compile_runtime_request(request)

    assert result.exit_code == 0
    run_orchestration.assert_called_once()
    assert result.payload["status"] == "success"
    assert result.payload["metadata"]["packageVariants"] == {"pulse": "viper"}
    assert result.payload["metadata"]["requestedPackageVariants"] == {"pulse": "viper"}

    uploaded = run_orchestration.call_args.kwargs["constituent_versions"]
    assert uploaded.package_variants == {"pulse": "viper"}
    assert append_history.call_args.kwargs["record"]["packageVariants"] == {"pulse": "viper"}
    assert append_history.call_args.kwargs["record"]["selection"]["packageVariants"] == {
        "pulse": "viper"
    }


def test_execute_compile_runtime_request_keeps_the_default_variant_without_capabilities(
    tmp_path: Path,
):
    """A target without ``viper`` freezes the default implementation and succeeds."""

    _write_two_variant_device(tmp_path, viper=False)
    request = CompileRuntimeRequest(
        runtime_id="general",
        board="esp32",
        workspace_root=tmp_path,
        package_variants={"pulse": "py"},
    )
    orchestration = _fake_orchestration(
        tmp_path, _fake_report(tmp_path), artifact_path=tmp_path / "firmware.bin"
    )

    with (
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
            return_value=orchestration,
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.verify_firmware_artifact",
            return_value=mock.Mock(
                path=tmp_path / "firmware.bin", size_bytes=2, sha256="sha256:abc"
            ),
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.publish_firmware_artifact",
            return_value=mock.Mock(
                path=tmp_path / "published" / "image.bin",
                size_bytes=2,
                sha256="sha256:abc",
                created=True,
            ),
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.append_firmware_history",
            return_value=tmp_path / "firmware_history.json",
        ),
    ):
        result = execute_compile_runtime_request(request)

    assert result.exit_code == 0
    assert result.payload["metadata"]["packageVariants"] == {"pulse": "py"}


def test_execute_compile_runtime_request_records_the_requested_variants(
    tmp_path: Path,
):
    """An explicit override is recorded beside the effective map."""

    _write_two_variant_device(tmp_path, viper=True)
    request = CompileRuntimeRequest(
        runtime_id="general",
        board="esp32",
        workspace_root=tmp_path,
        package_variants={"pulse": "py"},
    )
    orchestration = _fake_orchestration(
        tmp_path, _fake_report(tmp_path), artifact_path=tmp_path / "firmware.bin"
    )

    with (
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
            return_value=orchestration,
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.verify_firmware_artifact",
            return_value=mock.Mock(
                path=tmp_path / "firmware.bin", size_bytes=2, sha256="sha256:abc"
            ),
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.publish_firmware_artifact",
            return_value=mock.Mock(
                path=tmp_path / "published" / "image.bin",
                size_bytes=2,
                sha256="sha256:abc",
                created=True,
            ),
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.append_firmware_history",
            return_value=tmp_path / "firmware_history.json",
        ),
    ):
        result = execute_compile_runtime_request(request)

    assert result.exit_code == 0
    assert result.payload["metadata"]["packageVariants"] == {"pulse": "py"}
    assert result.payload["metadata"]["requestedPackageVariants"] == {"pulse": "py"}


def test_execute_compile_runtime_request_conflict_maps_exit_code_4(tmp_path: Path):
    """A staging conflict still maps to exit code 4."""

    conflict = StagingConflict(
        target_rel_path="libs/core/system.py",
        first_source=tmp_path / "a.py",
        second_source=tmp_path / "b.py",
    )
    report = _fake_report(tmp_path, conflicts=[conflict])
    request = CompileRuntimeRequest(runtime_id="general", board="esp32", workspace_root=tmp_path)
    orchestration = _fake_orchestration(tmp_path, report, build_exit_code=None)

    with mock.patch(
        "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
        return_value=orchestration,
    ):
        result = execute_compile_runtime_request(request)

    assert result.exit_code == 4
    assert result.payload["errors"][0]["category"] == "staging-conflict"


def test_render_result_json_returns_single_line(tmp_path: Path):
    request = CompileRuntimeRequest(runtime_id="general", board="esp32", workspace_root=tmp_path)

    with mock.patch(
        "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
        side_effect=FileNotFoundError("runtime manifest missing"),
    ):
        result = execute_compile_runtime_request(request)

    rendered = render_result_json(result)
    assert "\n" not in rendered
    assert '"schemaVersion":1' in rendered


def test_execute_compile_runtime_request_passes_embedded_output_override(tmp_path: Path):
    request = CompileRuntimeRequest(
        runtime_id="general",
        board="esp32",
        workspace_root=tmp_path,
        embedded_inventory_output=tmp_path / "artifacts" / "manifest.json",
    )

    with mock.patch(
        "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
        return_value=_fake_orchestration(tmp_path, _fake_report(tmp_path)),
    ) as run_orchestration:
        execute_compile_runtime_request(request)

    assert (
        run_orchestration.call_args.kwargs["embedded_inventory_output"]
        == (tmp_path / "artifacts" / "manifest.json").resolve()
    )


def test_execute_compile_runtime_request_build_command_clean_target(tmp_path: Path):
    request = CompileRuntimeRequest(
        runtime_id="general",
        board="esp32",
        workspace_root=tmp_path,
        clean_build=True,
    )
    orchestration = _fake_orchestration(
        tmp_path,
        _fake_report(tmp_path),
        command=("make", "clean", "OTTER_PACKAGING_MODE=source-py"),
    )

    with mock.patch(
        "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
        return_value=orchestration,
    ):
        result = execute_compile_runtime_request(request)

    assert result.payload["build"]["command"].startswith("make clean")


def test_execute_compile_runtime_request_includes_preflight_warnings(tmp_path: Path):
    _write_target_mapping(tmp_path)

    request = CompileRuntimeRequest(runtime_id="general", board="esp32", workspace_root=tmp_path)
    orchestration = _fake_orchestration(tmp_path, _fake_report(tmp_path), warnings=("warn-a",))

    with mock.patch(
        "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
        return_value=orchestration,
    ):
        result = execute_compile_runtime_request(request)

    assert result.payload["warnings"] == ["warn-a"]


def test_execute_compile_runtime_request_includes_target_mapping_warning_for_wildcard(
    tmp_path: Path,
):
    mapping_path = (
        tmp_path
        / "src"
        / "micro_otter"
        / "nodes"
        / "device"
        / "targets"
        / "compile_target_mappings.json"
    )
    mapping_path.parent.mkdir(parents=True, exist_ok=True)
    mapping_path.write_text(
        '{"schemaVersion":1,"rules":[{"id":"generic-fallback","webTargetId":"generic_micropython","runtimeIdInclude":["*"],"runtimeIdExclude":[],"compile":{"board":"*","port":"*"},"priority":10}]}',
        encoding="utf-8",
    )

    request = CompileRuntimeRequest(runtime_id="general", board="esp32", workspace_root=tmp_path)
    orchestration = _fake_orchestration(tmp_path, _fake_report(tmp_path), warnings=())

    with mock.patch(
        "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
        return_value=orchestration,
    ):
        result = execute_compile_runtime_request(request)

    assert any(
        warning.startswith("TARGET_MAPPING_WILDCARD") for warning in result.payload["warnings"]
    )


def test_execute_compile_runtime_request_compiled_mode_precompile_metadata(tmp_path: Path):
    request = CompileRuntimeRequest(
        runtime_id="general",
        board="esp32",
        workspace_root=tmp_path,
        module_packaging_mode="compiled-mpy",
    )
    orchestration = _fake_orchestration(
        tmp_path,
        _fake_report(tmp_path),
        precompiled_files=3,
        compiler_path=tmp_path / "mpy-cross",
        sources_removed=3,
    )

    with mock.patch(
        "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
        return_value=orchestration,
    ):
        result = execute_compile_runtime_request(request)

    assert result.payload["metadata"]["modulePackagingMode"] == "compiled-mpy"
    assert result.payload["metadata"]["precompiledFiles"] == 3
    assert result.payload["metadata"]["mpySourcesRemoved"] == 3
    assert result.payload["metadata"]["mpyCrossPath"] == str(tmp_path / "mpy-cross")


def test_execute_compile_runtime_request_reports_package_selection(tmp_path: Path):
    _write_target_mapping(tmp_path)
    request = CompileRuntimeRequest(
        runtime_id="general",
        board="esp32",
        workspace_root=tmp_path,
        package_ids=("core", "boss"),
    )
    orchestration = _fake_orchestration(tmp_path, _fake_report(tmp_path))

    with mock.patch(
        "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
        return_value=orchestration,
    ) as run_orchestration:
        result = execute_compile_runtime_request(request)

    assert result.payload["metadata"]["packageIds"] == ["core", "boss"]
    assert run_orchestration.call_args.kwargs["package_ids"] == ("core", "boss")


def test_execute_compile_runtime_request_reports_no_package_selection(tmp_path: Path):
    request = CompileRuntimeRequest(runtime_id="general", board="esp32", workspace_root=tmp_path)
    orchestration = _fake_orchestration(tmp_path, _fake_report(tmp_path))

    with mock.patch(
        "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
        return_value=orchestration,
    ):
        result = execute_compile_runtime_request(request)

    assert result.payload["metadata"]["packageIds"] is None


def test_execute_compile_runtime_request_forwards_and_reports_addons_root(tmp_path: Path):
    _write_target_mapping(tmp_path)
    addons_root = tmp_path / "addons"
    request = CompileRuntimeRequest(
        runtime_id="general",
        board="esp32",
        workspace_root=tmp_path,
        addons_root=addons_root,
    )
    orchestration = _fake_orchestration(tmp_path, _fake_report(tmp_path))

    with mock.patch(
        "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
        return_value=orchestration,
    ) as run_orchestration:
        result = execute_compile_runtime_request(request)

    assert run_orchestration.call_args.kwargs["addons_root"] == addons_root.resolve()
    assert result.payload["paths"]["addonsRoot"] == str(addons_root.resolve())


def test_execute_compile_runtime_request_reports_no_addons_root(tmp_path: Path):
    request = CompileRuntimeRequest(runtime_id="general", board="esp32", workspace_root=tmp_path)
    orchestration = _fake_orchestration(tmp_path, _fake_report(tmp_path))

    with mock.patch(
        "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
        return_value=orchestration,
    ) as run_orchestration:
        result = execute_compile_runtime_request(request)

    assert run_orchestration.call_args.kwargs["addons_root"] is None
    assert result.payload["paths"]["addonsRoot"] is None


def test_execute_compile_runtime_request_reports_package_provenance(tmp_path: Path):
    _write_target_mapping(tmp_path)
    device_root = tmp_path / "src" / "micro_otter" / "nodes" / "device"
    (device_root / "node_pkgs").mkdir(parents=True, exist_ok=True)
    (device_root / "node_pkgs" / "index.json").write_text(
        json.dumps({"version": 1, "packages": [{"id": "core", "manifest": "core/manifest.json"}]}),
        encoding="utf-8",
    )
    addons_root = tmp_path / "addons"
    addon_dir = addons_root / "sample_addon"
    addon_dir.mkdir(parents=True)
    (addon_dir / "manifest.json").write_text(
        json.dumps(
            {
                "id": "sample_addon",
                "version": "1.0.0",
                "manifestVersion": 2,
                "variants": {"py": {"mpAssets": {"*": ["moa_sample_addon/__init__.py"]}}},
            }
        ),
        encoding="utf-8",
    )
    request = CompileRuntimeRequest(
        runtime_id="general",
        board="esp32",
        workspace_root=tmp_path,
        addons_root=addons_root,
    )
    orchestration = _fake_orchestration(tmp_path, _fake_report(tmp_path))

    with mock.patch(
        "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
        return_value=orchestration,
    ):
        result = execute_compile_runtime_request(request)

    assert result.payload["metadata"]["packageProvenance"] == {
        "core": "builtin",
        "sample_addon": "addon",
    }


def test_execute_compile_runtime_request_includes_discovered_firmware_artifact(tmp_path: Path):
    request = CompileRuntimeRequest(runtime_id="general", board="esp32", workspace_root=tmp_path)
    firmware = tmp_path / "firmware.bin"
    firmware.write_bytes(b"fw")
    orchestration = _fake_orchestration(
        tmp_path,
        _fake_report(tmp_path),
        artifact_path=firmware,
    )

    with (
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
            return_value=orchestration,
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.verify_firmware_artifact",
            return_value=mock.Mock(path=firmware, size_bytes=2, sha256="sha256:abc"),
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.publish_firmware_artifact",
            return_value=mock.Mock(
                path=tmp_path / "published" / "1.11.0-esp32-general-1.11.0.bin",
                size_bytes=2,
                sha256="sha256:abc",
                created=True,
            ),
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command._update_latest_versions_registry",
            return_value=tmp_path / "latest_versions.json",
        ),
    ):
        result = execute_compile_runtime_request(request)

    assert result.payload["paths"]["firmwareArtifact"] == str(firmware)
    assert result.payload["metadata"]["firmwareArtifactSizeBytes"] == 2
    assert result.payload["metadata"]["firmwareArtifactHash"] == "sha256:abc"
    assert result.payload["metadata"]["firmwarePublishStatus"] == "published"


def test_execute_compile_runtime_request_verbose_mode_emits_detailed_files(tmp_path: Path):
    request = CompileRuntimeRequest(
        runtime_id="general",
        board="esp32",
        workspace_root=tmp_path,
        verbose=True,
    )
    orchestration = _fake_orchestration(tmp_path, _fake_report(tmp_path))

    with mock.patch(
        "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
        return_value=orchestration,
    ):
        result = execute_compile_runtime_request(request)

    assert result.payload["staging"]["detailedFiles"]


def test_execute_compile_runtime_request_maps_micropython_config_error(tmp_path: Path):
    request = CompileRuntimeRequest(runtime_id="general", board="esp32", workspace_root=tmp_path)

    with mock.patch(
        "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
        side_effect=MicropythonVersionError("Cannot resolve MicroPython interpreter version"),
    ):
        result = execute_compile_runtime_request(request)

    assert result.exit_code == 5
    assert result.payload["errors"][0]["category"] == "micropython-config"


def test_execute_compile_runtime_request_maps_called_process_error(tmp_path: Path):
    request = CompileRuntimeRequest(runtime_id="general", board="esp32", workspace_root=tmp_path)

    with mock.patch(
        "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
        side_effect=subprocess.CalledProcessError(2, ["make"]),
    ):
        result = execute_compile_runtime_request(request)

    assert result.exit_code == 7
    assert result.payload["errors"][0]["category"] == "build-command-failed"


def test_execute_compile_runtime_request_maps_oserror_to_toolchain_error(tmp_path: Path):
    request = CompileRuntimeRequest(runtime_id="general", board="esp32", workspace_root=tmp_path)

    with mock.patch(
        "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
        side_effect=OSError("toolchain missing"),
    ):
        result = execute_compile_runtime_request(request)

    assert result.exit_code == 6
    assert result.payload["errors"][0]["category"] == "build-toolchain-invocation"


def test_execute_compile_runtime_request_maps_artifact_verification_to_exit_8(tmp_path: Path):
    request = CompileRuntimeRequest(runtime_id="general", board="esp32", workspace_root=tmp_path)

    with mock.patch(
        "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
        side_effect=ArtifactVerificationError("artifact invalid"),
    ):
        result = execute_compile_runtime_request(request)

    assert result.exit_code == 8
    assert result.payload["errors"][0]["category"] == "artifact-verification"


def test_unknown_package_id_maps_to_exit_code_and_code(tmp_path: Path):
    _write_target_mapping(tmp_path)
    request = CompileRuntimeRequest(
        runtime_id="general",
        board="esp32",
        workspace_root=tmp_path,
        package_ids=("nope",),
    )

    with mock.patch(
        "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
        side_effect=UnknownPackageIdError(requested=["nope"], known=["core", "pins"]),
    ):
        result = execute_compile_runtime_request(request)

    assert result.exit_code == 2
    error = result.payload["errors"][0]
    assert error["code"] == "unknown-package-id"
    assert error["category"] == "package-selection"
    assert error["details"] == {"requested": ["nope"], "known": ["core", "pins"]}
    assert "core, pins" in error["hint"]


def test_package_not_staged_maps_to_exit_code_and_code(tmp_path: Path):
    _write_target_mapping(tmp_path)
    request = CompileRuntimeRequest(
        runtime_id="general",
        board="esp32",
        workspace_root=tmp_path,
        package_ids=("local_only",),
    )

    with mock.patch(
        "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
        side_effect=PackageNotStagedError(package_ids=["local_only"]),
    ):
        result = execute_compile_runtime_request(request)

    assert result.exit_code == 2
    error = result.payload["errors"][0]
    assert error["code"] == "package-not-staged"
    assert error["category"] == "package-selection"
    assert error["details"] == {"packageIds": ["local_only"]}
    assert "node_pkgs/" in error["hint"]


def test_execute_compile_runtime_request_requires_artifact_after_successful_build(tmp_path: Path):
    request = CompileRuntimeRequest(runtime_id="general", board="esp32", workspace_root=tmp_path)

    with mock.patch(
        "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
        return_value=_fake_orchestration(tmp_path, _fake_report(tmp_path), build_exit_code=0),
    ):
        result = execute_compile_runtime_request(request)

    assert result.exit_code == 8
    assert result.payload["status"] == "failed"
    assert result.payload["errors"][0]["category"] == "artifact-verification"


def test_execute_compile_runtime_request_dry_run_does_not_require_artifact(tmp_path: Path):
    request = CompileRuntimeRequest(
        runtime_id="general",
        board="esp32",
        workspace_root=tmp_path,
        dry_run=True,
    )

    with mock.patch(
        "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
        return_value=_fake_orchestration(tmp_path, _fake_report(tmp_path), build_exit_code=None),
    ):
        result = execute_compile_runtime_request(request)

    assert result.exit_code == 0
    assert result.payload["status"] == "success"
    assert result.payload["paths"]["firmwareArtifact"] is None


def test_normalize_runtime_semver_warns_on_invalid_value():
    import warnings

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        result = _normalize_runtime_semver(None)
    assert result == "0.0.0"
    assert len(caught) == 1
    assert issubclass(caught[0].category, RuntimeWarning)
    assert "0.0.0" in str(caught[0].message)


def test_normalize_runtime_semver_no_warning_for_valid_value():
    import warnings

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        result = _normalize_runtime_semver("1.11.0")
    assert result == "1.11.0"
    assert len(caught) == 0


# ---------------------------------------------------------------------------
# _resolve_pre_build_publish_target
# ---------------------------------------------------------------------------


def test_resolve_pre_build_publish_target_returns_none_when_micropython_version_fails(
    tmp_path: Path,
):
    normalized = mock.Mock(
        micropython_root=tmp_path / "micropython",
        device_root=tmp_path / "device",
        runtime_id="general",
        board="esp32",
        workspace_root=tmp_path,
    )
    with mock.patch(
        "micro_otter.tools.firmware_compile.compile_command.resolve_micropython_version",
        side_effect=Exception("not found"),
    ):
        result = _resolve_pre_build_publish_target(normalized)

    assert result is None


def test_resolve_pre_build_publish_target_returns_none_when_manifest_missing(tmp_path: Path):
    normalized = mock.Mock(
        micropython_root=tmp_path / "micropython",
        device_root=tmp_path / "device",
        runtime_id="general",
        board="esp32",
        workspace_root=tmp_path,
    )
    with mock.patch(
        "micro_otter.tools.firmware_compile.compile_command.resolve_micropython_version",
        return_value="1.27.0",
    ):
        # No manifest file created, so read_text raises FileNotFoundError
        result = _resolve_pre_build_publish_target(normalized)

    assert result is None


def test_resolve_pre_build_publish_target_returns_path_when_version_resolves(tmp_path: Path):
    device_root = tmp_path / "device"
    manifest_dir = device_root / "runtime" / "general"
    manifest_dir.mkdir(parents=True)
    manifest_file = manifest_dir / "manifest.json"
    manifest_file.write_text('{"version":"1.11.0"}', encoding="utf-8")

    normalized = mock.Mock(
        micropython_root=tmp_path / "micropython",
        device_root=device_root,
        runtime_id="general",
        board="esp32",
        slug="esp32",
        workspace_root=tmp_path,
    )
    identity = mock.Mock(
        full_version="1.27.0-esp32-general-0.1.0-0123456789ab",
        filename="my-repo-1.27.0-esp32-general-0.1.0-0123456789ab.bin",
    )

    with (
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.resolve_micropython_version",
            return_value="1.27.0",
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.resolve_build_identity",
            return_value=identity,
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.SYSTEM_FIRMWARE_PUBLISH_ROOT",
            tmp_path / "firmware",
        ),
    ):
        result = _resolve_pre_build_publish_target(normalized)

    assert result is not None
    full_version, publish_path = result
    assert full_version == "1.27.0-esp32-general-0.1.0-0123456789ab"
    assert publish_path.name == "my-repo-1.27.0-esp32-general-0.1.0-0123456789ab.bin"


def test_resolve_pre_build_publish_target_returns_none_when_lineage_resolution_fails(
    tmp_path: Path,
):
    device_root = tmp_path / "device"
    manifest_dir = device_root / "runtime" / "general"
    manifest_dir.mkdir(parents=True)
    (manifest_dir / "manifest.json").write_text('{"version":"1.11.0"}', encoding="utf-8")

    normalized = mock.Mock(
        micropython_root=tmp_path / "micropython",
        device_root=device_root,
        runtime_id="general",
        board="esp32",
        slug="esp32",
        workspace_root=tmp_path,
    )

    with (
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.resolve_micropython_version",
            return_value="1.27.0",
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.resolve_build_identity",
            side_effect=Exception("lineage error"),
        ),
    ):
        result = _resolve_pre_build_publish_target(normalized)

    assert result is None


# ---------------------------------------------------------------------------
# Pre-build firmware-exists check in execute_compile_runtime_request
# ---------------------------------------------------------------------------


def test_execute_compile_runtime_request_exits_9_when_firmware_already_published(tmp_path: Path):
    _write_target_mapping(tmp_path)
    _write_runtime_lineage(tmp_path)
    publish_root = tmp_path / "firmware"
    publish_root.mkdir()
    existing_file = publish_root / "micro-otter-1.27.0-esp32-general-0.1.0.bin"
    existing_file.touch()

    request = CompileRuntimeRequest(runtime_id="general", board="esp32", workspace_root=tmp_path)

    with (
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.resolve_micropython_version",
            return_value="1.27.0",
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.SYSTEM_MICROPYTHON_ROOT",
            tmp_path / "micropython",
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command._resolve_pre_build_publish_target",
            return_value=("1.27.0-esp32-general-0.1.0", existing_file),
        ),
    ):
        result = execute_compile_runtime_request(request)

    assert result.exit_code == 9
    assert result.payload["status"] == "failed"
    errors = result.payload["errors"]
    assert len(errors) == 1
    assert errors[0]["code"] == "FIRMWARE_ALREADY_PUBLISHED"
    assert errors[0]["category"] == "firmware-already-published"
    assert "existingPath" in errors[0]["details"]
    assert "fullVersion" in errors[0]["details"]
    # A recorded (published) artifact must survive the pre-check.
    assert existing_file.exists()


def test_execute_compile_runtime_request_deletes_existing_firmware_when_force_overwrite(
    tmp_path: Path,
):
    _write_target_mapping(tmp_path)
    # 0.1.0 is a recorded (published) version, so replacing it needs --force-overwrite.
    _write_runtime_lineage(tmp_path)
    publish_root = tmp_path / "firmware"
    publish_root.mkdir()
    existing_file = publish_root / "micro-otter-1.27.0-esp32-general-0.1.0.bin"
    existing_file.touch()

    request = CompileRuntimeRequest(
        runtime_id="general",
        board="esp32",
        workspace_root=tmp_path,
        force_overwrite=True,
    )

    report = _fake_report(tmp_path)
    orchestration = _fake_orchestration(tmp_path, report)

    with (
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.SYSTEM_MICROPYTHON_ROOT",
            tmp_path / "micropython",
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command._resolve_pre_build_publish_target",
            return_value=("1.27.0-esp32-general-0.1.0", existing_file),
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
            return_value=orchestration,
        ),
    ):
        result = execute_compile_runtime_request(request)

    # The pre-check should have deleted the file and proceeded to the build
    assert not existing_file.exists()
    assert result.exit_code != 9
    assert not any(
        "Replaced unrecorded firmware artifact" in warning for warning in result.payload["warnings"]
    )


def test_execute_compile_runtime_request_replaces_unrecorded_firmware_artifact(
    tmp_path: Path,
):
    _write_target_mapping(tmp_path)
    publish_root = tmp_path / "firmware"
    publish_root.mkdir()
    leftover = publish_root / "micro-otter-1.27.0-esp32-general-0.1.0.bin"
    leftover.write_bytes(b"stale-binary")

    request = CompileRuntimeRequest(runtime_id="general", board="esp32", workspace_root=tmp_path)
    orchestration = _fake_orchestration(tmp_path, _fake_report(tmp_path))

    # No runtime lineage entry for 0.1.0: the .bin is a leftover from an interrupted
    # build, so the pre-check must replace it instead of reporting "already published".
    with (
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.SYSTEM_MICROPYTHON_ROOT",
            tmp_path / "micropython",
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command._resolve_pre_build_publish_target",
            return_value=("1.27.0-esp32-general-0.1.0", leftover),
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
            return_value=orchestration,
        ),
    ):
        result = execute_compile_runtime_request(request)

    assert not leftover.exists()
    assert result.exit_code != 9
    assert all(error["code"] != "FIRMWARE_ALREADY_PUBLISHED" for error in result.payload["errors"])
    assert any(
        "Replaced unrecorded firmware artifact" in warning for warning in result.payload["warnings"]
    )


def test_execute_compile_runtime_request_ignores_lineage_entries_for_other_versions(
    tmp_path: Path,
):
    _write_target_mapping(tmp_path)
    # A lineage entry for a different runtime firmware version must not mark 0.1.0
    # as published.
    _write_runtime_lineage(tmp_path, firmware_version="0.0.9")
    publish_root = tmp_path / "firmware"
    publish_root.mkdir()
    existing_file = publish_root / "micro-otter-1.27.0-esp32-general-0.1.0.bin"
    existing_file.write_bytes(b"stale-binary")

    request = CompileRuntimeRequest(runtime_id="general", board="esp32", workspace_root=tmp_path)
    orchestration = _fake_orchestration(tmp_path, _fake_report(tmp_path))

    with (
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.SYSTEM_MICROPYTHON_ROOT",
            tmp_path / "micropython",
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command._resolve_pre_build_publish_target",
            return_value=("1.27.0-esp32-general-0.1.0", existing_file),
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
            return_value=orchestration,
        ),
    ):
        result = execute_compile_runtime_request(request)

    assert not existing_file.exists()
    assert result.exit_code != 9


def test_execute_compile_runtime_request_skips_pre_check_in_dry_run(tmp_path: Path):
    _write_target_mapping(tmp_path)
    request = CompileRuntimeRequest(
        runtime_id="general",
        board="esp32",
        workspace_root=tmp_path,
        dry_run=True,
    )

    report = _fake_report(tmp_path)
    orchestration = _fake_orchestration(tmp_path, report, build_exit_code=None)

    resolve_calls = []

    def track_resolve(normalized):
        resolve_calls.append(normalized)
        return (
            "1.27.0-esp32-general-0.1.0",
            tmp_path / "firmware" / "micro-otter-1.27.0-esp32-general-0.1.0.bin",
        )

    with (
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.SYSTEM_MICROPYTHON_ROOT",
            tmp_path / "micropython",
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command._resolve_pre_build_publish_target",
            side_effect=track_resolve,
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
            return_value=orchestration,
        ),
    ):
        result = execute_compile_runtime_request(request)

    # dry_run skips the pre-check entirely
    assert len(resolve_calls) == 0
    assert result.exit_code == 0


# ---------------------------------------------------------------------------
# _firmware_version_is_recorded
# ---------------------------------------------------------------------------


def test_firmware_version_is_recorded_false_without_lineage_file(tmp_path: Path):
    assert (
        _firmware_version_is_recorded(
            workspace_root=tmp_path,
            target_key="esp32-general",
            full_version="1.27.0-esp32-general-0.1.0",
        )
        is False
    )


def test_firmware_version_is_recorded_true_when_entry_exists(tmp_path: Path):
    _write_runtime_lineage(tmp_path)

    assert _firmware_version_is_recorded(
        workspace_root=tmp_path,
        target_key="esp32-general",
        full_version="1.27.0-esp32-general-0.1.0",
    )


def test_firmware_version_is_recorded_true_for_unparseable_full_version(tmp_path: Path):
    # Conservative fallback: never replace an artifact whose identity is unknown.
    assert _firmware_version_is_recorded(
        workspace_root=tmp_path,
        target_key="esp32-general",
        full_version="not-a-version",
    )


def test_resolve_pre_build_publish_target_includes_runtime_assets_version(tmp_path: Path):
    device_root = tmp_path / "device"
    manifest_dir = device_root / "runtime" / "general"
    manifest_dir.mkdir(parents=True)
    (manifest_dir / "manifest.json").write_text('{"version":"1.11.0"}', encoding="utf-8")

    normalized = mock.Mock(
        micropython_root=tmp_path / "micropython",
        device_root=device_root,
        runtime_id="general",
        board="esp32",
        slug="esp32",
        workspace_root=tmp_path,
    )
    identity = mock.Mock(
        full_version="1.27.0-esp32-general-0.1.0-0123456789ab",
        filename="my-repo-1.27.0-esp32-general-0.1.0-0123456789ab.bin",
    )

    with (
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.resolve_micropython_version",
            return_value="1.27.0",
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.resolve_build_identity",
            return_value=identity,
        ) as resolve_identity,
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.SYSTEM_FIRMWARE_PUBLISH_ROOT",
            tmp_path / "firmware",
        ),
    ):
        result = _resolve_pre_build_publish_target(normalized)

    assert result is not None
    assert resolve_identity.call_args.kwargs["micropython_version"] == "1.27.0"
    assert resolve_identity.call_args.kwargs["request"] is normalized


def test_execute_compile_runtime_request_discards_artifact_when_lineage_update_fails(
    tmp_path: Path,
):
    _write_target_mapping(tmp_path)
    published_path = tmp_path / "published" / "1.27.0-esp32-general-0.1.0.bin"
    published_path.parent.mkdir(parents=True)
    published_path.write_bytes(b"fresh-binary")

    request = CompileRuntimeRequest(runtime_id="general", board="esp32", workspace_root=tmp_path)
    orchestration = _fake_orchestration(
        tmp_path,
        _fake_report(tmp_path),
        artifact_path=tmp_path / "firmware.bin",
    )

    with (
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.SYSTEM_MICROPYTHON_ROOT",
            tmp_path / "micropython",
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command._resolve_pre_build_publish_target",
            return_value=None,
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
            return_value=orchestration,
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.verify_firmware_artifact",
            return_value=mock.Mock(
                path=tmp_path / "firmware.bin", size_bytes=2, sha256="sha256:abc"
            ),
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.publish_firmware_artifact",
            return_value=mock.Mock(
                path=published_path,
                size_bytes=2,
                sha256="sha256:abc",
                created=True,
            ),
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.append_firmware_history",
            side_effect=OSError("history is read-only"),
        ),
    ):
        result = execute_compile_runtime_request(request)

    assert result.payload["status"] == "failed"
    # The .bin was published but never recorded, so it must not be left behind.
    assert not published_path.exists()


def test_run_compile_runtime_command_passes_port_as_target_for_s3_board(tmp_path: Path):
    mapping_path = (
        tmp_path
        / "src"
        / "micro_otter"
        / "nodes"
        / "device"
        / "targets"
        / "compile_target_mappings.json"
    )
    mapping_path.parent.mkdir(parents=True, exist_ok=True)
    mapping_path.write_text(
        '{"schemaVersion":1,"rules":['
        '{"id":"esp32-s3-mini-default","webTargetId":"esp32_s3_mini","runtimeIdInclude":["*"],"runtimeIdExclude":[],"compile":{"board":"ESP32_GENERIC_S3","port":"esp32"},"priority":100},'
        '{"id":"generic-fallback","webTargetId":"generic_micropython","runtimeIdInclude":["*"],"runtimeIdExclude":[],"compile":{"board":"*","port":"*"},"priority":10}'
        "]}",
        encoding="utf-8",
    )

    request = CompileRuntimeRequest(
        runtime_id="general",
        board="ESP32_GENERIC_S3",
        workspace_root=tmp_path,
        dry_run=True,
    )
    orchestration = _fake_orchestration(tmp_path, _fake_report(tmp_path))

    with mock.patch(
        "micro_otter.tools.firmware_compile.compile_command.run_build_orchestration",
        return_value=orchestration,
    ) as run_orchestration:
        exit_code = run_compile_runtime_command(request)

    assert exit_code == 0
    kwargs = run_orchestration.call_args.kwargs
    assert kwargs["target"] == "esp32"
    assert kwargs["profile"].board == "ESP32_GENERIC_S3"


def test_publish_root_uses_env_override_when_set(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    override = tmp_path / "published"
    override.mkdir()
    device_root = tmp_path / "device"
    manifest_dir = device_root / "runtime" / "general"
    manifest_dir.mkdir(parents=True)
    (manifest_dir / "manifest.json").write_text('{"version":"1.11.0"}', encoding="utf-8")
    monkeypatch.setenv("MICRO_OTTER_FIRMWARE_DIR", str(override))

    normalized = mock.Mock(
        micropython_root=tmp_path / "micropython",
        device_root=device_root,
        runtime_id="general",
        board="esp32",
        slug="esp32",
        workspace_root=tmp_path,
    )
    identity = mock.Mock(
        full_version="1.27.0-esp32-general-0.1.0-0123456789ab",
        filename="my-repo-1.27.0-esp32-general-0.1.0-0123456789ab.bin",
    )

    with (
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.resolve_micropython_version",
            return_value="1.27.0",
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.resolve_build_identity",
            return_value=identity,
        ),
        mock.patch(
            "micro_otter.tools.firmware_compile.compile_command.SYSTEM_FIRMWARE_PUBLISH_ROOT",
            tmp_path / "firmware",
        ),
    ):
        result = _resolve_pre_build_publish_target(normalized)

    assert result is not None
    _, publish_path = result
    assert publish_path.parent == override.resolve()


def test_micropython_root_prefers_toolchain_install_over_workspace_clone(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    toolchain_dir = tmp_path / "toolchain"
    installed = toolchain_dir / "micropython"
    installed.mkdir(parents=True)
    monkeypatch.setenv("MICRO_OTTER_TOOLCHAIN_DIR", str(toolchain_dir))

    assert _default_micropython_root(tmp_path) == installed.resolve()

import json
from dataclasses import replace
from pathlib import Path

from micro_otter.tools.firmware_compile.staging_metadata import (
    build_embedded_hash_records,
    write_embedded_metadata,
    write_runtime_bootstrap_setup_templates_module,
    write_runtime_embedded_metadata_payload_module,
    write_runtime_embedded_static_assets_module,
)
from micro_otter.tools.firmware_compile.staging_models import (
    ConstituentVersions,
    RuntimePayload,
    StagingFileEntry,
)
from micro_otter.tools.firmware_compile.staging_paths import resolve_staging_paths


def _setup(tmp_path: Path):
    modules = tmp_path / "src" / "micropython" / "ports" / "esp32" / "modules"
    modules.mkdir(parents=True)

    runtime_root = tmp_path / "runtime"
    runtime_root.mkdir(parents=True)

    payload = RuntimePayload(
        runtime_id="general",
        runtime_version="1.11.0",
        runtime_root=runtime_root,
        runtime_files=(),
        tools_files=(),
        package_assets=(),
        runtime_target_id=None,
        compile_board_id="esp32",
        compile_port_id="esp32",
        target_mapping_rule_id="esp32-default",
        target_mapping_source="compile_target_mappings.json",
        target_mapping_confidence="exact",
        runtime_name="Micro-Otter",
        runtime_description="Generated runtime fixture",
    )
    paths = resolve_staging_paths(workspace_root=tmp_path, target="esp32")

    return paths, payload


def test_build_embedded_hash_records_sorted_by_path(tmp_path: Path):
    paths, _payload = _setup(tmp_path)

    (paths.modules_path / "libs" / "z.py").parent.mkdir(parents=True, exist_ok=True)
    (paths.modules_path / "libs" / "z.py").write_text("z\n", encoding="utf-8")
    (paths.modules_path / "libs" / "a.py").write_text("a\n", encoding="utf-8")

    entries = [
        StagingFileEntry(
            source_path=tmp_path / "x1",
            target_rel_path="libs/z.py",
            origin="package",
            package_id="core",
            package_version="1.0.1",
        ),
        StagingFileEntry(
            source_path=tmp_path / "x2",
            target_rel_path="libs/a.py",
            origin="package",
            package_id="core",
            package_version="1.0.1",
        ),
    ]

    records = build_embedded_hash_records(paths=paths, entries=entries)
    assert [record.path for record in records] == ["libs/a.py", "libs/z.py"]


def test_write_embedded_metadata_outputs_otter_files(tmp_path: Path):
    paths, payload = _setup(tmp_path)
    (paths.modules_path / "libs" / "core" / "system.py").parent.mkdir(parents=True, exist_ok=True)
    (paths.modules_path / "libs" / "core" / "system.py").write_text("x=1\n", encoding="utf-8")

    records = build_embedded_hash_records(
        paths=paths,
        entries=[
            StagingFileEntry(
                source_path=tmp_path / "unused",
                target_rel_path="libs/core/system.py",
                origin="package",
                package_id="core",
                package_version="1.0.1",
            )
        ],
    )

    manifest_path, hashes_path = write_embedded_metadata(
        paths=paths, payload=payload, records=records
    )

    assert manifest_path.exists()
    assert hashes_path.exists()

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    hashes = json.loads(hashes_path.read_text(encoding="utf-8"))

    assert manifest["runtime"]["mode"] == "embedded"
    assert manifest["runtime"]["id"] == "general"
    assert hashes["schemaVersion"] == 1
    assert hashes["files"][0]["path"] == "libs/core/system.py"


def test_write_embedded_metadata_includes_runtime_assets_version(tmp_path: Path):
    paths, payload = _setup(tmp_path)
    from dataclasses import replace as _replace
    payload_with_assets = _replace(payload, runtime_assets_version="1.1.0")

    manifest_path, _hashes_path = write_embedded_metadata(
        paths=paths,
        payload=payload_with_assets,
        records=[],
    )

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["components"]["runtimeAssets"]["version"] == "1.1.0"



def test_write_embedded_metadata_dry_run(tmp_path: Path):
    paths, payload = _setup(tmp_path)
    records = []

    manifest_path, hashes_path = write_embedded_metadata(
        paths=paths,
        payload=payload,
        records=records,
        dry_run=True,
    )

    assert manifest_path.name == "embedded_manifest.json"
    assert hashes_path.name == "embedded_hashes.json"
    assert not manifest_path.exists()
    assert not hashes_path.exists()


def test_write_embedded_metadata_respects_manifest_output_override(tmp_path: Path):
    paths, payload = _setup(tmp_path)
    custom_manifest = tmp_path / "artifacts" / "custom_manifest.json"

    manifest_path, hashes_path = write_embedded_metadata(
        paths=paths,
        payload=payload,
        records=[],
        embedded_manifest_output=custom_manifest,
        dry_run=False,
    )

    assert manifest_path == custom_manifest.resolve()
    assert hashes_path == custom_manifest.resolve().with_name("embedded_hashes.json")
    assert manifest_path.exists()
    assert hashes_path.exists()


def test_write_runtime_bootstrap_setup_templates_module_generates_python_module(tmp_path: Path):
    paths, payload = _setup(tmp_path)
    (paths.modules_path / "custom_view.json").write_text('{"v":1}\n', encoding="utf-8")

    output_path = write_runtime_bootstrap_setup_templates_module(
        paths=paths,
        payload=payload,
        dry_run=False,
    )

    assert output_path.exists()
    text = output_path.read_text(encoding="utf-8")
    assert "RUNTIME_IDENTITY_MODE_SUMMARY" in text
    assert "build_manifest_template" in text
    assert "custom_view.json" in text
    compile(text, str(output_path), "exec")


def test_write_runtime_bootstrap_setup_templates_module_dry_run(tmp_path: Path):
    paths, payload = _setup(tmp_path)

    output_path = write_runtime_bootstrap_setup_templates_module(
        paths=paths,
        payload=payload,
        dry_run=True,
    )

    assert output_path.name == "bootstrap_setup_templates.py"
    assert not output_path.exists()


def test_write_runtime_bootstrap_setup_templates_module_reports_missing_required_payload_fields(
    tmp_path: Path,
):
    paths, payload = _setup(tmp_path)
    invalid_payload = replace(payload, compile_board_id=None)

    try:
        write_runtime_bootstrap_setup_templates_module(
            paths=paths,
            payload=invalid_payload,
            dry_run=False,
        )
    except ValueError as exc:
        assert "GENERATION_INPUT_MISSING" in str(exc)
        assert "compile_board_id" in str(exc)
    else:
        raise AssertionError("Expected ValueError for missing compile_board_id")


def test_write_runtime_embedded_metadata_payload_module_reports_invalid_custom_view_json(
    tmp_path: Path,
):
    paths, payload = _setup(tmp_path)
    (paths.modules_path / "custom_view.json").write_text("not-json", encoding="utf-8")

    try:
        write_runtime_embedded_metadata_payload_module(
            paths=paths,
            payload=payload,
            records=[],
            dry_run=False,
        )
    except ValueError as exc:
        assert "GENERATION_INPUT_INVALID" in str(exc)
        assert "custom_view.json" in str(exc)
    else:
        raise AssertionError("Expected ValueError for invalid custom_view.json")


def test_write_runtime_embedded_metadata_payload_module_bakes_allowed_web_target_ids(
    tmp_path: Path,
):
    paths, payload = _setup(tmp_path)
    payload_with_targets = replace(
        payload,
        allowed_web_target_ids=("esp32_wroom", "esp32_s3_mini"),
    )

    output_path = write_runtime_embedded_metadata_payload_module(
        paths=paths,
        payload=payload_with_targets,
        records=[],
        dry_run=False,
    )

    text = output_path.read_text(encoding="utf-8")
    assert "'allowedWebTargetIds': ['esp32_wroom', 'esp32_s3_mini']" in text
    compile(text, str(output_path), "exec")


def test_write_runtime_embedded_metadata_payload_module_omits_allowed_ids_when_unset(
    tmp_path: Path,
):
    paths, payload = _setup(tmp_path)

    output_path = write_runtime_embedded_metadata_payload_module(
        paths=paths,
        payload=payload,
        records=[],
        dry_run=False,
    )

    text = output_path.read_text(encoding="utf-8")
    assert "'allowedWebTargetIds': []" in text
    compile(text, str(output_path), "exec")


def test_write_runtime_embedded_metadata_payload_module_bakes_build_base_target_id(
    tmp_path: Path,
):
    paths, payload = _setup(tmp_path)
    payload_with_base = replace(payload, web_target_base_id="esp32_s3")

    output_path = write_runtime_embedded_metadata_payload_module(
        paths=paths,
        payload=payload_with_base,
        records=[],
        dry_run=False,
    )

    text = output_path.read_text(encoding="utf-8")
    assert "'buildBaseTargetId': 'esp32_s3'" in text
    compile(text, str(output_path), "exec")


def test_write_runtime_embedded_static_assets_module_writes_file(tmp_path: Path):
    paths, _payload = _setup(tmp_path)

    asset_entries = [
        ("html/index.html", b"<html></html>"),
        ("locales/en.json", b'{"key": "value"}'),
    ]

    output_path = write_runtime_embedded_static_assets_module(
        paths=paths,
        asset_entries=asset_entries,
        dry_run=False,
    )

    assert output_path.exists()
    assert output_path.name == "embedded_static_assets.py"
    assert output_path.parent.name == "otter_runtime"
    content = output_path.read_text(encoding="utf-8")
    assert "EMBEDDED_STATIC_ASSETS" in content
    assert "html/index.html" in content
    assert "locales/en.json" in content
    assert "import deflate" not in content
    assert "_decompress(" not in content


def test_write_runtime_embedded_static_assets_module_dry_run_skips_write(tmp_path: Path):
    paths, _payload = _setup(tmp_path)

    asset_entries = [("html/index.html", b"<html></html>")]

    output_path = write_runtime_embedded_static_assets_module(
        paths=paths,
        asset_entries=asset_entries,
        dry_run=True,
    )

    assert not output_path.exists()


def test_write_runtime_embedded_static_assets_module_values_are_bytes(tmp_path: Path):
    import re
    import zlib

    paths, _payload = _setup(tmp_path)
    raw = b"Hello, world!"
    asset_entries = [("test/file.bin", raw)]

    write_runtime_embedded_static_assets_module(
        paths=paths,
        asset_entries=asset_entries,
        dry_run=False,
    )

    output_path = paths.modules_path / "otter_runtime" / "embedded_static_assets.py"
    content = output_path.read_text(encoding="utf-8")

    # Values are stored as raw compressed bytes literals (no _decompress wrapper).
    # Extract the bytes literal from the dict and verify it round-trips via host zlib.
    assert "test/file.bin" in content
    assert "_decompress(" not in content
    match = re.search(r"'test/file\.bin':\s*(b(?:'[^']*'|\"[^\"]*\"))", content)
    assert match is not None, "No bytes literal found for test/file.bin in generated module"
    embedded_bytes = eval(match.group(1))  # noqa: S307 - trusted generated content in test
    assert isinstance(embedded_bytes, bytes)
    assert zlib.decompress(embedded_bytes) == raw


def test_write_runtime_embedded_static_assets_module_empty_entries(tmp_path: Path):
    paths, _payload = _setup(tmp_path)

    output_path = write_runtime_embedded_static_assets_module(
        paths=paths,
        asset_entries=[],
        dry_run=False,
    )

    assert output_path.exists()
    content = output_path.read_text(encoding="utf-8")
    assert "EMBEDDED_STATIC_ASSETS" in content
    assert content.count("{") >= 1


# --- constituent_versions baking tests ---


def test_write_bootstrap_setup_templates_bakes_constituent_versions_when_provided(tmp_path: Path):
    paths, payload = _setup(tmp_path)

    cv = ConstituentVersions(
        micropython_version="1.27.0",
        runtime_source_version="1.11.0",
        runtime_firmware_version="0.3.0",
        device_tools_version="0.9.0",
        node_packages={"core": "1.0.0"},
    )
    output_path = write_runtime_bootstrap_setup_templates_module(
        paths=paths,
        payload=payload,
        dry_run=False,
        constituent_versions=cv,
    )

    text = output_path.read_text(encoding="utf-8")
    assert "RUNTIME_FIRMWARE_VERSION" in text
    assert "CONSTITUENT_VERSIONS" in text
    assert "'0.3.0'" in text
    assert "'1.27.0'" in text
    assert "runtimeFirmwareVersion" in text
    assert "constituentVersions" in text
    # Verify the generated code is syntactically valid Python
    compile(text, str(output_path), "exec")


def test_write_bootstrap_setup_templates_omits_constituent_versions_when_none(tmp_path: Path):
    paths, payload = _setup(tmp_path)

    output_path = write_runtime_bootstrap_setup_templates_module(
        paths=paths,
        payload=payload,
        dry_run=False,
        constituent_versions=None,
    )

    text = output_path.read_text(encoding="utf-8")
    assert "CONSTITUENT_VERSIONS" not in text
    assert "RUNTIME_FIRMWARE_VERSION" not in text
    assert "runtimeFirmwareVersion" not in text
    assert "constituentVersions" not in text
    # Still a valid Python module
    compile(text, str(output_path), "exec")


def test_constituent_versions_to_dict_includes_runtime_assets_and_addons(tmp_path: Path):
    cv = ConstituentVersions(
        micropython_version="1.27.0",
        runtime_source_version="1.11.0",
        runtime_firmware_version="0.3.0",
        device_tools_version="0.9.0",
        node_packages={"core": "1.0.0"},
        runtime_assets_version="1.2.2",
        addon_packages={"hello": "0.2.0"},
    )

    payload = cv.to_dict()

    assert payload["runtimeAssetsVersion"] == "1.2.2"
    assert payload["addonPackages"] == {"hello": "0.2.0"}


def test_constituent_versions_to_dict_omits_optional_fields_when_absent(tmp_path: Path):
    cv = ConstituentVersions(
        micropython_version="1.27.0",
        runtime_source_version="1.11.0",
        runtime_firmware_version="0.3.0",
        device_tools_version="0.9.0",
        node_packages={"core": "1.0.0"},
    )

    payload = cv.to_dict()

    assert "runtimeAssetsVersion" not in payload
    assert "addonPackages" not in payload
    assert "packageVariants" not in payload
    assert payload["nodePackages"] == {"core": "1.0.0"}


def test_constituent_versions_to_dict_emits_package_variants_when_set(tmp_path: Path):
    """A frozen variant is visible in the baked ``device.json``."""

    cv = ConstituentVersions(
        micropython_version="1.27.0",
        runtime_source_version="1.11.0",
        runtime_firmware_version="0.3.0",
        device_tools_version="0.9.0",
        node_packages={"core": "1.0.0"},
        package_variants={"pulse": "viper"},
    )

    assert cv.to_dict()["packageVariants"] == {"pulse": "viper"}


def test_constituent_versions_to_dict_emits_frozen_addons_when_set(tmp_path: Path):
    """The frozen add-on record is visible in the baked ``device.json``."""

    cv = ConstituentVersions(
        micropython_version="1.27.0",
        runtime_source_version="1.11.0",
        runtime_firmware_version="0.3.0",
        device_tools_version="0.9.0",
        node_packages={"core": "1.0.0"},
        addon_packages={"pulse": "1.0.0"},
        package_variants={"pulse": "viper"},
        frozen_addons={"pulse": {"variant": "viper", "version": "1.0.0"}},
    )

    assert cv.to_dict()["frozenAddons"] == {"pulse": {"variant": "viper", "version": "1.0.0"}}


def test_bootstrap_module_bakes_package_variants_when_set(tmp_path: Path):
    """The generated bootstrap module carries the frozen variant map."""

    paths, payload = _setup(tmp_path)
    cv = ConstituentVersions(
        micropython_version="1.27.0",
        runtime_source_version="1.11.0",
        runtime_firmware_version="0.3.0",
        device_tools_version="0.9.0",
        node_packages={"core": "1.0.0"},
        package_variants={"pulse": "viper"},
    )
    output_path = write_runtime_bootstrap_setup_templates_module(
        paths=paths,
        payload=payload,
        dry_run=False,
        constituent_versions=cv,
    )

    text = output_path.read_text(encoding="utf-8")
    assert "packageVariants" in text
    assert "'viper'" in text
    compile(text, str(output_path), "exec")

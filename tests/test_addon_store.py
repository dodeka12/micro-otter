"""Tests for the read-only add-on inventory (:mod:`micro_otter.tools.addon_store`)."""

from __future__ import annotations

import json
from pathlib import Path

from micro_otter.tools.addon_store import (
    RUNTIME_ADDONS_KEY,
    AddonRecord,
    PackageProvenance,
    addon_asset_path,
    addon_conflicts,
    addon_index_entries,
    addon_inventory_payload,
    addon_module_root,
    apply_addons_to_runtime_manifest,
    builtin_package_ids,
    installed_addons,
    is_package_id,
    iter_addon_package_dirs,
    merged_index_payload,
    provenance_of,
    read_addon_manifest,
    runtime_manifest_addons,
)

DEVICE_ROOT = Path(__file__).resolve().parents[1] / "src" / "micro_otter" / "nodes" / "device"


def _write_json(path: Path, payload: object) -> None:
    """Write *payload* as JSON to *path*, creating parents."""

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _make_addon(
    addons_root: Path,
    package_id: str,
    *,
    version: str = "1.0.0",
    name: str | None = None,
    record: dict[str, object] | None = None,
    module: str | None = None,
) -> Path:
    """Create one installed-looking add-on package and return its directory."""

    package_dir = addons_root / package_id
    manifest: dict[str, object] = {
        "id": package_id,
        "version": version,
        "manifestVersion": 2,
        "variants": {"py": {"mpAssets": {"*": [f"moa_{package_id}/__init__.py"]}}},
    }
    if name is not None:
        manifest["name"] = name
    _write_json(package_dir / "manifest.json", manifest)
    if module is not None:
        module_path = package_dir / module
        module_path.parent.mkdir(parents=True, exist_ok=True)
        module_path.write_text("# stub\n", encoding="utf-8")
    if record is not None:
        _write_json(package_dir / ".installed.json", record)
    return package_dir


def _device_root_with_index(tmp_path: Path, ids: list[str]) -> Path:
    """Create a device root whose ``node_pkgs/index.json`` declares *ids*."""

    device_root = tmp_path / "device"
    _write_json(
        device_root / "node_pkgs" / "index.json",
        {
            "version": 1,
            "packages": [
                {"id": package_id, "manifest": f"{package_id}/manifest.json"}
                for package_id in ids
            ],
        },
    )
    return device_root


def test_is_package_id_accepts_snake_case_and_rejects_everything_else() -> None:
    assert is_package_id("sample_addon") is True
    assert is_package_id("a1") is True
    for rejected in ("1abc", "Sample", "sample-addon", ".staging", "__x", "", None, 7):
        assert is_package_id(rejected) is False


def test_iter_addon_package_dirs_skips_bookkeeping_and_manifestless_dirs(
    tmp_path: Path,
) -> None:
    addons_root = tmp_path / "addons"
    _make_addon(addons_root, "beta_pkg")
    _make_addon(addons_root, "alpha_pkg")
    _write_json(addons_root / ".staging" / "x" / "manifest.json", {"id": "x"})
    _write_json(addons_root / ".trash" / "y" / "manifest.json", {"id": "y"})
    (addons_root / "no_manifest").mkdir(parents=True)
    (addons_root / "not-a-package").mkdir(parents=True)
    _write_json(addons_root / "not-a-package" / "manifest.json", {"id": "not-a-package"})

    assert [package_id for package_id, _ in iter_addon_package_dirs(addons_root)] == [
        "alpha_pkg",
        "beta_pkg",
    ]


def test_installed_addons_reports_provenance_fields_in_id_order(tmp_path: Path) -> None:
    addons_root = tmp_path / "addons"
    _make_addon(
        addons_root,
        "second_pkg",
        version="2.1.0",
        name="Second",
        record={"archiveSha256": "abc123", "installedAt": "2026-11-07T09:00:00+00:00"},
    )
    _make_addon(addons_root, "first_pkg", version="0.1.0")

    records = installed_addons(addons_root)

    assert [record.id for record in records] == ["first_pkg", "second_pkg"]
    assert isinstance(records[1], AddonRecord)
    assert records[1].name == "Second"
    assert records[1].version == "2.1.0"
    assert records[1].archive_sha256 == "abc123"
    assert records[1].installed_at == "2026-11-07T09:00:00+00:00"
    assert records[0].archive_sha256 is None
    assert records[0].installed_at is None


def test_installed_addons_skips_malformed_manifest(tmp_path: Path) -> None:
    addons_root = tmp_path / "addons"
    _make_addon(addons_root, "good_pkg")
    (addons_root / "broken_pkg").mkdir(parents=True)
    (addons_root / "broken_pkg" / "manifest.json").write_text("{not json", encoding="utf-8")

    assert [record.id for record in installed_addons(addons_root)] == ["good_pkg"]


def test_read_addon_manifest_returns_none_for_unknown_and_invalid_ids(tmp_path: Path) -> None:
    addons_root = tmp_path / "addons"
    _make_addon(addons_root, "known_pkg")

    assert read_addon_manifest(addons_root, "known_pkg") == {
        "id": "known_pkg",
        "version": "1.0.0",
        "manifestVersion": 2,
        "variants": {"py": {"mpAssets": {"*": ["moa_known_pkg/__init__.py"]}}},
    }
    assert read_addon_manifest(addons_root, "absent_pkg") is None
    assert read_addon_manifest(addons_root, "..") is None
    assert read_addon_manifest(None, "known_pkg") is None


def test_builtin_package_ids_reads_the_shipped_index() -> None:
    ids = builtin_package_ids(DEVICE_ROOT)

    assert ids[0] == "core"
    assert "led" in ids


def test_builtin_package_ids_is_empty_without_an_index(tmp_path: Path) -> None:
    assert builtin_package_ids(tmp_path) == ()


def test_missing_and_none_roots_yield_no_packages(tmp_path: Path) -> None:
    assert list(iter_addon_package_dirs(None)) == []
    assert list(iter_addon_package_dirs(tmp_path / "missing")) == []
    assert installed_addons(None) == ()
    assert merged_index_payload(DEVICE_ROOT, tmp_path / "missing") == merged_index_payload(
        DEVICE_ROOT, None
    )


def test_provenance_of_prefers_builtin_and_is_total(tmp_path: Path) -> None:
    device_root = _device_root_with_index(tmp_path, ["core"])
    addons_root = tmp_path / "addons"
    _make_addon(addons_root, "sample_addon")
    _make_addon(addons_root, "core")

    assert provenance_of(device_root, addons_root, "core") == PackageProvenance.BUILTIN
    assert provenance_of(device_root, addons_root, "sample_addon") == PackageProvenance.ADDON
    assert provenance_of(device_root, addons_root, "ghost") is None
    assert provenance_of(device_root, None, "sample_addon") is None


def test_addon_index_entries_are_node_pkgs_relative_and_ordered(tmp_path: Path) -> None:
    addons_root = tmp_path / "addons"
    _make_addon(addons_root, "beta_pkg")
    _make_addon(addons_root, "alpha_pkg")

    assert addon_index_entries(addons_root) == (
        {"id": "alpha_pkg", "manifest": "alpha_pkg/manifest.json", "root": "addons"},
        {"id": "beta_pkg", "manifest": "beta_pkg/manifest.json", "root": "addons"},
    )
    assert addon_index_entries(None) == ()


def test_merged_index_payload_without_addons_equals_the_source_file() -> None:
    source = json.loads((DEVICE_ROOT / "node_pkgs" / "index.json").read_text(encoding="utf-8"))

    assert merged_index_payload(DEVICE_ROOT, None) == source


def test_merged_index_payload_appends_addons_after_the_builtin_entries(tmp_path: Path) -> None:
    device_root = _device_root_with_index(tmp_path, ["core", "led"])
    addons_root = tmp_path / "addons"
    _make_addon(addons_root, "sample_addon")

    payload = merged_index_payload(device_root, addons_root)

    assert payload["version"] == 1
    packages = payload["packages"]
    assert [entry["id"] for entry in packages] == ["core", "led", "sample_addon"]
    assert packages[2] == {
        "id": "sample_addon",
        "manifest": "sample_addon/manifest.json",
        "root": "addons",
    }


def test_merged_index_payload_drops_an_addon_that_shadows_a_builtin(tmp_path: Path) -> None:
    device_root = _device_root_with_index(tmp_path, ["core"])
    addons_root = tmp_path / "addons"
    _make_addon(addons_root, "core")

    packages = merged_index_payload(device_root, addons_root)["packages"]

    assert packages == [{"id": "core", "manifest": "core/manifest.json"}]


def test_merged_index_payload_skips_a_malformed_addon(tmp_path: Path) -> None:
    device_root = _device_root_with_index(tmp_path, ["core"])
    addons_root = tmp_path / "addons"
    _make_addon(addons_root, "good_pkg")
    (addons_root / "broken_pkg").mkdir(parents=True)
    (addons_root / "broken_pkg" / "manifest.json").write_text("{oops", encoding="utf-8")

    packages = merged_index_payload(device_root, addons_root)["packages"]

    assert [entry["id"] for entry in packages] == ["core", "good_pkg"]


def test_addon_asset_path_resolves_manifest_and_asset(tmp_path: Path) -> None:
    addons_root = tmp_path / "addons"
    package_dir = _make_addon(addons_root, "sample_addon", module="moa_sample_addon/driver.py")

    assert addon_asset_path(addons_root, ("sample_addon", "manifest.json")) == (
        package_dir / "manifest.json"
    ).resolve()
    assert addon_asset_path(addons_root, ("sample_addon", "moa_sample_addon", "driver.py")) == (
        package_dir / "moa_sample_addon" / "driver.py"
    ).resolve()


def test_addon_asset_path_rejects_traversal_unknown_ids_and_absolute_segments(
    tmp_path: Path,
) -> None:
    addons_root = tmp_path / "addons"
    _make_addon(addons_root, "sample_addon")

    assert addon_asset_path(addons_root, ("..", "x")) is None
    assert addon_asset_path(addons_root, ("sample_addon", "..", "manifest.json")) is None
    assert addon_asset_path(addons_root, ("sample_addon", "/etc/passwd")) is None
    assert addon_asset_path(addons_root, ("sample_addon", "a/b")) is None
    assert addon_asset_path(addons_root, ("absent_pkg", "manifest.json")) is None
    assert addon_asset_path(None, ("sample_addon", "manifest.json")) is None
    assert addon_asset_path(addons_root, ("sample_addon",)) is None


def test_addon_conflicts_reports_a_shadowing_folder_and_is_empty_on_a_clean_root(
    tmp_path: Path,
) -> None:
    device_root = _device_root_with_index(tmp_path, ["core"])
    addons_root = tmp_path / "addons"
    _make_addon(addons_root, "sample_addon")

    assert addon_conflicts(device_root, addons_root) == ()
    assert addon_conflicts(device_root, None) == ()

    _make_addon(addons_root, "core")

    assert addon_conflicts(device_root, addons_root) == ("core",)


def test_apply_addons_to_runtime_manifest_keeps_every_other_key() -> None:
    manifest = {
        "id": "general",
        "version": "1.0.0",
        "nodePackages": {"global": ["core"], "local": ["local_pkg"], "optional": ["extra"]},
        "filesystem": ["otter_main.py"],
    }

    merged = apply_addons_to_runtime_manifest(manifest, ["sample_addon"])

    assert merged["nodePackages"] == {
        "global": ["core"],
        "local": ["local_pkg"],
        "optional": ["extra"],
        RUNTIME_ADDONS_KEY: ["sample_addon"],
    }
    assert merged["filesystem"] == ["otter_main.py"]
    assert "addons" not in manifest["nodePackages"]


def test_apply_addons_to_runtime_manifest_defaults_to_an_empty_sorted_list() -> None:
    manifest = {"id": "general", "nodePackages": {"global": ["core"]}}

    merged = apply_addons_to_runtime_manifest(manifest, [])

    assert merged["nodePackages"] == {"global": ["core"], RUNTIME_ADDONS_KEY: []}

    merged_many = apply_addons_to_runtime_manifest(manifest, ["b_pkg", "a_pkg", "a_pkg"])
    assert merged_many["nodePackages"][RUNTIME_ADDONS_KEY] == ["a_pkg", "b_pkg"]


def test_apply_addons_to_runtime_manifest_creates_the_mapping_when_absent() -> None:
    merged = apply_addons_to_runtime_manifest({"id": "general"}, ["sample_addon"])

    assert merged["nodePackages"] == {RUNTIME_ADDONS_KEY: ["sample_addon"]}


def test_apply_addons_to_runtime_manifest_leaves_a_non_mapping_untouched() -> None:
    manifest = {"id": "general", "nodePackages": "collections/example.json"}

    merged = apply_addons_to_runtime_manifest(manifest, ["sample_addon"])

    assert merged["nodePackages"] == "collections/example.json"


def test_runtime_manifest_addons_matches_only_runtime_manifests(tmp_path: Path) -> None:
    device_root = _device_root_with_index(tmp_path, ["core"])
    _write_json(
        device_root / "runtime" / "general" / "manifest.json",
        {"id": "general", "nodePackages": {"global": ["core"]}},
    )
    addons_root = tmp_path / "addons"
    _make_addon(addons_root, "sample_addon")

    merged = runtime_manifest_addons(
        device_root, "/device/runtime/general/manifest.json", addons_root
    )

    assert merged is not None
    assert merged["nodePackages"][RUNTIME_ADDONS_KEY] == ["sample_addon"]

    for rejected in (
        "/device/runtime/general/node_generators.js",
        "/device/node_pkgs/index.json",
        "/device/runtime/manifest.json",
        "/device/runtime/general/extra/manifest.json",
        "/device/runtime/absent/manifest.json",
    ):
        assert runtime_manifest_addons(device_root, rejected, addons_root) is None


def test_addon_module_root_builds_base_and_variant_roots() -> None:
    # The empty id is this module's vocabulary for the default implementation;
    # the compile resolver calls it "py" (DEFAULT_VARIANT_ID), never mixed here.
    assert addon_module_root("hello") == "moa_hello"
    assert addon_module_root("hello", "viper") == "moa_hello_viper"


def _make_variant_addon(addons_root: Path, package_id: str) -> Path:
    """Create a single-manifest add-on with a ``py`` and a ``viper`` variant."""

    package_dir = _make_addon(addons_root, package_id)
    variant_root = f"moa_{package_id}_viper"
    _write_json(
        package_dir / "manifest.json",
        {
            "id": package_id,
            "version": "2.0.0",
            "manifestVersion": 2,
            "variants": {
                "py": {"mpAssets": {"*": [f"moa_{package_id}/__init__.py"]}},
                "viper": {
                    "requiredCapabilities": ["viper"],
                    "hardware": {"en": "ESP32", "de": "ESP32"},
                    "precedence": 10,
                    "mpAssets": {"*": [f"{variant_root}/__init__.py"]},
                },
            },
        },
    )
    (package_dir / variant_root / "__init__.py").parent.mkdir(parents=True, exist_ok=True)
    (package_dir / variant_root / "__init__.py").write_text("# stub\n", encoding="utf-8")
    return package_dir


def test_variant_addon_yields_one_index_entry_and_a_record(tmp_path: Path) -> None:
    addons_root = tmp_path / "addons"
    _make_variant_addon(addons_root, "pulse")

    entries = addon_index_entries(addons_root)
    assert [entry["manifest"] for entry in entries] == ["pulse/manifest.json"]
    assert {entry["root"] for entry in entries} == {"addons"}

    (record,) = installed_addons(addons_root)
    assert record.variants == ("py", "viper")
    assert record.module_roots == ("moa_pulse", "moa_pulse_viper")
    assert record.contract_warnings == ()


def test_contract_warnings_accept_a_titled_default_variant(tmp_path: Path) -> None:
    addons_root = tmp_path / "addons"
    package_dir = addons_root / "pulse"
    _write_json(
        package_dir / "manifest.json",
        {
            "id": "pulse",
            "version": "1.0.0",
            "manifestVersion": 2,
            "variants": {
                "py": {
                    "title": {"en": "Py", "de": "Py"},
                    "description": {"en": "Plain MicroPython", "de": "Reines MicroPython"},
                    "mpAssets": {"*": ["moa_pulse/__init__.py"]},
                }
            },
        },
    )
    (package_dir / "moa_pulse" / "__init__.py").parent.mkdir(parents=True, exist_ok=True)
    (package_dir / "moa_pulse" / "__init__.py").write_text("# stub\n", encoding="utf-8")

    assert addon_index_entries(addons_root) == (
        {"id": "pulse", "manifest": "pulse/manifest.json", "root": "addons"},
    )
    (record,) = installed_addons(addons_root)
    assert record.contract_warnings == ()


def test_contract_warnings_flag_a_manifest_without_variants(tmp_path: Path) -> None:
    addons_root = tmp_path / "addons"
    package_dir = addons_root / "pulse"
    _write_json(
        package_dir / "manifest.json",
        {"id": "pulse", "version": "1.0.0"},
    )

    (record,) = installed_addons(addons_root)
    assert any("no variants" in warning for warning in record.contract_warnings)
    assert addon_index_entries(addons_root) == ()


def test_violating_module_root_is_skipped_from_index_and_warned(tmp_path: Path) -> None:
    addons_root = tmp_path / "addons"
    package_dir = addons_root / "bad_pkg"
    (package_dir / "otter_bad_pkg").mkdir(parents=True)
    (package_dir / "otter_bad_pkg" / "__init__.py").write_text("# stub\n", encoding="utf-8")
    _write_json(
        package_dir / "manifest.json",
        {
            "id": "bad_pkg",
            "version": "1.0.0",
            "manifestVersion": 2,
            "variants": {"py": {"mpAssets": {"*": ["otter_bad_pkg/__init__.py"]}}},
        },
    )

    assert addon_index_entries(addons_root) == ()

    (record,) = installed_addons(addons_root)
    assert record.module_roots == ("otter_bad_pkg",)
    assert record.contract_warnings
    assert "moa_bad_pkg" in record.contract_warnings[0]
    assert package_dir.is_dir()


def test_addon_inventory_payload_is_empty_for_an_absent_root(tmp_path: Path) -> None:
    assert addon_inventory_payload(_device_root_with_index(tmp_path, ["core"]), None) == {
        "addons": [],
        "conflicts": [],
        "warnings": [],
    }

    missing = tmp_path / "no-addons"
    assert addon_inventory_payload(_device_root_with_index(tmp_path, ["core"]), missing) == {
        "addons": [],
        "conflicts": [],
        "warnings": [],
    }
    assert not missing.exists()


def test_addon_inventory_payload_describes_one_installed_package(tmp_path: Path) -> None:
    device_root = _device_root_with_index(tmp_path, ["core"])
    addons_root = tmp_path / "addons"
    package_dir = _make_addon(
        addons_root,
        "sample_addon",
        version="1.2.3",
        name="Sample",
        record={"installedAt": "2026-11-11T10:00:00+00:00"},
        module="moa_sample_addon/__init__.py",
    )

    payload = addon_inventory_payload(device_root, addons_root)

    assert payload["conflicts"] == []
    assert payload["warnings"] == []
    assert payload["addons"] == [
        {
            "id": "sample_addon",
            "version": "1.2.3",
            "name": "Sample",
            "variants": ["py"],
            "moduleRoots": ["moa_sample_addon"],
            "packageDir": str(package_dir),
            "provenance": "addon",
            "installedAt": "2026-11-11T10:00:00+00:00",
        }
    ]


def test_addon_inventory_payload_reports_a_shadowing_folder_first(tmp_path: Path) -> None:
    device_root = _device_root_with_index(tmp_path, ["core"])
    addons_root = tmp_path / "addons"
    _make_addon(addons_root, "core")

    payload = addon_inventory_payload(device_root, addons_root)

    assert payload["conflicts"] == ["core"]
    assert payload["warnings"] == [
        "core shadows a built-in package and is ignored by the build"
    ]
    assert payload["addons"][0]["provenance"] == "builtin"


def test_addon_inventory_payload_warns_about_duplicate_variant_precedence(
    tmp_path: Path,
) -> None:
    device_root = _device_root_with_index(tmp_path, ["core"])
    addons_root = tmp_path / "addons"
    package_dir = _make_variant_addon(addons_root, "pulse")
    _write_json(
        package_dir / "manifest.json",
        {
            "id": "pulse",
            "version": "2.0.0",
            "manifestVersion": 2,
            "variants": {
                "py": {"mpAssets": {"*": ["moa_pulse/__init__.py"]}},
                "viper": {
                    "requiredCapabilities": ["viper"],
                    "precedence": 10,
                    "mpAssets": {"*": ["moa_pulse_viper/__init__.py"]},
                },
                "other": {
                    "requiredCapabilities": ["other"],
                    "precedence": 10,
                    "mpAssets": {"*": ["moa_pulse_other/__init__.py"]},
                },
            },
        },
    )

    payload = addon_inventory_payload(device_root, addons_root)

    assert payload["warnings"] == ["pulse: variants declare duplicate precedence values"]
    # The duplicate-precedence package is still listed, so the warning names a row.
    assert [row["id"] for row in payload["addons"]] == ["pulse"]


def test_addon_inventory_payload_writes_nothing(tmp_path: Path) -> None:
    device_root = _device_root_with_index(tmp_path, ["core"])
    addons_root = tmp_path / "addons"
    _make_addon(addons_root, "sample_addon")

    def snapshot() -> list[str]:
        """List every path under *tmp_path* so a write would show up as a difference."""

        return sorted(str(path.relative_to(tmp_path)) for path in tmp_path.rglob("*"))

    before = snapshot()
    addon_inventory_payload(device_root, addons_root)

    assert snapshot() == before


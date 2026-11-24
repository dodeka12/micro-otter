"""Tests for :mod:`micro_otter.tools.addon_archive` (validation, install, uninstall)."""

from __future__ import annotations

import json
import stat
import warnings
import zipfile
from collections.abc import Sequence
from pathlib import Path

import pytest

from micro_otter.tools import addon_archive
from micro_otter.tools.addon_archive import (
    AddonInstallError,
    install_addon,
    prune_addons_root,
    uninstall_addon,
    validate_addon_source,
    validate_addon_tree,
)
from micro_otter.tools.addon_store import installed_addons

BUILTIN_IDS = ("core", "led")
"""Built-in ids the install guard must protect."""


def _write_package(
    package_dir: Path,
    *,
    manifest: dict[str, object] | None = None,
    files: dict[str, str] | None = None,
) -> Path:
    """Create a package tree at *package_dir* and return it."""

    payload = (
        {
            "id": "sample_addon",
            "version": "1.0.0",
            "manifestVersion": 2,
            "variants": {"py": {"mpAssets": {"*": ["moa_sample_addon/__init__.py"]}}},
        }
        if manifest is None
        else manifest
    )
    contents = {"moa_sample_addon/__init__.py": "# module\n"} if files is None else files
    package_dir.mkdir(parents=True, exist_ok=True)
    (package_dir / "manifest.json").write_text(json.dumps(payload), encoding="utf-8")
    for relative, text in contents.items():
        target = package_dir / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
    return package_dir


def _zip_directory(directory: Path, archive_path: Path, *, arc_prefix: str = "") -> Path:
    """Zip every file below *directory* into *archive_path* under *arc_prefix*."""

    with zipfile.ZipFile(archive_path, "w") as archive:
        for path in sorted(directory.rglob("*")):
            if path.is_file():
                archive.write(path, f"{arc_prefix}{path.relative_to(directory).as_posix()}")
    return archive_path


def _zip_members(archive_path: Path, members: Sequence[tuple[str, str | None]]) -> Path:
    """Write raw zip members; a ``None`` payload marks a symlink entry."""

    with warnings.catch_warnings():
        # Duplicate members are the point of one test, and zipfile warns about them.
        warnings.simplefilter("ignore", UserWarning)
        with zipfile.ZipFile(archive_path, "w") as archive:
            for name, payload in members:
                info = zipfile.ZipInfo(name)
                if payload is None:
                    info.external_attr = (stat.S_IFLNK | 0o777) << 16
                    archive.writestr(info, "moa_sample_addon/__init__.py")
                else:
                    archive.writestr(info, payload)
    return archive_path


def _sample_archive(tmp_path: Path, *, arc_prefix: str = "sample_addon/") -> Path:
    """Build a valid ``sample_addon`` archive and return its path."""

    package_dir = _write_package(tmp_path / "build" / "sample_addon")
    return _zip_directory(package_dir, tmp_path / "sample_addon.zip", arc_prefix=arc_prefix)


def _error_code(error: pytest.ExceptionInfo[AddonInstallError]) -> str:
    """Return the stable code of a raised :class:`AddonInstallError`."""

    return error.value.code


def test_install_directory_copies_tree_and_records_provenance(tmp_path: Path) -> None:
    source = _write_package(tmp_path / "build" / "sample_addon")
    addons_root = tmp_path / "addons"

    result = install_addon(source, addons_root=addons_root, builtin_ids=BUILTIN_IDS)

    assert result.id == "sample_addon"
    assert result.version == "1.0.0"
    assert result.replaced is False
    assert result.archive_sha256 is None
    installed = addons_root / "sample_addon"
    assert result.package_dir == installed
    assert (installed / "manifest.json").is_file()
    assert (installed / "moa_sample_addon" / "__init__.py").is_file()
    record = json.loads((installed / ".installed.json").read_text(encoding="utf-8"))
    assert record["schemaVersion"] == 1
    assert record["id"] == "sample_addon"
    assert record["archive"] == "sample_addon"
    assert record["archiveSha256"] is None
    assert record["installedAt"]
    assert list(addons_root.glob(".staging/*")) == []


def test_install_zip_with_single_top_level_folder_strips_prefix(tmp_path: Path) -> None:
    archive = _sample_archive(tmp_path)
    addons_root = tmp_path / "addons"

    result = install_addon(archive, addons_root=addons_root, builtin_ids=BUILTIN_IDS)

    assert result.id == "sample_addon"
    assert result.archive_sha256 is not None
    assert (addons_root / "sample_addon" / "manifest.json").is_file()
    record = json.loads(
        (addons_root / "sample_addon" / ".installed.json").read_text(encoding="utf-8")
    )
    assert record["archive"] == "sample_addon.zip"
    assert record["archiveSha256"] == result.archive_sha256


def test_install_uses_manifest_id_not_archive_folder_name(tmp_path: Path) -> None:
    archive = _sample_archive(tmp_path, arc_prefix="sample_addon-1.0.0/")
    addons_root = tmp_path / "addons"

    result = install_addon(archive, addons_root=addons_root, builtin_ids=BUILTIN_IDS)

    assert result.id == "sample_addon"
    assert sorted(path.name for path in addons_root.iterdir()) == [".staging", "sample_addon"]


def test_macos_metadata_directory_is_ignored(tmp_path: Path) -> None:
    """A Finder-shaped archive (with ``__MACOSX/``) installs and ignores the metadata."""

    archive = _sample_archive(tmp_path)
    with zipfile.ZipFile(archive, "a") as handle:
        handle.writestr("__MACOSX/._manifest.json", "apple-double")
        handle.writestr("__MACOSX/sample_addon/._manifest.json", "apple-double")
    addons_root = tmp_path / "addons"

    assert validate_addon_source(archive, builtin_ids=BUILTIN_IDS).id == "sample_addon"
    result = install_addon(archive, addons_root=addons_root, builtin_ids=BUILTIN_IDS)

    assert result.id == "sample_addon"
    assert (addons_root / "sample_addon" / "manifest.json").is_file()
    assert not (addons_root / "__MACOSX").exists()


def test_macos_metadata_only_archive_is_still_refused(tmp_path: Path) -> None:
    """An archive holding only ``__MACOSX/`` still fails ``addon-archive-no-manifest``."""

    archive = _zip_members(
        tmp_path / "apple-double-only.zip",
        [("__MACOSX/._manifest.json", "apple-double")],
    )

    with pytest.raises(AddonInstallError) as error:
        install_addon(archive, addons_root=tmp_path / "addons", builtin_ids=BUILTIN_IDS)

    assert _error_code(error) == "addon-archive-no-manifest"


def test_documented_caps() -> None:
    """Pin the add-on size limits documented in ``installation.md``."""

    # docs/dev/nodes/addons/installation.md lists these values; keep them in lock-step.
    assert addon_archive.MAX_ARCHIVE_BYTES == 64 * 1024 * 1024
    assert addon_archive.MAX_UNPACKED_BYTES == 128 * 1024 * 1024
    assert addon_archive.MAX_ENTRIES == 2000


def test_install_zip_with_root_manifest_requires_package_id(tmp_path: Path) -> None:
    archive = _sample_archive(tmp_path, arc_prefix="")
    addons_root = tmp_path / "addons"

    with pytest.raises(AddonInstallError) as error:
        install_addon(archive, addons_root=addons_root, builtin_ids=BUILTIN_IDS)

    assert _error_code(error) == "addon-manifest-invalid"
    assert "--as" in (error.value.hint or "")
    assert not (addons_root / "sample_addon").exists()

    result = install_addon(
        archive,
        addons_root=addons_root,
        builtin_ids=BUILTIN_IDS,
        package_id="sample_addon",
    )

    assert result.id == "sample_addon"


def test_install_twice_requires_force_and_leaves_no_trash_entry(tmp_path: Path) -> None:
    archive = _sample_archive(tmp_path)
    addons_root = tmp_path / "addons"
    install_addon(archive, addons_root=addons_root, builtin_ids=BUILTIN_IDS)

    with pytest.raises(AddonInstallError) as error:
        install_addon(archive, addons_root=addons_root, builtin_ids=BUILTIN_IDS)

    assert _error_code(error) == "addon-already-installed"
    assert "--force" in (error.value.hint or "")

    result = install_addon(
        archive, addons_root=addons_root, builtin_ids=BUILTIN_IDS, force=True
    )

    assert result.replaced is True
    assert list((addons_root / ".trash").iterdir()) == []


def test_install_rejects_missing_source(tmp_path: Path) -> None:
    with pytest.raises(AddonInstallError) as error:
        install_addon(
            tmp_path / "absent.zip",
            addons_root=tmp_path / "addons",
            builtin_ids=BUILTIN_IDS,
        )

    assert _error_code(error) == "addon-archive-not-found"


def test_rejects_absolute_member_path(tmp_path: Path) -> None:
    archive = _zip_members(
        tmp_path / "bad.zip",
        [
            ("/etc/passwd", "x"),
            ("sample_addon/manifest.json", json.dumps({"id": "sample_addon"})),
        ],
    )

    with pytest.raises(AddonInstallError) as error:
        install_addon(archive, addons_root=tmp_path / "addons", builtin_ids=BUILTIN_IDS)

    assert _error_code(error) == "addon-archive-unsafe-path"


def test_rejects_parent_traversal_member(tmp_path: Path) -> None:
    archive = _zip_members(
        tmp_path / "bad.zip",
        [("sample_addon/../../escape.py", "x")],
    )

    with pytest.raises(AddonInstallError) as error:
        install_addon(archive, addons_root=tmp_path / "addons", builtin_ids=BUILTIN_IDS)

    assert _error_code(error) == "addon-archive-unsafe-path"


def test_rejects_backslash_member_path(tmp_path: Path) -> None:
    archive = _zip_members(
        tmp_path / "bad.zip",
        [("sample_addon\\manifest.json", "{}")],
    )

    with pytest.raises(AddonInstallError) as error:
        install_addon(archive, addons_root=tmp_path / "addons", builtin_ids=BUILTIN_IDS)

    assert _error_code(error) == "addon-archive-unsafe-path"


def test_rejects_symlink_member(tmp_path: Path) -> None:
    archive = _zip_members(
        tmp_path / "bad.zip",
        [
            ("sample_addon/manifest.json", json.dumps({"id": "sample_addon"})),
            ("sample_addon/link.py", None),
        ],
    )

    with pytest.raises(AddonInstallError) as error:
        install_addon(archive, addons_root=tmp_path / "addons", builtin_ids=BUILTIN_IDS)

    assert _error_code(error) == "addon-archive-symlink"


def test_rejects_duplicate_member_names(tmp_path: Path) -> None:
    archive = _zip_members(
        tmp_path / "bad.zip",
        [
            ("sample_addon/manifest.json", json.dumps({"id": "sample_addon"})),
            ("sample_addon/manifest.json", json.dumps({"id": "other"})),
        ],
    )

    with pytest.raises(AddonInstallError) as error:
        install_addon(archive, addons_root=tmp_path / "addons", builtin_ids=BUILTIN_IDS)

    assert _error_code(error) == "addon-archive-unsafe-path"


def test_rejects_archive_over_size_limit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    archive = _sample_archive(tmp_path)
    monkeypatch.setattr(addon_archive, "MAX_ARCHIVE_BYTES", 8)

    with pytest.raises(AddonInstallError) as error:
        install_addon(archive, addons_root=tmp_path / "addons", builtin_ids=BUILTIN_IDS)

    assert _error_code(error) == "addon-archive-too-large"


def test_rejects_too_many_entries(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    archive = _sample_archive(tmp_path)
    monkeypatch.setattr(addon_archive, "MAX_ENTRIES", 1)

    with pytest.raises(AddonInstallError) as error:
        install_addon(archive, addons_root=tmp_path / "addons", builtin_ids=BUILTIN_IDS)

    assert _error_code(error) == "addon-archive-too-many-entries"


def test_rejects_unpacked_tree_over_limit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = _write_package(tmp_path / "build" / "sample_addon")
    monkeypatch.setattr(addon_archive, "MAX_UNPACKED_BYTES", 4)

    with pytest.raises(AddonInstallError) as error:
        install_addon(source, addons_root=tmp_path / "addons", builtin_ids=BUILTIN_IDS)

    assert _error_code(error) == "addon-archive-unpacked-too-large"
    assert not (tmp_path / "addons" / "sample_addon").exists()


def test_rejects_manifest_without_version(tmp_path: Path) -> None:
    source = _write_package(
        tmp_path / "build" / "sample_addon",
        manifest={"id": "sample_addon", "mpAssets": {"*": []}},
    )

    with pytest.raises(AddonInstallError) as error:
        install_addon(source, addons_root=tmp_path / "addons", builtin_ids=BUILTIN_IDS)

    assert _error_code(error) == "addon-manifest-missing-version"


def test_rejects_missing_declared_asset(tmp_path: Path) -> None:
    source = _write_package(
        tmp_path / "build" / "sample_addon",
        manifest={
            "id": "sample_addon",
            "version": "1.0.0",
            "manifestVersion": 2,
            "variants": {"py": {"mpAssets": {"*": ["moa_sample_addon/absent.py"]}}},
        },
    )

    with pytest.raises(AddonInstallError) as error:
        install_addon(source, addons_root=tmp_path / "addons", builtin_ids=BUILTIN_IDS)

    assert _error_code(error) == "addon-manifest-missing-asset"


def test_rejects_mpycache_asset(tmp_path: Path) -> None:
    source = _write_package(
        tmp_path / "build" / "sample_addon",
        manifest={
            "id": "sample_addon",
            "version": "1.0.0",
            "manifestVersion": 2,
            "variants": {"py": {"mpAssets": {"*": ["__mpycache__/moa_sample_addon/__init__.py"]}}},
        },
        files={"__mpycache__/moa_sample_addon/__init__.py": "# cache\n"},
    )

    with pytest.raises(AddonInstallError) as error:
        install_addon(source, addons_root=tmp_path / "addons", builtin_ids=BUILTIN_IDS)

    assert _error_code(error) == "addon-manifest-forbidden-asset"


def test_rejects_install_record_asset(tmp_path: Path) -> None:
    source = _write_package(
        tmp_path / "build" / "sample_addon",
        manifest={
            "id": "sample_addon",
            "version": "1.0.0",
            "manifestVersion": 2,
            "variants": {"py": {"mpAssets": {"*": [".installed.json"]}}},
        },
        files={".installed.json": "{}"},
    )

    with pytest.raises(AddonInstallError) as error:
        install_addon(source, addons_root=tmp_path / "addons", builtin_ids=BUILTIN_IDS)

    assert _error_code(error) == "addon-manifest-forbidden-asset"


def test_rejects_builtin_id_conflict_and_writes_nothing(tmp_path: Path) -> None:
    source = _write_package(
        tmp_path / "build" / "core",
        manifest={
            "id": "core",
            "version": "9.9.9",
            "mpAssets": {"*": ["moa_sample_addon/__init__.py"]},
        },
    )
    addons_root = tmp_path / "addons"

    with pytest.raises(AddonInstallError) as error:
        install_addon(source, addons_root=addons_root, builtin_ids=BUILTIN_IDS)

    assert _error_code(error) == "addon-id-conflicts-builtin"
    assert sorted(path.name for path in addons_root.iterdir()) == [".staging"]


def test_rejects_invalid_id_and_id_mismatch(tmp_path: Path) -> None:
    bad_id = _write_package(
        tmp_path / "build" / "bad",
        manifest={"id": "Bad-Id", "version": "1.0.0"},
        files={},
    )
    good = _write_package(tmp_path / "build" / "sample_addon")

    with pytest.raises(AddonInstallError) as error:
        install_addon(bad_id, addons_root=tmp_path / "addons", builtin_ids=BUILTIN_IDS)
    assert _error_code(error) == "addon-id-invalid"

    with pytest.raises(AddonInstallError) as mismatch:
        install_addon(
            good,
            addons_root=tmp_path / "addons",
            builtin_ids=BUILTIN_IDS,
            package_id="other_id",
        )
    assert _error_code(mismatch) == "addon-id-mismatch"


def test_rejects_manifest_at_unknown_location(tmp_path: Path) -> None:
    archive = _zip_members(
        tmp_path / "bad.zip",
        [("readme.txt", "no package here")],
    )

    with pytest.raises(AddonInstallError) as error:
        install_addon(archive, addons_root=tmp_path / "addons", builtin_ids=BUILTIN_IDS)

    assert _error_code(error) == "addon-archive-no-manifest"


def test_rejects_unreadable_archive(tmp_path: Path) -> None:
    broken = tmp_path / "broken.zip"
    broken.write_text("not a zip file", encoding="utf-8")

    with pytest.raises(AddonInstallError) as error:
        install_addon(broken, addons_root=tmp_path / "addons", builtin_ids=BUILTIN_IDS)

    assert _error_code(error) == "addon-archive-invalid"


def test_uninstall_removes_package_and_keeps_root(tmp_path: Path) -> None:
    archive = _sample_archive(tmp_path)
    addons_root = tmp_path / "addons"
    install_addon(archive, addons_root=addons_root, builtin_ids=BUILTIN_IDS)

    result = uninstall_addon("sample_addon", addons_root=addons_root)

    assert result.id == "sample_addon"
    assert result.version == "1.0.0"
    assert not (addons_root / "sample_addon").exists()
    assert installed_addons(addons_root) == ()
    assert list((addons_root / ".trash").iterdir()) == []


def test_uninstall_unknown_id_lists_installed_ids(tmp_path: Path) -> None:
    archive = _sample_archive(tmp_path)
    addons_root = tmp_path / "addons"
    install_addon(archive, addons_root=addons_root, builtin_ids=BUILTIN_IDS)

    with pytest.raises(AddonInstallError) as error:
        uninstall_addon("ghost_pkg", addons_root=addons_root)

    assert _error_code(error) == "addon-not-installed"
    assert "sample_addon" in (error.value.hint or "")


def test_uninstall_rejects_invalid_id(tmp_path: Path) -> None:
    with pytest.raises(AddonInstallError) as error:
        uninstall_addon("../etc", addons_root=tmp_path / "addons")

    assert _error_code(error) == "addon-id-invalid"


def test_prune_removes_staging_and_trash_leftovers(tmp_path: Path) -> None:
    addons_root = tmp_path / "addons"
    (addons_root / ".staging" / "install-abc" / "x").mkdir(parents=True)
    (addons_root / ".trash" / "sample_addon-1").mkdir(parents=True)
    (addons_root / "sample_addon").mkdir(parents=True)
    (addons_root / "sample_addon" / "manifest.json").write_text("{}", encoding="utf-8")

    removed = prune_addons_root(addons_root)

    assert set(removed) == {".staging/install-abc", ".trash/sample_addon-1"}
    assert (addons_root / "sample_addon" / "manifest.json").is_file()
    assert prune_addons_root(tmp_path / "absent") == ()


def test_validate_addon_source_accepts_fixture_and_writes_nothing(tmp_path: Path) -> None:
    archive = _sample_archive(tmp_path)

    manifest = validate_addon_source(archive, builtin_ids=BUILTIN_IDS)

    assert manifest.id == "sample_addon"
    assert manifest.version == "1.0.0"
    assert manifest.assets == ("moa_sample_addon/__init__.py",)
    assert not (tmp_path / "addons").exists()


def test_validate_addon_tree_returns_manifest_without_touching_files(tmp_path: Path) -> None:
    package_dir = _write_package(tmp_path / "build" / "sample_addon")

    manifest = validate_addon_tree(package_dir, builtin_ids=BUILTIN_IDS)

    assert manifest.name is None
    assert sorted(path.name for path in package_dir.iterdir()) == [
        "manifest.json",
        "moa_sample_addon",
    ]


def _write_variant_package(
    package_dir: Path,
    *,
    variant: dict[str, object] | None = None,
    extra_variant_name: str | None = None,
    extra_variant: dict[str, object] | None = None,
) -> Path:
    """Create a single-manifest ``pulse`` add-on with a ``py`` and ``viper`` variant."""

    viper = {
        "requiredCapabilities": ["viper"],
        "hardware": {"en": "ESP32", "de": "ESP32"},
        "precedence": 10,
        "mpAssets": {"*": ["moa_pulse_viper/__init__.py"]},
    }
    if variant is not None:
        viper.update(variant)

    variants: dict[str, object] = {
        "py": {"mpAssets": {"*": ["moa_pulse/__init__.py"]}},
        "viper": viper,
    }
    if extra_variant_name is not None:
        payload: dict[str, object] = {
            "requiredCapabilities": ["lite"],
            "hardware": {"en": "Lite", "de": "Lite"},
            "precedence": 10,
            "mpAssets": {"*": [f"moa_pulse_{extra_variant_name}/__init__.py"]},
        }
        if extra_variant is not None:
            payload.update(extra_variant)
        variants[extra_variant_name] = payload

    package_dir.mkdir(parents=True, exist_ok=True)
    (package_dir / "manifest.json").write_text(
        json.dumps(
            {
                "id": "pulse",
                "version": "1.0.0",
                "manifestVersion": 2,
                "variants": variants,
            }
        ),
        encoding="utf-8",
    )
    for relative in ("moa_pulse/__init__.py", "moa_pulse_viper/__init__.py"):
        target = package_dir / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("# stub\n", encoding="utf-8")
    return package_dir


def test_variant_package_validates_and_reports_both_variants(tmp_path: Path) -> None:
    manifest = validate_addon_tree(
        _write_variant_package(tmp_path / "build" / "pulse"), builtin_ids=BUILTIN_IDS
    )

    assert [variant.id for variant in manifest.variants] == ["py", "viper"]
    assert manifest.module_roots == ("moa_pulse", "moa_pulse_viper")
    assert manifest.variants[1].module_root == "moa_pulse_viper"
    assert manifest.variants[1].precedence == 10
    assert manifest.variants[1].required_capabilities == ("viper",)
    assert manifest.variants[1].hardware == {"en": "ESP32", "de": "ESP32"}


@pytest.mark.parametrize(
    ("module_root",),
    [("otter_sample_addon",), ("moa_other",), ("sample_addon",)],
)
def test_rejects_module_root_outside_the_moa_namespace(
    tmp_path: Path, module_root: str
) -> None:
    package_dir = _write_package(
        tmp_path / "build" / "sample_addon",
        manifest={
            "id": "sample_addon",
            "version": "1.0.0",
            "manifestVersion": 2,
            "variants": {"py": {"mpAssets": {"*": [f"{module_root}/__init__.py"]}}},
        },
        files={f"{module_root}/__init__.py": "# stub\n"},
    )

    with pytest.raises(AddonInstallError) as error:
        validate_addon_tree(package_dir, builtin_ids=BUILTIN_IDS)

    assert _error_code(error) == "addon-module-root-invalid"


def test_rejects_duplicate_variant_precedence(tmp_path: Path) -> None:
    package_dir = _write_variant_package(
        tmp_path / "build" / "pulse",
        extra_variant_name="lite",
        extra_variant={
            "requiredCapabilities": ["lite"],
            "hardware": {"en": "Lite", "de": "Lite"},
            "precedence": 10,
            "mpAssets": {"*": ["moa_pulse_lite/__init__.py"]},
        },
    )
    (package_dir / "moa_pulse_lite" / "__init__.py").parent.mkdir(parents=True, exist_ok=True)
    (package_dir / "moa_pulse_lite" / "__init__.py").write_text("# stub\n", encoding="utf-8")

    with pytest.raises(AddonInstallError) as error:
        validate_addon_tree(package_dir, builtin_ids=BUILTIN_IDS)

    assert _error_code(error) == "addon-variant-precedence-duplicate"


def test_accepts_a_titled_default_variant(tmp_path: Path) -> None:
    package_dir = _write_package(
        tmp_path / "build" / "sample_addon",
        manifest={
            "id": "sample_addon",
            "version": "1.0.0",
            "manifestVersion": 2,
            "variants": {
                "py": {
                    "title": {"en": "Py", "de": "Py"},
                    "description": {"en": "Plain MicroPython", "de": "Reines MicroPython"},
                    "mpAssets": {"*": ["moa_sample_addon/__init__.py"]},
                }
            },
        },
    )

    manifest = validate_addon_tree(package_dir, builtin_ids=BUILTIN_IDS)

    assert manifest.module_roots == ("moa_sample_addon",)

    addons_root = tmp_path / "addons"
    result = install_addon(package_dir, addons_root=addons_root, builtin_ids=BUILTIN_IDS)

    assert result.id == "sample_addon"
    assert (addons_root / "sample_addon" / "manifest.json").is_file()


def test_legacy_variant_manifest_is_rejected(tmp_path: Path) -> None:
    package_dir = _write_package(tmp_path / "build" / "sample_addon")
    (package_dir / "manifest.viper.json").write_text(
        json.dumps(
            {
                "id": "sample_addon",
                "version": "1.0.0",
                "requiredCapabilities": ["viper"],
                "mpAssets": {"*": ["moa_sample_addon_viper/__init__.py"]},
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(AddonInstallError) as error:
        validate_addon_tree(package_dir, builtin_ids=BUILTIN_IDS)

    assert _error_code(error) == "addon-layout-legacy-variant-manifest"



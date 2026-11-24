"""Tests for the deterministic firmware content hash (v2)."""

import pytest

from micro_otter.tools.firmware_compile.content_identity import (
    _content_payload,
    build_firmware_manifest,
    firmware_content_hash,
)


def _base_kwargs(**overrides):
    kwargs = {
        "slug": "esp32",
        "backend": "esp-idf",
        "platform_version": "1.27.0",
        "runtime_id": "general",
        "constituents": {
            "runtime-source": "1.11.0",
            "device-tools": "0.0.0",
            "runtime-assets": "1.2.2",
        },
        "embedded_packages": {"core": "1.0.0"},
    }
    kwargs.update(overrides)
    return kwargs


def test_same_inputs_produce_same_hash():
    first = firmware_content_hash(**_base_kwargs())
    second = firmware_content_hash(**_base_kwargs())
    assert first == second


def test_hash_is_twelve_hex_chars():
    digest = firmware_content_hash(**_base_kwargs())
    assert len(digest) == 12
    assert all(c in "0123456789abcdef" for c in digest)


def test_embedded_package_change_changes_hash():
    baseline = firmware_content_hash(**_base_kwargs())
    changed = firmware_content_hash(**_base_kwargs(embedded_packages={"core": "1.0.1"}))
    assert changed != baseline


def test_addon_change_changes_hash():
    baseline = firmware_content_hash(**_base_kwargs())
    changed = firmware_content_hash(**_base_kwargs(addon_packages={"hello": "0.2.0"}))
    assert changed != baseline


def test_addon_version_bump_changes_hash():
    baseline = firmware_content_hash(**_base_kwargs(addon_packages={"hello": "0.2.0"}))
    changed = firmware_content_hash(**_base_kwargs(addon_packages={"hello": "0.3.0"}))
    assert changed != baseline


def test_selection_changes_each_change_hash():
    baseline = firmware_content_hash(**_base_kwargs())
    assert firmware_content_hash(**_base_kwargs(selection={"packageIds": ["core"]})) != baseline
    assert firmware_content_hash(
        **_base_kwargs(selection={"packageVariants": {"core": "viper"}})
    ) != baseline
    assert firmware_content_hash(
        **_base_kwargs(selection={"modulePackagingMode": "compiled-mpy"})
    ) != baseline
    assert firmware_content_hash(
        **_base_kwargs(selection={"optimizationLevel": 2})
    ) != baseline


def test_package_order_does_not_affect_hash():
    ordered = firmware_content_hash(
        **_base_kwargs(embedded_packages={"core": "1.0.0", "audio": "2.0.0"})
    )
    reordered = firmware_content_hash(
        **_base_kwargs(embedded_packages={"audio": "2.0.0", "core": "1.0.0"})
    )
    assert ordered == reordered


def test_selection_order_does_not_affect_hash():
    ordered = firmware_content_hash(
        **_base_kwargs(selection={"packageIds": ["core", "audio"]})
    )
    reordered = firmware_content_hash(
        **_base_kwargs(selection={"packageIds": ["audio", "core"]})
    )
    assert ordered == reordered


def test_legacy_calls_without_addons_or_selection_still_hash():
    digest = firmware_content_hash(**_base_kwargs())
    assert len(digest) == 12


def test_payload_excludes_version_and_build_metadata():
    payload = _content_payload(
        slug="esp32",
        backend="esp-idf",
        platform_version="1.27.0",
        runtime_id="general",
        constituents={"runtime-source": "1.11.0"},
        embedded_packages={"core": "1.0.0"},
    )
    for key in (
        "runtimeFirmwareVersion",
        "versionSource",
        "gitSource",
        "finishedAt",
        "fileHashes",
    ):
        assert key not in payload


def test_payload_schema_version_is_two():
    payload = _content_payload(**_base_kwargs())
    assert payload["schemaVersion"] == 2


def test_symbol_is_exported_from_the_package():
    from micro_otter.tools import firmware_compile

    assert "firmware_content_hash" in firmware_compile.__all__
    assert "build_firmware_manifest" in firmware_compile.__all__

def test_build_firmware_manifest_v2_shape():
    kwargs = _base_kwargs(
        addon_packages={"hello": "0.2.0"},
        selection={"packageIds": ["core"], "modulePackagingMode": "compiled-mpy"},
    )
    content_hash = firmware_content_hash(**kwargs)
    manifest = build_firmware_manifest(
        backend=kwargs["backend"],
        board="esp32",
        slug=kwargs["slug"],
        platform_version=kwargs["platform_version"],
        runtime_id=kwargs["runtime_id"],
        runtime_version="1.11.0",
        runtime_firmware_version="1.0.0",
        content_hash=content_hash,
        constituents=kwargs["constituents"],
        embedded_packages=kwargs["embedded_packages"],
        addon_packages=kwargs["addon_packages"],
        selection=kwargs["selection"],
        base_version="1.0.0",
        channel="release",
        version_source="git-release-tag",
    )

    assert manifest["schemaVersion"] == 2
    assert manifest["addonPackages"] == {"hello": "0.2.0"}
    assert manifest["selection"]["packageIds"] == ["core"]
    assert manifest["version"] == {
        "version": "1.0.0",
        "baseVersion": "1.0.0",
        "channel": "release",
        "versionSource": "git-release-tag",
    }


def test_build_firmware_manifest_rejects_mismatched_hash():
    kwargs = _base_kwargs()
    with pytest.raises(ValueError, match="content_hash"):
        build_firmware_manifest(
            backend=kwargs["backend"],
            board="esp32",
            slug=kwargs["slug"],
            platform_version=kwargs["platform_version"],
            runtime_id=kwargs["runtime_id"],
            runtime_version="1.11.0",
            runtime_firmware_version="1.0.0",
            content_hash="000000000000",
            constituents=kwargs["constituents"],
            embedded_packages=kwargs["embedded_packages"],
        )


def test_v1_shaped_manifest_still_reads_in_inventory(tmp_path):
    from micro_otter.tools.firmware_compile.firmware_inventory import (
        FirmwareInventoryEntry,
    )

    entry = FirmwareInventoryEntry(
        path=tmp_path / "x.bin",
        filename="x.bin",
        board_id="esp32",
        runtime_id="general",
        micropython_version="1.27.0",
        runtime_firmware_version="0.1.0",
        content_hash=None,
        size_bytes=0,
        modified_at="",
        has_manifest=True,
        embedded_packages={"core": "1.0.0"},
        not_embedded=(),
        addon_packages={},
        selection={},
        channel=None,
        version_source=None,
        identity_complete=False,
    )
    assert entry.identity_complete is False


def test_payload_without_variants_is_byte_identical_to_v2():
    """Omitting the variant map reproduces the v2 payload exactly."""

    assert _content_payload(**_base_kwargs()) == {
        "schemaVersion": 2,
        "slug": "esp32",
        "backend": "esp-idf",
        "platformVersion": "1.27.0",
        "runtimeId": "general",
        "constituents": {
            "runtime-source": "1.11.0",
            "device-tools": "0.0.0",
            "runtime-assets": "1.2.2",
        },
        "embeddedPackages": {"core": "1.0.0"},
        "addonPackages": {},
        "selection": {},
    }


def test_payload_with_variants_is_v3():
    """Passing a variant map upgrades the payload and records the outcome."""

    payload = _content_payload(**_base_kwargs(package_variants={"pulse": "viper"}))

    assert payload["schemaVersion"] == 3
    assert payload["packageVariants"] == {"pulse": "viper"}


def test_variant_change_changes_the_hash():
    """Two implementations of one package must not share a digest."""

    without = firmware_content_hash(**_base_kwargs())
    viper = firmware_content_hash(**_base_kwargs(package_variants={"pulse": "viper"}))
    py = firmware_content_hash(**_base_kwargs(package_variants={"pulse": "py"}))

    assert len({without, viper, py}) == 3


def test_variant_key_order_does_not_change_the_hash():
    """The hash sorts the variant map, so input order is irrelevant."""

    first = firmware_content_hash(**_base_kwargs(package_variants={"b": "x", "a": "y"}))
    second = firmware_content_hash(**_base_kwargs(package_variants={"a": "y", "b": "x"}))

    assert first == second


def test_empty_variant_map_is_v3_and_differs_from_none():
    """An empty map is a deliberate v3 statement, not the v2 payload."""

    payload = _content_payload(**_base_kwargs(package_variants={}))
    without = firmware_content_hash(**_base_kwargs())
    empty = firmware_content_hash(**_base_kwargs(package_variants={}))

    assert payload["schemaVersion"] == 3
    assert payload["packageVariants"] == {}
    assert empty != without


def _manifest_call(**overrides):
    """Return the ``build_firmware_manifest`` arguments for one variant map."""

    kwargs = _base_kwargs(**overrides)
    content_hash = firmware_content_hash(**kwargs)
    call = {
        "backend": kwargs["backend"],
        "board": "esp32",
        "slug": kwargs["slug"],
        "platform_version": kwargs["platform_version"],
        "runtime_id": kwargs["runtime_id"],
        "runtime_version": "1.11.0",
        "runtime_firmware_version": "1.0.0",
        "content_hash": content_hash,
        "constituents": kwargs["constituents"],
        "embedded_packages": kwargs["embedded_packages"],
        "addon_packages": kwargs.get("addon_packages"),
        "selection": kwargs.get("selection"),
        "base_version": "1.0.0",
        "channel": "release",
        "version_source": "git-release-tag",
    }
    if "package_variants" in kwargs:
        call["package_variants"] = kwargs["package_variants"]
    return call


def test_manifest_round_trips_the_variant_map():
    """A v3 manifest records the same map its hash covered."""

    manifest = build_firmware_manifest(**_manifest_call(package_variants={"pulse": "viper"}))

    assert manifest["schemaVersion"] == 3
    assert manifest["packageVariants"] == {"pulse": "viper"}


def test_manifest_without_variants_has_no_variant_key():
    """A v2 manifest stays byte-compatible: the key is absent, not empty."""

    manifest = build_firmware_manifest(**_manifest_call())

    assert manifest["schemaVersion"] == 2
    assert "packageVariants" not in manifest


def test_manifest_rejects_a_hash_that_ignored_the_variants():
    """A caller cannot record variants the hash did not cover."""

    call = _manifest_call(package_variants={"pulse": "viper"})
    call["content_hash"] = firmware_content_hash(**_base_kwargs())

    with pytest.raises(ValueError, match="content_hash"):
        build_firmware_manifest(**call)

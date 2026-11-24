"""Tests for the single firmware semver grammar in version_semver."""

from __future__ import annotations

import pytest

from micro_otter.tools.firmware_compile.version_semver import (
    CHANNEL_DEV,
    CHANNEL_RELEASE,
    VersionSyntaxError,
    channel_of,
    is_prerelease,
    parse_version,
    select_latest,
    try_parse_version,
    version_sort_key,
)


@pytest.mark.parametrize(
    "value",
    ["0.41.0", "0.41.0-rc.1", "0.41.0-dev.3.gabc1234", "1.0.0+build.7"],
)
def test_version_re_accepts_valid_versions(value: str) -> None:
    assert try_parse_version(value) is not None


@pytest.mark.parametrize(
    "value",
    ["0.41", "0.41.0-", "v0.41.0", "0.41.0.1", "0.41.0-dev..1", ""],
)
def test_version_re_rejects_invalid_versions(value: str) -> None:
    assert try_parse_version(value) is None


def test_parse_version_raises_with_offending_value() -> None:
    with pytest.raises(VersionSyntaxError) as excinfo:
        parse_version("v0.41.0")
    assert "v0.41.0" in str(excinfo.value)


def test_parse_version_fields() -> None:
    parsed = parse_version("1.0.1-dev.7.gabc1234+build.7")
    assert parsed.major == 1
    assert parsed.minor == 0
    assert parsed.patch == 1
    assert parsed.prerelease == "dev.7.gabc1234"
    assert parsed.build == "build.7"


def test_version_sort_key_release_above_prerelease() -> None:
    assert version_sort_key("1.0.0") > version_sort_key("1.0.0-rc.1")
    assert version_sort_key("1.0.0-rc.1") > version_sort_key("1.0.0-dev.9.gabc1234")
    assert version_sort_key("1.0.0-dev.9.gabc1234") > version_sort_key("1.0.0-dev.2.gabc1234")


def test_version_sort_key_numeric_core() -> None:
    assert version_sort_key("0.10.0") > version_sort_key("0.9.9")


def test_version_sort_key_non_semver_ranks_below_semver() -> None:
    assert version_sort_key("0.0.1") > version_sort_key("custom")


def test_version_sort_key_build_metadata_ignored() -> None:
    assert version_sort_key("1.0.0+build.1") == version_sort_key("1.0.0+build.2")


def test_is_prerelease_and_channel() -> None:
    assert is_prerelease("1.0.1-dev.7.gabc1234") is True
    assert is_prerelease("1.0.0") is False
    assert is_prerelease("custom") is False
    assert channel_of("1.0.1-dev.7.gabc1234") == CHANNEL_DEV
    assert channel_of("1.0.0") == CHANNEL_RELEASE


def test_select_latest_with_channel() -> None:
    values = ["1.0.0", "1.0.1-dev.7.gabc1234"]
    assert select_latest(values) == "1.0.1-dev.7.gabc1234"
    assert select_latest(values, channel=CHANNEL_RELEASE) == "1.0.0"
    assert select_latest(values, channel=CHANNEL_DEV) == "1.0.1-dev.7.gabc1234"
    assert select_latest(values, channel="unknown") is None
    assert select_latest([]) is None

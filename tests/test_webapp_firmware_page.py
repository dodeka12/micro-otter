"""Tests for ``micro_otter.tools.webapp_firmware_page`` and the duplicated CSP constant.

The page is a pure render of a caller-supplied release index, so these tests pin the schema-drift
check against ``tools/vite-hosted-csp.mjs``, every validation failure, the escaping, the three
command blocks and byte-identical repeat renders.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from micro_otter.tools.webapp_csp import HOSTED_CSP_POLICY
from micro_otter.tools.webapp_errors import WebappError
from micro_otter.tools.webapp_firmware_page import (
    load_firmware_index,
    render_firmware_page,
    write_firmware_page,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
"""Repository root, used to read the Vite plugin's copy of the policy."""

FIXTURE_INDEX = Path(__file__).resolve().parent / "fixtures" / "webapp" / "index.json"
"""Two-board release index; the second board name contains a ``<script>`` tag."""


def _js_policy() -> str:
    """Return ``HOSTED_CSP_POLICY`` as ``tools/vite-hosted-csp.mjs`` spells it."""

    source = (REPO_ROOT / "tools" / "vite-hosted-csp.mjs").read_text(encoding="utf-8")
    match = re.search(
        r"export const HOSTED_CSP_POLICY =\s*((?:\"[^\"]*\"\s*\+?\s*)+);",
        source,
        re.DOTALL,
    )
    assert match is not None, "HOSTED_CSP_POLICY not found in tools/vite-hosted-csp.mjs"
    return "".join(re.findall(r'"([^"]*)"', match.group(1)))


def _document(**entry_overrides: object) -> dict[str, object]:
    """Return a one-entry release index with *entry_overrides* applied to its entry."""

    entry: dict[str, object] = {
        "board": "esp32",
        "boardName": "ESP32 (WROOM / generic)",
        "chip": "esp32",
        "flashOffset": "0x1000",
        "version": "1.0.0",
        "micropythonVersion": "1.26.0",
        "sha256": "1" * 64,
        "size": 1468928,
        "url": "https://example.invalid/esp32-1.0.0.bin",
    }
    entry.update(entry_overrides)
    return {
        "schemaVersion": 1,
        "release": {"version": "1.0.0", "tag": "firmware-v1.0.0", "kind": "stable"},
        "firmware": [entry],
    }


def _write_index(tmp_path: Path, document: dict[str, object]) -> Path:
    """Write *document* as ``index.json`` under *tmp_path* and return the path."""

    path = tmp_path / "index.json"
    path.write_text(json.dumps(document), encoding="utf-8")
    return path


def _index(tmp_path: Path, **entry_overrides: object) -> dict[str, object]:
    """Load a one-entry index with *entry_overrides* applied to the entry."""

    return load_firmware_index(_write_index(tmp_path, _document(**entry_overrides)))


def test_csp_constant_matches_the_vite_plugin() -> None:
    assert HOSTED_CSP_POLICY == _js_policy()
    assert "'unsafe-inline'" not in HOSTED_CSP_POLICY
    assert "'unsafe-eval'" not in HOSTED_CSP_POLICY
    assert "frame-ancestors" not in HOSTED_CSP_POLICY


def test_load_firmware_index_accepts_the_integer_schema() -> None:
    index = load_firmware_index(FIXTURE_INDEX)

    assert index["schemaVersion"] == 1
    assert index["release"] == {"version": "1.0.0", "tag": "firmware-v1.0.0"}
    assert [entry["board"] for entry in index["firmware"]] == ["esp32", "esp32_generic_s3"]


def test_load_firmware_index_accepts_a_schema_string(tmp_path: Path) -> None:
    document = _document()
    document["schemaVersion"] = "firmware-index/1"

    index = load_firmware_index(_write_index(tmp_path, document))

    assert index["schemaVersion"] == 1


def test_load_firmware_index_normalises_the_flash_offset(tmp_path: Path) -> None:
    assert _index(tmp_path, flashOffset=4096)["firmware"][0]["flashOffset"] == "0x1000"
    assert _index(tmp_path, flashOffset="0")["firmware"][0]["flashOffset"] == "0x0"


def test_load_firmware_index_derives_the_artifact_file_name(tmp_path: Path) -> None:
    index = _index(tmp_path, url="https://example.invalid/release/esp32-general.bin")

    assert index["firmware"][0]["filename"] == "esp32-general.bin"


def test_load_firmware_index_keeps_package_url_optional(tmp_path: Path) -> None:
    assert _index(tmp_path)["firmware"][0]["packageUrl"] is None
    index = _index(
        tmp_path,
        package={"sha256": "2" * 64, "size": 1, "url": "https://example.invalid/p.firmware.zip"},
    )

    assert index["firmware"][0]["packageUrl"] == "https://example.invalid/p.firmware.zip"


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        ({"board": None}, "firmware[0].board"),
        ({"boardName": 5}, "firmware[0].boardName"),
        ({"boardName": "line\nbreak"}, "firmware[0].boardName"),
        ({"chip": "esp32; rm -rf /"}, "firmware[0].chip"),
        ({"flashOffset": "not-an-offset"}, "firmware[0].flashOffset"),
        ({"flashOffset": -1}, "firmware[0].flashOffset"),
        ({"version": ""}, "firmware[0].version"),
        ({"micropythonVersion": None}, "firmware[0].micropythonVersion"),
        ({"sha256": "abc"}, "firmware[0].sha256"),
        ({"sha256": "A" * 64}, "firmware[0].sha256"),
        ({"size": -1}, "firmware[0].size"),
        ({"size": "1 MB"}, "firmware[0].size"),
        ({"url": ""}, "firmware[0].url"),
        ({"package": {"url": ""}}, "firmware[0].package.url"),
        ({"package": "esp32.firmware.zip"}, "firmware[0].package"),
    ],
)
def test_load_firmware_index_names_the_failing_field(
    tmp_path: Path, overrides: dict[str, object], expected: str
) -> None:
    with pytest.raises(WebappError) as raised:
        _index(tmp_path, **overrides)

    assert raised.value.code == "webapp-firmware-index-invalid"
    assert expected in str(raised.value)


@pytest.mark.parametrize(
    ("document", "expected"),
    [
        ({"schemaVersion": 2, "firmware": [{}]}, "schemaVersion"),
        ({"schemaVersion": True, "firmware": [{}]}, "schemaVersion"),
        ({"schemaVersion": 1, "firmware": []}, "firmware"),
        ({"schemaVersion": 1, "firmware": {}}, "firmware"),
        ({"schemaVersion": 1, "firmware": ["esp32"]}, "firmware[0]"),
        ([], "the document"),
    ],
)
def test_load_firmware_index_rejects_a_bad_document(
    tmp_path: Path, document: object, expected: str
) -> None:
    with pytest.raises(WebappError) as raised:
        load_firmware_index(_write_index(tmp_path, document))  # type: ignore[arg-type]

    assert raised.value.code == "webapp-firmware-index-invalid"
    assert expected in str(raised.value)


def test_load_firmware_index_reports_a_missing_file(tmp_path: Path) -> None:
    with pytest.raises(WebappError) as raised:
        load_firmware_index(tmp_path / "absent.json")

    assert raised.value.code == "webapp-firmware-index-invalid"
    assert "does not exist" in str(raised.value)


def test_load_firmware_index_reports_invalid_json(tmp_path: Path) -> None:
    path = tmp_path / "index.json"
    path.write_text("{oops", encoding="utf-8")

    with pytest.raises(WebappError) as raised:
        load_firmware_index(path)

    assert raised.value.code == "webapp-firmware-index-invalid"
    assert "not valid JSON" in str(raised.value)


def test_render_firmware_page_has_one_section_per_board() -> None:
    index = load_firmware_index(FIXTURE_INDEX)

    page, _css = render_firmware_page(index, public_url="https://example.invalid/")

    assert page.count('<section class="board"') == 2
    assert '<section class="board" id="board-esp32">' in page
    assert "ESP32 (WROOM / generic)" in page
    assert "board <code>esp32_generic_s3</code>" in page


def test_render_firmware_page_prints_three_command_blocks_per_board() -> None:
    index = load_firmware_index(FIXTURE_INDEX)

    page, _css = render_firmware_page(index)

    assert page.count("<pre><code>") == 6
    assert (
        "python3 -m esptool --chip esp32 --port /dev/ttyUSB0 write_flash 0x1000 "
        "esp32-general-1.0.0-micropython-1.26.0.bin"
    ) in page
    assert (
        "py -m esptool --chip esp32 --port COM3 write_flash 0x1000 "
        "esp32-general-1.0.0-micropython-1.26.0.bin"
    ) in page
    assert "python3 -m esptool --chip esp32 --port /dev/ttyUSB0 erase_flash" in page
    assert "python3 -m esptool --chip esp32s3 --port /dev/ttyUSB0 write_flash 0x0" in page


def test_render_firmware_page_omits_the_chip_flag_when_the_catalog_omits_it(
    tmp_path: Path,
) -> None:
    page, _css = render_firmware_page(_index(tmp_path, chip=""))

    assert "python3 -m esptool --port /dev/ttyUSB0 write_flash 0x1000" in page


def test_render_firmware_page_escapes_index_values() -> None:
    index = load_firmware_index(FIXTURE_INDEX)

    page, _css = render_firmware_page(index)

    assert "<script" not in page
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in page


def test_render_firmware_page_links_the_url_exactly_as_the_index_states_it(
    tmp_path: Path,
) -> None:
    absolute = load_firmware_index(FIXTURE_INDEX)
    absolute_page, _css = render_firmware_page(absolute)
    assert (
        'href="https://example.invalid/firmware-v1.0.0/esp32-general-1.0.0-micropython-1.26.0.bin"'
        in absolute_page
    )

    relative_page, _css = render_firmware_page(
        _index(tmp_path, url="./assets/esp32-1.0.0.bin")
    )
    assert 'href="./assets/esp32-1.0.0.bin"' in relative_page


def test_render_firmware_page_links_the_package_when_the_index_carries_one() -> None:
    index = load_firmware_index(FIXTURE_INDEX)

    page, _css = render_firmware_page(index)

    assert page.count("Download the .firmware.zip package (recommended)") == 1
    assert "esp32-general-1.0.0-micropython-1.26.0.firmware.zip" in page


def test_render_firmware_page_is_script_free_and_carries_the_policy() -> None:
    index = load_firmware_index(FIXTURE_INDEX)

    page, _css = render_firmware_page(index)

    assert "<script" not in page
    assert "<style" not in page
    assert f'<meta http-equiv="Content-Security-Policy" content="{HOSTED_CSP_POLICY}">' in page
    assert '<link rel="stylesheet" href="firmware-page.css">' in page


def test_render_firmware_page_links_the_editor_only_when_a_public_url_is_given() -> None:
    index = load_firmware_index(FIXTURE_INDEX)

    with_url, _css = render_firmware_page(index, public_url="https://example.invalid/")
    without_url, _css2 = render_firmware_page(index)

    assert '<a href="https://example.invalid/">https://example.invalid/</a>' in with_url
    assert "The hosted editor runs at" not in without_url


def test_render_firmware_page_is_byte_identical_across_runs() -> None:
    index = load_firmware_index(FIXTURE_INDEX)

    first, first_css = render_firmware_page(index, public_url="https://example.invalid/")
    second, second_css = render_firmware_page(index, public_url="https://example.invalid/")

    assert first == second
    assert first_css == second_css


def test_write_firmware_page_writes_page_and_stylesheet(tmp_path: Path) -> None:
    index = load_firmware_index(FIXTURE_INDEX)

    html_path = write_firmware_page(
        tmp_path, index, public_url="https://example.invalid/"
    )

    assert html_path == tmp_path / "firmware" / "index.html"
    assert html_path.is_file()
    assert (tmp_path / "firmware" / "firmware-page.css").is_file()
    assert "Micro-Otter firmware" in html_path.read_text(encoding="utf-8")


def test_write_firmware_page_is_idempotent(tmp_path: Path) -> None:
    index = load_firmware_index(FIXTURE_INDEX)

    first = write_firmware_page(tmp_path, index).read_bytes()
    second = write_firmware_page(tmp_path, index).read_bytes()

    assert first == second

from pathlib import Path

import pytest

from micro_otter.tools.firmware_compile.board_registry import (
    BOARD_CATALOG_DEFAULT_PATH,
    BoardCatalogError,
    find_board,
    load_board_catalog,
    slug,
)


def _write_catalog(tmp_path: Path, content: str) -> Path:
    path = tmp_path / "boards.json"
    path.write_text(content, encoding="utf-8")
    return path


_ESP32_BUILD_BLOCK = (
    '"build": {\n        "port": "esp32",\n        "board": "esp32",\n'
    '        "buildDirName": "build-ESP32_GENERIC"\n      }'
)


VALID_CATALOG = """\
{
  "schemaVersion": 2,
  "boards": [
    {
      "name": "esp32",
      "slug": "esp32",
      "displayName": "ESP32 (WROOM / generic)",
      "buildBackend": "esp-idf",
      "flashBackend": "esptool",
      "chip": "esp32",
      "build": {
        "port": "esp32",
        "board": "esp32",
        "buildDirName": "build-ESP32_GENERIC"
      },
      "flash": {"offset": "0x1000"}
    },
    {
      "name": "ESP32_GENERIC_S3",
      "slug": "esp32_generic_s3",
      "displayName": "ESP32-S3 (generic)",
      "buildBackend": "esp-idf",
      "flashBackend": "esptool",
      "chip": "esp32s3",
      "build": {
        "port": "esp32",
        "board": "ESP32_GENERIC_S3",
        "buildDirName": "build-ESP32_GENERIC_S3"
      },
      "flash": {"offset": "0"}
    }
  ]
}
"""


def test_load_board_catalog_returns_expected_boards(tmp_path: Path):
    catalog = load_board_catalog(_write_catalog(tmp_path, VALID_CATALOG))

    assert [spec.name for spec in catalog] == ["esp32", "ESP32_GENERIC_S3"]

    esp32 = catalog[0]
    assert esp32.display_name == "ESP32 (WROOM / generic)"
    assert esp32.slug == "esp32"
    assert esp32.chip == "esp32"
    assert esp32.build_backend == "esp-idf"
    assert esp32.flash_backend == "esptool"
    assert dict(esp32.build_params) == {
        "port": "esp32",
        "board": "esp32",
        "buildDirName": "build-ESP32_GENERIC",
    }
    assert dict(esp32.flash_params) == {"offset": "0x1000"}

    s3 = catalog[1]
    assert s3.slug == "esp32_generic_s3"
    assert s3.chip == "esp32s3"
    assert dict(s3.flash_params) == {"offset": "0"}


def test_load_board_catalog_missing_file_raises(tmp_path: Path):
    with pytest.raises(BoardCatalogError, match="not found"):
        load_board_catalog(tmp_path / "missing.json")


def test_load_board_catalog_v1_schema_raises(tmp_path: Path):
    content = VALID_CATALOG.replace('"schemaVersion": 2', '"schemaVersion": 1')
    with pytest.raises(BoardCatalogError, match="schemaVersion"):
        load_board_catalog(_write_catalog(tmp_path, content))


def test_load_board_catalog_missing_required_field_raises(tmp_path: Path):
    content = VALID_CATALOG.replace('      "chip": "esp32",\n', "", 1)
    with pytest.raises(BoardCatalogError, match="chip"):
        load_board_catalog(_write_catalog(tmp_path, content))


def test_load_board_catalog_duplicate_name_raises(tmp_path: Path):
    content = VALID_CATALOG.replace(
        '"name": "ESP32_GENERIC_S3",\n      "slug": "esp32_generic_s3"',
        '"name": "esp32",\n      "slug": "esp32"',
        1,
    )
    with pytest.raises(BoardCatalogError, match="duplicate"):
        load_board_catalog(_write_catalog(tmp_path, content))


def test_load_board_catalog_slug_mismatch_raises(tmp_path: Path):
    content = VALID_CATALOG.replace('"slug": "esp32_generic_s3"', '"slug": "esp32s3"', 1)
    with pytest.raises(BoardCatalogError, match="slug"):
        load_board_catalog(_write_catalog(tmp_path, content))


def test_find_board_matches_exact_name(tmp_path: Path):
    catalog = load_board_catalog(_write_catalog(tmp_path, VALID_CATALOG))

    assert find_board("esp32", catalog).name == "esp32"
    assert find_board("ESP32_GENERIC_S3", catalog).slug == "esp32_generic_s3"
    assert find_board(" esp32 ", catalog).name == "esp32"
    assert find_board("esp32s3", catalog) is None
    assert find_board("", catalog) is None


def test_non_object_build_params_rejected(tmp_path: Path):
    content = VALID_CATALOG.replace(_ESP32_BUILD_BLOCK, '"build": ["port=esp32"]', 1)
    with pytest.raises(BoardCatalogError, match="build"):
        load_board_catalog(_write_catalog(tmp_path, content))


def test_non_string_build_param_value_rejected(tmp_path: Path):
    content = VALID_CATALOG.replace('"port": "esp32"', '"port": 1', 1)
    with pytest.raises(BoardCatalogError, match="build"):
        load_board_catalog(_write_catalog(tmp_path, content))


def test_empty_build_param_key_rejected(tmp_path: Path):
    content = VALID_CATALOG.replace('"port": "esp32"', '"": "esp32"', 1)
    with pytest.raises(BoardCatalogError, match="build"):
        load_board_catalog(_write_catalog(tmp_path, content))


def test_empty_build_params_object_is_accepted_and_immutable(tmp_path: Path):
    content = VALID_CATALOG.replace(_ESP32_BUILD_BLOCK, '"build": {}', 1)
    catalog = load_board_catalog(_write_catalog(tmp_path, content))

    assert dict(catalog[0].build_params) == {}
    with pytest.raises(TypeError):
        catalog[0].build_params["IDF_TARGET"] = "esp32"  # type: ignore[index]


def test_slug_normalizes_board_names():
    assert slug("ESP32_GENERIC_S3") == "esp32_generic_s3"
    assert slug("arduino:avr:uno") == "arduino_avr_uno"
    assert slug(" esp32-s3 ") == "esp32_s3"
    assert slug("::") == "board"


def test_default_catalog_path_points_at_firmware_tree():
    assert str(BOARD_CATALOG_DEFAULT_PATH).startswith("src/micro_otter/nodes/device/firmware/")


def test_shipped_catalog_declares_the_generic_s2_board():
    repo_root = Path(__file__).resolve().parents[1]
    catalog = load_board_catalog((repo_root / BOARD_CATALOG_DEFAULT_PATH).resolve())

    s2 = find_board("ESP32_GENERIC_S2", catalog)

    assert s2 is not None
    assert s2.slug == "esp32_generic_s2"
    assert s2.chip == "esp32s2"
    assert dict(s2.build_params) == {
        "port": "esp32",
        "board": "ESP32_GENERIC_S2",
        "buildDirName": "build-ESP32_GENERIC_S2",
    }
    assert dict(s2.flash_params) == {"offset": "0x1000"}

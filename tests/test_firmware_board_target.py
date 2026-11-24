from pathlib import Path

import pytest

from micro_otter.tools.firmware_compile.board_registry import (
    BOARD_CATALOG_DEFAULT_PATH,
    find_board_by_slug,
    load_board_catalog,
)
from micro_otter.tools.firmware_compile.board_target import (
    BoardTarget,
    resolve_board_target,
    slug,
)
from micro_otter.tools.firmware_compile.build_profile import BuildProfile
from micro_otter.tools.firmware_compile.build_toolchain import build_micropython_command
from micro_otter.tools.firmware_compile.firmware_deploy import resolve_firmware_image
from micro_otter.tools.firmware_compile.local_firmware import parse_firmware_filename
from micro_otter.tools.firmware_compile.version_identity import format_full_firmware_version

REPO_ROOT = Path(__file__).resolve().parents[1]


def _write_catalog(tmp_path: Path, content: str) -> Path:
    path = tmp_path / BOARD_CATALOG_DEFAULT_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


CATALOG = """\
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
      "build": {"port": "esp32", "board": "esp32", "buildDirName": "build-ESP32_GENERIC"},
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


def test_slug_normalizes_board_names():
    assert slug("ESP32_GENERIC_S3") == "esp32_generic_s3"
    assert slug("arduino:avr:uno") == "arduino_avr_uno"
    assert slug(" esp32-s3 ") == "esp32_s3"


def test_find_board_by_slug_matches_exactly_and_case_insensitively(tmp_path: Path):
    _write_catalog(tmp_path, CATALOG)
    catalog = load_board_catalog(tmp_path / BOARD_CATALOG_DEFAULT_PATH)

    exact = find_board_by_slug(catalog, "esp32_generic_s3")
    mixed = find_board_by_slug(catalog, "  ESP32_Generic_S3  ")

    assert exact is not None
    assert mixed is not None
    assert exact.name == "ESP32_GENERIC_S3"
    assert mixed.name == "ESP32_GENERIC_S3"


def test_find_board_by_slug_returns_none_for_unknown_or_empty(tmp_path: Path):
    _write_catalog(tmp_path, CATALOG)
    catalog = load_board_catalog(tmp_path / BOARD_CATALOG_DEFAULT_PATH)

    assert find_board_by_slug(catalog, "no_such_board") is None
    assert find_board_by_slug(catalog, "   ") is None
    assert find_board_by_slug([], "esp32") is None


def test_resolve_board_target_from_catalog(tmp_path: Path):
    _write_catalog(tmp_path, CATALOG)

    target = resolve_board_target(
        name="ESP32_GENERIC_S3",
        runtime_id="general",
        workspace_root=tmp_path,
        micropython_root=tmp_path,
    )

    assert isinstance(target, BoardTarget)
    assert target.name == "ESP32_GENERIC_S3"
    assert target.slug == "esp32_generic_s3"
    assert target.build_backend == "esp-idf"
    assert target.flash_backend == "esptool"
    assert target.chip == "esp32s3"
    assert target.build_params["port"] == "esp32"
    assert target.build_params["board"] == "ESP32_GENERIC_S3"
    assert target.flash_params["offset"] == "0"


class _FakeBackend:
    """Backend stub that returns a fixed off-catalog target from ``resolve_name``."""

    def __init__(self, target: BoardTarget | None = None) -> None:
        self._target = target

    def resolve_name(self, name: str, *, micropython_root) -> BoardTarget | None:
        """Return the configured target regardless of *name*."""

        return self._target


def test_resolve_board_target_falls_back_to_backend(tmp_path: Path):
    _write_catalog(tmp_path, CATALOG)

    target = resolve_board_target(
        name="ESP32_GENERIC_C3",
        runtime_id="general",
        workspace_root=tmp_path,
        micropython_root=tmp_path,
        backends=[_FakeBackend(BoardTarget.from_board_name("ESP32_GENERIC_C3", port="esp32"))],
    )

    assert target.name == "ESP32_GENERIC_C3"
    assert target.build_params["port"] == "esp32"


def test_resolve_board_target_unknown_raises(tmp_path: Path):
    _write_catalog(tmp_path, CATALOG)

    with pytest.raises(ValueError, match="Unknown MicroPython target/board: nope"):
        resolve_board_target(
            name="nope",
            runtime_id="general",
            workspace_root=tmp_path,
            micropython_root=tmp_path,
        )


def _synthetic_micropython_root(tmp_path: Path) -> Path:
    """Create a micropython tree with only the esp32 ports and a Makefile each."""

    root = tmp_path / "micropython"
    for port in ("esp32", "esp32s3"):
        port_dir = root / "ports" / port
        port_dir.mkdir(parents=True, exist_ok=True)
        (port_dir / "Makefile").write_text("", encoding="utf-8")
    return root


def test_every_catalog_row_produces_a_target_command_and_artifact(tmp_path: Path):
    micropython_root = _synthetic_micropython_root(tmp_path)
    catalog = load_board_catalog((REPO_ROOT / BOARD_CATALOG_DEFAULT_PATH).resolve())
    assert len(catalog) >= 2  # esp32 and the ESP32_GENERIC_S3 regression case

    publish_root = tmp_path / "publish"
    publish_root.mkdir()

    for spec in catalog:
        target = resolve_board_target(
            name=spec.name,
            runtime_id="general",
            workspace_root=REPO_ROOT,
            micropython_root=micropython_root,
        )
        assert target.slug == spec.slug
        assert target.build_backend == "esp-idf"
        assert target.flash_backend == "esptool"

        # The build command is byte-stable and never guesses a board name.
        command = build_micropython_command(
            profile=BuildProfile(runtime_id="general", board=target.name),
            micropython_root=micropython_root,
        )
        assert command.argv[0] == "make"
        port = target.build_params["port"]
        if target.name.lower() != port.lower():
            assert command.argv[1] == f"BOARD={target.name}"
        assert command.cwd == (micropython_root / "ports" / port).resolve()

        # The firmware identity round-trips through the canonical slug.
        version = format_full_firmware_version("1.29.0", target.slug, "general", "0.36.0")
        entry = parse_firmware_filename(f"micro-otter-{version}.bin")
        assert entry is not None
        assert entry.board_id == target.slug

        # The deploy lookup finds an image published under the same slug.
        image = publish_root / f"micro-otter-{version}.bin"
        image.write_bytes(b"\x00" * 8)
        resolved = resolve_firmware_image(
            board_spec=spec,
            runtime_id="general",
            publish_root=publish_root,
        )
        assert resolved == image.resolve()

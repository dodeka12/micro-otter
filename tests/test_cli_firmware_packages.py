"""CLI tests for the firmware package/export/import/list verbs."""

from __future__ import annotations

import http.server
import json
import threading
from pathlib import Path

from typer.testing import CliRunner

from micro_otter.cli import app
from micro_otter.tools.firmware_compile.firmware_package import package_firmware_image

runner = CliRunner()

IMAGE_NAME = "1.27.0-esp32-general-1.0.1-0123456789ab.bin"
SIDECAR_NAME = "1.27.0-esp32-general-1.0.1-0123456789ab.manifest.json"


def _sidecar() -> dict:
    """Return a minimal v2 sidecar that agrees with ``IMAGE_NAME``."""

    return {
        "schemaVersion": 2,
        "slug": "esp32",
        "runtime": {"id": "general"},
        "runtimeFirmwareVersion": "1.0.1",
        "contentHash": "0123456789ab",
    }


def _write_image(root: Path, *, data: bytes = b"image-bytes") -> Path:
    """Write a fake published image and its sidecar, returning the image path."""

    root.mkdir(parents=True, exist_ok=True)
    image = root / IMAGE_NAME
    image.write_bytes(data)
    (root / SIDECAR_NAME).write_text(json.dumps(_sidecar()))
    return image


def test_package_writes_zip(tmp_path):
    image = _write_image(tmp_path / "source")
    output = tmp_path / "out.firmware.zip"

    result = runner.invoke(
        app, ["firmware", "package", str(image), "-o", str(output)]
    )

    assert result.exit_code == 0
    assert output.is_file()


def test_fw_alias_invokes_package(tmp_path):
    image = _write_image(tmp_path / "source")
    output = tmp_path / "out.firmware.zip"

    result = runner.invoke(app, ["fw", "package", str(image), "-o", str(output)])

    assert result.exit_code == 0
    assert output.is_file()


def test_import_installs_and_dedupes(tmp_path):
    package = package_firmware_image(_write_image(tmp_path / "source"))
    publish = tmp_path / "publish"

    first = runner.invoke(
        app, ["firmware", "import", str(package), "--firmware-dir", str(publish)]
    )
    second = runner.invoke(
        app, ["firmware", "import", str(package), "--firmware-dir", str(publish)]
    )

    assert first.exit_code == 0
    assert "installed" in first.stdout
    assert second.exit_code == 0
    assert "already-present" in second.stdout


def test_import_exists_requires_force(tmp_path):
    publish = tmp_path / "publish"
    publish.mkdir()
    package_a = package_firmware_image(_write_image(tmp_path / "a", data=b"first"))
    runner.invoke(app, ["firmware", "import", str(package_a), "--firmware-dir", str(publish)])

    package_b = package_firmware_image(_write_image(tmp_path / "b", data=b"second"))
    refused = runner.invoke(
        app, ["firmware", "import", str(package_b), "--firmware-dir", str(publish)]
    )
    forced = runner.invoke(
        app, ["firmware", "import", str(package_b), "--firmware-dir", str(publish), "--force"]
    )

    assert refused.exit_code == 2
    assert "firmware-import-exists" in refused.output
    assert forced.exit_code == 0
    assert "installed" in forced.stdout


def test_export_resolves_by_version(tmp_path):
    publish = tmp_path / "publish"
    publish.mkdir()
    package = package_firmware_image(_write_image(tmp_path / "source"))
    runner.invoke(app, ["firmware", "import", str(package), "--firmware-dir", str(publish)])

    output = tmp_path / "exported.firmware.zip"
    result = runner.invoke(
        app,
        ["firmware", "export", "1.0.1", "--firmware-dir", str(publish), "-o", str(output)],
    )

    assert result.exit_code == 0
    assert output.is_file()


def test_export_missing_version_reports_hint(tmp_path):
    result = runner.invoke(
        app, ["firmware", "export", "9.9.9", "--firmware-dir", str(tmp_path / "empty")]
    )

    assert result.exit_code == 2
    assert "No published image matches version" in result.output


def test_list_json_matches_inventory_shape(tmp_path):
    publish = tmp_path / "publish"
    publish.mkdir()
    package = package_firmware_image(_write_image(tmp_path / "source"))
    runner.invoke(app, ["firmware", "import", str(package), "--firmware-dir", str(publish)])

    result = runner.invoke(app, ["firmware", "list", "--json", "--firmware-dir", str(publish)])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["schemaVersion"] == 2
    assert len(payload["entries"]) == 1
    assert payload["entries"][0]["boardId"] == "esp32"


class _FileHandler(http.server.BaseHTTPRequestHandler):
    """Serve a fixed payload over loopback for ``--url`` tests."""

    payload: bytes = b""

    def do_GET(self) -> None:  # noqa: N802
        self.send_response(200)
        self.send_header("Content-Length", str(len(self.payload)))
        self.end_headers()
        self.wfile.write(self.payload)

    def log_message(self, *args: object) -> None:
        pass


def _serve_once(payload: bytes) -> tuple[threading.Thread, int]:
    """Start a loopback server serving *payload* and return ``(thread, port)``."""

    _FileHandler.payload = payload
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _FileHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return thread, server.server_port


def test_export_output_dir_writes_the_derived_name(tmp_path):
    publish = tmp_path / "publish"
    publish.mkdir()
    package = package_firmware_image(_write_image(tmp_path / "source"))
    runner.invoke(app, ["firmware", "import", str(package), "--firmware-dir", str(publish)])

    out_dir = tmp_path / "out"
    out_dir.mkdir()
    result = runner.invoke(
        app,
        [
            "firmware", "export", "1.0.1", "--firmware-dir", str(publish),
            "--output-dir", str(out_dir),
        ],
    )

    assert result.exit_code == 0
    assert (out_dir / f"{IMAGE_NAME[:-4]}.firmware.zip").is_file()


def test_export_output_dir_refuses_existing_without_force(tmp_path):
    publish = tmp_path / "publish"
    publish.mkdir()
    package = package_firmware_image(_write_image(tmp_path / "source"))
    runner.invoke(app, ["firmware", "import", str(package), "--firmware-dir", str(publish)])

    out_dir = tmp_path / "out"
    out_dir.mkdir()
    runner.invoke(
        app,
        [
            "firmware", "export", "1.0.1", "--firmware-dir", str(publish),
            "--output-dir", str(out_dir),
        ],
    )
    refused = runner.invoke(
        app,
        [
            "firmware", "export", "1.0.1", "--firmware-dir", str(publish),
            "--output-dir", str(out_dir),
        ],
    )
    forced = runner.invoke(
        app,
        [
            "firmware", "export", "1.0.1", "--firmware-dir", str(publish),
            "--output-dir", str(out_dir), "--force",
        ],
    )

    assert refused.exit_code == 2
    assert "firmware-export-exists" in refused.output
    assert forced.exit_code == 0


def test_export_rejects_output_and_output_dir_together(tmp_path):
    result = runner.invoke(
        app,
        [
            "firmware",
            "export",
            "1.0.1",
            "--firmware-dir",
            str(tmp_path / "empty"),
            "-o",
            str(tmp_path / "a.zip"),
            "--output-dir",
            str(tmp_path / "out"),
        ],
    )

    assert result.exit_code == 2
    assert "either --output or --output-dir" in result.output


def test_import_from_url(tmp_path):
    package = package_firmware_image(_write_image(tmp_path / "source"))
    thread, port = _serve_once(package.read_bytes())
    publish = tmp_path / "publish"

    result = runner.invoke(
        app,
        [
            "firmware", "import", "--url", f"http://127.0.0.1:{port}/p.firmware.zip",
            "--firmware-dir", str(publish),
        ],
    )

    assert result.exit_code == 0
    assert "installed" in result.stdout


def test_import_file_url_is_invalid(tmp_path):
    result = runner.invoke(
        app,
        [
            "firmware", "import", "--url", "file:///etc/passwd",
            "--firmware-dir", str(tmp_path / "publish"),
        ],
    )

    assert result.exit_code == 1
    assert "archive-url-invalid" in result.output


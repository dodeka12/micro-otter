"""Tests for ``micro-otter addons list|install|uninstall|validate``."""

from __future__ import annotations

import http.server
import json
import threading
import zipfile
from pathlib import Path

import pytest
from typer.testing import CliRunner

from micro_otter.cli import app
from micro_otter.cli.addons import _device_root
from micro_otter.config import load_config
from micro_otter.tools.addon_store import addon_inventory_payload

runner = CliRunner()

FIXTURE_ARCHIVE = Path(__file__).resolve().parent / "fixtures" / "addons" / "sample_addon.zip"
"""Checked-in add-on archive used by the happy-path tests."""


@pytest.fixture(autouse=True)
def _isolated_addons_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point every command at a throwaway home and addons root.

    The working directory stays inside the checkout, because the built-in package ids
    (used by the install guard) are read from the resolved workspace.
    """

    addons_root = tmp_path / "addons"
    monkeypatch.setenv("MICRO_OTTER_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("MICRO_OTTER_ADDONS_DIR", str(addons_root))
    monkeypatch.delenv("MICRO_OTTER_CONFIG", raising=False)
    return addons_root


def _invoke(*args: str) -> tuple[int, str, str]:
    """Run the CLI with *args* and return ``(exit_code, stdout, stderr)``."""

    result = runner.invoke(app, list(args))
    return result.exit_code, result.stdout, result.stderr


def test_list_reports_an_empty_root(tmp_path: Path) -> None:
    exit_code, stdout, _stderr = _invoke("addons", "list")

    assert exit_code == 0
    assert "No add-ons installed" in stdout

    exit_code, stdout, _stderr = _invoke("addons", "list", "--json-output")

    assert exit_code == 0
    assert json.loads(stdout) == {"addons": [], "conflicts": [], "warnings": []}


def test_install_then_list_shows_addon_provenance() -> None:
    exit_code, stdout, stderr = _invoke("addons", "install", str(FIXTURE_ARCHIVE))

    assert exit_code == 0, stderr
    assert "Installed sample_addon" in stdout

    exit_code, stdout, _stderr = _invoke("addons", "list", "--json-output")

    payload = json.loads(stdout)
    assert exit_code == 0
    assert [row["id"] for row in payload["addons"]] == ["sample_addon"]
    assert payload["addons"][0]["provenance"] == "addon"
    assert payload["addons"][0]["version"] == "1.0.0"
    assert payload["addons"][0]["installedAt"]


def test_install_twice_fails_and_force_replaces() -> None:
    assert _invoke("addons", "install", str(FIXTURE_ARCHIVE))[0] == 0

    exit_code, _stdout, stderr = _invoke("addons", "install", str(FIXTURE_ARCHIVE))

    assert exit_code == 1
    assert "addon-already-installed" in stderr
    assert "hint:" in stderr

    exit_code, stdout, stderr = _invoke("addons", "install", "--force", str(FIXTURE_ARCHIVE))

    assert exit_code == 0, stderr
    assert "Replaced sample_addon" in stdout


def test_uninstall_removes_the_package_and_reports_payload() -> None:
    assert _invoke("addons", "install", str(FIXTURE_ARCHIVE))[0] == 0

    exit_code, stdout, stderr = _invoke("addons", "uninstall", "sample_addon")

    assert exit_code == 0, stderr
    assert "Removed sample_addon" in stdout

    exit_code, stdout, _stderr = _invoke("addons", "list", "--json-output")
    assert json.loads(stdout)["addons"] == []


def test_uninstall_unknown_id_lists_installed_ids() -> None:
    assert _invoke("addons", "install", str(FIXTURE_ARCHIVE))[0] == 0

    exit_code, _stdout, stderr = _invoke("addons", "uninstall", "ghost_pkg")

    assert exit_code == 1
    assert "addon-not-installed" in stderr
    assert "sample_addon" in stderr


def test_validate_creates_nothing(_isolated_addons_root: Path) -> None:
    exit_code, stdout, stderr = _invoke("addons", "validate", str(FIXTURE_ARCHIVE))

    assert exit_code == 0, stderr
    assert "sample_addon 1.0.0 is a valid add-on package" in stdout
    assert not _isolated_addons_root.exists()


def test_validate_reports_the_error_code(tmp_path: Path) -> None:
    bad = tmp_path / "bad.zip"
    bad.write_text("not a zip file", encoding="utf-8")

    exit_code, _stdout, stderr = _invoke("addons", "validate", str(bad))

    assert exit_code == 1
    assert "addon-archive-invalid" in stderr


def test_install_missing_archive_reports_not_found(tmp_path: Path) -> None:
    exit_code, _stdout, stderr = _invoke("addons", "install", str(tmp_path / "nope.zip"))

    assert exit_code == 1
    assert "archive-path-invalid" in stderr


def test_install_rejects_a_builtin_id(tmp_path: Path) -> None:
    package_dir = tmp_path / "build" / "core"
    (package_dir / "moa_core").mkdir(parents=True)
    (package_dir / "moa_core" / "__init__.py").write_text("# stub\n", encoding="utf-8")
    (package_dir / "manifest.json").write_text(
        json.dumps(
            {
                "id": "core",
                "version": "9.9.9",
                "mpAssets": {"*": ["moa_core/__init__.py"]},
            }
        ),
        encoding="utf-8",
    )

    exit_code, _stdout, stderr = _invoke("addons", "install", str(package_dir))

    assert exit_code == 1
    assert "addon-id-conflicts-builtin" in stderr


def test_json_output_payload_for_install_and_uninstall() -> None:
    exit_code, stdout, stderr = _invoke("addons", "install", str(FIXTURE_ARCHIVE), "--json-output")

    assert exit_code == 0, stderr
    payload = json.loads(stdout)
    assert payload["id"] == "sample_addon"
    assert payload["replaced"] is False
    assert payload["archiveSha256"]

    exit_code, stdout, stderr = _invoke("addons", "uninstall", "sample_addon", "--json-output")

    assert exit_code == 0, stderr
    assert json.loads(stdout) == {"id": "sample_addon", "version": "1.0.0", "removed": True}


def _write_variant_package(tmp_path: Path) -> Path:
    """Create a single-manifest ``pulse`` add-on directory and return it."""

    package_dir = tmp_path / "pulse"
    for relative in ("moa_pulse/__init__.py", "moa_pulse_viper/__init__.py"):
        target = package_dir / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("# stub\n", encoding="utf-8")
    (package_dir / "manifest.json").write_text(
        json.dumps(
            {
                "id": "pulse",
                "version": "1.0.0",
                "manifestVersion": 2,
                "variants": {
                    "py": {"mpAssets": {"*": ["moa_pulse/__init__.py"]}},
                    "viper": {
                        "requiredCapabilities": ["viper"],
                        "hardware": {"en": "ESP32", "de": "ESP32"},
                        "precedence": 10,
                        "mpAssets": {"*": ["moa_pulse_viper/__init__.py"]},
                    },
                },
            }
        ),
        encoding="utf-8",
    )
    return package_dir


def test_list_json_includes_variants_and_module_roots(tmp_path: Path) -> None:
    assert _invoke("addons", "install", str(_write_variant_package(tmp_path)))[0] == 0

    exit_code, stdout, _stderr = _invoke("addons", "list", "--json-output")

    assert exit_code == 0
    (row,) = json.loads(stdout)["addons"]
    assert row["variants"] == ["py", "viper"]
    assert row["moduleRoots"] == ["moa_pulse", "moa_pulse_viper"]


def test_validate_prints_variants(tmp_path: Path) -> None:
    exit_code, stdout, stderr = _invoke("addons", "validate", str(_write_variant_package(tmp_path)))

    assert exit_code == 0, stderr
    assert "pulse 1.0.0 is a valid add-on package (2 variant(s))" in stdout


def test_list_warns_on_contract_violation(_isolated_addons_root: Path) -> None:
    package_dir = _isolated_addons_root / "bad_pkg"
    (package_dir / "otter_bad_pkg").mkdir(parents=True)
    (package_dir / "otter_bad_pkg" / "__init__.py").write_text("# stub\n", encoding="utf-8")
    (package_dir / "manifest.json").write_text(
        json.dumps(
            {
                "id": "bad_pkg",
                "version": "1.0.0",
                "manifestVersion": 2,
                "variants": {"py": {"mpAssets": {"*": ["otter_bad_pkg/__init__.py"]}}},
            }
        ),
        encoding="utf-8",
    )

    exit_code, _stdout, stderr = _invoke("addons", "list")

    assert exit_code == 0
    assert "bad_pkg:" in stderr
    assert "moa_bad_pkg" in stderr


def test_list_json_output_is_the_shared_inventory_payload() -> None:
    """The CLI and the Firmware tab's add-on jobs must not drift to two shapes."""

    assert _invoke("addons", "install", str(FIXTURE_ARCHIVE))[0] == 0

    exit_code, stdout, _stderr = _invoke("addons", "list", "--json-output")
    config = load_config()
    expected = json.dumps(
        addon_inventory_payload(_device_root(config), config.addons_dir), indent=2
    )

    assert exit_code == 0
    assert stdout.strip() == expected


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


def test_package_writes_a_reproducible_archive(tmp_path: Path) -> None:
    package_dir = tmp_path / "my_nodes"
    (package_dir / "moa_my_nodes").mkdir(parents=True)
    (package_dir / "manifest.json").write_text(
        json.dumps({
            'id': 'my_nodes',
            'version': '1.0.0',
            'manifestVersion': 2,
            'variants': {'py': {'mpAssets': {'*': ['moa_my_nodes/__init__.py']}}},
        }),
        encoding="utf-8",
    )
    (package_dir / "moa_my_nodes" / "__init__.py").write_text("")

    exit_code, stdout, _stderr = _invoke("addons", "package", str(package_dir))

    assert exit_code == 0
    assert "Wrote " in stdout
    assert "sha256: " in stdout
    archive = package_dir.parent / "my_nodes.zip"
    assert archive.is_file()
    with zipfile.ZipFile(archive) as handle:
        assert all(name.startswith("my_nodes/") for name in handle.namelist())


def test_package_output_installs_without_as(tmp_path: Path) -> None:
    package_dir = tmp_path / "my_nodes"
    (package_dir / "moa_my_nodes").mkdir(parents=True)
    (package_dir / "manifest.json").write_text(
        json.dumps({
            'id': 'my_nodes',
            'version': '1.0.0',
            'manifestVersion': 2,
            'variants': {'py': {'mpAssets': {'*': ['moa_my_nodes/__init__.py']}}},
        }),
        encoding="utf-8",
    )
    (package_dir / "moa_my_nodes" / "__init__.py").write_text("")

    assert _invoke("addons", "package", str(package_dir))[0] == 0
    archive = package_dir.parent / "my_nodes.zip"

    exit_code, stdout, stderr = _invoke("addons", "install", str(archive))

    assert exit_code == 0, stderr
    assert "Installed my_nodes" in stdout


def test_package_refuses_an_existing_archive_without_force(tmp_path: Path) -> None:
    package_dir = tmp_path / "my_nodes"
    (package_dir / "moa_my_nodes").mkdir(parents=True)
    (package_dir / "manifest.json").write_text(
        json.dumps({
            'id': 'my_nodes',
            'version': '1.0.0',
            'manifestVersion': 2,
            'variants': {'py': {'mpAssets': {'*': ['moa_my_nodes/__init__.py']}}},
        }),
        encoding="utf-8",
    )
    (package_dir / "moa_my_nodes" / "__init__.py").write_text("")

    assert _invoke("addons", "package", str(package_dir))[0] == 0
    exit_code, _stdout, stderr = _invoke("addons", "package", str(package_dir))

    assert exit_code == 1
    assert "already exists" in stderr


def test_package_refuses_a_tree_without_manifest(tmp_path: Path) -> None:
    plain = tmp_path / "plain"
    plain.mkdir()

    exit_code, _stdout, stderr = _invoke("addons", "package", str(plain))

    assert exit_code == 1
    assert "addon-archive-no-manifest" in stderr


def test_install_url_installs(tmp_path: Path) -> None:
    thread, port = _serve_once(FIXTURE_ARCHIVE.read_bytes())

    exit_code, stdout, _stderr = _invoke(
        "addons", "install", "--url", f"http://127.0.0.1:{port}/addon.zip"
    )

    assert exit_code == 0
    assert "Installed sample_addon" in stdout


def test_install_url_and_path_together_exit_2(tmp_path: Path) -> None:
    exit_code, _stdout, stderr = _invoke(
        "addons", "install", str(FIXTURE_ARCHIVE), "--url", "https://x/a.zip"
    )

    assert exit_code == 2
    assert "either a source path or --url" in stderr


def test_install_public_http_url_is_blocked(tmp_path: Path) -> None:
    exit_code, _stdout, stderr = _invoke("addons", "install", "--url", "http://example.com/a.zip")

    assert exit_code == 1
    assert "archive-url-blocked" in stderr

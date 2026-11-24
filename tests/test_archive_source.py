"""Tests for :mod:`micro_otter.tools.archive_source`."""

from __future__ import annotations

import hashlib
import http.server
import shutil
import socket
import threading
import zipfile
from pathlib import Path

import pytest

from micro_otter.tools.addon_archive import install_addon, validate_addon_source
from micro_otter.tools.archive_source import (
    ArchiveSourceError,
    download_archive,
    package_addon_source,
    resolve_archive_source,
)

BUILTIN_IDS = ("core", "led")
"""Built-in ids the install guard protects, matching the add-on test suite."""

FIXTURE_PACKAGE_DIR = (
    Path(__file__).resolve().parent / "fixtures" / "addons" / "sample_addon"
)
"""Checked-in valid add-on package directory."""


class _PayloadHandler(http.server.BaseHTTPRequestHandler):
    """Serve a fixed payload and a configurable redirect map."""

    payload: bytes = b""
    redirects: dict[str, tuple[int, str]] = {}

    def do_GET(self) -> None:  # noqa: N802 - http.server callback
        """Answer with a redirect when mapped, else the fixed payload."""

        if self.path in self.redirects:
            status, location = self.redirects[self.path]
            self.send_response(status)
            self.send_header("Location", location)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Length", str(len(self.payload)))
        self.end_headers()
        self.wfile.write(self.payload)

    def log_message(self, *args: object) -> None:  # noqa: D401
        """Suppress request logging during tests."""


@pytest.fixture
def http_server() -> http.server.ThreadingHTTPServer:
    """Start a loopback HTTP server on an ephemeral port and shut it down after."""

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _PayloadHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()


def _write_zip(path: Path, size: int = 1) -> Path:
    """Write a ``.zip`` archive of *size* bytes at *path* and return it."""

    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("payload.bin", b"x" * size)
    return path


def _sha256(path: Path) -> str:
    """Return the hex SHA-256 of the file at *path*."""

    return hashlib.sha256(path.read_bytes()).hexdigest()


class TestResolveLocalArchive:
    """Path-branch behaviour of the resolver."""

    def test_real_zip_resolves_to_absolute_path(self, tmp_path: Path) -> None:
        """A real ``.zip`` resolves to its absolute path and stays owned by the caller."""

        archive = _write_zip(tmp_path / "pkg.zip")
        with resolve_archive_source(
            path=str(archive), url=None, max_bytes=1024, label="addon"
        ) as resolved:
            assert resolved == archive.resolve()
        assert archive.exists()

    def test_url_resolution_removes_the_temp_file(self, http_server, tmp_path: Path) -> None:
        """A URL resolution yields a temp file that is gone after the block."""

        _PayloadHandler.payload = b"zip-bytes"
        url = f"http://127.0.0.1:{http_server.server_port}/pkg.zip"
        with resolve_archive_source(
            path=None, url=url, max_bytes=1024, label="addon"
        ) as resolved:
            assert resolved.read_bytes() == b"zip-bytes"
        assert not resolved.exists()

    def test_both_and_neither_raise_value_error(self, tmp_path: Path) -> None:
        """Exactly one of path/url is required; the module raises ``ValueError``."""

        with pytest.raises(ValueError):
            with resolve_archive_source(path=None, url=None, max_bytes=1024, label="addon"):
                pass
        with pytest.raises(ValueError):
            with resolve_archive_source(
                path="/tmp/a.zip", url="https://x/y.zip", max_bytes=1024, label="addon"
            ):
                pass

    def test_failing_download_leaves_no_temp_file(self, tmp_path: Path) -> None:
        """A refused URL leaves no ``mo-addon-*`` file behind."""

        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            closed_port = probe.getsockname()[1]
        with pytest.raises(ArchiveSourceError) as exc:
            with resolve_archive_source(
                path=None,
                url=f"http://127.0.0.1:{closed_port}/x.zip",
                max_bytes=1024,
                label="addon",
            ):
                pass
        assert exc.value.code == "archive-url-unreachable"


class TestLocalArchiveErrors:
    """The path policy's error codes."""

    def test_missing_directory_and_wrong_suffix(self, tmp_path: Path) -> None:
        """A missing path, a directory, and a non-``.zip`` all refuse with the path code."""

        directory = tmp_path / "pkg"
        directory.mkdir()
        _write_zip(tmp_path / "pkg.tar.gz")
        for target in ("/no/such/file.zip", str(directory), str(tmp_path / "pkg.tar.gz")):
            with pytest.raises(ArchiveSourceError) as exc:
                with resolve_archive_source(
                    path=target, url=None, max_bytes=1024, label="addon"
                ):
                    pass
            assert exc.value.code == "archive-path-invalid"

    def test_oversized_file_reports_the_cap(self, tmp_path: Path) -> None:
        """A file one byte above the cap raises ``archive-too-large`` with the cap."""

        archive = _write_zip(tmp_path / "pkg.zip", size=11)
        with pytest.raises(ArchiveSourceError) as exc:
            with resolve_archive_source(
                path=str(archive), url=None, max_bytes=10, label="firmware package"
            ):
                pass
        assert exc.value.code == "archive-too-large"
        assert "10-byte cap" in str(exc.value)
        assert exc.value.hint


class TestSuffixPolicy:
    """The caller-chosen suffix policy (``.zip`` default, ``.bin`` for a raw image)."""

    def test_default_suffixes_still_resolve_a_zip(self, tmp_path: Path) -> None:
        """An existing ``.zip`` resolves with the default suffixes, unchanged."""

        archive = _write_zip(tmp_path / "pkg.zip")
        with resolve_archive_source(
            path=str(archive), url=None, max_bytes=1024, label="addon"
        ) as resolved:
            assert resolved == archive.resolve()

    def test_bin_path_resolves_with_bin_suffixes(self, tmp_path: Path) -> None:
        """A ``.bin`` path resolves when ``suffixes=(\".bin\",)`` is requested."""

        image = tmp_path / "esp32.bin"
        image.write_bytes(b"\x00" * 8)
        with resolve_archive_source(
            path=str(image), url=None, max_bytes=1024, label="firmware image", suffixes=(".bin",)
        ) as resolved:
            assert resolved == image.resolve()

    def test_bin_path_is_refused_with_the_default(self, tmp_path: Path) -> None:
        """A ``.bin`` path is refused with the default ``.zip`` suffixes."""

        image = tmp_path / "esp32.bin"
        image.write_bytes(b"\x00" * 8)
        with pytest.raises(ArchiveSourceError) as exc:
            with resolve_archive_source(
                path=str(image), url=None, max_bytes=1024, label="firmware image"
            ):
                pass
        assert exc.value.code == "archive-path-invalid"

    def test_firmware_zip_is_refused_when_only_bin_is_accepted(self, tmp_path: Path) -> None:
        """A ``.firmware.zip`` path is refused under ``suffixes=(\".bin\",)``."""

        package = tmp_path / "app.firmware.zip"
        package.write_bytes(b"\x00" * 8)
        with pytest.raises(ArchiveSourceError) as exc:
            with resolve_archive_source(
                path=str(package), url=None, max_bytes=1024, label="firmware image",
                suffixes=(".bin",)
            ):
                pass
        assert exc.value.code == "archive-path-invalid"

    def test_empty_and_dotless_suffixes_raise_value_error(self, tmp_path: Path) -> None:
        """An empty suffix list or a suffix without a leading dot is a programming error."""

        archive = _write_zip(tmp_path / "pkg.zip")
        with pytest.raises(ValueError):
            with resolve_archive_source(
                path=str(archive), url=None, max_bytes=1024, label="addon", suffixes=()
            ):
                pass
        with pytest.raises(ValueError):
            with resolve_archive_source(
                path=str(archive), url=None, max_bytes=1024, label="addon", suffixes=("zip",)
            ):
                pass

    def test_url_branch_uses_the_first_suffix_for_the_temp_file(
        self, http_server, tmp_path: Path
    ) -> None:
        """A URL download under ``suffixes=(\".bin\",)`` lands in a ``.bin`` temp file."""

        _PayloadHandler.payload = b"\x00\x01\x02"
        url = f"http://127.0.0.1:{http_server.server_port}/esp32.bin"
        with resolve_archive_source(
            path=None, url=url, max_bytes=1024, label="firmware image", suffixes=(".bin",)
        ) as resolved:
            assert resolved.suffix == ".bin"
            assert resolved.read_bytes() == b"\x00\x01\x02"
        assert not resolved.exists()



class TestDownloadArchive:
    """The URL policy, against a loopback HTTP server."""

    def test_success_writes_exact_bytes(self, http_server, tmp_path: Path) -> None:
        """A loopback download writes the exact bytes and returns the size."""

        _PayloadHandler.payload = b"hello-archive"
        url = f"http://127.0.0.1:{http_server.server_port}/pkg.zip"
        destination = tmp_path / "out.zip"
        assert download_archive(url, destination, max_bytes=1024) == len(b"hello-archive")
        assert destination.read_bytes() == b"hello-archive"

    def test_non_loopback_http_is_blocked(self) -> None:
        """Plain http towards a public host is refused before any request is made."""

        with pytest.raises(ArchiveSourceError) as exc:
            download_archive("http://example.com/x.zip", Path("/tmp/o"), max_bytes=1)
        assert exc.value.code == "archive-url-blocked"

    def test_file_scheme_is_invalid(self) -> None:
        """A ``file:`` URL is refused with ``archive-url-invalid``."""

        with pytest.raises(ArchiveSourceError) as exc:
            download_archive("file:///etc/passwd", Path("/tmp/o"), max_bytes=1)
        assert exc.value.code == "archive-url-invalid"

    def test_three_hop_redirect_is_followed(self, http_server, tmp_path: Path) -> None:
        """A three-hop redirect chain reaches the final payload."""

        _PayloadHandler.payload = b"final"
        _PayloadHandler.redirects = {
            "/a": (302, "/b"),
            "/b": (302, "/c"),
            "/c": (302, "/d"),
        }
        url = f"http://127.0.0.1:{http_server.server_port}/a"
        destination = tmp_path / "out.zip"
        assert download_archive(url, destination, max_bytes=1024) == len(b"final")
        assert destination.read_bytes() == b"final"

    def test_fourth_hop_raises_redirect(self, http_server, tmp_path: Path) -> None:
        """A fourth redirect hop is refused with ``archive-url-redirect``."""

        _PayloadHandler.payload = b"final"
        _PayloadHandler.redirects = {
            "/a": (302, "/b"),
            "/b": (302, "/c"),
            "/c": (302, "/d"),
            "/d": (302, "/e"),
        }
        url = f"http://127.0.0.1:{http_server.server_port}/a"
        with pytest.raises(ArchiveSourceError) as exc:
            download_archive(url, tmp_path / "out.zip", max_bytes=1024)
        assert exc.value.code == "archive-url-redirect"

    def test_redirect_to_public_http_is_blocked(self, http_server, tmp_path: Path) -> None:
        """A hop to public http is refused even though the first hop was loopback."""

        _PayloadHandler.redirects = {"/a": (302, "http://example.com/x.zip")}
        url = f"http://127.0.0.1:{http_server.server_port}/a"
        with pytest.raises(ArchiveSourceError) as exc:
            download_archive(url, tmp_path / "out.zip", max_bytes=1024)
        assert exc.value.code == "archive-url-blocked"

    def test_body_over_cap_aborts_without_partial_file(
        self, http_server, tmp_path: Path
    ) -> None:
        """A body one chunk over the cap raises and leaves no partial file."""

        _PayloadHandler.payload = b"x" * (64 * 1024 + 1)
        url = f"http://127.0.0.1:{http_server.server_port}/big.zip"
        destination = tmp_path / "out.zip"
        with pytest.raises(ArchiveSourceError) as exc:
            download_archive(url, destination, max_bytes=64 * 1024)
        assert exc.value.code == "archive-url-too-large"
        assert not destination.exists()

    def test_closed_port_raises_unreachable(self, tmp_path: Path) -> None:
        """A connection to a closed port maps to ``archive-url-unreachable``."""

        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            closed_port = probe.getsockname()[1]
        with pytest.raises(ArchiveSourceError) as exc:
            download_archive(
                f"http://127.0.0.1:{closed_port}/x.zip",
                tmp_path / "out.zip",
                max_bytes=1024,
            )
        assert exc.value.code == "archive-url-unreachable"



class TestPackageAddonSource:
    """Reproducible directory→zip packaging."""

    def test_two_runs_are_byte_identical(self, tmp_path: Path) -> None:
        """Packaging the same tree twice produces identical bytes."""

        first = package_addon_source(FIXTURE_PACKAGE_DIR, tmp_path / "a.zip")
        second = package_addon_source(FIXTURE_PACKAGE_DIR, tmp_path / "b.zip")
        assert _sha256(first) == _sha256(second)

    def test_members_are_relative_posix_sorted(self, tmp_path: Path) -> None:
        """Member names are the relative POSIX paths under the package folder."""

        archive = package_addon_source(FIXTURE_PACKAGE_DIR, tmp_path / "pkg.zip")
        with zipfile.ZipFile(archive) as handle:
            names = handle.namelist()
        prefix = f"{FIXTURE_PACKAGE_DIR.name}/"
        assert names == sorted(names)
        assert all(Path(name).as_posix() == name for name in names)
        assert all(name.startswith(prefix) for name in names)
        assert f"{prefix}manifest.json" in names
        assert "manifest.json" not in names

    def test_missing_manifest_refuses(self, tmp_path: Path) -> None:
        """A directory without ``manifest.json`` raises ``archive-path-invalid``."""

        plain = tmp_path / "plain"
        plain.mkdir()
        (plain / "file.txt").write_text("hi")
        with pytest.raises(ArchiveSourceError) as exc:
            package_addon_source(plain)
        assert exc.value.code == "archive-path-invalid"

    def test_existing_destination_needs_force(self, tmp_path: Path) -> None:
        """An existing destination raises ``FileExistsError`` unless forced."""

        destination = tmp_path / "pkg.zip"
        package_addon_source(FIXTURE_PACKAGE_DIR, destination)
        with pytest.raises(FileExistsError):
            package_addon_source(FIXTURE_PACKAGE_DIR, destination)
        package_addon_source(FIXTURE_PACKAGE_DIR, destination, force=True)

    def test_produced_archive_validates(self, tmp_path: Path) -> None:
        """The produced archive is accepted by ``validate_addon_source`` without ``--as``."""

        archive = package_addon_source(FIXTURE_PACKAGE_DIR, tmp_path / "pkg.zip")
        manifest = validate_addon_source(archive, builtin_ids=BUILTIN_IDS)
        assert manifest.id == "sample_addon"

    def test_produced_archive_installs_without_as(self, tmp_path: Path) -> None:
        """The produced archive installs with the same call the WebSocket frame makes."""

        archive = package_addon_source(FIXTURE_PACKAGE_DIR, tmp_path / "pkg.zip")
        addons_root = tmp_path / "addons"

        result = install_addon(archive, addons_root=addons_root, builtin_ids=BUILTIN_IDS)

        assert result.id == "sample_addon"
        assert (addons_root / "sample_addon" / "manifest.json").is_file()

    def test_produced_archive_mirrors_the_fixture_layout(self, tmp_path: Path) -> None:
        """The archive holds every fixture file under ``<folder>/`` exactly once."""

        archive = package_addon_source(FIXTURE_PACKAGE_DIR, tmp_path / "pkg.zip")
        prefix = f"{FIXTURE_PACKAGE_DIR.name}/"
        expected = [
            f"{prefix}{path.relative_to(FIXTURE_PACKAGE_DIR).as_posix()}"
            for path in sorted(FIXTURE_PACKAGE_DIR.rglob("*"))
            if path.is_file()
        ]
        with zipfile.ZipFile(archive) as handle:
            assert handle.namelist() == expected

    def test_packaging_skips_editor_and_os_caches(self, tmp_path: Path) -> None:
        """``.DS_Store``, ``Thumbs.db``, and ``__pycache__`` are not packaged."""

        package_dir = tmp_path / "sample_addon"
        shutil.copytree(FIXTURE_PACKAGE_DIR, package_dir)
        (package_dir / ".DS_Store").write_text("", encoding="utf-8")
        (package_dir / "Thumbs.db").write_text("", encoding="utf-8")
        cache_dir = package_dir / "__pycache__"
        cache_dir.mkdir()
        (cache_dir / "moa_sample_addon.cpython-312.pyc").write_text("")

        archive = package_addon_source(package_dir, tmp_path / "pkg.zip")

        with zipfile.ZipFile(archive) as handle:
            names = handle.namelist()
        assert not any(
            part in {".DS_Store", "Thumbs.db", "__pycache__"}
            for name in names
            for part in Path(name).parts
        )
        manifest = validate_addon_source(archive, builtin_ids=BUILTIN_IDS)
        assert manifest.id == "sample_addon"


"""Tests for the standalone dev server's add-on discovery (:mod:`serve_nodes`)."""

from __future__ import annotations

import io
import json
from pathlib import Path

import pytest

from micro_otter.tools import serve_nodes


def _install_addon(addons_root: Path, package_id: str = "sample_addon") -> Path:
    """Create one installed add-on package and return its directory."""

    package_dir = addons_root / package_id
    package_dir.mkdir(parents=True, exist_ok=True)
    (package_dir / "manifest.json").write_text(
        json.dumps(
            {
                "id": package_id,
                "version": "1.0.0",
                "manifestVersion": 2,
                "variants": {"py": {"mpAssets": {"*": [f"moa_{package_id}/__init__.py"]}}},
            }
        ),
        encoding="utf-8",
    )
    module_dir = package_dir / f"moa_{package_id}"
    module_dir.mkdir(parents=True, exist_ok=True)
    (module_dir / "__init__.py").write_text("# addon\n", encoding="utf-8")
    return package_dir


class _RecordingHandler(serve_nodes.MyHTTPRequestHandler):
    """Handler that records the response instead of writing to a socket."""

    def __init__(self, path: str, headers: dict[str, str] | None = None) -> None:
        self.path = path
        self.headers = headers or {}
        self.wfile = io.BytesIO()
        self.status: int | None = None
        self.response_headers: list[tuple[str, str]] = []

    def send_response(self, code, message=None):  # noqa: D102 - stdlib override
        self.status = code

    def send_header(self, keyword, value):  # noqa: D102 - stdlib override
        self.response_headers.append((keyword, value))

    def end_headers(self):  # noqa: D102 - stdlib override
        return None

    def log_message(self, *args):  # noqa: D102 - stdlib override
        return None

    def header(self, name: str) -> str | None:
        """Return the recorded response header *name*, or ``None``."""

        for keyword, value in self.response_headers:
            if keyword.lower() == name.lower():
                return value
        return None


def _handler(path: str, *, addons_root: Path | None, headers=None) -> _RecordingHandler:
    """Return a recording handler pointed at *addons_root*."""

    handler = _RecordingHandler(path, headers)
    handler.addons_root = addons_root
    return handler


class _CacheHeaderHandler(_RecordingHandler):
    """Recording handler that runs the real ``end_headers`` cache policy."""

    def __init__(self, path: str, headers: dict[str, str] | None = None) -> None:
        super().__init__(path, headers)
        # The stdlib end_headers() appends the blank line to this buffer and writes it
        # to the wfile; both attributes are normally set up by the socket handlers.
        self.request_version = "HTTP/1.1"
        self._headers_buffer: list[bytes] = []

    end_headers = serve_nodes.MyHTTPRequestHandler.end_headers


def _cache_handler(path: str) -> _CacheHeaderHandler:
    """Return a cache-header recording handler for *path*."""

    handler = _CacheHeaderHandler(path)
    handler.addons_root = None
    handler.end_headers()
    return handler


def test_translate_path_falls_back_to_the_addons_folder(tmp_path: Path) -> None:
    package_dir = _install_addon(tmp_path / "addons")
    handler = _handler(
        "/device/node_pkgs/sample_addon/manifest.json", addons_root=tmp_path / "addons"
    )

    resolved = Path(handler.translate_path("/device/node_pkgs/sample_addon/manifest.json"))

    assert resolved == package_dir / "manifest.json"


def test_translate_path_prefers_the_builtin_file(tmp_path: Path) -> None:
    _install_addon(tmp_path / "addons", "led")
    handler = _handler("/device/node_pkgs/led/manifest.json", addons_root=tmp_path / "addons")

    resolved = Path(handler.translate_path("/device/node_pkgs/led/manifest.json"))

    assert resolved == serve_nodes.DEVICE_DIR / "node_pkgs" / "led" / "manifest.json"


def test_translate_path_without_an_addons_root_keeps_the_wheel_path() -> None:
    handler = _handler("/device/node_pkgs/sample_addon/manifest.json", addons_root=None)

    resolved = Path(handler.translate_path("/device/node_pkgs/sample_addon/manifest.json"))

    assert resolved == serve_nodes.DEVICE_DIR / "node_pkgs" / "sample_addon" / "manifest.json"


def test_do_get_serves_the_merged_index(tmp_path: Path) -> None:
    _install_addon(tmp_path / "addons")
    handler = _handler("/device/node_pkgs/index.json", addons_root=tmp_path / "addons")

    handler.do_GET()

    assert handler.status == 200
    body = json.loads(handler.wfile.getvalue())
    assert body["packages"][-1]["id"] == "sample_addon"


def test_do_get_serves_the_merged_runtime_manifest(tmp_path: Path) -> None:
    _install_addon(tmp_path / "addons")
    handler = _handler("/device/runtime/general/manifest.json", addons_root=tmp_path / "addons")

    handler.do_GET()

    assert handler.status == 200
    body = json.loads(handler.wfile.getvalue())
    assert body["nodePackages"]["addons"] == ["sample_addon"]


def test_do_head_sends_the_length_without_a_body(tmp_path: Path) -> None:
    _install_addon(tmp_path / "addons")
    handler = _handler("/device/node_pkgs/index.json", addons_root=tmp_path / "addons")

    handler.do_HEAD()

    assert handler.status == 200
    assert handler.header("Content-Length")
    assert handler.wfile.getvalue() == b""


def test_direct_navigation_to_the_index_is_still_blocked(tmp_path: Path) -> None:
    _install_addon(tmp_path / "addons")
    handler = _handler(
        "/device/node_pkgs/index.json",
        addons_root=tmp_path / "addons",
        headers={"Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document"},
    )

    handler.do_GET()

    assert handler.status == 403


def test_icon_requests_are_cacheable() -> None:
    handler = _cache_handler("/html/icons/close_24dp.svg")

    assert handler.header("Cache-Control") == serve_nodes.ICON_CACHE_CONTROL
    assert handler.header("Pragma") is None
    assert handler.header("Expires") is None
    assert "no-store" not in handler.header("Cache-Control")


def test_non_icon_requests_keep_the_no_store_rule() -> None:
    paths = (
        "/html/js/app/main.js",
        "/device/node_pkgs/index.json",
        "/html/styles/standard/view-system.css",
    )

    for path in paths:
        handler = _cache_handler(path)

        assert handler.header("Cache-Control") == serve_nodes.DEFAULT_CACHE_CONTROL, path
        assert handler.header("Pragma") == "no-cache", path
        assert handler.header("Expires") == "0", path


def test_icon_cache_policy_ignores_a_query_string() -> None:
    handler = _cache_handler("/html/icons/close_24dp.svg?v=2")

    assert handler.header("Cache-Control") == serve_nodes.ICON_CACHE_CONTROL
    assert handler.header("Pragma") is None


def test_cache_control_for_returns_none_for_other_paths() -> None:
    assert serve_nodes.cache_control_for("/html/icons/close_24dp.svg") == "public, max-age=3600"
    assert serve_nodes.cache_control_for("/html/icons/") == "public, max-age=3600"
    assert serve_nodes.cache_control_for("/html/icons/close_24dp.svg?v=2") is not None
    assert serve_nodes.cache_control_for("/html/icons-extra/x.svg") is None
    assert serve_nodes.cache_control_for("/html/js/app/main.js") is None
    assert serve_nodes.cache_control_for("/") is None


def _stale_build_layout(tmp_path: Path, *, served: str) -> Path:
    """Create a ``_dist/webapp`` build next to a package source tree.

    Args:
        tmp_path: Temporary directory standing in for the repository root's parent.
        served: Version stamped into the build's ``version.json``.

    Returns:
        The ``micro_otter`` package directory of the fake layout.
    """

    package_dir = tmp_path / "src" / "micro_otter"
    build_dir = tmp_path / "_dist" / "webapp"
    build_dir.mkdir(parents=True, exist_ok=True)
    (build_dir / "index.html").write_text("", encoding="utf-8")
    version_path = build_dir / "html" / "version.json"
    version_path.parent.mkdir(parents=True, exist_ok=True)
    version_path.write_text(json.dumps({"version": served}), encoding="utf-8")
    return package_dir


def test_stale_webapp_build_warning_names_both_versions(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    package_dir = _stale_build_layout(tmp_path, served="1.25.1.dev472")

    stale = serve_nodes.warn_if_stale_webapp_build(package_dir, package_version="1.25.1.dev640")

    assert stale == ("1.25.1.dev472", "1.25.1.dev640")
    out = capsys.readouterr().out
    assert "Stale web-app build" in out
    assert "npm run build" in out
    assert "1.25.1.dev472" in out
    assert "1.25.1.dev640" in out


def test_no_stale_webapp_build_warning_when_versions_match(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    package_dir = _stale_build_layout(tmp_path, served="1.25.1")

    assert serve_nodes.warn_if_stale_webapp_build(package_dir, package_version="1.25.1") is None
    assert capsys.readouterr().out == ""

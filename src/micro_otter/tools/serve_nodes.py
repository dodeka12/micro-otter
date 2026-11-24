#!/usr/bin/env python3
# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

"""
Simple HTTP server for testing the Micro Otter node editor.
Serves the src/nodes folder on http://localhost:8000 so static hosts
and the browser can access both the UI (under html/) and device assets.
"""

import http.server
import json
import socketserver
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlparse

from micro_otter import __version__
from micro_otter.config import load_config, resolve_firmware_publish_root
from micro_otter.tools.addon_store import (
    addon_asset_path,
    merged_index_payload,
    runtime_manifest_addons,
)
from micro_otter.tools.firmware_compile.firmware_history import load_firmware_history
from micro_otter.tools.firmware_compile.local_firmware import SYSTEM_FIRMWARE_PUBLISH_ROOT
from micro_otter.tools.firmware_compile.version_registry import (
    compose_latest_versions,
    load_latest_versions,
)
from micro_otter.tools.server_capabilities import detect_stale_static_root, resolve_static_root

# Configuration
# Loopback by default: the Typer `serve` command (`micro-otter serve`) is the supported entry point
# and binds the resolver's `host`, so this script must not silently default to "all interfaces".
HOST = "127.0.0.1"
PORT = 8000
APP_ROOT = Path(__file__).parent.parent / "nodes"
HTML_DIR = APP_ROOT / "html"
DEVICE_DIR = APP_ROOT / "device"
FAVICON_PATH = HTML_DIR / "favicon.ico"
PACKAGE_DIR = Path(__file__).parent.parent
"""The ``micro_otter`` package directory; its sibling tree holds the ``_dist`` build."""

NODE_PACKAGE_INDEX_PATH = "/device/node_pkgs/index.json"
"""Served node-package index; synthesized so installed add-ons appear in it."""

LATEST_VERSIONS_URL = "/device/firmware/latest_versions.json"
"""Served latest-versions registry; composed from committed baselines + history."""

NODE_PKGS_URL_PREFIX = "/device/node_pkgs/"
"""URL prefix whose missing files fall back to the add-ons folder."""

ICON_URL_PREFIX = "/html/icons/"
"""URL prefix whose files may be cached by the browser."""

ICON_CACHE_CONTROL = "public, max-age=3600"
"""Cache policy for icon assets: one hour, revalidated by the stdlib Last-Modified header."""

DEFAULT_CACHE_CONTROL = "no-store, no-cache, must-revalidate, max-age=0"
"""Dev-server default: never cache, so a UI asset edit shows up on the next reload."""


def cache_control_for(request_path: str) -> str | None:
    """Return the Cache-Control value for *request_path*, or None for the dev default.

    Args:
        request_path: Request path as sent by the browser, optionally with a query.

    Returns:
        The icon cache policy for a path below :data:`ICON_URL_PREFIX`, otherwise ``None``
        so the caller keeps the uncached dev default.
    """

    parsed = urlparse(request_path)
    path = unquote(parsed.path)
    if path.startswith(ICON_URL_PREFIX):
        return ICON_CACHE_CONTROL
    return None


class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    # Class variable to control whether direct access protection is enabled
    disable_protection = False

    addons_root: Path | None = None
    """Add-ons folder the handler serves from; set once by :func:`run_server`."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP_ROOT), **kwargs)

    def translate_path(self, path):
        parsed = urlparse(path)
        request_path = unquote(parsed.path)

        # Handle root path - serve index.html from APP_ROOT
        if request_path == "/" or request_path == "" or request_path == "/index.html":
            return str(APP_ROOT / "index.html")

        # Handle /device paths (device assets including runtime, targets, node packages)
        prefix = "/device"
        if request_path == prefix or request_path.startswith(f"{prefix}/"):
            relative = request_path[len(prefix) :].lstrip("/")
            safe_parts = [part for part in PurePosixPath(relative).parts if part not in ("..", ".")]
            target_path = DEVICE_DIR
            for part in safe_parts:
                target_path /= part
            if request_path.startswith(NODE_PKGS_URL_PREFIX) and not target_path.is_file():
                fallback = addon_asset_path(
                    self.addons_root, request_path[len(NODE_PKGS_URL_PREFIX) :].split("/")
                )
                if fallback is not None:
                    return str(fallback)
            return str(target_path)

        # All other paths use default behavior (serves from APP_ROOT)
        # This handles /html/styles/, /html/js/, /html/locales/, etc.
        return super().translate_path(path)

    def do_GET(self):
        if self._maybe_serve_favicon():
            return
        if self._maybe_serve_version_info():
            return
        if self._check_direct_access_blocked():
            return
        if self._maybe_serve_addon_payloads(head_only=False):
            return
        if self._maybe_serve_latest_versions(head_only=False):
            return
        super().do_GET()

    def do_HEAD(self):
        if self._maybe_serve_favicon(head_only=True):
            return
        if self._check_direct_access_blocked():
            return
        if self._maybe_serve_addon_payloads(head_only=True):
            return
        if self._maybe_serve_latest_versions(head_only=True):
            return
        super().do_HEAD()

    def _maybe_serve_addon_payloads(self, *, head_only: bool) -> bool:
        """Serve the merged index and runtime manifest instead of the files on disk.

        Both payloads are generated in memory from the shipped device tree plus the
        installed add-ons, so serving them never rewrites a checked-in file. They are
        sent *after* the direct-navigation guard, exactly like the static files they
        replace.
        """

        parsed_path = urlparse(self.path)
        request_path = parsed_path.path
        payload: dict[str, object] | None = None
        if request_path == NODE_PACKAGE_INDEX_PATH:
            payload = merged_index_payload(DEVICE_DIR, self.addons_root)
        else:
            payload = runtime_manifest_addons(DEVICE_DIR, request_path, self.addons_root)
        if payload is None:
            return False

        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not head_only:
            self.wfile.write(body)
        return True

    def _maybe_serve_latest_versions(self, *, head_only: bool) -> bool:
        """Serve the composed latest-versions registry instead of the file on disk.

        The committed ``latest_versions.json`` is a baseline only release tooling
        writes; the device app fetches the composed view (committed baselines plus
        the publish-root build history) so a freshly built image shows up without
        rewriting the source tree.
        """

        parsed_path = urlparse(self.path)
        if parsed_path.path != LATEST_VERSIONS_URL:
            return False

        committed_path = DEVICE_DIR / "firmware" / "latest_versions.json"
        try:
            committed = load_latest_versions(committed_path)
        except Exception:
            committed = {"schemaVersion": 2, "targets": {}}

        history = load_firmware_history(
            resolve_firmware_publish_root(fallback=SYSTEM_FIRMWARE_PUBLISH_ROOT)
        )
        payload = compose_latest_versions(committed, history)

        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not head_only:
            self.wfile.write(body)
        return True

    def _check_direct_access_blocked(self) -> bool:
        """
        Block direct browser navigation to protected resources.
        Allow only JavaScript requests (fetch, import, etc.) to access assets.
        Uses Sec-Fetch-* headers available in modern browsers.
        Can be disabled via --no-protection flag for testing.
        """
        # Skip protection if disabled via flag
        if self.disable_protection:
            return False

        parsed_path = urlparse(self.path)
        request_path = parsed_path.path

        # Allow index files and favicon - these are entry points
        if request_path in ("/", "", "/index.html", "/favicon.ico"):
            return False

        # Check if this is a direct browser navigation (user typing URL or clicking link)
        # Sec-Fetch-Mode: navigate means direct browser navigation
        # Sec-Fetch-Dest: document means loading as a page
        sec_fetch_mode = self.headers.get("Sec-Fetch-Mode", "")
        sec_fetch_dest = self.headers.get("Sec-Fetch-Dest", "")

        # Block if this looks like direct navigation to protected resources
        is_navigation = sec_fetch_mode == "navigate" and sec_fetch_dest == "document"

        if is_navigation:
            # Protected paths that should not be directly accessible
            protected_prefixes = ("/html/", "/device/")
            if any(request_path.startswith(prefix) for prefix in protected_prefixes):
                self.send_response(403)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                message = (
                    "<!DOCTYPE html><html><head><title>403 Forbidden</title></head>"
                    "<body><h1>403 Forbidden</h1>"
                    "<p>Direct access to this resource is not allowed.</p>"
                    "<p>Please access the application through the <a href='/'>main page</a>.</p>"
                    "</body></html>"
                )
                self.wfile.write(message.encode("utf-8"))
                return True

        return False

    def _maybe_serve_favicon(self, head_only: bool = False) -> bool:
        parsed_path = urlparse(self.path)
        if parsed_path.path != "/favicon.ico":
            return False

        if not FAVICON_PATH.exists():
            return False

        favicon_size = FAVICON_PATH.stat().st_size
        self.send_response(200)
        self.send_header("Content-Type", "image/x-icon")
        self.send_header("Content-Length", str(favicon_size))
        self.end_headers()

        if head_only:
            return True

        with open(FAVICON_PATH, "rb") as favicon_file:
            self.copyfile(favicon_file, self.wfile)
        return True

    def _maybe_serve_version_info(self) -> bool:
        parsed_path = urlparse(self.path)
        if parsed_path.path != "/api/version":
            return False

        # The package version is the only version identity (`micro_otter.__version__`):
        # `html/version.json` is a bundle build output now, so reading it back from the
        # served tree would make this endpoint report whatever bundle is on disk.
        payload = json.dumps({"version": __version__}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
        return True

    def log_message(self, format, *args):
        # Enhanced logging to debug 404 issues
        print(f"[{self.log_date_time_string()}] {format % args}")

    def end_headers(self):
        # Add CORS headers for local testing
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

        # Icon files are the only asset whose file names stay stable while the UI is
        # edited, so they may be cached: the browser still revalidates against the
        # stdlib Last-Modified header. Everything else keeps the no-store default so a
        # JS/CSS/HTML edit shows up on the next reload, which avoids confusing
        # stale-console output from an old bundle.
        cache_control = cache_control_for(self.path)
        if cache_control is None:
            self.send_header("Cache-Control", DEFAULT_CACHE_CONTROL)
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        else:
            # Pragma/Expires are the legacy spelling of no-store; sending them next to a
            # positive max-age would contradict the cache policy.
            self.send_header("Cache-Control", cache_control)

        # Ensure JSON files are served with correct content type
        if self.path.endswith(".json"):
            self.send_header("Content-Type", "application/json")
        super().end_headers()


def warn_if_stale_webapp_build(
    package_dir: Path = PACKAGE_DIR, package_version: str = __version__
) -> tuple[str, str] | None:
    """Print a console warning when the resolved static root serves a stale build.

    The dev server itself serves the source tree, but the bundled app and the serial bridge prefer
    ``_dist/webapp``. A forgotten ``npm run build`` therefore keeps an old bundle (and its old node
    package manifests) in front of the browser while the developer edits the source, which looks
    exactly like a deploy that ignores changed packages.

    Args:
        package_dir: The ``micro_otter`` package directory; defaults to :data:`PACKAGE_DIR`.
        package_version: Version of the running package; defaults to ``micro_otter.__version__``.

    Returns:
        The ``(served_version, package_version)`` pair when a stale build was found, else ``None``.
    """

    static_root = resolve_static_root(package_dir)
    stale = detect_stale_static_root(static_root, package_version)
    if stale is None:
        return None
    served_version, build_version = stale
    print(
        f"⚠️  Stale web-app build: {static_root} reports {served_version} while the package "
        f"reports {build_version}. Run `npm run build` so the served bundle matches the package."
    )
    return stale


def run_server(host: str = HOST, port: int = PORT, disable_protection: bool = False) -> None:
    """Start the dev HTTP server.

    Parameters are exposed so the CLI can override the bind address while
    keeping existing defaults for backwards compatibility.

    Args:
        host: Host/IP to bind to
        port: Port to listen on
        disable_protection: If True, allow direct browser navigation to all paths
    """

    if not APP_ROOT.exists():
        print(f"Error: node workspace not found at {APP_ROOT}")
        exit(1)

    # A stale bundle is the environment that produced the last false negative, so say so before
    # the banner instead of letting the browser compare against old package manifests.
    warn_if_stale_webapp_build()

    # Store disable_protection flag for handler to access
    MyHTTPRequestHandler.disable_protection = disable_protection
    # Resolved once per server so every request agrees on where add-ons live.
    MyHTTPRequestHandler.addons_root = load_config().addons_dir

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer((host, port), MyHTTPRequestHandler) as httpd:
        print(f"\n{'=' * 60}")
        display_host = host or "localhost"
        print(f"Server running at: http://{display_host}:{port}/")
        print(f"Serving directory: {APP_ROOT}")
        print(f"Absolute path: {APP_ROOT.absolute()}")
        if disable_protection:
            print("⚠️  Direct access protection DISABLED - all paths accessible")
        print("\nPress Ctrl+C to stop the server\n")

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n\nServer stopped.")


def main() -> None:
    run_server()


if __name__ == "__main__":
    main()

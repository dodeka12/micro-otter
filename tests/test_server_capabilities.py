"""Tests for the ``/api/server-capabilities`` payload builder.

The builder must describe the *current* environment: which build and flash
backends are installed, which features those make runnable, and nothing else. The
stub adapters below let each test state the environment explicitly instead of
depending on whether the developer machine has ESP-IDF or esptool installed.
"""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pytest

import micro_otter
from micro_otter.config import load_config
from micro_otter.tools import server_capabilities
from micro_otter.tools.firmware_compile.backends import (
    BackendStatus,
    register_backend,
    reset_registry,
)
from micro_otter.tools.firmware_compile.flash import register_flash_backend, reset_flash_registry
from micro_otter.tools.server_capabilities import (
    CAPABILITY_KEYS,
    FEATURE_FIRMWARE_COMPILE,
    FEATURE_FIRMWARE_DEPLOY,
    FEATURE_LOCAL_FILE_ACCESS,
    FEATURE_LOCAL_PACKAGE_SCAN,
    FEATURE_NODE_PACKAGE_ADDONS,
    FEATURE_SERIAL_BRIDGE,
    build_backend_descriptor,
    build_server_capabilities,
    detect_stale_static_root,
    read_app_version,
    resolve_static_root,
)


class _StubBuildBackend:
    """Minimal build backend whose availability and targets are fixed."""

    def __init__(
        self,
        backend_id: str = "stub-build",
        *,
        available: bool = True,
        targets: tuple[str, ...] = ("esp32",),
        detail: str | None = None,
    ) -> None:
        self.id = backend_id
        self._available = available
        self._targets = targets
        self._detail = detail
        self.target_calls = 0

    def status(self) -> BackendStatus:
        """Return the configured availability snapshot."""

        return BackendStatus(
            backend_id=self.id,
            available=self._available,
            version="1.2.3" if self._available else None,
            detail=self._detail,
        )

    def supported_targets(self) -> tuple[str, ...]:
        """Return the configured targets and count the probe."""

        self.target_calls += 1
        return self._targets


class _StubFlashBackend:
    """Minimal flash backend whose availability and chips are fixed."""

    def __init__(
        self,
        backend_id: str = "stub-flash",
        *,
        available: bool = True,
        chips: tuple[str, ...] = ("esp32",),
    ) -> None:
        self.id = backend_id
        self._available = available
        self._chips = chips
        self.chip_calls = 0

    def status(self) -> BackendStatus:
        """Return the configured availability snapshot."""

        return BackendStatus(
            backend_id=self.id,
            available=self._available,
            version="0.1.0" if self._available else None,
        )

    def supported_chips(self) -> tuple[str, ...]:
        """Return the configured chips and count the probe."""

        self.chip_calls += 1
        return self._chips


class _ExplodingBackend:
    """Backend whose ``status()`` raises, standing in for a broken adapter."""

    id = "broken"

    def status(self) -> BackendStatus:
        """Raise to emulate a misbehaving third-party adapter."""

        raise RuntimeError("adapter exploded")


@pytest.fixture(autouse=True)
def _isolated_registries():
    """Reset both backend registries and the serial-support cache per test."""

    reset_registry()
    reset_flash_registry()
    server_capabilities._serial_support_available.cache_clear()
    yield
    reset_registry()
    reset_flash_registry()
    server_capabilities._serial_support_available.cache_clear()


def _config(**overrides):
    """Return a resolved configuration with *overrides* applied."""

    return replace(load_config(env={}), **overrides)


def test_payload_has_contract_keys():
    """The payload carries exactly the documented keys and no schema version."""

    payload = build_server_capabilities(config=_config(), version="9.9.9")

    assert tuple(payload) == CAPABILITY_KEYS
    assert "schemaVersion" not in payload
    assert payload["serverType"] == "micro-otter"
    assert payload["version"] == "9.9.9"
    assert FEATURE_SERIAL_BRIDGE in payload["features"]
    assert FEATURE_LOCAL_PACKAGE_SCAN in payload["features"]
    assert payload["firmwareSources"] == ["local"]


def test_node_package_addons_absent_without_installed_addons(tmp_path):
    """No add-ons folder, or an empty one, means no ``node-package-addons`` feature."""

    empty_root = tmp_path / "addons"
    empty_root.mkdir()

    payload = build_server_capabilities(
        config=_config(addons_dir=tmp_path / "missing-addons"), version="1"
    )
    assert FEATURE_NODE_PACKAGE_ADDONS not in payload["features"]

    payload = build_server_capabilities(config=_config(addons_dir=empty_root), version="1")
    assert FEATURE_NODE_PACKAGE_ADDONS not in payload["features"]


def test_node_package_addons_present_after_installing_one(tmp_path):
    """One installed add-on advertises the feature, independently of the firmware flags."""

    addons_root = tmp_path / "addons"
    package_dir = addons_root / "sample_addon"
    package_dir.mkdir(parents=True)
    (package_dir / "manifest.json").write_text(
        '{"id": "sample_addon", "version": "1.0.0"}', encoding="utf-8"
    )

    payload = build_server_capabilities(
        config=_config(addons_dir=addons_root, enable_compile=False, enable_deploy=False),
        version="1",
    )

    assert FEATURE_NODE_PACKAGE_ADDONS in payload["features"]
    assert FEATURE_FIRMWARE_COMPILE not in payload["features"]
    assert FEATURE_FIRMWARE_DEPLOY not in payload["features"]


def test_local_file_access_advertised_on_loopback_host():
    """A loopback-bound server advertises ``local-file-access`` last."""

    payload = build_server_capabilities(config=_config(host="127.0.0.1"), version="1")
    assert FEATURE_LOCAL_FILE_ACCESS in payload["features"]
    assert payload["features"][-1] == FEATURE_LOCAL_FILE_ACCESS


def test_local_file_access_hidden_on_non_loopback_host():
    """A ``0.0.0.0`` bind does not advertise ``local-file-access``."""

    payload = build_server_capabilities(config=_config(host="0.0.0.0"), version="1")
    assert FEATURE_LOCAL_FILE_ACCESS not in payload["features"]


def test_features_include_firmware_compile_when_backend_available():
    """An available build backend with targets advertises ``firmware-compile``."""

    register_backend(_StubBuildBackend("stub-build", targets=("esp32s3",)))

    payload = build_server_capabilities(config=_config(enable_compile=True), version="1")

    assert FEATURE_FIRMWARE_COMPILE in payload["features"]
    entry = next(item for item in payload["buildBackends"] if item["id"] == "stub-build")
    assert entry["available"] is True
    assert entry["targets"] == ["esp32s3"]


def test_firmware_compile_hidden_when_enable_compile_false():
    """``enable_compile = false`` hides the feature but keeps the backend listed."""

    register_backend(_StubBuildBackend("stub-build"))

    payload = build_server_capabilities(config=_config(enable_compile=False), version="1")

    assert FEATURE_FIRMWARE_COMPILE not in payload["features"]
    assert "stub-build" in _backend_ids(payload)


def test_firmware_deploy_hidden_when_enable_deploy_false(monkeypatch):
    """Only ``enable_deploy`` lets an available flash backend advertise deploy."""

    register_flash_backend(_StubFlashBackend("stub-flash", chips=("esp32",)))
    monkeypatch.setattr(server_capabilities, "_serial_support_available", lambda: True)

    hidden = build_server_capabilities(config=_config(enable_deploy=False), version="1")
    shown = build_server_capabilities(config=_config(enable_deploy=True), version="1")

    assert FEATURE_FIRMWARE_DEPLOY not in hidden["features"]
    assert FEATURE_FIRMWARE_DEPLOY in shown["features"]
    assert "stub-flash" in [entry["id"] for entry in shown["flashBackends"]]


def test_backend_descriptor_reports_reason_from_missing_requirements():
    """``reason`` falls back to ``missing_requirements`` when ``detail`` is empty."""

    backend = _StubBuildBackend("odd-build", available=False)
    backend.status = lambda: BackendStatus(
        backend_id="odd-build",
        available=False,
        missing_requirements=("esptool", "idf.py"),
    )

    descriptor = build_backend_descriptor(backend)

    assert descriptor.available is False
    assert descriptor.reason == "esptool, idf.py"
    assert backend.target_calls == 0


def test_unavailable_backend_is_listed_with_available_false():
    """An unavailable backend appears in the payload with a reason and no targets."""

    register_backend(
        _StubBuildBackend("offline-build", available=False, detail="toolchain missing")
    )

    payload = build_server_capabilities(config=_config(), version="1")

    entry = next(item for item in payload["buildBackends"] if item["id"] == "offline-build")
    assert entry["available"] is False
    assert entry["reason"] == "toolchain missing"
    assert entry["targets"] == []


def test_broken_backend_is_skipped_without_failing():
    """A backend that raises from ``status()`` is skipped, not fatal."""

    register_backend(_ExplodingBackend())
    register_backend(_StubBuildBackend("healthy-build"))

    payload = build_server_capabilities(config=_config(), version="1")

    assert "broken" not in _backend_ids(payload)
    assert "healthy-build" in _backend_ids(payload)


def test_release_index_url_is_empty_until_release_source_lands():
    """This iteration offers only the local image source."""

    payload = build_server_capabilities(config=_config(), version="1")

    assert payload["releaseIndexUrl"] == ""
    assert payload["firmwareSources"] == ["local"]


def test_resolve_static_root_prefers_repo_root_build(tmp_path: Path) -> None:
    """A repo-root ``_dist/webapp`` build wins over the package and source trees."""

    package_dir = tmp_path / "src" / "micro_otter"
    (package_dir / "nodes").mkdir(parents=True)
    build_dir = tmp_path / "_dist" / "webapp"
    build_dir.mkdir(parents=True)
    (build_dir / "index.html").write_text("", encoding="utf-8")

    assert resolve_static_root(package_dir) == build_dir


def test_resolve_static_root_falls_back_to_packaged_bundle(tmp_path: Path) -> None:
    """Without a repo-root build, a bundle shipped next to the package is used."""

    package_dir = tmp_path / "site-packages" / "micro_otter"
    (package_dir / "nodes").mkdir(parents=True)
    packaged = package_dir / "dist" / "webapp"
    packaged.mkdir(parents=True)
    (packaged / "index.html").write_text("", encoding="utf-8")

    assert resolve_static_root(package_dir) == packaged


def test_resolve_static_root_falls_back_to_source_tree(tmp_path: Path) -> None:
    """With no build anywhere, the TypeScript source tree is the last resort."""

    package_dir = tmp_path / "src" / "micro_otter"
    (package_dir / "nodes").mkdir(parents=True)

    assert resolve_static_root(package_dir) == package_dir / "nodes"


def _backend_ids(payload):
    """Return the ``id`` values of the build backend list in the payload."""

    return [entry["id"] for entry in payload["buildBackends"]]


def _write_version(path: Path, version: str) -> None:
    """Write a minimal ``version.json`` at *path*.

    Args:
        path: Destination file; parents are created.
        version: Version string to stamp.
    """

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"version": version}), encoding="utf-8")


def _stale_build_layout(tmp_path: Path, *, served: str) -> tuple[Path, str]:
    """Create a ``_dist/webapp`` build next to a package source tree.

    Args:
        tmp_path: Temporary directory standing in for the repository root's parent.
        served: Version stamped into the build's ``version.json``.

    Returns:
        The ``(static_root, package_version)`` pair the stale check compares.
    """

    build_dir = tmp_path / "_dist" / "webapp"
    build_dir.mkdir(parents=True, exist_ok=True)
    (build_dir / "index.html").write_text("", encoding="utf-8")
    _write_version(build_dir / "html" / "version.json", served)
    return build_dir, "1.0.0.dev2"


def test_detect_stale_static_root_reports_both_versions_when_they_differ(tmp_path: Path) -> None:
    """A stale ``_dist/webapp`` build reports its own version and the package version."""

    build_dir, package_version = _stale_build_layout(tmp_path, served="1.0.0.dev1")

    assert detect_stale_static_root(build_dir, package_version) == ("1.0.0.dev1", "1.0.0.dev2")


def test_detect_stale_static_root_is_silent_when_versions_match(tmp_path: Path) -> None:
    """An up-to-date build is not reported as stale."""

    build_dir, package_version = _stale_build_layout(tmp_path, served="1.0.0.dev2")

    assert detect_stale_static_root(build_dir, package_version) is None


def test_detect_stale_static_root_ignores_the_source_tree(tmp_path: Path) -> None:
    """Serving the TypeScript source tree is never a stale build."""

    source_root = tmp_path / "src" / "micro_otter" / "nodes"

    assert detect_stale_static_root(source_root, "1.0.0.dev2") is None


def test_detect_stale_static_root_tolerates_missing_version_files(tmp_path: Path) -> None:
    """A missing build tag is a content problem, not a crash."""

    build_dir = tmp_path / "_dist" / "webapp"
    build_dir.mkdir(parents=True, exist_ok=True)
    (build_dir / "index.html").write_text("", encoding="utf-8")

    assert detect_stale_static_root(build_dir, "1.0.0.dev2") is None


def test_capability_payload_exposes_the_stale_build_pair(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The payload carries the served/package pair so a client can warn about a stale build."""

    build_dir, package_version = _stale_build_layout(tmp_path, served="0.9.0")
    monkeypatch.setattr(server_capabilities, "_STATIC_ROOT", build_dir)
    monkeypatch.setattr(server_capabilities, "__version__", package_version)

    payload = build_server_capabilities(config=_config(), version="1")

    assert payload["webappBuildServedVersion"] == "0.9.0"
    assert payload["webappBuildSourceVersion"] == package_version
    assert tuple(payload) == CAPABILITY_KEYS


def test_capability_payload_leaves_the_stale_build_pair_empty_when_current(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A current build exposes ``None`` for both stale-build keys."""

    build_dir, package_version = _stale_build_layout(tmp_path, served="1.0.0.dev2")
    monkeypatch.setattr(server_capabilities, "_STATIC_ROOT", build_dir)
    monkeypatch.setattr(server_capabilities, "__version__", package_version)

    payload = build_server_capabilities(config=_config(), version="1")

    assert payload["webappBuildServedVersion"] is None
    assert payload["webappBuildSourceVersion"] is None


def test_read_app_version_reports_the_installed_package_version() -> None:
    """``/api/version`` and the payload builder share the installed package version."""

    assert read_app_version() == micro_otter.__version__

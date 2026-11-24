# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
"""Runtime-side embedded metadata API helpers.

These functions are intended to be host-callable via the existing device code
execution channel. They return JSON-serializable dict payloads and do not
depend on writable filesystem metadata files.
"""

import json
import os

from otter_runtime.embedded_metadata_payload import (
    EMBEDDED_INVENTORY_HASH_PAYLOAD,
    EMBEDDED_PACKAGES_SUMMARY,
    RUNTIME_IDENTITY_MODE_SUMMARY,
)
from otter_runtime.bootstrap_setup_contract import (
    REQUIRED_WRITABLE_PATHS,
    make_error_row,
    make_setup_response,
    make_setup_result_row,
    make_status_file_row,
    make_status_response,
)
from otter_runtime.bootstrap_setup_templates import (
    DEVICE_JSON_PRESERVED_FIELDS,
    build_custom_view_template_text,
    build_device_template,
    build_main_loop_fallback_template,
    build_manifest_template,
    resolve_runtime_custom_view_path,
)

try:
    from otter_runtime.bootstrap_setup_templates import CONSTITUENT_VERSIONS
except ImportError:
    CONSTITUENT_VERSIONS = {}


def get_runtime_identity_mode_summary() -> dict:
    """Return runtime identity/version/mode metadata.

    Returns a reference to the frozen module-level constant.
    Callers must not mutate the returned dict.
    """
    return RUNTIME_IDENTITY_MODE_SUMMARY


def get_embedded_packages_summary() -> dict:
    """Return embedded package summary metadata.

    Returns a reference to the frozen module-level constant.
    Callers must not mutate the returned dict.
    """
    return EMBEDDED_PACKAGES_SUMMARY


def get_embedded_inventory_hash_payload() -> dict:
    """Return embedded inventory/hash payload metadata.

    Returns a reference to the frozen module-level constant.
    Callers must not mutate the returned dict.
    """
    return EMBEDDED_INVENTORY_HASH_PAYLOAD


def get_embedded_metadata_bundle() -> dict:
    """Return all embedded metadata payloads in a single response."""

    return {
        "runtime": get_runtime_identity_mode_summary(),
        "packagesSummary": get_embedded_packages_summary(),
        "inventory": get_embedded_inventory_hash_payload(),
    }


def get_firmware_build_info() -> dict:
    """Return firmware version and git source information for the current build.

    Returns a dict with:
    - ``id``: runtime identifier
    - ``version``: runtime source version
    - ``runtimeAssetsVersion``: compile-owned runtime assets version (or None)
    - ``gitSource``: dict with ``originUrl``, ``branch``, ``commitHash`` (or None)
    """
    identity = get_runtime_identity_mode_summary()
    return {
        "id": identity.get("id"),
        "version": identity.get("version"),
        "runtimeAssetsVersion": identity.get("runtimeAssetsVersion"),
        "gitSource": identity.get("gitSource"),
    }


def get_frozen_addons() -> dict:
    """Return the frozen add-on record baked into the embedded constituent versions.

    Returns ``{addon_id: {"variant": ..., "version": ...}}``, or ``{}`` when the image
    recorded no frozen add-ons. Callers must not mutate the returned dict.
    """

    frozen = CONSTITUENT_VERSIONS.get("frozenAddons")
    if not isinstance(frozen, dict):
        return {}
    return {str(key): value for key, value in frozen.items() if isinstance(value, dict)}


def _default_text_reader(path: str) -> str:
    with open(path, "r") as handle:
        return handle.read()


def _default_text_writer(path: str, content: str):
    _ensure_parent_directories(path)
    with open(path, "w") as handle:
        handle.write(content)


def _ensure_parent_directories(path: str):
    normalized = str(path)
    parts = [part for part in normalized.split("/") if part]
    if len(parts) <= 1:
        return

    absolute = normalized.startswith("/")
    current = "" if absolute else parts[0]
    parent_parts = parts[:-1]
    if not absolute:
        parent_parts = parent_parts[1:]

    for part in parent_parts:
        if absolute:
            current = f"{current}/{part}" if current else f"/{part}"
        else:
            current = f"{current}/{part}"

        try:
            os.mkdir(current)
        except OSError:
            # Directory already exists or cannot be created; open() will surface write errors.
            pass


def _validate_manifest_payload(payload: dict):
    required = ("id", "name", "version")
    for key in required:
        value = payload.get(key)
        if not isinstance(value, str) or not value.strip():
            return "missing-required-runtime-identity"
    return None


def _validate_device_payload(payload: dict):
    required = ("runtime", "version", "targetId", "targetConfigPath")
    for key in required:
        value = payload.get(key)
        if not isinstance(value, str) or not value.strip():
            return "missing-required-device-field"
    return None


def _validate_main_loop_text(text: str):
    normalized = text.strip()
    if not normalized:
        return "empty-main-loop"
    return None


def _validate_custom_view_payload(payload):
    if not isinstance(payload, dict):
        return "invalid-custom-view-schema"
    return None


def _resolve_bootstrap_paths():
    paths = list(REQUIRED_WRITABLE_PATHS)
    custom_view_path = resolve_runtime_custom_view_path()
    if isinstance(custom_view_path, str) and custom_view_path and custom_view_path not in paths:
        paths.append(custom_view_path)
    return paths


def get_bootstrap_setup_status(file_reader=None) -> dict:
    """Return bootstrap writable-file status against the frozen setup schema."""

    reader = file_reader if callable(file_reader) else _default_text_reader
    file_rows = []
    errors = []

    custom_view_path = resolve_runtime_custom_view_path()

    for path in _resolve_bootstrap_paths():
        try:
            raw_text = reader(path)
        except OSError:
            file_rows.append(make_status_file_row(path, exists=False, valid=False, reason="missing"))
            continue
        except Exception as exc:
            file_rows.append(make_status_file_row(path, exists=True, valid=False, reason="read-failed"))
            errors.append(
                {
                    "category": "runtime",
                    "message": str(exc),
                    "path": path,
                }
            )
            continue

        if path == "/app/main_loop.py":
            reason = _validate_main_loop_text(raw_text)
            file_rows.append(
                make_status_file_row(
                    path,
                    exists=True,
                    valid=reason is None,
                    reason=reason,
                )
            )
            continue

        if custom_view_path and path == custom_view_path:
            try:
                payload = json.loads(raw_text)
            except Exception:
                file_rows.append(
                    make_status_file_row(
                        path,
                        exists=True,
                        valid=False,
                        reason="invalid-json",
                    )
                )
                continue

            reason = _validate_custom_view_payload(payload)
            file_rows.append(
                make_status_file_row(
                    path,
                    exists=True,
                    valid=reason is None,
                    reason=reason,
                )
            )
            continue

        try:
            payload = json.loads(raw_text)
        except Exception:
            file_rows.append(
                make_status_file_row(
                    path,
                    exists=True,
                    valid=False,
                    reason="invalid-json",
                )
            )
            continue

        if not isinstance(payload, dict):
            file_rows.append(
                make_status_file_row(
                    path,
                    exists=True,
                    valid=False,
                    reason="invalid-schema",
                )
            )
            continue

        # Only firmware-owned JSON files are validated here. Target content is host-owned
        # (`DeviceDeployment._uploadTargetConfiguration`), so it is never validated on the device.
        validators = {
            "/manifest.json": _validate_manifest_payload,
            "/device.json": _validate_device_payload,
        }
        if path not in validators:
            continue
        reason = validators[path](payload)

        file_rows.append(
            make_status_file_row(
                path,
                exists=True,
                valid=reason is None,
                reason=reason,
            )
        )

    return make_status_response(file_rows, errors)


def _normalize_apply_options(options):
    normalized = {
        "force": False,
        "forcePaths": [],
    }
    if not isinstance(options, dict):
        return normalized

    force = options.get("force")
    if isinstance(force, bool):
        normalized["force"] = force

    force_paths = options.get("forcePaths")
    if isinstance(force_paths, list):
        normalized["forcePaths"] = [str(path) for path in force_paths if isinstance(path, str)]

    return normalized


def _serialize_json_payload(payload: dict) -> str:
    return json.dumps(payload)


def _merge_device_template(existing_payload: dict, template_payload: dict) -> dict:
    merged = dict(template_payload)
    for field in DEVICE_JSON_PRESERVED_FIELDS:
        if field in existing_payload:
            merged[field] = existing_payload.get(field)
    return merged


def _read_json_if_available(path: str, reader):
    try:
        raw = reader(path)
    except OSError:
        return None
    except Exception:
        return None

    try:
        payload = json.loads(raw)
    except Exception:
        return None

    if not isinstance(payload, dict):
        return None
    return payload


def _build_template_text_by_path(path: str, options: dict, reader) -> str:
    custom_view_path = resolve_runtime_custom_view_path()

    if custom_view_path and path == custom_view_path:
        custom_view_text = build_custom_view_template_text()
        if not isinstance(custom_view_text, str) or not custom_view_text.strip():
            raise ValueError("custom-view-template-unavailable")
        return custom_view_text

    if path == "/manifest.json":
        return _serialize_json_payload(build_manifest_template())

    if path == "/device.json":
        template_payload = build_device_template()
        existing = _read_json_if_available(path, reader)
        if isinstance(existing, dict):
            template_payload = _merge_device_template(existing, template_payload)
        return _serialize_json_payload(template_payload)

    return build_main_loop_fallback_template()


def apply_bootstrap_setup(options=None, file_reader=None, file_writer=None) -> dict:
    """Create bootstrap writable files when missing, without overwriting existing files."""

    resolved_options = _normalize_apply_options(options)
    reader = file_reader if callable(file_reader) else _default_text_reader
    writer = file_writer if callable(file_writer) else _default_text_writer

    results = []
    errors = []

    for path in _resolve_bootstrap_paths():
        try:
            desired_text = _build_template_text_by_path(path, resolved_options, reader)
        except Exception as exc:
            results.append(make_setup_result_row(path, "error", "template-build-failed"))
            errors.append(make_error_row("runtime", str(exc), path=path))
            continue

        exists = True
        try:
            existing_text = reader(path)
        except OSError:
            exists = False
            existing_text = None
        except Exception as exc:
            results.append(make_setup_result_row(path, "error", "read-failed"))
            errors.append(make_error_row("runtime", str(exc), path=path))
            continue

        if not exists:
            try:
                writer(path, desired_text)
                results.append(make_setup_result_row(path, "created"))
            except Exception as exc:
                results.append(make_setup_result_row(path, "error", "write-failed"))
                errors.append(make_error_row("filesystem", str(exc), path=path))
            continue

        if existing_text == desired_text:
            results.append(make_setup_result_row(path, "unchanged"))
            continue

        # Existing files are intentionally preserved to avoid resetting
        # user-selected or host-updated bootstrap metadata.
        results.append(make_setup_result_row(path, "unchanged", "preserved-existing"))

    try:
        import deflate as _deflate
        import gc as _gc
        import io as _io

        class _FlashStream(_io.IOBase):
            """Read-only stream over a frozen bytes object without copying it to heap.

            Inherits io.IOBase and implements readinto() as required by
            MicroPython's deflate.DeflateIO stream protocol.
            """

            def __init__(self, data):
                self._mv = memoryview(data)
                self._pos = 0

            def readinto(self, buf):
                n = len(buf)
                end = min(self._pos + n, len(self._mv))
                actual = end - self._pos
                if actual <= 0:
                    return 0
                buf[:actual] = self._mv[self._pos:end]
                self._pos = end
                return actual

        from otter_runtime.embedded_static_assets import EMBEDDED_STATIC_ASSETS
        for device_path, compressed in EMBEDDED_STATIC_ASSETS.items():
            full_path = "/" + device_path.lstrip("/")
            exists = True
            try:
                import os as _os
                _os.stat(full_path)
            except OSError:
                exists = False
            if not exists:
                _ensure_parent_directories(full_path)
                with _deflate.DeflateIO(_FlashStream(compressed), _deflate.ZLIB) as _d:
                    with open(full_path, "wb") as _f:
                        while True:
                            _chunk = _d.read(512)
                            if not _chunk:
                                break
                            _f.write(_chunk)
            _gc.collect()
    except ImportError:
        pass  # Not available in dynamic mode or tests
    except Exception as _exc:
        print("[error] boot: bootstrap static assets error ({})".format(_exc))

    return make_setup_response(results, errors)


__all__ = [
    "get_runtime_identity_mode_summary",
    "get_embedded_packages_summary",
    "get_embedded_inventory_hash_payload",
    "get_embedded_metadata_bundle",
    "get_firmware_build_info",
    "get_frozen_addons",
    "get_bootstrap_setup_status",
    "apply_bootstrap_setup",
]

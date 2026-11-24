"""Deterministic embedded metadata generation for staged payloads."""

from __future__ import annotations

import hashlib
import json
import zlib
from pathlib import Path
from pprint import pformat

from .staging_models import (
    ConstituentVersions,
    EmbeddedHashRecord,
    RuntimePayload,
    StagingFileEntry,
)
from .staging_paths import StagingPaths


def _sha256_bytes(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def _json_bytes(payload: dict) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _raise_generation_error(category: str, detail: str) -> None:
    raise ValueError(f"{category}: {detail}")


def _ensure_output_within_modules_root(output_path: Path, modules_root: Path) -> None:
    try:
        output_path.resolve().relative_to(modules_root.resolve())
    except ValueError as exc:
        _raise_generation_error(
            "GENERATION_PATH_INVALID",
            f"output path escapes modules root: {output_path}",
        )
        raise AssertionError("unreachable") from exc


def _validate_required_payload_fields(payload: RuntimePayload) -> None:
    required_fields = {
        "runtime_id": payload.runtime_id,
        "runtime_version": payload.runtime_version,
        "runtime_name": payload.runtime_name,
        "compile_board_id": payload.compile_board_id,
        "compile_port_id": payload.compile_port_id,
        "target_mapping_rule_id": payload.target_mapping_rule_id,
        "target_mapping_source": payload.target_mapping_source,
        "target_mapping_confidence": payload.target_mapping_confidence,
    }

    for field, value in required_fields.items():
        if not isinstance(value, str) or not value.strip():
            _raise_generation_error("GENERATION_INPUT_MISSING", field)


def _read_optional_custom_view_text(modules_root: Path) -> str | None:
    custom_view_path = modules_root / "custom_view.json"
    if not custom_view_path.is_file():
        return None

    content = custom_view_path.read_text(encoding="utf-8").strip()
    if not content:
        _raise_generation_error("GENERATION_INPUT_INVALID", "custom_view.json is empty")

    try:
        payload = json.loads(content)
    except Exception as exc:
        _raise_generation_error("GENERATION_INPUT_INVALID", "custom_view.json is not valid JSON")
        raise AssertionError("unreachable") from exc

    if not isinstance(payload, dict):
        _raise_generation_error(
            "GENERATION_INPUT_INVALID", "custom_view.json must be a JSON object"
        )

    return content


def build_embedded_hash_records(
    paths: StagingPaths,
    entries: list[StagingFileEntry],
) -> list[EmbeddedHashRecord]:
    """Create deterministic hash records from staged files."""

    records: list[EmbeddedHashRecord] = []
    modules_root = paths.modules_path.resolve()

    for entry in entries:
        target = (modules_root / entry.target_rel_path).resolve()
        if not target.exists() or not target.is_file():
            raise FileNotFoundError(f"Cannot hash missing staged file: {target}")

        suffix = target.suffix.lower().lstrip(".")
        file_kind = suffix or "bin"
        records.append(
            EmbeddedHashRecord(
                path=entry.target_rel_path,
                file_hash=_sha256_file(target),
                file_kind=file_kind,
                package_id=entry.package_id,
                package_version=entry.package_version,
            )
        )

    return sorted(records, key=lambda item: item.path)


def write_embedded_metadata(
    paths: StagingPaths,
    payload: RuntimePayload,
    records: list[EmbeddedHashRecord],
    embedded_manifest_output: Path | None = None,
    build_profile_id: str = "default",
    source_revision: str | None = None,
    dry_run: bool = False,
) -> tuple[Path, Path]:
    """Write deterministic `/otter/embedded_manifest.json` and hash table."""

    modules_root = paths.modules_path.resolve()
    otter_root = (modules_root / "otter").resolve()
    manifest_path = (
        embedded_manifest_output.resolve()
        if embedded_manifest_output is not None
        else (otter_root / "embedded_manifest.json").resolve()
    )
    hashes_path = manifest_path.with_name("embedded_hashes.json")

    files_payload = [
        {
            "path": record.path,
            "packageId": record.package_id,
            "packageVersion": record.package_version,
            "fileHash": record.file_hash,
            "fileKind": record.file_kind,
            "source": record.source,
        }
        for record in records
    ]
    hashes_payload = {
        "schemaVersion": 1,
        "files": files_payload,
    }

    package_entries = sorted(
        {
            (record.package_id, record.package_version)
            for record in records
            if record.package_id is not None
        }
    )
    packages = [{"id": package_id, "version": version} for package_id, version in package_entries]

    manifest_payload = {
        "schemaVersion": 1,
        "runtime": {
            "mode": "embedded",
            "id": payload.runtime_id,
            "version": payload.runtime_version,
        },
        "build": {
            "profileId": build_profile_id,
            "target": paths.target,
            "sourceRevision": source_revision,
        },
        "components": {
            "runtimeAssets": {"version": payload.runtime_assets_version},
        },
        "packages": {
            "included": packages,
            "listHash": _sha256_bytes(_json_bytes({"included": packages})),
        },
        "inventory": {
            "hashSchemaVersion": 1,
            "hashFile": "/otter/embedded_hashes.json",
            "selfHash": "",
        },
    }

    manifest_payload["inventory"]["selfHash"] = _sha256_bytes(_json_bytes(manifest_payload))

    if dry_run:
        return manifest_path, hashes_path

    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    hashes_path.write_text(json.dumps(hashes_payload, indent=2, sort_keys=True), encoding="utf-8")
    manifest_path.write_text(
        json.dumps(manifest_payload, indent=2, sort_keys=True), encoding="utf-8"
    )

    return manifest_path, hashes_path


def write_runtime_embedded_metadata_payload_module(
    paths: StagingPaths,
    payload: RuntimePayload,
    records: list[EmbeddedHashRecord],
    dry_run: bool = False,
) -> Path:
    """Write otter_runtime/embedded_metadata_payload.py from staged metadata."""

    modules_root = paths.modules_path.resolve()
    output_path = (modules_root / "otter_runtime" / "embedded_metadata_payload.py").resolve()
    _ensure_output_within_modules_root(output_path, modules_root)
    _validate_required_payload_fields(payload)

    packages_by_id: dict[str, dict] = {}
    total_files = 0
    total_bytes = 0

    for record in records:
        if not record.package_id:
            continue

        file_path = (modules_root / record.path).resolve()
        file_size = file_path.stat().st_size if file_path.exists() and file_path.is_file() else 0

        total_files += 1
        total_bytes += file_size

        package_entry = packages_by_id.get(record.package_id)
        if package_entry is None:
            package_entry = {
                "name": record.package_id,
                "version": record.package_version,
                "files": 0,
                "bytes": 0,
            }
            packages_by_id[record.package_id] = package_entry

        package_entry["files"] += 1
        package_entry["bytes"] += file_size

    packages = [packages_by_id[key] for key in sorted(packages_by_id.keys())]

    target_metadata = {
        "compile": {
            "board": payload.compile_board_id,
            "port": payload.compile_port_id,
        },
        "mappingRuleId": payload.target_mapping_rule_id,
        "mappingSource": payload.target_mapping_source,
        "mappingConfidence": payload.target_mapping_confidence,
        "allowedWebTargetIds": list(payload.allowed_web_target_ids),
        "buildBaseTargetId": payload.web_target_base_id,
    }
    runtime_target_id = (
        payload.runtime_target_id.strip()
        if isinstance(payload.runtime_target_id, str)
        else None
    )
    if runtime_target_id:
        target_metadata["id"] = runtime_target_id

    runtime_identity_mode_summary = {
        "mode": "embedded",
        "id": payload.runtime_id,
        "customView": "custom_view.json",
        "target": target_metadata,
        "name": payload.runtime_name or payload.runtime_id,
        "version": payload.runtime_version,
        "description": payload.runtime_description or "",
        "runtimeAssetsVersion": payload.runtime_assets_version,
    }
    if payload.git_source is not None:
        runtime_identity_mode_summary["gitSource"] = payload.git_source.to_dict()
    if runtime_target_id:
        runtime_identity_mode_summary["targetId"] = runtime_target_id

    runtime_custom_view_json_text = _read_optional_custom_view_text(modules_root)
    embedded_packages_summary = {
        "totalPackages": len(packages),
        "totalFiles": total_files,
        "totalBytes": total_bytes,
        "packages": packages,
    }
    embedded_inventory_hash_payload = {
        "schemaVersion": 1,
        "files": [
            {
                "path": record.path,
                "fileHash": record.file_hash,
                "fileKind": record.file_kind,
                "source": record.source,
                "packageId": record.package_id,
                "packageVersion": record.package_version,
            }
            for record in records
        ],
    }

    runtime_literal = pformat(runtime_identity_mode_summary, sort_dicts=True, width=100)
    packages_literal = pformat(embedded_packages_summary, sort_dicts=True, width=100)
    inventory_literal = pformat(embedded_inventory_hash_payload, sort_dicts=True, width=100)
    custom_view_literal = pformat(runtime_custom_view_json_text, width=100)

    content = (
        '# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only\n'
        '"""Generated embedded metadata payload constants for runtime API access.\n\n'
        'This file is generated during firmware staging. Do not edit manually.\n'
        '"""\n\n'
        f"RUNTIME_IDENTITY_MODE_SUMMARY = {runtime_literal}\n\n"
        f"EMBEDDED_PACKAGES_SUMMARY = {packages_literal}\n\n"
        f"EMBEDDED_INVENTORY_HASH_PAYLOAD = {inventory_literal}\n\n"
        f"RUNTIME_CUSTOM_VIEW_JSON_TEXT = {custom_view_literal}\n\n"
        "__all__ = [\n"
        '    "RUNTIME_IDENTITY_MODE_SUMMARY",\n'
        '    "EMBEDDED_PACKAGES_SUMMARY",\n'
        '    "EMBEDDED_INVENTORY_HASH_PAYLOAD",\n'
        '    "RUNTIME_CUSTOM_VIEW_JSON_TEXT",\n'
        "]\n"
    )

    if dry_run:
        return output_path

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(content, encoding="utf-8")
    return output_path


def write_runtime_bootstrap_setup_templates_module(
    paths: StagingPaths,
    payload: RuntimePayload,
    dry_run: bool = False,
    constituent_versions: ConstituentVersions | None = None,
) -> Path:
    """Write otter_runtime/bootstrap_setup_templates.py from resolved runtime payload."""

    modules_root = paths.modules_path.resolve()
    output_path = (modules_root / "otter_runtime" / "bootstrap_setup_templates.py").resolve()
    _ensure_output_within_modules_root(output_path, modules_root)
    _validate_required_payload_fields(payload)

    target_metadata = {
        "compile": {
            "board": payload.compile_board_id,
            "port": payload.compile_port_id,
        },
        "mappingRuleId": payload.target_mapping_rule_id,
        "mappingSource": payload.target_mapping_source,
        "mappingConfidence": payload.target_mapping_confidence,
        "allowedWebTargetIds": list(payload.allowed_web_target_ids),
        "buildBaseTargetId": payload.web_target_base_id,
    }
    runtime_target_id = (
        payload.runtime_target_id.strip()
        if isinstance(payload.runtime_target_id, str)
        else None
    )
    if runtime_target_id:
        target_metadata["id"] = runtime_target_id

    runtime_identity_mode_summary = {
        "mode": "embedded",
        "id": payload.runtime_id,
        "customView": "custom_view.json",
        "target": target_metadata,
        "name": payload.runtime_name or payload.runtime_id,
        "version": payload.runtime_version,
        "description": payload.runtime_description or "",
    }
    if runtime_target_id:
        runtime_identity_mode_summary["targetId"] = runtime_target_id

    runtime_custom_view_json_text = _read_optional_custom_view_text(modules_root)

    runtime_literal = pformat(runtime_identity_mode_summary, sort_dicts=True, width=100)
    custom_view_literal = pformat(runtime_custom_view_json_text, width=100)

    # Build optional constituent versions constants and injection snippet
    constituent_versions_constant = ""
    build_device_template_constituent_injection = ""
    if constituent_versions is not None:
        cv = constituent_versions
        cv_literal = pformat(cv.to_dict(), sort_dicts=True, width=100)
        rfv_literal = repr(cv.runtime_firmware_version)
        constituent_versions_constant = (
            f"RUNTIME_FIRMWARE_VERSION = {rfv_literal}\n\n"
            f"CONSTITUENT_VERSIONS = {cv_literal}\n\n"
        )
        build_device_template_constituent_injection = (
            "    device['runtimeFirmwareVersion'] = RUNTIME_FIRMWARE_VERSION\n"
            "    device['constituentVersions'] = CONSTITUENT_VERSIONS\n"
        )

    content = (
        '# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only\n'
        '"""Generated bootstrap setup templates and file preservation policy.\n\n'
        'This file is generated during firmware staging. Do not edit manually.\n'
        '"""\n\n'
        f"RUNTIME_IDENTITY_MODE_SUMMARY = {runtime_literal}\n\n"
        f"RUNTIME_CUSTOM_VIEW_JSON_TEXT = {custom_view_literal}\n\n"
        f"{constituent_versions_constant}"
        "TEMPLATE_SCHEMA_VERSION = 1\n\n"
        "MANIFEST_PATH = '/manifest.json'\n"
        "DEVICE_INFO_PATH = '/device.json'\n"
        "ACTIVE_TARGET_PATH = '/device/targets/active_target.json'\n"
        "MAIN_LOOP_PATH = '/app/main_loop.py'\n\n"
        "TEMPLATE_PATHS = (\n"
        "    MANIFEST_PATH,\n"
        "    DEVICE_INFO_PATH,\n"
        "    MAIN_LOOP_PATH,\n"
        ")\n\n"
        "DEVICE_JSON_PRESERVED_FIELDS = (\n"
        "    'targetUserDescription',\n"
        ")\n\n"
        "FORCE_REQUIRED_OVERWRITE_PATHS = (\n"
        "    MAIN_LOOP_PATH,\n"
        ")\n\n"
        "MAIN_LOOP_FALLBACK_TEMPLATE = '''import uasyncio as asyncio\n\n"
        "try:\n"
        "    import utime as _time\n\n"
        "    def _ticks_ms() -> int:\n"
        "        return _time.ticks_ms()\n\n"
        "    def _ticks_diff(current: int, previous: int) -> int:\n"
        "        return _time.ticks_diff(current, previous)\n"
        "except ImportError:\n"
        "    import time as _time\n\n"
        "    def _ticks_ms() -> int:\n"
        "        return int(_time.time() * 1000)\n\n"
        "    def _ticks_diff(current: int, previous: int) -> int:\n"
        "        return current - previous\n\n\n"
        "_STARTUP_TICKS_MS = _ticks_ms()\n\n\n"
        "async def run() -> None:\n"
        "    while True:\n"
        "        elapsed_seconds = _ticks_diff(_ticks_ms(), _STARTUP_TICKS_MS) // 1000\n"
        "        print('[user] Nothing to do for {} seconds'.format(elapsed_seconds))\n"
        "        await asyncio.sleep_ms(1000)\n"
        "'''\n\n"
        "def build_manifest_template():\n"
        "    template = {\n"
        "        'id': RUNTIME_IDENTITY_MODE_SUMMARY.get('id', 'general'),\n"
        "        'name': RUNTIME_IDENTITY_MODE_SUMMARY.get('name', 'Micro-Otter'),\n"
        "        'version': RUNTIME_IDENTITY_MODE_SUMMARY.get('version', 'unknown'),\n"
        "    }\n\n"
        "    description = RUNTIME_IDENTITY_MODE_SUMMARY.get('description')\n"
        "    if isinstance(description, str) and description:\n"
        "        template['description'] = description\n\n"
        "    custom_view = RUNTIME_IDENTITY_MODE_SUMMARY.get('customView')\n"
        "    if custom_view is not None:\n"
        "        template['customView'] = custom_view\n\n"
        "    target = RUNTIME_IDENTITY_MODE_SUMMARY.get('target')\n"
        "    if isinstance(target, dict):\n"
        "        template['target'] = target\n\n"
        "    return template\n\n\n"
        "def build_device_template():\n"
        "    runtime_id = str(RUNTIME_IDENTITY_MODE_SUMMARY.get('id', 'general'))\n"
        "    runtime_version = str(RUNTIME_IDENTITY_MODE_SUMMARY.get('version', 'unknown'))\n\n"
        "    target = RUNTIME_IDENTITY_MODE_SUMMARY.get('target')\n"
        "    target_id = target.get('id') if isinstance(target, dict) else None\n"
        "    normalized_target_id = None\n"
        "    if isinstance(target_id, str) and target_id.strip():\n"
        "        normalized_target_id = target_id.strip()\n\n"
    )

    if not build_device_template_constituent_injection:
        content += (
            "    return {\n"
            "        'runtime': runtime_id,\n"
            "        'version': runtime_version,\n"
            "        'targetId': normalized_target_id,\n"
            "        'targetDisplayName': '',\n"
            "        'targetDescription': '',\n"
            "        'targetConfigPath': ACTIVE_TARGET_PATH,\n"
            "    }\n\n\n"
        )
    else:
        content += (
            "    device = {\n"
            "        'runtime': runtime_id,\n"
            "        'version': runtime_version,\n"
            "        'targetId': normalized_target_id,\n"
            "        'targetDisplayName': '',\n"
            "        'targetDescription': '',\n"
            "        'targetConfigPath': ACTIVE_TARGET_PATH,\n"
            "    }\n"
            f"{build_device_template_constituent_injection}"
            "    return device\n\n\n"
        )

    content += (
        "def build_main_loop_fallback_template():\n"
        "    return MAIN_LOOP_FALLBACK_TEMPLATE\n\n\n"
        "def resolve_runtime_custom_view_path():\n"
        "    custom_view = RUNTIME_IDENTITY_MODE_SUMMARY.get('customView')\n"
        "    if not isinstance(custom_view, str):\n"
        "        return None\n\n"
        "    normalized = custom_view.strip()\n"
        "    if not normalized:\n"
        "        return None\n\n"
        "    if not normalized.startswith('/'):\n"
        "        normalized = f'/{normalized}'\n\n"
        "    return normalized\n\n\n"
        "def build_custom_view_template_text():\n"
        "    if not isinstance(RUNTIME_CUSTOM_VIEW_JSON_TEXT, str):\n"
        "        return None\n\n"
        "    content = RUNTIME_CUSTOM_VIEW_JSON_TEXT.strip()\n"
        "    if not content:\n"
        "        return None\n\n"
        "    return f'{content}\\n'\n\n\n"
        "def get_template_builders():\n"
        "    return {\n"
        "        MANIFEST_PATH: build_manifest_template,\n"
        "        DEVICE_INFO_PATH: build_device_template,\n"
        "        MAIN_LOOP_PATH: build_main_loop_fallback_template,\n"
        "    }\n\n\n"
        "def get_template_source_summary():\n"
        "    return {\n"
        "        'schemaVersion': TEMPLATE_SCHEMA_VERSION,\n"
        "        'paths': list(TEMPLATE_PATHS),\n"
        "        'deviceJsonPreservedFields': list(DEVICE_JSON_PRESERVED_FIELDS),\n"
        "        'forceRequiredOverwritePaths': list(FORCE_REQUIRED_OVERWRITE_PATHS),\n"
        "    }\n\n\n"
        "__all__ = [\n"
        "    'RUNTIME_IDENTITY_MODE_SUMMARY',\n"
        "    'RUNTIME_CUSTOM_VIEW_JSON_TEXT',\n"
        "    'TEMPLATE_SCHEMA_VERSION',\n"
        "    'MANIFEST_PATH',\n"
        "    'DEVICE_INFO_PATH',\n"
        "    'ACTIVE_TARGET_PATH',\n"
        "    'MAIN_LOOP_PATH',\n"
        "    'TEMPLATE_PATHS',\n"
        "    'DEVICE_JSON_PRESERVED_FIELDS',\n"
        "    'FORCE_REQUIRED_OVERWRITE_PATHS',\n"
        "    'MAIN_LOOP_FALLBACK_TEMPLATE',\n"
        "    'build_manifest_template',\n"
        "    'build_device_template',\n"
        "    'build_main_loop_fallback_template',\n"
        "    'resolve_runtime_custom_view_path',\n"
        "    'build_custom_view_template_text',\n"
        "    'get_template_builders',\n"
        "    'get_template_source_summary',\n"
        "]\n"
    )

    if dry_run:
        return output_path

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(content, encoding="utf-8")
    return output_path


def write_runtime_embedded_static_assets_module(
    paths: StagingPaths,
    asset_entries: list[tuple[str, bytes]],
    dry_run: bool = False,
) -> Path:
    """Write otter_runtime/embedded_static_assets.py embedding non-Python runtime assets.

    Args:
        paths: Staging paths providing the modules root.
        asset_entries: List of (device_relative_path, raw_bytes) tuples. Each entry is
            zlib-compressed and embedded as a bytes literal in the generated module.
        dry_run: If True, skip the write but still return the output path.

    Returns:
        Path to the generated module (whether written or not).
    """
    modules_root = paths.modules_path.resolve()
    output_path = (modules_root / "otter_runtime" / "embedded_static_assets.py").resolve()
    _ensure_output_within_modules_root(output_path, modules_root)

    entries_code = ""
    for device_path, raw_bytes in asset_entries:
        compressed = zlib.compress(raw_bytes, level=9)
        entries_code += f"    {device_path!r}: {compressed!r},\n"

    content = (
        '# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only\n'
        '"""Generated embedded static assets for bootstrap VFS write.\n\n'
        'This file is generated during firmware staging. Do not edit manually.\n'
        'Values are zlib-compressed bytes literals stored in flash ROM.\n'
        'Decompression happens on demand in the bootstrap writer; no heap is consumed\n'
        'by this module at import time.\n'
        '"""\n\n'
        'EMBEDDED_STATIC_ASSETS: dict = {\n'
        f'{entries_code}'
        '}\n\n'
        '__all__ = [\n'
        '    "EMBEDDED_STATIC_ASSETS",\n'
        ']\n'
    )

    if dry_run:
        return output_path

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(content, encoding="utf-8")
    return output_path

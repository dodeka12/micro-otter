"""Read-only node-package inventory plus the runtime-local manifest sync.

The scan answers one question: which node packages exist locally, which of them
this runtime stages into its firmware, and which are gated out by capability
checks. It is **advisory only** and reports firmware *content* facts. A package
missing from an image (``staged: false``) is never a "skip source upload" signal:
the web app's collection deploy keeps uploading source for ``missing`` /
``override-required`` packages regardless of what this module says.

Nothing here is cached. The scan is a handful of directory reads, and a cache
would go stale the moment a staging run writes new package folders.

``update_runtime_local_packages`` is a **bookkeeping** edit for humans running the
CLI. It is never called by the server and never by a build, and it cannot
influence which node-package source the web app uploads, because
``nodePackages.local`` is not a "present in firmware" signal.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .capability_requirements import evaluate_requirements
from .package_resolver import (
    PackageIndexEntry,
    PackageRoots,
    group_entries_by_id,
    load_package_entries,
    package_roots,
    read_package_manifest,
)

__all__ = [
    "LocalPackageRecord",
    "LocalPackageScan",
    "LocalPackageScanError",
    "LocalPackageSyncResult",
    "build_package_scan_payload",
    "scan_local_packages",
    "update_runtime_local_packages",
]

RUNTIME_NOT_FOUND = "runtime-not-found"
"""Code for a runtime id with no manifest on disk."""

RUNTIME_MANIFEST_INVALID = "runtime-manifest-invalid"
"""Code for a runtime manifest that is unreadable or not a JSON object."""

GLOBAL_PACKAGE_SOURCE = "global"
"""``source`` value for a package declared in ``node_pkgs/index.json``."""

RUNTIME_LOCAL_PACKAGE_SOURCE = "runtime-local"
"""``source`` value for a package folder under the runtime's ``node_pkgs``."""

_RUNTIME_MANIFEST_NAME = "manifest.json"
"""Name of the runtime manifest inside ``device/runtime/<runtime_id>``."""

_RUNTIME_PACKAGE_ROOT = "node_pkgs"
"""Folder holding runtime-local package folders inside a runtime directory."""

_MANIFEST_NAME = "manifest.json"
"""Name of a node-package manifest inside its package folder."""


@dataclass(frozen=True)
class LocalPackageRecord:
    """One node package discoverable on disk, with its staging status.

    ``staged`` is true only when the package is listed in the runtime manifest's
    ``nodePackages.global`` **and** its capability requirements are satisfied.
    ``gated_out`` is the listed-but-rejected case, and ``missing_capabilities``
    names the unmet requirement entries for it.

    ``staged: false`` means "not in this firmware image". It does **not** mean
    "skip the source upload": the collection deploy path classifies packages on
    its own and uploads source for anything the image cannot serve.
    """

    id: str
    name: str | None
    version: str | None
    source: str
    staged: bool
    gated_out: bool
    missing_capabilities: tuple[str, ...]
    manifest_path: Path | None


@dataclass(frozen=True)
class LocalPackageScan:
    """Result of one package inventory scan.

    ``runtime_id`` is carried so the payload serializer can emit the runtime a
    client asked about without re-reading the manifest.
    """

    runtime_id: str
    packages: tuple[LocalPackageRecord, ...]
    warnings: tuple[str, ...]


@dataclass(frozen=True)
class LocalPackageSyncResult:
    """Outcome of reconciling ``nodePackages.local`` with the package folders on disk.

    ``skipped`` lists every entry under the runtime's ``node_pkgs`` folder that is
    not a valid package folder (no manifest, unreadable manifest, or an ``id`` that
    does not match the folder name), so nothing is dropped silently.
    """

    written: bool
    previous: tuple[str, ...]
    current: tuple[str, ...]
    skipped: tuple[str, ...]


class LocalPackageScanError(RuntimeError):
    """Structured package-inventory failure.

    Mirrors :class:`...firmware_deploy.FirmwareDeployError` so a server layer can
    serialise either family identically: ``code`` is stable, ``exit_code`` maps to
    the CLI process code, and ``hint``/``details`` carry the remediation.
    """

    def __init__(
        self,
        message: str,
        *,
        code: str,
        hint: str | None = None,
        details: Mapping[str, object] | None = None,
        exit_code: int = 2,
    ) -> None:
        """Record the message plus the code, hint, details, and exit category."""

        super().__init__(message)
        self.code = code
        self.message = message
        self.hint = hint
        self.details = dict(details) if details is not None else None
        self.exit_code = exit_code


def _runtime_dir(device_root: Path, runtime_id: str) -> Path:
    """Return the runtime directory for ``runtime_id`` inside ``device_root``."""

    return Path(device_root) / "runtime" / runtime_id


def _available_runtime_ids(device_root: Path) -> tuple[str, ...]:
    """Return the runtime ids that have a manifest on disk, sorted."""

    runtime_root = Path(device_root) / "runtime"
    if not runtime_root.is_dir():
        return ()
    return tuple(
        sorted(
            path.name
            for path in runtime_root.iterdir()
            if path.is_dir() and (path / _RUNTIME_MANIFEST_NAME).is_file()
        )
    )


def _load_runtime_manifest(device_root: Path, runtime_id: str) -> dict[str, Any]:
    """Return the runtime manifest object for ``runtime_id``.

    Raises
    ------
    LocalPackageScanError
        ``runtime-not-found`` when the manifest is missing (the hint lists the
        runtime ids that do exist) and ``runtime-manifest-invalid`` when it is
        unparsable or not a JSON object.
    """

    manifest_path = _runtime_dir(device_root, runtime_id) / _RUNTIME_MANIFEST_NAME
    if not manifest_path.is_file():
        available = _available_runtime_ids(device_root)
        available_text = ", ".join(available) or "none"
        raise LocalPackageScanError(
            f"Runtime manifest not found for {runtime_id!r}: {manifest_path}",
            code=RUNTIME_NOT_FOUND,
            hint=f"Available runtime ids: {available_text}",
            details={"runtimeId": runtime_id, "manifestPath": str(manifest_path)},
        )

    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise LocalPackageScanError(
            f"Runtime manifest is not valid JSON: {manifest_path}",
            code=RUNTIME_MANIFEST_INVALID,
            hint="Fix the runtime manifest JSON; the scan never invents one.",
            details={"runtimeId": runtime_id, "manifestPath": str(manifest_path)},
        ) from error

    if not isinstance(payload, dict):
        raise LocalPackageScanError(
            f"Runtime manifest is not a JSON object: {manifest_path}",
            code=RUNTIME_MANIFEST_INVALID,
            hint="Fix the runtime manifest JSON; the scan never invents one.",
            details={"runtimeId": runtime_id, "manifestPath": str(manifest_path)},
        )
    return payload


def _manifest_package_ids(manifest: Mapping[str, Any], key: str) -> tuple[str, ...]:
    """Return the ids of ``nodePackages.<key>`` in declaration order, deduplicated."""

    node_packages = manifest.get("nodePackages")
    if not isinstance(node_packages, Mapping):
        return ()
    declared = node_packages.get(key)
    if not isinstance(declared, list):
        return ()

    ids: list[str] = []
    for entry in declared:
        if not isinstance(entry, str):
            continue
        trimmed = entry.strip()
        if trimmed and trimmed not in ids:
            ids.append(trimmed)
    return tuple(ids)


CapabilityPredicate = Callable[[str], bool]


def _capability_predicates(
    capabilities: Mapping[str, object] | None,
) -> tuple[CapabilityPredicate, CapabilityPredicate, CapabilityPredicate]:
    """Return the three CNF predicates :func:`evaluate_requirements` expects.

    The scan has no target document, so it evaluates one flat capability map
    instead of a general/pin capability split: a capability counts as supported
    when the map holds a truthy entry for it. ``capabilities=None`` means "no
    capability information available" and treats every requirement as satisfied,
    which is what makes a plain ``mo node-packages`` listing report firmware
    membership rather than a capability verdict it cannot know.
    """

    if capabilities is None:
        def _always(capability: str) -> bool:
            """Treat every capability as supported when no map was supplied."""

            return True

        return _always, _always, _always

    def is_general(capability: str) -> bool:
        """Report every capability as a flat-map entry rather than a pin capability."""

        return True

    def has_capability(capability: str) -> bool:
        """Report whether the supplied capability map supports ``capability``."""

        return bool(capabilities.get(capability))

    return is_general, has_capability, has_capability


def _missing_capability_names(missing: list[list[str]]) -> tuple[str, ...]:
    """Flatten the evaluator's unsatisfied OR-groups into one ordered name tuple."""

    names: list[str] = []
    for group in missing:
        for capability in group:
            if capability not in names:
                names.append(capability)
    return tuple(names)


@dataclass(frozen=True)
class _PackageGate:
    """Capability verdict plus manifest coordinates for one package id.

    ``satisfied`` is ``None`` when no variant manifest could be read, which the
    scan reports as "not staged, not gated out" plus a warning instead of a
    capability verdict it cannot support.
    """

    satisfied: bool | None
    missing: tuple[str, ...]
    manifest: Mapping[str, Any] | None
    manifest_path: Path | None
    warning: str | None


def _manifest_precedence(manifest: Mapping[str, Any]) -> int:
    """Return a manifest's ``precedence`` value, defaulting to ``0``."""

    value = manifest.get("precedence")
    if isinstance(value, bool):
        return 0
    try:
        precedence = int(value)
    except (TypeError, ValueError):
        return 0
    return precedence if precedence >= 0 else 0


def _package_gate(
    package_id: str,
    variants: list[PackageIndexEntry],
    *,
    roots: PackageRoots,
    predicates: tuple[CapabilityPredicate, CapabilityPredicate, CapabilityPredicate],
) -> _PackageGate:
    """Evaluate the capability requirements of every variant of ``package_id``.

    Gating verdicts come from :func:`...capability_requirements.evaluate_requirements`
    — the very function the staging resolver uses — so a package reported as staged
    here is a package a build would really embed. When several variants are
    satisfiable, the highest ``precedence`` supplies the reported name and version.
    """

    is_general, has_general_capability, has_pin_capability = predicates
    readable: list[tuple[int, Path, Mapping[str, Any]]] = []
    warning: str | None = None

    for entry in variants:
        manifest_path = roots.manifest_path(entry)
        try:
            manifest = read_package_manifest(
                roots.device_root,
                entry.manifest,
                addons_root=roots.addons_root,
                root=entry.root,
            )
        except (OSError, json.JSONDecodeError, ValueError) as error:
            if warning is None:
                warning = (
                    f"node package '{package_id}': unreadable manifest "
                    f"{entry.manifest} ({type(error).__name__})"
                )
            continue
        readable.append((_manifest_precedence(manifest), manifest_path, manifest))

    if not readable:
        return _PackageGate(
            satisfied=None,
            missing=(),
            manifest=None,
            manifest_path=None,
            warning=warning,
        )

    satisfied_variants: list[tuple[int, Path, Mapping[str, Any]]] = []
    unsatisfied_missing: list[str] = []
    for precedence, manifest_path, manifest in readable:
        ok, missing = evaluate_requirements(
            manifest.get("requiredCapabilities"),
            is_general,
            has_general_capability,
            has_pin_capability,
        )
        if ok:
            satisfied_variants.append((precedence, manifest_path, manifest))
        elif not unsatisfied_missing:
            unsatisfied_missing = list(_missing_capability_names(missing))

    if satisfied_variants:
        _precedence, manifest_path, manifest = max(
            satisfied_variants, key=lambda candidate: candidate[0]
        )
        return _PackageGate(
            satisfied=True,
            missing=(),
            manifest=manifest,
            manifest_path=manifest_path,
            warning=warning,
        )

    _precedence, manifest_path, manifest = max(readable, key=lambda candidate: candidate[0])
    return _PackageGate(
        satisfied=False,
        missing=tuple(unsatisfied_missing),
        manifest=manifest,
        manifest_path=manifest_path,
        warning=warning,
    )


def _manifest_text(manifest: Mapping[str, Any] | None, key: str) -> str | None:
    """Return a non-empty string field from ``manifest``, or ``None``."""

    if manifest is None:
        return None
    value = manifest.get(key)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _read_runtime_local_manifest(folder: Path) -> tuple[dict[str, Any] | None, str | None]:
    """Return ``(manifest, warning)`` for one runtime-local package folder.

    A missing, unparsable, or ``id``-mismatched manifest never raises: one broken
    package folder must not break the whole inventory.
    """

    manifest_path = folder / _MANIFEST_NAME
    if not manifest_path.is_file():
        return None, f"runtime-local package '{folder.name}': no {_MANIFEST_NAME}"
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        return None, (
            f"runtime-local package '{folder.name}': unreadable {_MANIFEST_NAME} "
            f"({type(error).__name__})"
        )
    if not isinstance(payload, dict):
        return None, f"runtime-local package '{folder.name}': {_MANIFEST_NAME} is not an object"
    declared_id = payload.get("id")
    if isinstance(declared_id, str) and declared_id.strip() and declared_id.strip() != folder.name:
        return None, (
            f"runtime-local package '{folder.name}': {_MANIFEST_NAME} declares id "
            f"{declared_id.strip()!r}"
        )
    return payload, None


def scan_local_packages(
    *,
    device_root: Path,
    runtime_id: str,
    capabilities: Mapping[str, object] | None = None,
    addons_root: Path | None = None,
) -> LocalPackageScan:
    """Return every node package on disk together with this runtime's staging status.

    Global packages come from ``node_pkgs/index.json`` in index order and are
    appended before the runtime-local folders under
    ``runtime/<runtime_id>/node_pkgs`` (sorted). ``capabilities`` is a flat
    capability map used for CNF gating; ``None`` (the default) means "no
    capability information", so requirements count as satisfied and the listing
    describes firmware membership only.

    Raises
    ------
    LocalPackageScanError
        ``runtime-not-found`` / ``runtime-manifest-invalid`` when the runtime
        manifest is missing or broken.
    """

    manifest = _load_runtime_manifest(device_root, runtime_id)
    global_ids = _manifest_package_ids(manifest, "global")
    local_ids = _manifest_package_ids(manifest, "local")
    roots = package_roots(device_root, addons_root)
    entries = load_package_entries(device_root, addons_root=addons_root)
    grouped = group_entries_by_id(entries)
    predicates = _capability_predicates(capabilities)

    records: list[LocalPackageRecord] = []
    warnings: list[str] = []

    for package_id, variants in grouped.items():
        gate = _package_gate(package_id, variants, roots=roots, predicates=predicates)
        if gate.warning is not None:
            warnings.append(gate.warning)
        listed = package_id in global_ids
        if gate.satisfied is None:
            staged = False
            gated_out = False
        else:
            staged = listed and gate.satisfied
            gated_out = listed and not gate.satisfied
        records.append(
            LocalPackageRecord(
                id=package_id,
                name=_manifest_text(gate.manifest, "name"),
                version=_manifest_text(gate.manifest, "version"),
                source=GLOBAL_PACKAGE_SOURCE,
                staged=staged,
                gated_out=gated_out,
                missing_capabilities=gate.missing if gated_out else (),
                manifest_path=gate.manifest_path,
            )
        )

    known_ids = set(grouped) | set(local_ids)
    for declared_id in global_ids:
        if declared_id not in known_ids:
            warnings.append(
                f"runtime manifest lists node package '{declared_id}' with no local package folder"
            )

    runtime_node_pkgs = _runtime_dir(device_root, runtime_id) / _RUNTIME_PACKAGE_ROOT
    if runtime_node_pkgs.is_dir():
        for folder in sorted(runtime_node_pkgs.iterdir()):
            if not folder.is_dir():
                continue
            local_manifest, warning = _read_runtime_local_manifest(folder)
            if warning is not None:
                warnings.append(warning)
            records.append(
                LocalPackageRecord(
                    id=folder.name,
                    name=_manifest_text(local_manifest, "name"),
                    version=_manifest_text(local_manifest, "version"),
                    source=RUNTIME_LOCAL_PACKAGE_SOURCE,
                    staged=False,
                    gated_out=False,
                    missing_capabilities=(),
                    manifest_path=folder / _MANIFEST_NAME if local_manifest is not None else None,
                )
            )

    return LocalPackageScan(
        runtime_id=runtime_id,
        packages=tuple(records),
        warnings=tuple(warnings),
    )


def build_package_scan_payload(scan: LocalPackageScan) -> dict[str, Any]:
    """Serialize ``scan`` into the shared package-inventory payload.

    The CLI prints this object and the ``WS /firmware`` scan job sends it, so a
    client never sees two shapes. Field names mirror the dataclass verbatim, with
    ``manifestPath`` rendered as a string or ``null``.
    """

    return {
        "schemaVersion": 1,
        "runtime": {"id": scan.runtime_id},
        "packages": [
            {
                "id": record.id,
                "name": record.name,
                "version": record.version,
                "source": record.source,
                "staged": record.staged,
                "gatedOut": record.gated_out,
                "missingCapabilities": list(record.missing_capabilities),
                "manifestPath": str(record.manifest_path) if record.manifest_path else None,
            }
            for record in scan.packages
        ],
        "warnings": list(scan.warnings),
    }


def _runtime_local_package_ids(runtime_node_pkgs: Path) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Return ``(current, skipped)`` package folder names under one runtime folder.

    A folder counts as ``current`` only when its ``manifest.json`` parses as an
    object whose ``id`` equals the folder name. Everything else — plain files,
    missing or unreadable manifests, id mismatches — is reported in ``skipped``.
    """

    if not runtime_node_pkgs.is_dir():
        return (), ()

    current: list[str] = []
    skipped: list[str] = []
    for entry in sorted(runtime_node_pkgs.iterdir()):
        if not entry.is_dir():
            skipped.append(entry.name)
            continue
        manifest, _warning = _read_runtime_local_manifest(entry)
        if manifest is None:
            skipped.append(entry.name)
            continue
        current.append(entry.name)
    return tuple(current), tuple(skipped)


def update_runtime_local_packages(
    *,
    device_root: Path,
    runtime_id: str,
    apply: bool = False,
) -> LocalPackageSyncResult:
    """Reconcile ``nodePackages.local`` with the package folders on disk.

    ``apply=False`` (the default) only reports the drift, which makes the command
    useful as a check. ``apply=True`` rewrites that one key — every other key and
    its order is preserved — and reports ``written=True``.

    This is a **bookkeeping** edit for humans running the CLI. The server never
    calls it, no build calls it, and it cannot influence which node-package source
    the web app uploads: ``nodePackages.local`` is not a "present in firmware"
    signal.

    Raises
    ------
    LocalPackageScanError
        ``runtime-not-found`` / ``runtime-manifest-invalid``. A missing manifest is
        never invented.
    """

    manifest = _load_runtime_manifest(device_root, runtime_id)
    manifest_path = _runtime_dir(device_root, runtime_id) / _RUNTIME_MANIFEST_NAME
    previous = _manifest_package_ids(manifest, "local")
    runtime_node_pkgs = _runtime_dir(device_root, runtime_id) / _RUNTIME_PACKAGE_ROOT
    current, skipped = _runtime_local_package_ids(runtime_node_pkgs)

    if not apply or previous == current:
        return LocalPackageSyncResult(
            written=False,
            previous=previous,
            current=current,
            skipped=skipped,
        )

    node_packages = manifest.get("nodePackages")
    if not isinstance(node_packages, dict):
        node_packages = {}
        manifest["nodePackages"] = node_packages
    node_packages["local"] = list(current)

    with manifest_path.open("w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, ensure_ascii=False)
        handle.write("\n")

    return LocalPackageSyncResult(
        written=True,
        previous=previous,
        current=current,
        skipped=skipped,
    )

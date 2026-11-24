"""Contract invariants for the server firmware surface.

These tests are the tripwire between the four contract documents in
``docs/dev/firmware-compile/`` and the code that implements them. They are
deliberately small and network-free: parse a document, compare it with a
constant, fail loudly. If one of them fails, fix whichever side is wrong — never
delete the test.
"""

from __future__ import annotations

import re
from dataclasses import fields
from pathlib import Path

import pytest

from micro_otter.config import load_config
from micro_otter.tools.firmware_compile.backends import reset_registry
from micro_otter.tools.firmware_compile.firmware_deploy import FLASH_ERROR_CODES
from micro_otter.tools.firmware_compile.flash import reset_flash_registry
from micro_otter.tools.firmware_ws_handler import (
    _FRAME_BUILDERS,
    ERROR_CODES,
    CompileJobRequest,
    DeployJobRequest,
    parse_client_frame,
)
from micro_otter.tools.server_capabilities import CAPABILITY_KEYS, build_server_capabilities

REPO_ROOT = Path(__file__).resolve().parents[1]
CONTRACT_DOCS = REPO_ROOT / "docs" / "dev" / "firmware-compile"
SERVICE_DOC = CONTRACT_DOCS / "server-firmware-api.md"
PROTOCOL_DOC = CONTRACT_DOCS / "firmware-build-websocket-protocol.md"
DEPLOY_DOC = CONTRACT_DOCS / "firmware-deploy-contract.md"
DEPLOYMENT_JS = REPO_ROOT / "src" / "micro_otter" / "nodes" / "html" / "js" / "deployment"

_ROW_RE = re.compile(r"^\|\s*`([^`]+)`\s*\|")
"""One markdown table row whose first cell is a single backticked identifier."""

_UPLOAD_DIRECTIVE_TOKENS = (
    "upload",
    "source",
    "collection",
    "deploy",
)
"""Substrings that must never name a field of a ``compile.start``/``deploy.start`` request.

A firmware job describes *image content*. Anything that could be read as an
instruction to upload node-package source belongs to ``runtime-deployment.ts``
and must not leak into this schema as it grows.
"""


@pytest.fixture(autouse=True)
def _isolated_registries():
    """Reset both backend registries so the payload is deterministic per test."""

    reset_registry()
    reset_flash_registry()
    yield
    reset_registry()
    reset_flash_registry()


def _table_codes(path: Path, heading: str) -> set[str]:
    """Return the first-column identifiers of every table row under *heading*.

    The scan stops at the next markdown heading of any level, so the frame and
    field tables elsewhere in the same file cannot pollute the result.
    """

    text = path.read_text(encoding="utf-8")
    start = text.index(heading)
    lines = text[start:].splitlines()[1:]
    codes: set[str] = set()
    for line in lines:
        if line.startswith("#"):
            break
        match = _ROW_RE.match(line.strip())
        if match is not None:
            codes.add(match.group(1))
    return codes


def test_capabilities_payload_has_exactly_contract_keys():
    """The payload carries exactly the seven documented keys, and no schema version."""

    payload = build_server_capabilities(config=load_config(env={}), version="9.9.9")

    assert tuple(payload) == CAPABILITY_KEYS
    assert "schemaVersion" not in payload
    assert _table_codes(SERVICE_DOC, "### Keys") == set(CAPABILITY_KEYS)


def test_documented_error_codes_match_handler_codes():
    """The protocol document lists exactly the codes the handler can emit."""

    assert _table_codes(PROTOCOL_DOC, "## Error codes") == set(ERROR_CODES)


def test_documented_frame_types_match_builders():
    """The frame table lists exactly the types the handler dispatches."""

    rows = _table_codes(PROTOCOL_DOC, "## Client → server frames")
    # The first table cell is the backticked column header ``type``, not a frame.
    assert "type" in rows
    assert rows - {"type"} == set(_FRAME_BUILDERS)


def test_documented_flash_codes_match_deploy_helper():
    """The deploy document lists exactly the ``flash-*`` codes the helper derives."""

    assert _table_codes(DEPLOY_DOC, "## Flash error codes") == set(FLASH_ERROR_CODES)
    assert set(FLASH_ERROR_CODES) <= set(ERROR_CODES)


def test_source_upload_path_ignores_firmware_selection():
    """The upload decision path never reads a firmware-selection input.

    The collection-deploy fallback for ``missing`` / ``override-required``
    packages must stay independent of firmware content, feature flags, and
    package selection. Keep this a text guard: a legitimate future mention has to
    be a deliberate allowlist edit, not an accident. It never replaces
    ``tests/deployment/collection-deployment-*.test.js``, which remain the
    authoritative behavioural gate.
    """

    forbidden = (
        "enable_compile",
        "enable_deploy",
        "packageIds",
        "modulePackagingMode",
        "firmware-compile",
        "firmware-deploy",
    )
    allowlist: dict[str, tuple[str, ...]] = {
        # ``device-deployment.ts`` owns the *upload confirmation* path. Its
        # ``EmbeddedSourceOverrideDeclinedError.packageIds`` list names the
        # firmware-bundled packages whose source the user declined to overwrite —
        # it comes from the deploy classifier's ``outdated`` entries, never from
        # ``compile.start``. Allowing the token here keeps the guard on the other
        # five inputs for that file.
        "device-deployment.ts": ("packageIds",),
        # ``collection-deployment.ts`` enforces the embedded override approval:
        # ``EmbeddedOverrideApprovalRequiredError.packageIds`` names the shadow packages
        # whose upload paths were not approved. Like the decline list it is derived from
        # the firmware module plan, never from a firmware build selection, and the
        # source-upload fallback still ignores every one of the six inputs.
        "collection-deployment.ts": ("packageIds",),
    }
    """File name -> tokens that file may legitimately mention, with the reason.

    Every entry needs a reason; an unexplained token is a regression, not an
    exemption.
    """

    sources = sorted(DEPLOYMENT_JS.glob("*.ts"))
    assert sources, "deployment sources moved; update this guard instead of deleting it"

    offenders: list[str] = []
    for path in sources:
        text = path.read_text(encoding="utf-8")
        permitted = allowlist.get(path.name, ())
        offenders.extend(
            f"{path.name}: {token}"
            for token in forbidden
            if token not in permitted and token in text
        )

    assert offenders == [], "the source-upload path must not read firmware selection: " + ", ".join(
        offenders
    )


def test_compile_frame_never_carries_upload_directives():
    """A parsed ``compile.start``/``deploy.start`` request exposes no upload field."""

    compile_request = parse_client_frame(
        '{"type": "compile.start", "runtimeId": "general", "board": "esp32", '
        '"packageIds": ["core"], "modulePackagingMode": "compiled-mpy"}'
    )
    deploy_request = parse_client_frame(
        '{"type": "deploy.start", "board": "esp32", "port": "/dev/ttyUSB0"}'
    )

    assert isinstance(compile_request, CompileJobRequest)
    assert isinstance(deploy_request, DeployJobRequest)

    for request in (compile_request, deploy_request):
        for field in fields(request):
            lowered = field.name.lower()
            assert not any(token in lowered for token in _UPLOAD_DIRECTIVE_TOKENS), (
                f"{type(request).__name__}.{field.name} reads like an upload instruction; "
                "source upload is not a firmware job input"
            )

    # The one selection field stays a selection field: it narrows image content.
    assert compile_request.package_ids == ("core",)
    assert compile_request.module_packaging_mode == "compiled-mpy"

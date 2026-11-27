"""Structural tests for the Docker image and compose contract.

These tests assert the *contract* of the Docker distribution without a Docker
daemon: the build-context filter, the runtime/compile Dockerfiles, the compose
profiles, the USB overlay, and the ``.env.example`` variables must not drift.
The live ``docker build``/``run``/``compose`` smoke runs on a host with a daemon
(iteration 34 phase 6) and in the CI ``docker``/``windows`` jobs.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
DEPLOY_DOCKER = REPO_ROOT / "deploy" / "docker"
DOCKERIGNORE = REPO_ROOT / ".dockerignore"
RUNTIME_DOCKERFILE = DEPLOY_DOCKER / "Dockerfile.runtime"
COMPILE_DOCKERFILE = DEPLOY_DOCKER / "Dockerfile.compile"
COMPOSE = DEPLOY_DOCKER / "compose.yaml"
COMPOSE_USB = DEPLOY_DOCKER / "compose.usb.yaml"
ENV_EXAMPLE = DEPLOY_DOCKER / ".env.example"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _normalized(text: str) -> str:
    """Lowercase ``text`` and collapse whitespace so assertions ignore line wrapping."""

    return re.sub(r"\s+", " ", text.lower())


# --- phase 1: runtime image & .dockerignore ------------------------------------

DOCKERIGNORE_EXCLUDES: tuple[str, ...] = (
    ".git/",
    ".devcontainer/",
    ".github/",
    ".vscode/",
    "ldev/",
    "dev/",
    "docs/",
    "user-docs/",
    "site/",
    "ai/",
    ".cline/",
    "_dist/",
    "dist/",
    "node_modules/",
    ".venv/",
    "tests/",
    "examples/",
    "hooks/",
)


def _dockerignore_entries() -> list[str]:
    return [
        line.strip()
        for line in _read(DOCKERIGNORE).splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]


def test_dockerignore_excludes_private_and_build_output() -> None:
    entries = _dockerignore_entries()
    missing = [entry for entry in DOCKERIGNORE_EXCLUDES if entry not in entries]
    assert not missing, f".dockerignore is missing required exclusions: {missing}"


def test_dockerignore_keeps_the_wheel_build_inputs() -> None:
    """The wheel build inputs are kept implicitly — never listed as exclusions."""

    entries = _dockerignore_entries()
    for keep in ("deploy/", "deploy/toolchain", "deploy/packaging", "src/", "tools/"):
        assert keep not in entries, f".dockerignore must keep {keep!r}; do not exclude it"


def test_runtime_dockerfile_contract() -> None:
    text = _read(RUNTIME_DOCKERFILE)
    for required in (
        "USER microotter",
        'VOLUME ["/data"]',
        "HEALTHCHECK",
        "SETUPTOOLS_SCM_PRETEND_VERSION_FOR_MICRO_OTTER",
    ):
        assert required in text, f"Dockerfile.runtime must contain {required!r}"
    for forbidden in ("idf.py", "git clone", "usr/bin/gpg"):
        assert forbidden not in text, f"Dockerfile.runtime must not contain {forbidden!r}"


def test_runtime_dockerfile_reuses_the_wheel_build_script() -> None:
    text = _read(RUNTIME_DOCKERFILE)
    assert "build-wheel.sh" in text, "the builder must reuse the phase-0 build script"
    assert "pip install" in text, "the runtime stage must install the built wheel"


# --- phase 2: compile image, compose profiles & USB overlay --------------------


def _yaml(path: Path) -> dict:
    return yaml.safe_load(_read(path))


def _compose() -> dict:
    return _yaml(COMPOSE)


def _interpolated_vars(text: str) -> list[str]:
    return re.findall(r"\$\{([A-Z0-9_]+)(?::-[^}]*)?\}", text)


def test_compile_dockerfile_contract() -> None:
    text = _read(COMPILE_DOCKERFILE)
    assert "FROM ${RUNTIME_IMAGE}" in text, "Dockerfile.compile must extend the runtime image"
    assert "micro-otter toolchain install" in text, "compile image must use the CLI install path"
    for forbidden in ("git clone", "usr/bin/gpg"):
        assert forbidden not in text, f"Dockerfile.compile must not contain {forbidden!r}"


def test_compose_services_and_profiles() -> None:
    services = _compose()["services"]
    assert set(services) == {"micro-otter", "micro-otter-compile"}, services
    assert services["micro-otter"]["profiles"] == ["runtime"]
    assert services["micro-otter-compile"]["profiles"] == ["compile"]


def test_compose_build_ports_and_volumes() -> None:
    for service in _compose()["services"].values():
        assert service["build"]["context"] == "../.."
        assert service["ports"] == ["${MICRO_OTTER_PORT:-8000}:8000"]
        assert "micro-otter-data:/data" in service["volumes"]


def test_compose_compile_build_arg_references_runtime_image() -> None:
    services = _compose()["services"]
    runtime_image = services["micro-otter"]["image"]
    compile_arg = services["micro-otter-compile"]["build"]["args"]["RUNTIME_IMAGE"]
    assert (
        compile_arg == runtime_image
    ), f"the compile image must build from the runtime image tag: {compile_arg} != {runtime_image}"


def test_compose_variables_have_env_example_lines() -> None:
    env_text = _read(ENV_EXAMPLE)
    missing = [var for var in _interpolated_vars(_read(COMPOSE)) if var not in env_text]
    assert not missing, f".env.example has no line for these compose variables: {missing}"


def test_usb_overlay_targets_only_the_runtime_service() -> None:
    services = _yaml(COMPOSE_USB)["services"]
    assert set(services) == {"micro-otter"}, services
    runtime = services["micro-otter"]
    assert "dialout" in runtime.get("group_add", [])
    assert set(runtime.get("device_cgroup_rules", [])) == {"c 188:* rmw", "c 166:* rmw"}

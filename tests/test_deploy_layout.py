"""Structural tests for the ``deploy/`` distribution layout.

The layout is load-bearing: containers (M7), releases (M8), and packaging (M7) add files to these
folders later, so the folder set, the ownership documentation, and the source-upload boundary must
not drift.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEPLOY_ROOT = REPO_ROOT / "deploy"

REQUIRED_PATHS: tuple[str, ...] = (
    "README.md",
    "toolchain/README.md",
    "toolchain/versions.env",
    "toolchain/bootstrap.sh",
    "toolchain/doctor.sh",
    "toolchain/esp-idf/bootstrap.sh",
    "docker/README.md",
    "docker/Dockerfile.runtime",
    "release/README.md",
    "packaging/README.md",
    "packaging/build-wheel.sh",
)

PLACEHOLDER_DIRS: tuple[str, ...] = ("release",)


def _normalized(text: str) -> str:
    """Lowercase ``text`` and collapse whitespace so assertions ignore line wrapping."""

    return re.sub(r"\s+", " ", text.lower())


def test_deploy_layout_contains_every_required_path() -> None:
    """The milestone-1 skeleton must exist with its documented entry points."""

    missing = [relative for relative in REQUIRED_PATHS if not (DEPLOY_ROOT / relative).exists()]

    assert not missing, f"deploy/ layout is incomplete; missing: {missing}"


def test_placeholder_folders_contain_only_a_readme() -> None:
    """Folders owned by later milestones stay placeholders during M1."""

    for name in PLACEHOLDER_DIRS:
        entries = sorted(entry.name for entry in (DEPLOY_ROOT / name).iterdir())

        assert entries == ["README.md"], (
            f"deploy/{name}/ is a placeholder until its milestone; expected only README.md, "
            f"found {entries}"
        )


def test_deploy_readme_states_folder_ownership() -> None:
    """Every folder in the layout is documented with its owning milestone."""

    text = _normalized((DEPLOY_ROOT / "README.md").read_text(encoding="utf-8"))

    for folder in ("toolchain/", "docker/", "release/", "packaging/"):
        assert folder in text, f"deploy/README.md must document ownership of {folder}"

    for milestone in ("m1", "m7", "m8"):
        assert milestone in text, f"deploy/README.md must reference milestone {milestone.upper()}"


def test_deploy_readme_keeps_source_upload_outside_deploy() -> None:
    """Node-package source upload stays in the web-app path, not in the backend seam."""

    text = _normalized((DEPLOY_ROOT / "README.md").read_text(encoding="utf-8"))

    assert "node-package source deployment is not a `deploy/` responsibility" in text


def test_placeholder_readmes_name_their_owner() -> None:
    """Each placeholder README states who owns the folder so later work lands in one place."""

    for name in PLACEHOLDER_DIRS:
        text = _normalized((DEPLOY_ROOT / name / "README.md").read_text(encoding="utf-8"))

        assert "owner:" in text, f"deploy/{name}/README.md must state its owning milestone"
        assert "m7" in text or "m8" in text, f"deploy/{name}/README.md must name the milestone"

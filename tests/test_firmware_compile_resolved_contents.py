from pathlib import Path

from micro_otter.tools.firmware_compile.resolved_contents import (
    MPY_FREEZE,
    NO_EMBEDDING,
    build_resolved_contents,
)
from micro_otter.tools.firmware_compile.staging_models import RuntimePackageAsset, RuntimePayload


def _payload() -> RuntimePayload:
    """Return a minimal resolved runtime payload for the mapping tests."""

    return RuntimePayload(
        runtime_id="general",
        runtime_version="1.2.3",
        runtime_root=Path("/runtime"),
        runtime_files=("main.py",),
        tools_files=("tool.py",),
        package_assets=(
            RuntimePackageAsset(
                package_id="pkg-a",
                package_version="0.1.0",
                source_path=Path("/src/a"),
                target_rel_path="pkg_a/mod.py",
            ),
            RuntimePackageAsset(
                package_id="pkg-b",
                package_version=None,
                source_path=Path("/src/b"),
                target_rel_path="pkg_b/mod.py",
            ),
        ),
    )


def test_mpy_freeze_backend_embeds_every_package():
    contents = build_resolved_contents(_payload(), embedding=MPY_FREEZE)

    assert contents.runtime_id == "general"
    assert contents.runtime_version == "1.2.3"
    assert [entry.target_rel_path for entry in contents.file_entries] == [
        "pkg_a/mod.py",
        "pkg_b/mod.py",
    ]
    assert contents.node_packages == {"pkg-a": "0.1.0", "pkg-b": None}
    assert contents.not_embedded_packages == ()


def test_no_embedding_backend_marks_every_package_not_embedded():
    contents = build_resolved_contents(_payload(), embedding=NO_EMBEDDING)

    assert contents.not_embedded_packages == ("pkg-a", "pkg-b")

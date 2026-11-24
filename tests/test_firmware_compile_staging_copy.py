from pathlib import Path

import pytest

from micro_otter.tools.firmware_compile.staging_copy import execute_staging_copy
from micro_otter.tools.firmware_compile.staging_models import (
    StagingConflict,
    StagingFileEntry,
    StagingPreflightResult,
)
from micro_otter.tools.firmware_compile.staging_paths import resolve_staging_paths


def _paths(tmp_path: Path):
    modules = tmp_path / "src" / "micropython" / "ports" / "esp32" / "modules"
    modules.mkdir(parents=True)
    return resolve_staging_paths(workspace_root=tmp_path, target="esp32")


def test_execute_staging_copy_copies_entries(tmp_path: Path):
    paths = _paths(tmp_path)

    src = tmp_path / "input" / "a.py"
    src.parent.mkdir(parents=True)
    src.write_text("print('ok')\n", encoding="utf-8")

    preflight = StagingPreflightResult(
        entries=[
            StagingFileEntry(
                source_path=src, target_rel_path="libs/core/a.py", origin="package"
            )
        ]
    )

    result = execute_staging_copy(paths=paths, preflight=preflight)

    assert result.files_discovered == 1
    assert result.files_copied == 1
    assert (paths.modules_path / "libs" / "core" / "a.py").exists()


def test_execute_staging_copy_rejects_conflicts(tmp_path: Path):
    paths = _paths(tmp_path)
    preflight = StagingPreflightResult(
        conflicts=[
            StagingConflict(
                target_rel_path="libs/core/a.py",
                first_source=Path("/a"),
                second_source=Path("/b"),
            )
        ]
    )

    with pytest.raises(ValueError, match="conflicts"):
        execute_staging_copy(paths=paths, preflight=preflight)


def test_execute_staging_copy_dry_run(tmp_path: Path):
    paths = _paths(tmp_path)

    src = tmp_path / "input" / "a.py"
    src.parent.mkdir(parents=True)
    src.write_text("print('ok')\n", encoding="utf-8")

    preflight = StagingPreflightResult(
        entries=[
            StagingFileEntry(
                source_path=src, target_rel_path="libs/core/a.py", origin="package"
            )
        ]
    )

    result = execute_staging_copy(paths=paths, preflight=preflight, dry_run=True)

    assert result.files_copied == 1
    assert not (paths.modules_path / "libs" / "core" / "a.py").exists()

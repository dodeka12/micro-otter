"""Startup file staging helpers for firmware runtime packaging."""

from __future__ import annotations

import shutil

from .staging_models import RuntimePayload, StagingStartupResult
from .staging_paths import StagingPaths

_STARTUP_SHIM = """try:
    import otter_runtime.bootstrap_setup_startup as _bootstrap_setup_startup
    import otter_main as _micro_otter_main
except Exception as _boot_import_error:
    print(
        "[error] boot: runtime import failed ({})".format(
            str(_boot_import_error).replace("\\n", " ")
        )
    )
else:
    try:
        _bootstrap_setup_startup.run_bootstrap_setup_from_startup(
            _bootstrap_setup_startup.STARTUP_ADAPTER_TARGET_ENTRYPOINT
        )
    except Exception as _bootstrap_setup_error:
        print(
            "[error] boot: bootstrap setup trigger failed ({})".format(
                str(_bootstrap_setup_error).replace("\\n", " ")
            )
        )

    _micro_otter_main.run()
"""


def render_main_py_shim() -> str:
    """Return deterministic `main.py` shim content."""

    return _STARTUP_SHIM


def stage_startup_files(
    paths: StagingPaths,
    payload: RuntimePayload,
    dry_run: bool = False,
) -> StagingStartupResult:
    """Stage runtime startup module and deterministic main.py shim."""

    modules_root = paths.modules_path.resolve()
    source_main = (payload.runtime_root / "otter_main.py").resolve()
    if not source_main.exists() or not source_main.is_file():
        raise FileNotFoundError(f"Missing startup module: {source_main}")

    result = StagingStartupResult(files_discovered=2, dry_run=dry_run)

    target_runtime_main = (modules_root / "otter_main.py").resolve()
    target_main_py = (modules_root / "main.py").resolve()

    if dry_run:
        result.files_written = 2
        return result

    target_runtime_main.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_main, target_runtime_main)
    result.files_written += 1

    target_main_py.parent.mkdir(parents=True, exist_ok=True)
    target_main_py.write_text(render_main_py_shim(), encoding="utf-8")
    result.files_written += 1

    return result

"""Guard tests for the firmware backend seam boundaries.

These tests parse the seam modules with :mod:`ast` instead of matching strings so
they fail on structure, not formatting. They exist to stop a future change from
moving node-package source-upload decisions — or CLI/node concerns — into the
`BuildBackend`/`FlashBackend` seam. They do not replace the web-app deployment
suite (`tests/deployment/`), which remains the behavioral proof.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
FIRMWARE_COMPILE_ROOT = REPO_ROOT / "src/micro_otter/tools/firmware_compile"
BACKEND_PACKAGE = FIRMWARE_COMPILE_ROOT / "backends"
FLASH_PACKAGE = FIRMWARE_COMPILE_ROOT / "flash"
ORCHESTRATION_MODULE = FIRMWARE_COMPILE_ROOT / "build_orchestration.py"

PACKAGE_PREFIX = "micro_otter.tools.firmware_compile"

SEAM_FILES = (
    BACKEND_PACKAGE / "base.py",
    BACKEND_PACKAGE / "registry.py",
    BACKEND_PACKAGE / "esp_idf.py",
    FLASH_PACKAGE / "base.py",
    FLASH_PACKAGE / "registry.py",
    FLASH_PACKAGE / "esptool.py",
)

PACKAGE_FILES = (
    *SEAM_FILES,
    BACKEND_PACKAGE / "__init__.py",
    FLASH_PACKAGE / "__init__.py",
)

FORBIDDEN_IMPORT_PREFIXES = ("micro_otter.cli", "micro_otter.nodes")

FORBIDDEN_PIPELINE_PREFIXES = (
    f"{PACKAGE_PREFIX}.compile_command",
    f"{PACKAGE_PREFIX}.staging_paths",
    f"{PACKAGE_PREFIX}.staging_runner",
    f"{PACKAGE_PREFIX}.build_toolchain",
    f"{PACKAGE_PREFIX}.build_precompile",
    f"{PACKAGE_PREFIX}.build_preflight",
    f"{PACKAGE_PREFIX}.build_artifact",
)

DEPLOYMENT_TOKENS = (
    "collection_deployment",
    "device_deployment",
    "collection-deployment",
    "device-deployment",
)


def _parse(path: Path) -> ast.Module:
    """Parse *path* into an AST."""

    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def _is_type_checking_block(node: ast.AST) -> bool:
    """Return True when *node* is a top-level ``if TYPE_CHECKING:`` guard."""

    if not isinstance(node, ast.If):
        return False
    test = node.test
    if isinstance(test, ast.Name):
        return test.id == "TYPE_CHECKING"
    if isinstance(test, ast.Attribute):
        return test.attr == "TYPE_CHECKING"
    return False


def _resolved_imports(nodes: list[ast.AST]) -> list[str]:
    """Return every imported module path under *nodes*, normalizing relative ones.

    Relative imports inside ``firmware_compile`` can only reach that package, so
    they are expressed with the package prefix; that is precise enough for the
    forbidden-prefix checks below.
    """

    modules: list[str] = []
    for root in nodes:
        for node in ast.walk(root):
            if isinstance(node, ast.Import):
                modules.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                if node.level:
                    suffix = node.module or ""
                    modules.append(f"{PACKAGE_PREFIX}.{suffix}" if suffix else PACKAGE_PREFIX)
                else:
                    modules.append(node.module or "")
    return modules


def _runtime_imports(tree: ast.Module) -> list[str]:
    """Return imports that execute at import time, skipping ``TYPE_CHECKING`` blocks."""

    return _resolved_imports([node for node in tree.body if not _is_type_checking_block(node)])


def _deployment_tokens(tree: ast.Module) -> set[str]:
    """Return deployment-module tokens referenced anywhere in *tree*.

    Identifiers, attribute names, and string constants are all inspected, so an
    import, a dynamic ``import_module`` call, or a path string counts equally.
    """

    found: set[str] = set()
    for node in ast.walk(tree):
        names: list[str] = []
        if isinstance(node, ast.Name):
            names.append(node.id)
        elif isinstance(node, ast.Attribute):
            names.append(node.attr)
        elif isinstance(node, ast.alias):
            names.append(node.name)
            if node.asname:
                names.append(node.asname)
        elif isinstance(node, ast.Constant) and isinstance(node.value, str):
            names.append(node.value)
        for name in names:
            lowered = name.lower()
            found.update(token for token in DEPLOYMENT_TOKENS if token in lowered)
    return found


def _method_node(tree: ast.Module, class_name: str, method_name: str) -> ast.AST:
    """Return the AST node for *class_name*.*method_name*."""

    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == class_name:
            for item in node.body:
                if isinstance(item, ast.FunctionDef | ast.AsyncFunctionDef):
                    if item.name == method_name:
                        return item
    raise AssertionError(f"{class_name}.{method_name} not found")


@pytest.mark.parametrize("path", SEAM_FILES, ids=lambda item: item.name)
def test_seam_modules_never_import_cli_or_node_code(path: Path):
    """The seam must not reach into the CLI or the node/device trees."""

    imports = _resolved_imports([_parse(path)])
    offenders = [
        module
        for module in imports
        if any(
            module == prefix or module.startswith(f"{prefix}.")
            for prefix in FORBIDDEN_IMPORT_PREFIXES
        )
    ]

    assert offenders == []


@pytest.mark.parametrize("path", SEAM_FILES, ids=lambda item: item.name)
def test_seam_modules_never_import_pipeline_execution_modules(path: Path):
    """Only the esp-idf backend may import the MicroPython pipeline modules."""

    imports = _runtime_imports(_parse(path))
    offenders = [
        module
        for module in imports
        if any(module.startswith(prefix) for prefix in FORBIDDEN_PIPELINE_PREFIXES)
    ]

    if path.name == "esp_idf.py":
        # The backend owns staging, precompile, the toolchain command, and
        # artifact discovery, so these imports live here and nowhere else.
        assert offenders != []
        assert any(module.endswith("build_orchestration") for module in imports)
        return

    assert offenders == []


PROCESS_STREAM_MODULE = FIRMWARE_COMPILE_ROOT / "process_stream.py"

PROCESS_LAUNCHERS = {"run", "Popen", "call", "check_call", "check_output"}


@pytest.mark.parametrize(
    "path",
    sorted([ORCHESTRATION_MODULE, *BACKEND_PACKAGE.glob("*.py"), *FLASH_PACKAGE.glob("*.py")]),
    ids=lambda path: path.name,
)
def test_seam_modules_launch_processes_only_through_the_shared_sink(path: Path) -> None:
    """Build and flash adapters never spawn a process outside ``process_stream``."""

    tree = _parse(path)
    launches = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Attribute)
        and node.attr in PROCESS_LAUNCHERS
        and isinstance(node.value, ast.Name)
        and node.value.id == "subprocess"
    ]

    assert launches == [], (
        f"{path.name} launches a subprocess directly; use "
        "process_stream.run_streamed_process so output streams and timeouts work"
    )


def test_shared_orchestration_imports_no_micropython_pipeline() -> None:
    """The shared orchestration resolves + delegates; it imports no make/staging."""

    imports = _runtime_imports(_parse(ORCHESTRATION_MODULE))
    offenders = [
        module
        for module in imports
        if any(module.startswith(prefix) for prefix in FORBIDDEN_PIPELINE_PREFIXES)
    ]

    assert offenders == []


@pytest.mark.parametrize("path", PACKAGE_FILES, ids=lambda item: f"{item.parent.name}-{item.name}")
def test_seam_packages_have_no_deployment_references(path: Path):
    """No seam module may reference the web-app collection deployment modules."""

    assert _deployment_tokens(_parse(path)) == set()


@pytest.mark.parametrize("path", SEAM_FILES, ids=lambda item: item.name)
def test_seam_modules_define_no_async_functions(path: Path):
    """Backends block on their toolchain; event loops belong to callers."""

    async_names = [
        node.name for node in ast.walk(_parse(path)) if isinstance(node, ast.AsyncFunctionDef)
    ]

    assert async_names == []


def test_protocol_entrypoints_are_synchronous():
    """The protocol methods themselves are plain functions."""

    build_method = _method_node(_parse(BACKEND_PACKAGE / "base.py"), "BuildBackend", "build")
    flash_method = _method_node(_parse(FLASH_PACKAGE / "base.py"), "FlashBackend", "flash")

    assert isinstance(build_method, ast.FunctionDef)
    assert isinstance(flash_method, ast.FunctionDef)


def test_run_build_orchestration_stage_callback_defaults_to_none():
    """Omitting the stage callback keeps the pre-iteration call signature."""

    tree = _parse(ORCHESTRATION_MODULE)
    function = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name == "run_build_orchestration"
    )
    arguments = function.args
    keyword_names = [argument.arg for argument in arguments.kwonlyargs]

    assert "stage_callback" in keyword_names
    default = arguments.kw_defaults[keyword_names.index("stage_callback")]
    assert isinstance(default, ast.Constant)
    assert default.value is None

"""Structural guards for the add-on node-package contract.

Each test reads source text and asserts one structural fact, so a later refactor fails with the
rule it protects instead of a mysterious behaviour change. Nothing here imports the build stack
beyond the modules under inspection.
"""

from __future__ import annotations

import ast
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src" / "micro_otter"
TOOLS = SOURCE / "tools"
FIRMWARE_COMPILE = TOOLS / "firmware_compile"
WEBAPP_DEPLOYMENT = SOURCE / "nodes" / "html" / "js" / "deployment"
EXAMPLE_ADDONS = ROOT / "examples" / "addons" / "node_pkgs"
REPO_LICENSE = ROOT / "LICENSE"


def _read(path: Path) -> str:
    """Return the text of *path*."""

    return path.read_text(encoding="utf-8")


def test_only_install_and_mpy_precompile_write_into_the_addons_root() -> None:
    """Read-only inventory: no other tool module writes next to an add-on package."""

    allowed = {"addon_archive.py", "addon_store.py", "mpy_precompile.py"}
    offenders: list[str] = []
    for path in sorted(TOOLS.glob("*.py")):
        text = _read(path)
        if "addons_root" not in text and "addons_dir" not in text:
            continue
        if path.name in allowed:
            continue
        if re.search(r"write_text\(|\.open\(\s*[\"']w|shutil\.rmtree|os\.replace\(", text):
            offenders.append(path.name)

    assert offenders == [], (
        "only addon_archive.py and mpy_precompile.py may write inside the addons root: "
        + ", ".join(offenders)
    )


def test_node_pkgs_path_join_lives_only_in_package_roots() -> None:
    """One join point: no call site re-grows a ``node_pkgs`` path join."""

    allowed = {
        "package_resolver.py",  # PackageRoots.builtin_node_pkgs
        "mpy_precompile.py",  # runtime-manifest walk and the runtime-local candidate
        "compile_command.py",  # built-in version lookup for the runtime lineage
        "staleness.py",  # built-in version lookup for the staleness check
        # The runtime-local inventory folder (`runtime/<id>/node_pkgs`) is not a
        # package-resolution root: the scan lists it and `--sync-local` rewrites
        # its owning manifest, so the join lives here instead of PackageRoots.
        "local_package_scan.py",
    }
    offenders = [
        path.name
        for path in sorted(FIRMWARE_COMPILE.glob("*.py"))
        if '"node_pkgs"' in _read(path) and path.name not in allowed
    ]

    assert offenders == [], "package path joins must go through PackageRoots: " + ", ".join(
        offenders
    )


def test_compilation_is_inherited_from_staging_not_addon_specific() -> None:
    """Compile is inherited: no add-on branch in the precompile step or the backend."""

    precompile = _read(FIRMWARE_COMPILE / "build_precompile.py")
    orchestration = _read(FIRMWARE_COMPILE / "backends" / "esp_idf.py")

    assert "addon" not in precompile.lower()
    assert orchestration.count("mpy_precompile_hook=") == 1
    # The hook is passed during staging and the hash records are built afterwards.
    staging_call = orchestration.index("mpy_precompile_hook=")
    assert orchestration.index("stage_callback", staging_call) > staging_call
    assert "addons_root" in orchestration


def test_deployment_code_never_learns_about_provenance() -> None:
    """Source upload stays untouched: the deploy views never read add-on provenance.

    The only namespace fact deploy may use is the shared predicate in
    ``js/data/module-namespace.ts``; a literal ``moa_`` here would hard-code the
    add-on namespace back into the deploy layer, bypassing that single source.
    """

    offenders: list[str] = []
    for path in sorted(WEBAPP_DEPLOYMENT.rglob("*")):
        if not path.is_file() or path.suffix not in {".ts", ".js"}:
            continue
        text = _read(path)
        for token in ("packageProvenance", "addons_dir", "addonId", "moa_"):
            if token in text:
                offenders.append(f"{path.name}:{token}")

    assert offenders == [], (
        "the collection deploy path must not consult add-on provenance: " + ", ".join(offenders)
    )


def test_servers_never_write_files() -> None:
    """The servers serve merged payloads from memory; they never write or delete."""

    offenders: list[str] = []
    for name in ("serial_bridge.py", "serve_nodes.py"):
        text = _read(TOOLS / name)
        for token in ("write_text", "shutil", "mkdir", "os.replace", "unlink"):
            if token in text:
                offenders.append(f"{name}:{token}")

    assert offenders == [], (
        "request handlers must stay read-only (no writes, no cleanup): " + ", ".join(offenders)
    )


def test_manifest_write_back_is_atomic_and_skips_unchanged_files() -> None:
    """Atomic writes: temp file + ``os.replace``, and no rewrite of an unchanged manifest."""

    text = _read(FIRMWARE_COMPILE / "mpy_precompile.py")
    save_json_body = text.split("def _serialized_json", 1)[0]
    update_body = text.split("def update_manifests_with_profile", 1)[1].split(
        "def run_manifest_mpy_precompile", 1
    )[0]

    assert "os.fsync(" in save_json_body
    assert "os.replace(temp_path, path)" in save_json_body
    assert "temp_path.unlink(missing_ok=True)" in save_json_body
    assert 'path.with_name(f"{path.name}.{os.getpid()}.tmp")' in save_json_body
    assert "_existing_text(manifest_path)" in update_body
    assert "continue" in update_body.split("_existing_text(manifest_path)", 1)[1]


def test_builtin_ids_win_and_are_a_required_validation_argument() -> None:
    """Built-in precedence: duplicate add-ons are dropped and the guard takes the id set."""

    store = _read(TOOLS / "addon_store.py")
    archive = _read(TOOLS / "addon_archive.py")

    assert 'if entry["id"] in builtin_ids:' in store
    assert "install_addon" in archive
    tree = ast.parse(archive)
    signatures = {
        node.name: node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef)
        and node.name in {"validate_addon_tree", "install_addon", "validate_addon_source"}
    }
    assert set(signatures) == {"validate_addon_tree", "install_addon", "validate_addon_source"}
    for name, node in signatures.items():
        keywords = [argument.arg for argument in node.args.kwonlyargs]
        assert "builtin_ids" in keywords, f"{name} must take builtin_ids as a keyword argument"
        default = next(
            (
                value
                for argument, value in zip(
                    node.args.kwonlyargs, node.args.kw_defaults, strict=False
                )
                if argument.arg == "builtin_ids"
            ),
            None,
        )
        assert default is None, f"{name} must not default builtin_ids"


def test_every_addons_root_parameter_is_keyword_only_and_defaults_to_none() -> None:
    """``None`` means legacy: no resolver call site is forced to know about add-ons."""

    resolver_modules = (
        FIRMWARE_COMPILE / "package_resolver.py",
        FIRMWARE_COMPILE / "staging_resolver.py",
        FIRMWARE_COMPILE / "staging_runner.py",
        FIRMWARE_COMPILE / "build_orchestration.py",
        FIRMWARE_COMPILE / "mpy_precompile.py",
    )

    checked = 0
    for module in resolver_modules:
        tree = ast.parse(_read(module))
        for node in ast.walk(tree):
            if not isinstance(node, ast.FunctionDef):
                continue
            positional_args = list(zip(node.args.args, node.args.defaults, strict=False))
            keyword_only = list(zip(node.args.kwonlyargs, node.args.kw_defaults, strict=False))
            for argument, default in positional_args + keyword_only:
                if argument.arg != "addons_root":
                    continue
                checked += 1
                assert (
                    isinstance(default, ast.Constant) and default.value is None
                ), f"{module.name}:{node.name} must default addons_root to None"

    assert (
        checked >= 8
    ), f"expected the addons_root parameter across the resolver stack, got {checked}"


def test_writers_require_an_explicit_addons_root() -> None:
    """The write paths never guess: ``addons_root`` has no default there."""

    for module_name, function_names in (
        ("addon_archive.py", {"install_addon", "uninstall_addon"}),
    ):
        tree = ast.parse(_read(TOOLS / module_name))
        for node in ast.walk(tree):
            if not isinstance(node, ast.FunctionDef) or node.name not in function_names:
                continue
            assert "addons_root" in [
                argument.arg for argument in node.args.kwonlyargs
            ], f"{module_name}:{node.name} must take addons_root as a keyword argument"


def test_every_example_addon_ships_the_repository_licence() -> None:
    """Licence packaging: each example package ships the GPL text and declares it in its node info.

    The archive and install paths copy a package tree verbatim, so a licence file only has to
    exist next to the manifest. Keeping it byte-identical to the repository ``LICENSE`` stops the
    copies from drifting, and the node ``info`` text is the only place the editor can surface the
    licence to a user who never opens the package folder.
    """

    licence_text = _read(REPO_LICENSE)
    packages = sorted(path for path in EXAMPLE_ADDONS.glob("*") if path.is_dir())

    assert packages, "expected example add-on packages under examples/addons/node_pkgs"

    for package in packages:
        shipped = package / "LICENSE"
        assert shipped.is_file(), f"{package.name} must ship a LICENSE file"
        assert (
            _read(shipped) == licence_text
        ), f"{package.name}/LICENSE must stay identical to the repository LICENSE"

        node_types = json.loads(_read(package / "node_definitions.json"))["nodeTypes"]
        infos = [
            text
            for node_type in node_types.values()
            for text in (node_type.get("info") or {}).values()
        ]
        assert any(
            "GPL-3.0" in text for text in infos
        ), f"{package.name} node info must mention the GPL-3.0-only licence"

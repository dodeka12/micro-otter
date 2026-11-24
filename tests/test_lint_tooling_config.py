"""Tests for the repository lint tooling configuration.

These tests assert the *contract* of the lint setup rather than linting the tree:
the ruff pin must stay in lockstep with the pre-commit hook, the ruff profile must
stay scoped to host Python, and ``package.json`` must expose the documented
commands. Running the linters themselves is the job of ``npm run lint``,
``npm run lint:python`` and ``npm run check:device-syntax``.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tomllib
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
PYPROJECT = REPO_ROOT / "pyproject.toml"
PRECOMMIT = REPO_ROOT / ".pre-commit-config.yaml"
PACKAGE_JSON = REPO_ROOT / "package.json"

RUFF_PRECOMMIT_REPO = "https://github.com/astral-sh/ruff-pre-commit"
DEVICE_TREE = "src/micro_otter/nodes/device"
RUNTIME_ASSETS = "src/micro_otter/tools/firmware_compile/runtime_assets"
GENERATED_HOOKS = "webserver_hooks_generated.py"
GENERATED_MAIN_LOOP = "main_loop.py"
DEVICE_CODE_EXCLUDES = (DEVICE_TREE, RUNTIME_ASSETS, GENERATED_MAIN_LOOP, GENERATED_HOOKS)


def _load_pyproject() -> dict:
    with PYPROJECT.open("rb") as fh:
        return tomllib.load(fh)


def _dev_group() -> list[str]:
    return list(_load_pyproject()["dependency-groups"]["dev"])


def _ruff_pin() -> str:
    """Return the pinned ruff version declared in the dev dependency group."""
    for entry in _dev_group():
        if entry.startswith("ruff=="):
            return entry.split("==", 1)[1]
    raise AssertionError(f"ruff is not pinned in [dependency-groups].dev: {_dev_group()}")


def _precommit_ruff_rev() -> str:
    """Return the ruff-pre-commit revision, without the leading ``v``."""
    in_ruff_repo = False
    for line in PRECOMMIT.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith(("repo:", "- repo:", "repo :", "- repo :")):
            in_ruff_repo = RUFF_PRECOMMIT_REPO in stripped
            continue
        if in_ruff_repo and stripped.startswith("rev:"):
            return stripped.split(":", 1)[1].strip().lstrip("v")
    raise AssertionError(f"no rev found for {RUFF_PRECOMMIT_REPO} in {PRECOMMIT.name}")


def _venv_ruff() -> Path:
    return Path(sys.executable).parent / "ruff"


# --- step 1.1: ruff is a declared dev dependency ---------------------------------


def test_ruff_is_declared_in_dev_dependency_group() -> None:
    assert any(entry.startswith("ruff") for entry in _dev_group())


def test_ruff_pin_matches_precommit_rev() -> None:
    pin = _ruff_pin()
    rev = _precommit_ruff_rev()
    assert pin == rev, (
        "ruff version drift: pyproject [dependency-groups].dev pins "
        f"{pin!r} but {PRECOMMIT.name} uses {rev!r}. Bump both together so the "
        "editor, pre-commit hook and npm scripts report identical findings."
    )


def test_ruff_is_not_a_runtime_dependency() -> None:
    runtime = list(_load_pyproject()["project"]["dependencies"])
    assert not any(entry.startswith("ruff") for entry in runtime), (
        "ruff must stay a dev-only dependency so it is not shipped in the wheel"
    )


def test_venv_ruff_reports_pinned_version() -> None:
    binary = _venv_ruff()
    if not binary.exists():
        pytest.skip(f"{binary} not installed; run 'uv sync --all-groups --python 3.12'")
    result = subprocess.run([str(binary), "--version"], capture_output=True, text=True, check=True)
    assert result.stdout.startswith(f"ruff {_ruff_pin()}"), result.stdout


# --- step 1.2: the ruff profile is scoped to host Python -------------------------


def _ruff_section() -> dict:
    return dict(_load_pyproject()["tool"]["ruff"])


def _run_ruff(*args: str) -> subprocess.CompletedProcess[str]:
    binary = _venv_ruff()
    if not binary.exists():
        pytest.skip(f"{binary} not installed; run 'uv sync --all-groups --python 3.12'")
    return subprocess.run(
        [str(binary), "check", "--no-cache", *args],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )


def test_ruff_profile_does_not_enable_fix() -> None:
    assert "fix" not in _ruff_section(), (
        "[tool.ruff] must not set fix = true: a plain 'ruff check' is a lint gate and "
        "must never rewrite the working tree. Use --fix explicitly instead."
    )


def test_ruff_extend_exclude_covers_device_tree_and_generated_file() -> None:
    excludes = [entry.rstrip("/") for entry in _ruff_section().get("extend-exclude", [])]
    missing = [
        entry.rstrip("/") for entry in DEVICE_CODE_EXCLUDES if entry.rstrip("/") not in excludes
    ]
    assert not missing, f"device/MicroPython code paths not excluded from ruff: {missing}"


def test_ruff_uses_extend_exclude_not_exclude() -> None:
    ruff = _ruff_section()
    assert "exclude" not in ruff, (
        "[tool.ruff] must use extend-exclude: 'exclude' replaces ruff's defaults and "
        "would start linting .venv/ and build artefacts"
    )


def test_ruff_force_exclude_is_enabled() -> None:
    assert _ruff_section().get("force-exclude") is True, (
        "force-exclude must stay enabled: pre-commit passes explicit filenames and ruff "
        "bypasses exclusions for paths given directly on the command line otherwise, so "
        "--fix would rewrite the MicroPython device tree"
    )


def test_bugbear_treats_typer_defaults_as_immutable() -> None:
    immutable = _load_pyproject()["tool"]["ruff"]["lint"]["flake8-bugbear"][
        "extend-immutable-calls"
    ]
    assert "typer.Option" in immutable
    assert "typer.Argument" in immutable


def test_device_tree_is_not_linted_by_ruff() -> None:
    result = _run_ruff("--select", "UP038", DEVICE_TREE)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "UP038" not in result.stdout


def test_device_file_passed_explicitly_is_still_excluded() -> None:
    device_file = f"{DEVICE_TREE}/node_pkgs/vars/otter_vars/arrays.py"
    result = _run_ruff("--select", "UP038", device_file)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "UP038" not in result.stdout


def test_generated_transpiler_output_is_not_linted() -> None:
    result = _run_ruff("--select", "F401,B905", GENERATED_MAIN_LOOP, RUNTIME_ASSETS)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "F401" not in result.stdout
    assert "B905" not in result.stdout


def test_host_code_still_reports_up038(tmp_path: Path) -> None:
    probe = tmp_path / "probe.py"
    probe.write_text(
        "def f(value):\n    return isinstance(value, (int, float))\n", encoding="utf-8"
    )
    result = _run_ruff("--config", str(PYPROJECT), "--select", "UP038", str(probe))
    assert result.returncode == 1, result.stdout + result.stderr
    assert "UP038" in result.stdout


# --- step 1.4: package.json exposes the Python lint scripts -----------------------


def _scripts() -> dict[str, str]:
    return dict(json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))["scripts"])


def test_python_lint_scripts_exist_and_use_uv_run_ruff() -> None:
    scripts = _scripts()
    for name in ("lint:python", "lint:python:fix", "format:python"):
        assert name in scripts, f"missing npm script {name!r}"
        assert "uv run ruff" in scripts[name], scripts[name]


def test_plain_python_lint_never_modifies_the_tree() -> None:
    command = _scripts()["lint:python"]
    assert "--fix" not in command, command
    assert "format" not in command, command


def test_python_lint_scripts_do_not_name_the_device_tree() -> None:
    offenders = {
        name: command
        for name, command in _scripts().items()
        if "python" in name and any(entry in command for entry in DEVICE_CODE_EXCLUDES)
    }
    assert not offenders, (
        f"device/MicroPython exclusions belong in pyproject.toml only, found: {offenders}"
    )


# --- step 2.1: ESLint 9 flat config replaces .eslintrc.json ------------------------

ESLINT_CONFIG = REPO_ROOT / "eslint.config.js"
LEGACY_ESLINTRC = REPO_ROOT / ".eslintrc.json"
NODE_MODULES = REPO_ROOT / "node_modules"
ESLINT_DEV_DEPENDENCIES = ("@eslint/js", "globals")
GENERATED_FRONTEND_JS = "src/micro_otter/nodes/html/js/core/open-source-packages.generated.js"


def _require_node_modules() -> None:
    if not (NODE_MODULES / "eslint").is_dir():
        pytest.skip(f"{NODE_MODULES / 'eslint'} missing; run 'npm ci' first")


def _node(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["node", *args], capture_output=True, text=True, cwd=REPO_ROOT)


def _eslint_export(expression: str) -> object:
    """Evaluate ``expression`` against the default export of ``eslint.config.js``."""
    _require_node_modules()
    result = _node(
        "--input-type=module",
        "-e",
        f"import('./eslint.config.js').then((m) => console.log(JSON.stringify({expression})))",
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def _dev_dependencies() -> dict[str, str]:
    return dict(json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))["devDependencies"])


def test_eslint_flat_config_loads() -> None:
    assert ESLINT_CONFIG.is_file(), (
        "eslint.config.js is missing: ESLint 9 refuses to load .eslintrc.json, so the repo "
        "would have no working configuration at all"
    )
    count = _eslint_export("m.default.length")
    assert isinstance(count, int) and count > 0, f"eslint.config.js exports no config: {count!r}"


def test_eslint_config_ignores_the_device_tree() -> None:
    ignores = _eslint_export("m.default.flatMap((config) => config.ignores ?? [])")
    assert "**/device/**" in ignores, (
        "the device tree holds MicroPython generator output and must stay ignored, "
        f"got {ignores}"
    )


def test_legacy_eslintrc_is_gone() -> None:
    assert not LEGACY_ESLINTRC.exists(), (
        f"{LEGACY_ESLINTRC.name} is not read by ESLint 9 and only misleads contributors; "
        "eslint.config.js is the single source of truth"
    )


def test_eslint_flat_config_dependencies_are_declared() -> None:
    dev_dependencies = _dev_dependencies()
    missing = [name for name in ESLINT_DEV_DEPENDENCIES if name not in dev_dependencies]
    assert not missing, (
        f"{missing} are imported by eslint.config.js but not declared in devDependencies; "
        "they resolve today only because npm hoists eslint's own dependencies"
    )


def _print_config(relative_path: str) -> dict:
    """Return the resolved ESLint configuration for ``relative_path``."""
    _require_node_modules()
    result = subprocess.run(
        [str(NODE_MODULES / ".bin" / "eslint"), "--print-config", relative_path],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    return dict(json.loads(result.stdout))


def test_eslint_config_keeps_rule_set_and_module_parsing() -> None:
    config = _print_config(GENERATED_FRONTEND_JS)
    severity, options = config["rules"]["no-unused-vars"]
    assert severity in (2, "error"), f"no-unused-vars must stay an error, got {severity!r}"
    assert options == {"argsIgnorePattern": "^_"}, options
    assert config["languageOptions"]["sourceType"] == "module"


# --- step 2.3: the JavaScript lint scope covers src/ and tests/ ---------------------

TEST_FILE = "tests/data/history-manager.test.js"


def test_lint_js_covers_sources_and_tests() -> None:
    command = _scripts()["lint:js"]
    for expected in ("src/**/*.js", "tests/**/*.js"):
        assert expected in command, (
            f"lint:js must cover {expected!r}; dropping it would shrink the lint gate "
            f"without failing the exit-code check: {command}"
        )


def test_lint_delegates_to_lint_js() -> None:
    command = _scripts()["lint"]
    assert "lint:js" in command, f"lint must delegate to lint:js, got {command!r}"
    assert "eslint" not in command, (
        "lint should not duplicate the eslint invocation; keeping one glob list in lint:js "
        f"prevents the two commands from drifting apart: {command}"
    )


def test_test_lint_block_resolves_source_imports_through_typescript() -> None:
    config = _print_config(TEST_FILE)
    severity = config["rules"]["import/no-unresolved"][0]
    assert severity in (2, "error"), (
        "import/no-unresolved must stay enabled for tests: the test tree imports sources with "
        "TypeScript-style '.js' specifiers, which the TypeScript resolver handles. Disabling the "
        f"rule would hide real typos instead of fixing the resolution. Got {severity!r}"
    )
    resolvers = config.get("settings", {}).get("import/resolver", {})
    assert "typescript" in resolvers, f"missing TypeScript import resolver: {resolvers}"


def test_test_lint_block_keeps_jsdoc_requirements_off() -> None:
    severity = _print_config(TEST_FILE)["rules"]["jsdoc/require-jsdoc"][0]
    assert severity in (0, "off"), (
        "tests describe behaviour instead of exposing a documented API; requiring JSDoc there "
        f"produces hundreds of findings that no reviewer benefits from. Got {severity!r}"
    )


# --- step 3.1: typescript-eslint is the single source of the TypeScript parser -----

TYPESCRIPT_ESLINT_SUBPACKAGES = ("@typescript-eslint/parser", "@typescript-eslint/eslint-plugin")


def test_typescript_eslint_is_declared_in_dev_dependencies() -> None:
    dev_dependencies = _dev_dependencies()
    assert "typescript-eslint" in dev_dependencies, (
        "eslint.config.js imports typescript-eslint, so it must be a declared devDependency; "
        "relying on a transitive copy pins the parser to whatever eslint happens to hoist"
    )


def test_typescript_eslint_exposes_the_config_presets() -> None:
    _require_node_modules()
    probe = (
        "import('typescript-eslint')"
        ".then((m) => console.log(Array.isArray(m.configs.recommended)))"
    )
    result = _node("--input-type=module", "-e", probe)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "true", (
        "typescript-eslint must export 'configs.recommended' as an array of flat configs, "
        f"got {result.stdout!r}"
    )


def test_typescript_eslint_subpackages_are_not_declared_separately() -> None:
    package = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    declared = {**package.get("dependencies", {}), **package.get("devDependencies", {})}
    offenders = [name for name in TYPESCRIPT_ESLINT_SUBPACKAGES if name in declared]
    assert not offenders, (
        f"{offenders} must not be declared next to typescript-eslint: two declarations make the "
        "parser and the plugin version drift apart, and a mismatched parser silently mis-parses "
        "newer TypeScript syntax"
    )


# --- step 3.2: the flat config carries a TypeScript block --------------------------

TS_ENTRY = "src/micro_otter/nodes/html/js/app/main.ts"


def test_typescript_block_applies_the_typescript_rules() -> None:
    config = _print_config(TS_ENTRY)
    rules = config["rules"]
    assert "@typescript-eslint/no-unused-vars" in rules, (
        "src/main.ts must be linted by the TypeScript block; without it the 138 TS files are "
        "linted by nothing at all"
    )
    severity, options = rules["@typescript-eslint/no-unused-vars"]
    assert severity in (2, "error"), f"no-unused-vars must stay an error, got {severity!r}"
    assert options == {"argsIgnorePattern": "^_"}, options
    assert rules["no-unused-vars"][0] in (0, "off"), (
        "the core no-unused-vars rule misreports type-only usage in TypeScript; it must be "
        "replaced by the TypeScript-aware variant instead of reporting twice"
    )
    assert config["languageOptions"]["sourceType"] == "module"


def test_typescript_block_keeps_no_explicit_any_at_warn() -> None:
    severity = _print_config(TS_ENTRY)["rules"]["@typescript-eslint/no-explicit-any"][0]
    assert severity in (1, "warn"), (
        "no-explicit-any is a tracked warning baseline (165 findings at the time of writing); "
        "promoting it to an error without clearing the backlog only invites eslint-disable "
        f"comments. Tighten it deliberately once the count reaches zero. Got {severity!r}"
    )


def _severity(rule_value: object) -> int:
    """Return the numeric severity of a rule entry from ``--print-config`` output."""
    value = rule_value[0] if isinstance(rule_value, list) else rule_value
    if isinstance(value, str):
        return {"off": 0, "warn": 1, "error": 2}.get(value, -1)
    return value if isinstance(value, int) else -1


def test_typescript_rules_do_not_leak_into_javascript_files() -> None:
    config = _print_config(GENERATED_FRONTEND_JS)
    # eslint-config-prettier lists the TypeScript-ESLint formatting rules as 'off' for every
    # file it covers, so presence alone is not a leak: severity is what matters.
    enabled = sorted(
        rule
        for rule, value in config["rules"].items()
        if rule.startswith("@typescript-eslint/") and _severity(value) > 0
    )
    assert not enabled, (
        f"the TypeScript block must stay scoped to src/**/*.ts, but these rules are enabled for "
        f"a .js file: {enabled}"
    )


def test_lint_script_runs_both_javascript_and_typescript_lint() -> None:
    scripts = _scripts()
    command = scripts["lint"]
    for expected in ("lint:js", "lint:ts"):
        assert expected in command, (
            f"lint must delegate to {expected!r}; dropping it shrinks the gate silently: {command}"
        )
    assert "src/**/*.ts" in scripts["lint:ts"], scripts["lint:ts"]


# --- step 3.3: the TypeScript baseline stays green while the any warnings exist ----


def test_typescript_lint_passes_with_warnings_only() -> None:
    _require_node_modules()
    result = subprocess.run(
        [str(NODE_MODULES / ".bin" / "eslint"), "src/**/*.ts"],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_lint_scripts_leave_max_warnings_to_the_caller() -> None:
    scripts = _scripts()
    offenders = {
        name: command
        for name, command in scripts.items()
        if name.startswith("lint") and "--max-warnings" in command
    }
    assert not offenders, (
        f"lint must not pass --max-warnings: no-explicit-any is a tracked warning baseline, so "
        f"turning warnings into failures has to be a deliberate config change: {offenders}"
    )


# --- step 4.2: the device gate is wired into npm and into the aggregate lint command ------


def test_device_syntax_script_runs_the_gate_for_every_architecture() -> None:
    command = _scripts()["check:device-syntax"]
    assert "tools/check_device_syntax.py" in command, command
    assert "--march" not in command, (
        "the repository-wide gate must use the tool's default architectures (xtensa and "
        "xtensawin), so both supported boards are checked; narrowing --march is for local "
        f"one-architecture runs only: {command}"
    )
    assert "--device-root src/micro_otter/nodes/device" not in command, (
        f"the gate must default to src/micro_otter/nodes/device instead of restating it: {command}"
    )
    assert "--device-root examples/addons" in command, (
        "the example add-on device tree must be gated with an explicit device root: " + command
    )


def test_lint_all_chains_every_gate() -> None:
    command = _scripts()["lint:all"]
    for expected in ("npm run lint", "npm run lint:python", "npm run check:device-syntax"):
        assert expected in command, (
            f"lint:all must chain {expected!r}: each gate passes on its own, so one dropped from "
            f"the aggregate would go unnoticed until CI or a reviewer catches it: {command}"
        )


# --- steps 5.2/5.3: the docs and the pre-push gate agree with package.json --------------


TOOLING_DOCS = (
    REPO_ROOT / "CONTRIBUTING.md",
    REPO_ROOT / "README.md",
    REPO_ROOT / "docs" / "dev" / "guides" / "coding-style-guide.md",
)
NPM_RUN_REFERENCE = re.compile(r"npm run ([A-Za-z0-9:_-]+)")


def test_documented_npm_scripts_exist() -> None:
    scripts = set(_scripts())
    missing: dict[str, list[str]] = {}
    for doc in TOOLING_DOCS:
        referenced = set(NPM_RUN_REFERENCE.findall(doc.read_text(encoding="utf-8")))
        absent = sorted(referenced - scripts)
        if absent:
            missing[str(doc.relative_to(REPO_ROOT))] = absent
    assert not missing, (
        "these documents name npm scripts that package.json does not define, so a contributor "
        f"following them hits 'Missing script': {missing}"
    )


def test_check_ci_local_runs_every_lint_gate() -> None:
    steps = [step.strip() for step in _scripts()["check:ci-local"].split("&&")]
    for expected in ("npm run check:ci-local:web", "npm run check:device-syntax"):
        assert expected in steps, (
            f"check:ci-local backs hooks/pre-push, so dropping {expected!r} lets a push land "
            f"code that lint or the device gate rejects: {steps}"
        )
    web_steps = [step.strip() for step in _scripts()["check:ci-local:web"].split("&&")]
    for expected in ("npm run lint", "npm run lint:python"):
        assert expected in web_steps, (
            f"check:ci-local:web carries the host-side gates the CI web job runs, so dropping "
            f"{expected!r} lets a push land code that lint rejects: {web_steps}"
        )


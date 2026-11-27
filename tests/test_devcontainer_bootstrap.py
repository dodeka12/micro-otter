"""Tests for the dev container configuration and toolchain bootstrap script.

The bootstrap tests run ``deploy/toolchain/esp-idf/bootstrap.sh`` against fake
``git``/``make``/``mpy-cross`` shims in a temp tree so the version-aware
re-clone/rebuild decisions can be exercised without a real toolchain or network.

The configuration tests read ``.devcontainer/devcontainer.json`` and
``.vscode/settings.json`` and assert that the editor extensions the settings
rely on are actually installed by the container.
"""

import json
import os
import re
import stat
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BOOTSTRAP = REPO_ROOT / "deploy" / "toolchain" / "esp-idf" / "bootstrap.sh"
DEVCONTAINER_JSON = REPO_ROOT / ".devcontainer" / "devcontainer.json"
VSCODE_SETTINGS = REPO_ROOT / ".vscode" / "settings.json"

# Marketplace ids (<publisher>.<extension>). ``charliermarsh.ruff`` is the id the Ruff
# extension still publishes under after the move to the ``astral-sh`` GitHub org, so the
# publisher segment does not match the repository org name.
RUFF_EXTENSION = "charliermarsh.ruff"
ESLINT_EXTENSION = "dbaeumer.vscode-eslint"

ESP_IDF_VERSION = "v5.5.2"
MICROPYTHON_VERSION = "v1.29.0"

GIT_SHIM = """#!/usr/bin/env bash
log="${FAKE_GIT_LOG:?}"
printf 'git %s\\n' "$*" >> "$log"
mode=""
for a in "$@"; do
    if [[ "$a" == "clone" ]]; then mode="clone"; fi
    if [[ "$a" == "describe" ]]; then mode="describe"; fi
done
if [[ "$mode" == "clone" ]]; then
    dest="${@: -1}"
    tag=""
    prev=""
    for a in "$@"; do
        if [[ "$prev" == "-b" ]]; then tag="$a"; fi
        prev="$a"
    done
    mkdir -p "${dest}/.git"
    printf '%s' "$tag" > "${dest}/.fake_tag"
    printf '#!/usr/bin/env bash\\nexit 0\\n' > "${dest}/install.sh"
    chmod +x "${dest}/install.sh"
elif [[ "$mode" == "describe" ]]; then
    dir=""
    prev=""
    for a in "$@"; do
        if [[ "$prev" == "-C" ]]; then dir="$a"; fi
        prev="$a"
    done
    if [[ -f "${dir}/.fake_tag" ]]; then
        cat "${dir}/.fake_tag"
    else
        exit 1
    fi
fi
exit 0
"""

MAKE_SHIM = """#!/usr/bin/env bash
log="${FAKE_MAKE_LOG:?}"
printf 'make %s\\n' "$*" >> "$log"
exit 0
"""

MPY_CROSS_SHIM = """#!/usr/bin/env bash
log="${FAKE_MPY_LOG:?}"
printf 'mpy-cross %s\\n' "$*" >> "$log"
if [[ "$1" == "--version" ]]; then
    printf 'MicroPython %s-dirty on 2026-01-01; mpy-cross emitting mpy v6.3\\n' \\
        "${FAKE_MPY_VERSION:-}"
fi
exit 0
"""


def _write_exec(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


def _run_bootstrap(
    tmp_path: Path,
    *,
    mpy: str | None = None,
    mpy_cross_version: str | None = None,
    idf_tag: str | None = ESP_IDF_VERSION,
) -> dict:
    """Run the bootstrap script in an isolated temp tree.

    ``mpy`` controls the MicroPython checkout state:
      - ``None``: no checkout exists (expect a clone)
      - ``""``: a ``.git`` dir exists but the checkout is unrecognized (describe fails)
      - ``"vX.Y.Z"``: a checkout at that exact tag
    """

    bin_dir = tmp_path / "bin"
    idf = tmp_path / "idf"
    mpy_dir = tmp_path / "mpy"
    espressif = tmp_path / "espressif"
    git_log = tmp_path / "git.log"
    make_log = tmp_path / "make.log"
    mpy_log = tmp_path / "mpy-cross.log"

    _write_exec(bin_dir / "git", GIT_SHIM)
    _write_exec(bin_dir / "make", MAKE_SHIM)

    # Pre-satisfy the ESP-IDF side (clone at the given tag + toolchain marker)
    # so the decision under test is isolated.
    idf.mkdir(parents=True, exist_ok=True)
    (idf / ".git").mkdir(parents=True, exist_ok=True)
    if idf_tag is not None:
        (idf / ".fake_tag").write_text(idf_tag, encoding="utf-8")
    (idf / f".micro_otter_idf_tools_installed_{ESP_IDF_VERSION}").touch()

    if mpy is not None:
        (mpy_dir / ".git").mkdir(parents=True, exist_ok=True)
        if mpy:
            (mpy_dir / ".fake_tag").write_text(mpy, encoding="utf-8")

    if mpy_cross_version is not None:
        _write_exec(
            mpy_dir / "mpy-cross" / "build" / "mpy-cross",
            MPY_CROSS_SHIM,
        )

    env = os.environ.copy()
    env.update(
        {
            "IDF_PATH": str(idf),
            "IDF_TOOLS_PATH": str(espressif),
            "ESP_IDF_VERSION": ESP_IDF_VERSION,
            "MICROPYTHON_ROOT": str(mpy_dir),
            "MICROPYTHON_VERSION": MICROPYTHON_VERSION,
            "PATH": f"{bin_dir}:{env.get('PATH', '')}",
            "FAKE_GIT_LOG": str(git_log),
            "FAKE_MAKE_LOG": str(make_log),
            "FAKE_MPY_LOG": str(mpy_log),
            "FAKE_MPY_VERSION": mpy_cross_version or "",
        }
    )

    result = subprocess.run(
        ["bash", str(BOOTSTRAP)],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
    )

    return {
        "returncode": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "git_log": git_log.read_text(encoding="utf-8") if git_log.exists() else "",
        "make_log": make_log.read_text(encoding="utf-8") if make_log.exists() else "",
        "mpy_dir": mpy_dir,
    }


def test_micropython_absent_clones_at_pinned_tag(tmp_path: Path) -> None:
    result = _run_bootstrap(tmp_path, mpy=None)

    assert result["returncode"] == 0, result["stderr"]
    assert "git clone -b v1.29.0" in result["git_log"]
    assert "micropython.git" in result["git_log"]
    assert (result["mpy_dir"] / ".fake_tag").read_text(encoding="utf-8") == MICROPYTHON_VERSION


def test_micropython_matching_tag_skips_clone_and_build(tmp_path: Path) -> None:
    result = _run_bootstrap(
        tmp_path, mpy=MICROPYTHON_VERSION, mpy_cross_version=MICROPYTHON_VERSION
    )

    assert result["returncode"] == 0, result["stderr"]
    assert "micropython.git" not in result["git_log"]
    assert result["make_log"] == ""


def test_micropython_mismatched_tag_reclones(tmp_path: Path) -> None:
    result = _run_bootstrap(tmp_path, mpy="v1.27.0", mpy_cross_version=MICROPYTHON_VERSION)

    assert result["returncode"] == 0, result["stderr"]
    assert "git clone -b v1.29.0" in result["git_log"]
    assert (result["mpy_dir"] / ".fake_tag").read_text(encoding="utf-8") == MICROPYTHON_VERSION


def test_micropython_unrecognized_checkout_reclones(tmp_path: Path) -> None:
    result = _run_bootstrap(tmp_path, mpy="", mpy_cross_version=MICROPYTHON_VERSION)

    assert result["returncode"] == 0, result["stderr"]
    assert "git clone -b v1.29.0" in result["git_log"]


def test_mpy_cross_missing_rebuilds(tmp_path: Path) -> None:
    result = _run_bootstrap(tmp_path, mpy=MICROPYTHON_VERSION, mpy_cross_version=None)

    assert result["returncode"] == 0, result["stderr"]
    assert "make -C" in result["make_log"]
    assert "mpy-cross" in result["make_log"]


def test_mpy_cross_stale_version_rebuilds(tmp_path: Path) -> None:
    result = _run_bootstrap(tmp_path, mpy=MICROPYTHON_VERSION, mpy_cross_version="v1.27.0")

    assert result["returncode"] == 0, result["stderr"]
    assert "make -C" in result["make_log"]


def test_mpy_cross_matching_version_skips_build(tmp_path: Path) -> None:
    result = _run_bootstrap(
        tmp_path, mpy=MICROPYTHON_VERSION, mpy_cross_version=MICROPYTHON_VERSION
    )

    assert result["returncode"] == 0, result["stderr"]
    assert result["make_log"] == ""


def test_idf_mismatched_tag_reclones(tmp_path: Path) -> None:
    result = _run_bootstrap(
        tmp_path,
        mpy=MICROPYTHON_VERSION,
        mpy_cross_version=MICROPYTHON_VERSION,
        idf_tag="v5.5.1",
    )

    assert result["returncode"] == 0, result["stderr"]
    assert "git clone -b v5.5.2" in result["git_log"]
    assert "esp-idf.git" in result["git_log"]


# --- the container installs the editor extensions the settings rely on -----------------


def _strip_jsonc(source: str) -> str:
    """Drop ``//`` and ``/* */`` comments and the trailing commas they leave behind."""
    out: list[str] = []
    index = 0
    in_string = False
    while index < len(source):
        char = source[index]
        if in_string:
            out.append(char)
            if char == "\\":
                index += 1
                if index < len(source):
                    out.append(source[index])
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
            out.append(char)
        elif source.startswith("//", index):
            newline = source.find("\n", index)
            index = len(source) if newline == -1 else newline
            continue
        elif source.startswith("/*", index):
            end = source.find("*/", index + 2)
            index = len(source) if end == -1 else end + 2
            continue
        else:
            out.append(char)
        index += 1
    return re.sub(r",(\s*[}\]])", r"\1", "".join(out))


def _devcontainer_extensions() -> list[str]:
    config = json.loads(DEVCONTAINER_JSON.read_text(encoding="utf-8"))
    return list(config["customizations"]["vscode"]["extensions"])


def _vscode_settings() -> dict[str, object]:
    # settings.json is JSONC: the file documents its entries with // comments.
    return dict(json.loads(_strip_jsonc(VSCODE_SETTINGS.read_text(encoding="utf-8"))))


def test_devcontainer_installs_the_ruff_extension_once() -> None:
    extensions = _devcontainer_extensions()
    assert extensions.count(RUFF_EXTENSION) == 1, (
        "a fresh container must install the Ruff extension: .vscode/settings.json makes it "
        "the Python formatter and linter, so without it every format-on-save is a silent "
        f"no-op. Expected {RUFF_EXTENSION!r} exactly once, got {extensions}"
    )


def test_devcontainer_keeps_the_eslint_extension() -> None:
    extensions = _devcontainer_extensions()
    assert ESLINT_EXTENSION in extensions, (
        "adding the Ruff extension must not drop the ESLint one: the JavaScript and "
        f"TypeScript trees are linted through it on save, got {extensions}"
    )


def test_devcontainer_extension_entries_are_marketplace_ids() -> None:
    invalid = [entry for entry in _devcontainer_extensions() if entry.count(".") != 1]
    assert not invalid, (
        f"extension entries must be <publisher>.<extension>; the container silently skips "
        f"anything else: {invalid}"
    )


def test_python_formatter_names_an_extension_the_container_installs() -> None:
    python = _vscode_settings()["[python]"]
    assert isinstance(python, dict), python
    formatter = python["editor.defaultFormatter"]
    assert formatter == RUFF_EXTENSION, (
        f"[python].editor.defaultFormatter must be {RUFF_EXTENSION!r}, the id the extension "
        f"publishes under (the GitHub org moved to astral-sh, the marketplace id did not): "
        f"{formatter!r}"
    )
    assert formatter in _devcontainer_extensions(), (
        f"{formatter!r} is configured as the Python formatter but the container does not "
        "install it, so VS Code falls back with no formatter"
    )


def test_python_ruff_code_actions_stay_enabled() -> None:
    python = _vscode_settings()["[python]"]
    assert isinstance(python, dict), python
    actions = python["editor.codeActionsOnSave"]
    assert isinstance(actions, dict), actions
    for action in ("source.organizeImports.ruff", "source.fixAll.ruff"):
        assert action in actions, (
            f"{action} must stay in [python].editor.codeActionsOnSave, otherwise import "
            f"sorting and ruff autofixes stop running on save: {actions}"
        )


# --- the devcontainer signs only when GIT_SIGNING_ENABLED=1 ---------------------

POST_CREATE = REPO_ROOT / ".devcontainer" / "post-create.sh"

SIGNING_SETTINGS = ("gpg.program", "gpg.format", "commit.gpgsign", "tag.gpgSign", "user.signingkey")


def _post_create_lines() -> list[str]:
    return POST_CREATE.read_text(encoding="utf-8").splitlines()


def _guard_index(lines: list[str]) -> int:
    return next(
        i
        for i, line in enumerate(lines)
        if "GIT_SIGNING_ENABLED" in line and line.strip().startswith("if")
    )


def test_signing_settings_are_guarded_by_git_signing_enabled() -> None:
    lines = _post_create_lines()
    guard = _guard_index(lines)
    signing = [i for i, line in enumerate(lines) if any(n in line for n in SIGNING_SETTINGS)]
    assert signing, "signing settings must exist"
    assert all(i > guard for i in signing), "signing settings must be inside the signing guard"
    assert not any(
        "gpgsign" in line or "gpgSign" in line for line in lines[:guard]
    ), "no signing setting may precede the guard"


def test_hooks_path_stays_outside_the_signing_guard() -> None:
    lines = _post_create_lines()
    hooks = next(i for i, line in enumerate(lines) if "core.hooksPath hooks" in line)
    guard = _guard_index(lines)
    signing_max = max(i for i, line in enumerate(lines) if any(n in line for n in SIGNING_SETTINGS))
    assert not (guard < hooks < signing_max), "core.hooksPath must stay outside the signing guard"

"""Tests for the shared toolchain pin source and the shell dispatchers under ``deploy/``.

The pins in ``deploy/toolchain/versions.env`` are the canonical source. The devcontainer
``Dockerfile`` mirrors them as image-layer defaults, so this module fails when the mirror drifts.
The dispatcher tests run against a copy of ``deploy/toolchain/`` with faked backend directories, so
no real toolchain install ever runs.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
DEPLOY_ROOT = REPO_ROOT / "deploy"
DEPLOY_TOOLCHAIN_DIR = DEPLOY_ROOT / "toolchain"
VERSIONS_ENV = DEPLOY_TOOLCHAIN_DIR / "versions.env"
DOCKERFILE = REPO_ROOT / ".devcontainer" / "Dockerfile"
DEVCONTAINER_JSON = REPO_ROOT / ".devcontainer" / "devcontainer.json"
POST_CREATE_SCRIPT = REPO_ROOT / ".devcontainer" / "post-create.sh"
ESP_IDF_BOOTSTRAP = DEPLOY_TOOLCHAIN_DIR / "esp-idf" / "bootstrap.sh"
IDF_LAUNCHER = DEPLOY_TOOLCHAIN_DIR / "esp-idf" / "idf.py"
LINK_LAUNCHER_SCRIPT = REPO_ROOT / ".devcontainer" / "link-idf-launcher.sh"

# Locations the container must not bake in: the bootstrap derives them from
# MICRO_OTTER_TOOLCHAIN_DIR, and an image-level default would silently win over a relocation.
_TOOLCHAIN_LOCATION_ENV_VARS: tuple[str, ...] = ("IDF_PATH", "IDF_TOOLS_PATH", "MICROPYTHON_ROOT")
_DEFAULT_LOCATION_FRAGMENTS: tuple[str, ...] = (
    "${IDF_PATH:-/opt/esp-idf}",
    "${IDF_TOOLS_PATH:-/opt/.espressif}",
    "${MICROPYTHON_ROOT:-/opt/micropython}",
)
_HARDCODED_OPT_PATHS: tuple[str, ...] = ("/opt/esp-idf", "/opt/.espressif", "/opt/micropython")

REQUIRED_PIN_KEYS: tuple[str, ...] = (
    "ESP_IDF_VERSION",
    "MICROPYTHON_VERSION",
    "MPY_CROSS_VERSION",
)

TAG_PATTERN = re.compile(r"^v\d+\.\d+\.\d+$")
_ENV_ASSIGNMENT_PATTERN = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$")
_DOCKERFILE_ENV_PATTERN = re.compile(r"^ENV\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$")

_ENV_KEYS_CLEARED_FOR_SCRIPTS: tuple[str, ...] = (
    "MICRO_OTTER_BUILD_BACKEND",
    "MICRO_OTTER_TOOLCHAIN_DIR",
    "IDF_PATH",
    "IDF_TOOLS_PATH",
    "MICROPYTHON_ROOT",
    "ESP_IDF_VERSION",
    "MICROPYTHON_VERSION",
    "MPY_CROSS_VERSION",
)


def _parse_env_file(path: Path) -> dict[str, str]:
    """Parse ``KEY=VALUE`` lines from a dotenv-style file, ignoring comments and blanks."""

    values: dict[str, str] = {}

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            continue

        match = _ENV_ASSIGNMENT_PATTERN.match(line)
        assert match is not None, f"{path} contains a non-assignment line: {raw_line!r}"
        values[match.group(1)] = match.group(2).strip()

    return values


def _load_pins() -> dict[str, str]:
    """Return the canonical toolchain pins from ``deploy/toolchain/versions.env``."""

    return _parse_env_file(VERSIONS_ENV)


def _dockerfile_env() -> dict[str, str]:
    """Return the ``ENV`` assignments declared by the devcontainer ``Dockerfile``."""

    values: dict[str, str] = {}

    for line in DOCKERFILE.read_text(encoding="utf-8").splitlines():
        match = _DOCKERFILE_ENV_PATTERN.match(line.strip())
        if match is None:
            continue

        values[match.group(1)] = match.group(2).strip()

    return values


def _script_env(**overrides: str) -> dict[str, str]:
    """Return an environment with toolchain variables cleared, plus ``overrides``."""

    env = {
        key: value for key, value in os.environ.items() if key not in _ENV_KEYS_CLEARED_FOR_SCRIPTS
    }
    env.update(overrides)

    return env


def _run_shell(
    script: Path,
    *args: str,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    """Run ``script`` with bash and capture its output."""

    return subprocess.run(
        ["bash", str(script), *args],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )


def _copy_toolchain_dir(tmp_path: Path) -> Path:
    """Copy ``deploy/toolchain/`` into ``tmp_path`` so tests never touch the real tree."""

    destination = tmp_path / "toolchain"
    shutil.copytree(DEPLOY_TOOLCHAIN_DIR, destination)

    return destination


def _write_executable(path: Path, body: str) -> Path:
    """Write a bash script at ``path`` and mark it executable."""

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")
    path.chmod(0o755)

    return path


def _write_fake_idf_checkout(checkout: Path, *, body: str | None = None) -> Path:
    """Create ``<checkout>/tools/idf.py`` executably echoing the launcher contract."""

    default_body = (
        "#!/usr/bin/env bash\n"
        "printf 'IDF_PATH=%s\\n' \"${IDF_PATH}\"\n"
        "printf 'IDF_TOOLS_PATH=%s\\n' \"${IDF_TOOLS_PATH}\"\n"
        "printf 'exported=%s\\n' \"${MICRO_OTTER_FAKE_EXPORTED:-unset}\"\n"
        "printf 'args=%s\\n' \"$*\"\n"
    )
    return _write_executable(checkout / "tools" / "idf.py", body or default_body)


def _write_python_idf_entry(checkout: Path) -> Path:
    """Create a non-executable Python ``tools/idf.py`` for the interpreter fallback."""

    entry = checkout / "tools" / "idf.py"
    entry.parent.mkdir(parents=True, exist_ok=True)
    entry.write_text(
        "import os\n"
        "import sys\n"
        "print(f\"IDF_PATH={os.environ.get('IDF_PATH', '')}\")\n"
        "print('args=' + ' '.join(sys.argv[1:]))\n",
        encoding="utf-8",
    )
    entry.chmod(0o644)

    return entry


def _symlink_bin_dir(tmp_path: Path, tools: tuple[str, ...]) -> Path:
    """Create a bin directory exposing only ``tools`` so host checks are deterministic."""

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()

    for tool in tools:
        resolved = shutil.which(tool)
        assert resolved is not None, f"test host is missing {tool}"
        (bin_dir / tool).symlink_to(resolved)

    return bin_dir


def _read_toolchain_config(script: Path, env: dict[str, str]) -> dict[str, str]:
    """Source ``script`` in a subshell and return its ``print_toolchain_config`` output."""

    result = subprocess.run(
        ["bash", "-c", f'source "{script}"; print_toolchain_config'],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )
    assert result.returncode == 0, f"sourcing {script} failed: {result.stderr}"

    config: dict[str, str] = {}
    for line in result.stdout.splitlines():
        key, separator, value = line.partition("=")
        assert separator == "=", f"unexpected config line: {line!r}"
        config[key] = value

    return config


def test_versions_env_declares_required_pins() -> None:
    """The shared pin file exists and declares every pin the toolchain needs."""

    assert VERSIONS_ENV.is_file(), "deploy/toolchain/versions.env must exist"
    pins = _load_pins()

    for key in REQUIRED_PIN_KEYS:
        assert key in pins, f"deploy/toolchain/versions.env must pin {key}"


def test_versions_env_pins_are_tag_shaped() -> None:
    """Pins are Git tags, not branch names or ranges, so checkouts stay reproducible."""

    pins = _load_pins()

    for key in REQUIRED_PIN_KEYS:
        assert TAG_PATTERN.match(pins[key]), f"{key}={pins[key]!r} must be a vX.Y.Z release tag"


def test_mpy_cross_pin_matches_micropython_pin() -> None:
    """``MPY_CROSS_VERSION`` stays explicit but must track the MicroPython pin."""

    pins = _load_pins()

    assert pins["MPY_CROSS_VERSION"] == pins["MICROPYTHON_VERSION"], (
        "MPY_CROSS_VERSION must equal MICROPYTHON_VERSION unless a build intentionally pins a "
        "different mpy-cross"
    )


def test_dockerfile_pins_mirror_versions_env() -> None:
    """The Dockerfile layer defaults must mirror the canonical pin source."""

    pins = _load_pins()
    dockerfile_env = _dockerfile_env()

    for key in ("ESP_IDF_VERSION", "MICROPYTHON_VERSION"):
        assert key in dockerfile_env, f".devcontainer/Dockerfile must set ENV {key}"
        assert dockerfile_env[key] == pins[key], (
            f".devcontainer/Dockerfile {key}={dockerfile_env[key]!r} drifted from "
            f"deploy/toolchain/versions.env ({pins[key]!r})"
        )


def test_versions_env_documents_backend_override_path() -> None:
    """The pin file must explain where backend-specific overrides belong."""

    text = VERSIONS_ENV.read_text(encoding="utf-8")

    assert "deploy/toolchain/<backend>/versions.env" in text


def test_deploy_scripts_are_syntactically_valid() -> None:
    """Every shell script under ``deploy/`` must pass ``bash -n``."""

    scripts = sorted(DEPLOY_ROOT.rglob("*.sh"))
    assert scripts, "expected shell scripts under deploy/"

    for script in scripts:
        result = subprocess.run(
            ["bash", "-n", str(script)],
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, f"bash -n failed for {script}: {result.stderr}"


def test_bootstrap_dispatcher_runs_selected_backend(tmp_path: Path) -> None:
    """The dispatcher forwards arguments to ``<backend>/bootstrap.sh``."""

    toolchain_dir = _copy_toolchain_dir(tmp_path)
    _write_executable(
        toolchain_dir / "esp-idf" / "bootstrap.sh",
        "#!/usr/bin/env bash\nset -euo pipefail\nprintf 'fake-esp-idf %s\\n' \"$*\"\n",
    )

    result = _run_shell(
        toolchain_dir / "bootstrap.sh",
        "--flag",
        "value",
        env=_script_env(MICRO_OTTER_BUILD_BACKEND="esp-idf"),
    )

    assert result.returncode == 0, result.stderr
    assert "fake-esp-idf --flag value" in result.stdout


def test_bootstrap_dispatcher_defaults_to_esp_idf(tmp_path: Path) -> None:
    """With no backend selected, the dispatcher uses the ``esp-idf`` backend."""

    toolchain_dir = _copy_toolchain_dir(tmp_path)
    _write_executable(
        toolchain_dir / "esp-idf" / "bootstrap.sh",
        "#!/usr/bin/env bash\nset -euo pipefail\nprintf 'default-backend-ran\\n'\n",
    )

    result = _run_shell(toolchain_dir / "bootstrap.sh", env=_script_env())

    assert result.returncode == 0, result.stderr
    assert "default-backend-ran" in result.stdout


def test_bootstrap_dispatcher_fails_for_unknown_backend(tmp_path: Path) -> None:
    """An unknown backend id reports the id and the expected path, then exits non-zero."""

    toolchain_dir = _copy_toolchain_dir(tmp_path)
    expected_path = toolchain_dir / "arm-none" / "bootstrap.sh"

    result = _run_shell(
        toolchain_dir / "bootstrap.sh",
        env=_script_env(MICRO_OTTER_BUILD_BACKEND="arm-none"),
    )

    assert result.returncode != 0
    assert "arm-none" in result.stderr
    assert str(expected_path) in result.stderr


def test_bootstrap_dispatcher_rejects_malformed_backend_id(tmp_path: Path) -> None:
    """A backend id containing path characters is rejected before a path is built."""

    toolchain_dir = _copy_toolchain_dir(tmp_path)

    result = _run_shell(
        toolchain_dir / "bootstrap.sh",
        env=_script_env(MICRO_OTTER_BUILD_BACKEND="../esp-idf"),
    )

    assert result.returncode != 0
    assert "invalid MICRO_OTTER_BUILD_BACKEND" in result.stderr


def test_doctor_dispatcher_runs_generic_checks_before_backend_hook(tmp_path: Path) -> None:
    """Host checks run first; an executable backend hook then takes over."""

    toolchain_dir = _copy_toolchain_dir(tmp_path)
    _write_executable(
        toolchain_dir / "esp-idf" / "doctor.sh",
        "#!/usr/bin/env bash\nset -euo pipefail\nprintf 'backend-doctor: esp-idf\\n'\n",
    )
    bin_dir = _symlink_bin_dir(tmp_path, ("bash", "git", "make", "python3"))
    env = _script_env(MICRO_OTTER_BUILD_BACKEND="esp-idf")
    env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"

    result = _run_shell(toolchain_dir / "doctor.sh", env=env)

    assert result.returncode == 0, result.stderr
    assert "backend-doctor: esp-idf" in result.stdout
    assert result.stdout.index("bash") < result.stdout.index("backend-doctor: esp-idf")


def test_doctor_dispatcher_reports_missing_optional_hook(tmp_path: Path) -> None:
    """A backend without a doctor hook still exits successfully, with a notice."""

    toolchain_dir = _copy_toolchain_dir(tmp_path)
    stale_hook = toolchain_dir / "esp-idf" / "doctor.sh"
    if stale_hook.exists():
        stale_hook.unlink()

    bin_dir = _symlink_bin_dir(tmp_path, ("bash", "git", "make", "python3"))
    env = _script_env(MICRO_OTTER_BUILD_BACKEND="esp-idf")
    env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"

    result = _run_shell(toolchain_dir / "doctor.sh", env=env)

    assert result.returncode == 0, result.stderr
    assert "no doctor hook" in result.stdout


def test_doctor_dispatcher_fails_when_host_tools_missing(tmp_path: Path) -> None:
    """A missing host tool fails the run before the backend hook executes."""

    toolchain_dir = _copy_toolchain_dir(tmp_path)
    hook_marker = tmp_path / "hook-ran"
    _write_executable(
        toolchain_dir / "esp-idf" / "doctor.sh",
        f'#!/usr/bin/env bash\nset -euo pipefail\ntouch "{hook_marker}"\n',
    )
    bin_dir = _symlink_bin_dir(tmp_path, ("bash",))
    env = _script_env(MICRO_OTTER_BUILD_BACKEND="esp-idf")
    env["PATH"] = str(bin_dir)

    result = _run_shell(toolchain_dir / "doctor.sh", env=env)

    assert result.returncode != 0
    assert "missing" in result.stdout
    assert not hook_marker.exists(), "backend hook must not run when host tools are missing"


def test_esp_idf_bootstrap_derives_paths_from_toolchain_dir(tmp_path: Path) -> None:
    """``MICRO_OTTER_TOOLCHAIN_DIR`` relocates every derived toolchain path off ``/opt``."""

    toolchain_dir = tmp_path / "relocated root"
    config = _read_toolchain_config(
        ESP_IDF_BOOTSTRAP,
        _script_env(MICRO_OTTER_TOOLCHAIN_DIR=str(toolchain_dir)),
    )

    assert config["MICRO_OTTER_TOOLCHAIN_DIR"] == str(toolchain_dir)
    assert config["IDF_PATH"] == f"{toolchain_dir}/esp-idf"
    assert config["IDF_TOOLS_PATH"] == f"{toolchain_dir}/.espressif"
    assert config["MICROPYTHON_ROOT"] == f"{toolchain_dir}/micropython"
    assert config["MPY_CROSS_BIN"] == f"{toolchain_dir}/micropython/mpy-cross/build/mpy-cross"


def test_esp_idf_bootstrap_reads_pins_from_versions_env(tmp_path: Path) -> None:
    """With no pins in the environment, the shared ``versions.env`` supplies them."""

    pins = _load_pins()
    config = _read_toolchain_config(
        ESP_IDF_BOOTSTRAP,
        _script_env(MICRO_OTTER_TOOLCHAIN_DIR=str(tmp_path / "root")),
    )

    assert config["ESP_IDF_VERSION"] == pins["ESP_IDF_VERSION"]
    assert config["MICROPYTHON_VERSION"] == pins["MICROPYTHON_VERSION"]
    assert config["MPY_CROSS_VERSION"] == pins["MPY_CROSS_VERSION"]


def test_esp_idf_bootstrap_honors_explicit_path_overrides(tmp_path: Path) -> None:
    """Explicit ``IDF_PATH``/``IDF_TOOLS_PATH``/``MICROPYTHON_ROOT`` beat the derived defaults."""

    config = _read_toolchain_config(
        ESP_IDF_BOOTSTRAP,
        _script_env(
            MICRO_OTTER_TOOLCHAIN_DIR=str(tmp_path / "root"),
            IDF_PATH=str(tmp_path / "custom-idf"),
            IDF_TOOLS_PATH=str(tmp_path / "custom-tools"),
            MICROPYTHON_ROOT=str(tmp_path / "custom-micropython"),
        ),
    )

    assert config["IDF_PATH"] == str(tmp_path / "custom-idf")
    assert config["IDF_TOOLS_PATH"] == str(tmp_path / "custom-tools")
    assert config["MICROPYTHON_ROOT"] == str(tmp_path / "custom-micropython")
    assert config["MPY_CROSS_BIN"] == f"{tmp_path / 'custom-micropython'}/mpy-cross/build/mpy-cross"


def test_esp_idf_bootstrap_applies_backend_pin_file(tmp_path: Path) -> None:
    """A backend-local ``versions.env`` overrides the shared pin for that backend only."""

    toolchain_dir = _copy_toolchain_dir(tmp_path)
    (toolchain_dir / "esp-idf" / "versions.env").write_text(
        "MICROPYTHON_VERSION=v9.9.9\n",
        encoding="utf-8",
    )
    config = _read_toolchain_config(
        toolchain_dir / "esp-idf" / "bootstrap.sh",
        _script_env(MICRO_OTTER_TOOLCHAIN_DIR=str(tmp_path / "root")),
    )

    assert config["MICROPYTHON_VERSION"] == "v9.9.9"
    assert config["ESP_IDF_VERSION"] == _load_pins()["ESP_IDF_VERSION"]


def test_esp_idf_bootstrap_stays_inert_when_sourced(tmp_path: Path) -> None:
    """Sourcing the bootstrap only defines functions; nothing clones or installs."""

    toolchain_dir = tmp_path / "never-created"

    result = subprocess.run(
        ["bash", "-c", f'source "{ESP_IDF_BOOTSTRAP}"'],
        capture_output=True,
        text=True,
        env=_script_env(MICRO_OTTER_TOOLCHAIN_DIR=str(toolchain_dir)),
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout == ""
    assert not toolchain_dir.exists(), "sourcing must not create the toolchain root"


def test_esp_idf_bootstrap_checks_mpy_cross_against_mpy_cross_pin() -> None:
    """The rebuild decision compares against ``MPY_CROSS_VERSION``, not the MicroPython pin."""

    text = ESP_IDF_BOOTSTRAP.read_text(encoding="utf-8")

    assert 'MPY_CROSS_VERSION="${MPY_CROSS_VERSION:-${MICROPYTHON_VERSION}}"' in text
    assert '"MicroPython ${MPY_CROSS_VERSION}"' in text


def test_esp_idf_bootstrap_fails_loudly_without_pins(tmp_path: Path) -> None:
    """A bootstrap copy with no pin file and no pins in the environment refuses to run."""

    toolchain_dir = _copy_toolchain_dir(tmp_path)
    (toolchain_dir / "versions.env").unlink()

    result = _run_shell(
        toolchain_dir / "esp-idf" / "bootstrap.sh",
        env=_script_env(MICRO_OTTER_TOOLCHAIN_DIR=str(tmp_path / "root")),
    )

    assert result.returncode != 0
    assert "pins are unset" in result.stderr
    assert not (tmp_path / "root").exists()


def test_devcontainer_post_create_uses_the_toolchain_dispatcher() -> None:
    """Container setup installs the toolchain through the dispatcher, before post-create.sh."""

    config = json.loads(DEVCONTAINER_JSON.read_text(encoding="utf-8"))
    command = config["postCreateCommand"]

    assert isinstance(command, str), command
    assert "bash deploy/toolchain/bootstrap.sh" in command, (
        "postCreateCommand must install the toolchain through deploy/toolchain/bootstrap.sh so "
        f"backend selection stays in one place, got {command!r}"
    )
    assert command.index("deploy/toolchain/bootstrap.sh") < command.index(
        "post-create.sh"
    ), f"the toolchain dispatcher must run before post-create.sh, got {command!r}"
    assert (
        "bootstrap-opt-toolchains.sh" not in command
    ), f"postCreateCommand still calls the removed .devcontainer script: {command!r}"


def test_devcontainer_bootstrap_script_lives_under_deploy() -> None:
    """The old devcontainer-owned bootstrap is gone; the deploy tree is the single source."""

    assert not (REPO_ROOT / ".devcontainer" / "bootstrap-opt-toolchains.sh").exists()
    assert ESP_IDF_BOOTSTRAP.is_file(), "deploy/toolchain/esp-idf/bootstrap.sh must exist"


def test_dockerfile_does_not_hardcode_toolchain_locations() -> None:
    """No image-level location defaults, and /opt paths appear only as runtime fallbacks."""

    offenders: list[str] = []

    for raw_line in DOCKERFILE.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        if any(line.startswith(f"ENV {name}=") for name in _TOOLCHAIN_LOCATION_ENV_VARS):
            offenders.append(f"ENV override blocks MICRO_OTTER_TOOLCHAIN_DIR relocation: {line}")

        if any(path in line for path in _HARDCODED_OPT_PATHS) and not any(
            fragment in line for fragment in _DEFAULT_LOCATION_FRAGMENTS
        ):
            offenders.append(f"hardcoded toolchain path: {line}")

    assert not offenders, offenders


def test_idf_launcher_is_syntactically_valid_and_executable() -> None:
    """The launcher is a bash script (not only ``*.sh``) and ships executable."""

    result = subprocess.run(
        ["bash", "-n", str(IDF_LAUNCHER)],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, f"bash -n failed for {IDF_LAUNCHER}: {result.stderr}"
    assert IDF_LAUNCHER.stat().st_mode & 0o111, f"{IDF_LAUNCHER} must be executable"


def test_idf_launcher_derives_paths_from_toolchain_dir(tmp_path: Path) -> None:
    """``MICRO_OTTER_TOOLCHAIN_DIR`` locates the checkout and the tools directory."""

    toolchain_dir = tmp_path / "toolchain"
    checkout = toolchain_dir / "esp-idf"
    _write_fake_idf_checkout(checkout)

    result = _run_shell(
        IDF_LAUNCHER,
        "-p",
        "/dev/ttyUSB0",
        "flash",
        env=_script_env(MICRO_OTTER_TOOLCHAIN_DIR=str(toolchain_dir)),
    )

    assert result.returncode == 0, result.stderr
    assert f"IDF_PATH={checkout}" in result.stdout
    assert f"IDF_TOOLS_PATH={toolchain_dir / '.espressif'}" in result.stdout
    assert "args=-p /dev/ttyUSB0 flash" in result.stdout


def test_idf_launcher_honors_exported_idf_path(tmp_path: Path) -> None:
    """An exported ``IDF_PATH`` wins over the value derived from the toolchain dir."""

    checkout = tmp_path / "custom-esp-idf"
    _write_fake_idf_checkout(checkout)

    result = _run_shell(
        IDF_LAUNCHER,
        "build",
        env=_script_env(
            MICRO_OTTER_TOOLCHAIN_DIR=str(tmp_path / "toolchain"),
            IDF_PATH=str(checkout),
        ),
    )

    assert result.returncode == 0, result.stderr
    assert f"IDF_PATH={checkout}" in result.stdout
    assert "args=build" in result.stdout


def test_idf_launcher_sources_export_sh_when_present(tmp_path: Path) -> None:
    """``export.sh`` is sourced so the IDF python environment is active."""

    checkout = tmp_path / "esp-idf"
    _write_fake_idf_checkout(checkout)
    (checkout / "export.sh").write_text(
        "export MICRO_OTTER_FAKE_EXPORTED=1\n",
        encoding="utf-8",
    )

    result = _run_shell(IDF_LAUNCHER, env=_script_env(IDF_PATH=str(checkout)))

    assert result.returncode == 0, result.stderr
    assert "exported=1" in result.stdout


def test_idf_launcher_runs_idf_tools_entry_point(tmp_path: Path) -> None:
    """A checked-out ``tools/idf.py`` without the exec bit still runs."""

    checkout = tmp_path / "esp-idf"
    _write_python_idf_entry(checkout)

    result = _run_shell(IDF_LAUNCHER, "build", env=_script_env(IDF_PATH=str(checkout)))

    assert result.returncode == 0, result.stderr
    assert "args=build" in result.stdout
    assert f"IDF_PATH={checkout}" in result.stdout


def test_idf_launcher_reports_missing_idf_with_hint(tmp_path: Path) -> None:
    """A checkout without ``tools/idf.py`` exits 127 and names the install path."""

    checkout = tmp_path / "esp-idf"
    checkout.mkdir()

    result = _run_shell(IDF_LAUNCHER, "build", env=_script_env(IDF_PATH=str(checkout)))

    assert result.returncode == 127
    assert f"idf.py: ESP-IDF not found at {checkout}" in result.stderr
    assert "hint: run 'micro-otter toolchain install' or set MICRO_OTTER_TOOLCHAIN_DIR" in (
        result.stderr
    )


def test_idf_launcher_defaults_to_the_container_prefix(tmp_path: Path) -> None:
    """With nothing exported the launcher looks under ``/opt`` like the image does."""

    if (Path("/opt/esp-idf") / "tools" / "idf.py").exists():
        pytest.skip("host has a real /opt/esp-idf checkout")

    result = _run_shell(IDF_LAUNCHER, env=_script_env())

    assert result.returncode == 127
    assert "idf.py: ESP-IDF not found at /opt/esp-idf" in result.stderr


def test_dockerfile_does_not_embed_idf_launcher() -> None:
    """The repository launcher is the only copy; the image links it at create time."""

    text = DOCKERFILE.read_text(encoding="utf-8")

    assert "/usr/local/bin/idf.py" not in text, (
        ".devcontainer/Dockerfile must not write its own idf.py; "
        ".devcontainer/link-idf-launcher.sh links deploy/toolchain/esp-idf/idf.py instead"
    )
    assert (
        "deploy/toolchain/esp-idf/idf.py" in text
    ), "the Dockerfile must name deploy/toolchain/esp-idf/idf.py as the single launcher"


def test_devcontainer_links_the_repository_launcher() -> None:
    """The link script points at the repository launcher and runs at create time."""

    assert LINK_LAUNCHER_SCRIPT.is_file(), ".devcontainer/link-idf-launcher.sh must exist"
    assert LINK_LAUNCHER_SCRIPT.stat().st_mode & 0o111, f"{LINK_LAUNCHER_SCRIPT} must be executable"

    text = LINK_LAUNCHER_SCRIPT.read_text(encoding="utf-8")

    assert "deploy/toolchain/esp-idf/idf.py" in text
    assert "/usr/local/bin/idf.py" in text
    assert "ln -sfn" in text, "the link must be idempotent"
    assert not re.search(
        r"^\s*sudo\s", text, re.MULTILINE
    ), "the container runs as root; the link must not shell out to sudo"

    command = json.loads(DEVCONTAINER_JSON.read_text(encoding="utf-8"))["postCreateCommand"]

    assert isinstance(command, str), command
    assert (
        "bash .devcontainer/link-idf-launcher.sh" in command
    ), f"postCreateCommand must link the repository launcher onto PATH, got {command!r}"
    assert command.index("deploy/toolchain/bootstrap.sh") < command.index(
        "link-idf-launcher.sh"
    ), f"the toolchain must be installed before the launcher is linked, got {command!r}"
    assert command.index("link-idf-launcher.sh") < command.index(
        "post-create.sh"
    ), f"the launcher link must exist before post-create.sh runs, got {command!r}"


def test_devcontainer_link_script_is_syntactically_valid() -> None:
    """``link-idf-launcher.sh`` must pass ``bash -n``."""

    result = subprocess.run(
        ["bash", "-n", str(LINK_LAUNCHER_SCRIPT)],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, f"bash -n failed for {LINK_LAUNCHER_SCRIPT}: {result.stderr}"


def test_devcontainer_link_script_fails_when_the_launcher_is_missing(tmp_path: Path) -> None:
    """A checkout without the launcher fails with a clear error instead of a dangling link."""

    repo = tmp_path / "repo"
    (repo / ".devcontainer").mkdir(parents=True)
    copied = repo / ".devcontainer" / "link-idf-launcher.sh"
    shutil.copy2(LINK_LAUNCHER_SCRIPT, copied)

    result = _run_shell(copied, env=_script_env())

    assert result.returncode == 1
    assert "error: ESP-IDF launcher not found at" in result.stderr
    assert "deploy/toolchain/esp-idf/idf.py" in result.stderr


def test_post_create_script_does_not_install_toolchains() -> None:
    """``post-create.sh`` owns Python/Node/git setup only; the dispatcher owns toolchains."""

    text = POST_CREATE_SCRIPT.read_text(encoding="utf-8")

    for marker in (
        "deploy/toolchain",
        "bootstrap-opt-toolchains",
        "esp-idf",
        "micropython",
        "./install.sh",
    ):
        assert marker not in text.lower(), (
            f"post-create.sh must not duplicate toolchain installation ({marker!r} found); the "
            "dispatcher is the only install path"
        )


def test_post_create_script_registers_safe_directories_before_repository_git_commands() -> None:
    """Host-owned bind mounts must be marked safe before any repository-local git command runs.

    The container runs as root while the workspace and the sibling public clone belong to the host
    user; without a ``safe.directory`` entry git silently stops seeing the repository and the script
    aborts at ``git config core.hooksPath`` with "fatal: not in a git directory".
    """

    text = POST_CREATE_SCRIPT.read_text(encoding="utf-8")

    assert (
        "git config --global --add safe.directory" in text
    ), "post-create.sh must register the bind-mounted repositories as safe directories"
    assert text.index("git config --global --add safe.directory") < text.index(
        "git config core.hooksPath"
    ), "safe.directory registration must precede the repository-local git config calls"


def test_post_create_script_exports_gpg_tty_for_login_and_interactive_shells() -> None:
    """``GPG_TTY`` must reach login shells too, or pinentry has no terminal to prompt on.

    A VS Code terminal starts a login shell, which reads ``~/.profile`` and never runs the body of
    ``~/.bashrc``; with no ``GPG_TTY`` gpg fails with "Inappropriate ioctl for device" even though
    the terminal itself is healthy. The export resolves the tty per shell start, because the device
    name changes with every terminal.
    """

    text = POST_CREATE_SCRIPT.read_text(encoding="utf-8")

    assert (
        "for _gpg_rc in ~/.bashrc ~/.profile; do" in text
    ), "post-create.sh must install the GPG_TTY export for interactive and login shells alike"
    assert (
        "# micro-otter: export GPG_TTY for pinentry" in text
    ), "the block must be identifiable so re-running post-create.sh stays idempotent"
    assert (
        "_micro_otter_tty=\\$(tty 2>/dev/null)" in text
    ), "the export must resolve the current tty instead of baking in a device name"
    assert (
        "[ -t 0 ] || [ -t 1 ]" in text
    ), "the export must stay silent for shells without a terminal"

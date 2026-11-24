#!/usr/bin/env bash
# ESP-IDF + MicroPython toolchain bootstrap.
#
# This is the only supported install path for the ESP-IDF/MicroPython toolchain. Run it through the
# dispatcher (deploy/toolchain/bootstrap.sh) so backend selection stays in one place.
#
# Pins come from deploy/toolchain/versions.env (shared) and deploy/toolchain/esp-idf/versions.env
# (backend-specific, optional). Both are applied only when the variable is not already set, so an
# explicit environment override always wins. The backend file is applied first, so a backend pin
# beats the shared pin for this backend only.
#
# Locations:
#   MICRO_OTTER_TOOLCHAIN_DIR  install root (default: /opt)
#   IDF_PATH                   default: ${MICRO_OTTER_TOOLCHAIN_DIR}/esp-idf
#   IDF_TOOLS_PATH             default: ${MICRO_OTTER_TOOLCHAIN_DIR}/.espressif
#   MICROPYTHON_ROOT           default: ${MICRO_OTTER_TOOLCHAIN_DIR}/micropython
#
# Contract: deploy/toolchain/README.md
set -euo pipefail

# Resolve this script's own directory so any caller working directory works.
_bootstrap_source="${BASH_SOURCE[0]}"
_bootstrap_dir="${_bootstrap_source%/*}"
if [[ "${_bootstrap_dir}" == "${_bootstrap_source}" ]]; then
    _bootstrap_dir="."
fi
readonly _script_dir="$(cd -- "${_bootstrap_dir}" && pwd -P)"
readonly _toolchain_dir="$(cd -- "${_script_dir}/.." && pwd -P)"

# Apply KEY=VALUE pins from an env file, keeping values the caller already exported.
# Arguments: $1 - env file path; missing files are ignored.
apply_pin_defaults() {
    local file="$1"
    local line key value

    [[ -f "${file}" ]] || return 0

    while IFS= read -r line || [[ -n "${line}" ]]; do
        line="${line%%#*}"
        line="${line//[[:space:]]/}"
        [[ -z "${line}" ]] && continue

        key="${line%%=*}"
        value="${line#*=}"
        [[ "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
        [[ -n "${!key:-}" ]] && continue

        printf -v "${key}" '%s' "${value}"
        export "${key?}"
    done < "${file}"
}

# Resolve every toolchain location from pins, caller overrides, and the /opt fallback.
resolve_paths() {
    # Backend-local pins are applied first so they win over the shared file; caller exports win
    # over both because a file never overwrites an already-set variable.
    apply_pin_defaults "${_script_dir}/versions.env"
    apply_pin_defaults "${_toolchain_dir}/versions.env"

    MICRO_OTTER_TOOLCHAIN_DIR="${MICRO_OTTER_TOOLCHAIN_DIR:-/opt}"
    IDF_PATH="${IDF_PATH:-${MICRO_OTTER_TOOLCHAIN_DIR}/esp-idf}"
    IDF_TOOLS_PATH="${IDF_TOOLS_PATH:-${MICRO_OTTER_TOOLCHAIN_DIR}/.espressif}"
    MICROPYTHON_ROOT="${MICROPYTHON_ROOT:-${MICRO_OTTER_TOOLCHAIN_DIR}/micropython}"
    ESP_IDF_VERSION="${ESP_IDF_VERSION:-}"
    MICROPYTHON_VERSION="${MICROPYTHON_VERSION:-}"
    MPY_CROSS_VERSION="${MPY_CROSS_VERSION:-${MICROPYTHON_VERSION}}"
    MPY_CROSS_BIN="${MICROPYTHON_ROOT}/mpy-cross/build/mpy-cross"

    export MICRO_OTTER_TOOLCHAIN_DIR IDF_PATH IDF_TOOLS_PATH MICROPYTHON_ROOT
    export ESP_IDF_VERSION MICROPYTHON_VERSION MPY_CROSS_VERSION MPY_CROSS_BIN
}

# Print the resolved toolchain configuration as KEY=VALUE lines.
# Lets tests and callers read the derived paths without installing anything.
print_toolchain_config() {
    resolve_paths

    printf 'MICRO_OTTER_TOOLCHAIN_DIR=%s\n' "${MICRO_OTTER_TOOLCHAIN_DIR}"
    printf 'IDF_PATH=%s\n' "${IDF_PATH}"
    printf 'IDF_TOOLS_PATH=%s\n' "${IDF_TOOLS_PATH}"
    printf 'MICROPYTHON_ROOT=%s\n' "${MICROPYTHON_ROOT}"
    printf 'ESP_IDF_VERSION=%s\n' "${ESP_IDF_VERSION}"
    printf 'MICROPYTHON_VERSION=%s\n' "${MICROPYTHON_VERSION}"
    printf 'MPY_CROSS_VERSION=%s\n' "${MPY_CROSS_VERSION}"
    printf 'MPY_CROSS_BIN=%s\n' "${MPY_CROSS_BIN}"
}

# Helpers ----------------------------------------------------------------

current_tag() {
    # Print the exact tag the given checkout is at, or "" if unknown.
    git -C "$1" describe --tags --exact-match 2>/dev/null || true
}

ensure_clone_at_version() {
    local root="$1"
    local version="$2"
    local name="$3"
    local url="$4"

    if [[ -d "${root}/.git" ]]; then
        local have
        have="$(current_tag "${root}")"
        if [[ "${have}" == "${version}" ]]; then
            echo "${name} already at ${version}; skipping clone"
            return 0
        fi
        echo "${name} at ${root} is '${have:-unknown}', wanted ${version}; re-cloning"
        rm -rf "${root}"
    fi

    echo "Bootstrapping ${name} into ${root} (${version})"
    git clone -b "${version}" --depth 1 --recursive --shallow-submodules \
        "${url}" "${root}"
}

# ESP-IDF ----------------------------------------------------------------

bootstrap_esp_idf() {
    local idf_marker="${IDF_PATH}/.micro_otter_idf_tools_installed_${ESP_IDF_VERSION}"

    ensure_clone_at_version \
        "${IDF_PATH}" "${ESP_IDF_VERSION}" "ESP-IDF" \
        "https://github.com/espressif/esp-idf.git"

    if [[ ! -f "${idf_marker}" ]]; then
        echo "Installing ESP-IDF toolchain into ${IDF_TOOLS_PATH}"
        (
            cd "${IDF_PATH}"
            IDF_TOOLS_PATH="${IDF_TOOLS_PATH}" ./install.sh esp32
        )
        touch "${idf_marker}"
    else
        echo "ESP-IDF toolchain marker found; skipping install"
    fi
}

# MicroPython ------------------------------------------------------------

bootstrap_micropython() {
    local mpy_cross_ok=0
    local reported

    ensure_clone_at_version \
        "${MICROPYTHON_ROOT}" "${MICROPYTHON_VERSION}" "MicroPython" \
        "https://github.com/micropython/micropython.git"

    if [[ -x "${MPY_CROSS_BIN}" ]]; then
        reported="$("${MPY_CROSS_BIN}" --version 2>/dev/null \
            | grep -oE 'MicroPython v[0-9]+\.[0-9]+\.[0-9]+' || true)"
        if [[ "${reported}" == "MicroPython ${MPY_CROSS_VERSION}" ]]; then
            echo "mpy-cross already reports ${MPY_CROSS_VERSION}; skipping build"
            mpy_cross_ok=1
        else
            echo "mpy-cross reports '${reported:-unknown}', wanted MPY_CROSS_VERSION ${MPY_CROSS_VERSION}; rebuilding"
        fi
    fi

    if [[ "${mpy_cross_ok}" -ne 1 ]]; then
        echo "Building mpy-cross at ${MPY_CROSS_BIN}"
        make -C "${MICROPYTHON_ROOT}/mpy-cross" -j"$(nproc)"
    fi
}

# Entry point ------------------------------------------------------------

main() {
    resolve_paths

    if [[ -z "${ESP_IDF_VERSION}" || -z "${MICROPYTHON_VERSION}" ]]; then
        printf 'error: toolchain pins are unset\n' >&2
        printf 'set ESP_IDF_VERSION and MICROPYTHON_VERSION, or restore deploy/toolchain/versions.env\n' >&2
        return 2
    fi

    printf 'Toolchain configuration:\n'
    print_toolchain_config

    # Create the configured root, not a hardcoded /opt, so a relocated toolchain works.
    mkdir -p -- "${MICRO_OTTER_TOOLCHAIN_DIR}"
    mkdir -p -- "${IDF_TOOLS_PATH}"

    bootstrap_esp_idf
    bootstrap_micropython
}

# Sourcing this script only defines functions; nothing installs until main runs.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi

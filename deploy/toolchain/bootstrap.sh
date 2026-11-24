#!/usr/bin/env bash
# Toolchain bootstrap dispatcher.
#
# Resolves the selected build backend from MICRO_OTTER_BUILD_BACKEND (default: esp-idf) and runs
# deploy/toolchain/<backend>/bootstrap.sh with the forwarded arguments. An unknown or malformed
# backend id fails loudly; the dispatcher never falls back to a different backend silently.
#
# Contract: deploy/toolchain/README.md
# Config-aware superset: `micro-otter toolchain install` resolves the workspace and toolchain
# directory, builds the child environment from the configuration resolver, and supports --dry-run.
set -euo pipefail

readonly BACKEND_ENV_VAR="MICRO_OTTER_BUILD_BACKEND"
readonly DEFAULT_BACKEND="esp-idf"
readonly BACKEND_ID_PATTERN='^[A-Za-z0-9._-]+$'

# Resolve this script's own directory so any caller working directory works.
_dispatcher_source="${BASH_SOURCE[0]}"
_dispatcher_dir="${_dispatcher_source%/*}"
if [[ "${_dispatcher_dir}" == "${_dispatcher_source}" ]]; then
    _dispatcher_dir="."
fi
readonly _script_dir="$(cd -- "${_dispatcher_dir}" && pwd -P)"

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

# Print the backend directory names available next to this dispatcher.
list_available_backends() {
    local entry
    local found=0

    for entry in "${_script_dir}"/*/; do
        [[ -d "${entry}" ]] || continue
        entry="${entry%/}"
        printf '  %s\n' "${entry##*/}"
        found=1
    done

    if [[ "${found}" -eq 0 ]]; then
        printf '  (none)\n'
    fi
}

# Validate the backend id, then hand off to that backend's bootstrap script.
main() {
    apply_pin_defaults "${_script_dir}/versions.env"

    local backend="${MICRO_OTTER_BUILD_BACKEND:-${DEFAULT_BACKEND}}"

    if [[ ! "${backend}" =~ ${BACKEND_ID_PATTERN} ]]; then
        printf 'error: invalid %s value %q\n' "${BACKEND_ENV_VAR}" "${backend}" >&2
        printf 'allowed characters: letters, digits, ".", "_", "-"\n' >&2
        return 2
    fi

    local backend_script="${_script_dir}/${backend}/bootstrap.sh"

    if [[ ! -f "${backend_script}" ]]; then
        printf 'error: unknown build backend %q\n' "${backend}" >&2
        printf 'expected backend bootstrap at: %s\n' "${backend_script}" >&2
        printf 'available backends:\n' >&2
        list_available_backends >&2
        return 2
    fi

    exec bash "${backend_script}" "$@"
}

main "$@"

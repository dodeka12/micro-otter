#!/usr/bin/env bash
# Toolchain doctor dispatcher.
#
# Runs the backend-agnostic host checks (bash, git, make, python3) and then hands off to the
# selected backend's optional doctor hook (deploy/toolchain/<backend>/doctor.sh). This script is
# deliberately not the M2 `micro-otter doctor` command: it reports raw host prerequisites and owns
# no config resolution.
#
# Contract: deploy/toolchain/README.md
# Config-aware superset: `micro-otter doctor` adds the configuration resolver, writability, and
# toolchain-component checks on top of these raw host prerequisites.
set -euo pipefail

readonly BACKEND_ENV_VAR="MICRO_OTTER_BUILD_BACKEND"
readonly DEFAULT_BACKEND="esp-idf"
readonly BACKEND_ID_PATTERN='^[A-Za-z0-9._-]+$'
readonly REQUIRED_HOST_TOOLS=(bash git make python3)

# Resolve this script's own directory so any caller working directory works.
_doctor_source="${BASH_SOURCE[0]}"
_doctor_dir="${_doctor_source%/*}"
if [[ "${_doctor_dir}" == "${_doctor_source}" ]]; then
    _doctor_dir="."
fi
readonly _script_dir="$(cd -- "${_doctor_dir}" && pwd -P)"

# Print the validated backend id on stdout, or a diagnostic on stderr and a non-zero status.
resolve_backend() {
    local backend="${MICRO_OTTER_BUILD_BACKEND:-${DEFAULT_BACKEND}}"

    if [[ ! "${backend}" =~ ${BACKEND_ID_PATTERN} ]]; then
        printf 'error: invalid %s value %q\n' "${BACKEND_ENV_VAR}" "${backend}" >&2
        printf 'allowed characters: letters, digits, ".", "_", "-"\n' >&2
        return 2
    fi

    printf '%s\n' "${backend}"
}

# Report the required host tools; returns non-zero when any of them is missing.
run_generic_checks() {
    local tool
    local resolved
    local missing=0

    printf 'Host tool checks:\n'

    for tool in "${REQUIRED_HOST_TOOLS[@]}"; do
        if resolved="$(command -v -- "${tool}")"; then
            printf '  ok      %-8s %s\n' "${tool}" "${resolved}"
        else
            printf '  missing %-8s install it before bootstrapping the toolchain\n' "${tool}"
            missing=1
        fi
    done

    return "${missing}"
}

# Run the generic checks, then the backend doctor hook when one exists.
main() {
    local backend

    if ! backend="$(resolve_backend)"; then
        return 2
    fi

    if ! run_generic_checks; then
        printf '\nmissing host tools; install them before bootstrapping the toolchain\n' >&2
        return 1
    fi

    local backend_doctor="${_script_dir}/${backend}/doctor.sh"

    if [[ -f "${backend_doctor}" && -x "${backend_doctor}" ]]; then
        printf '\nbackend checks: %s\n' "${backend}"
        exec bash "${backend_doctor}"
    fi

    printf '\nno doctor hook for build backend %q; skipping backend-specific checks\n' "${backend}"
    printf 'expected hook: %s\n' "${backend_doctor}"
}

main "$@"

#!/usr/bin/env bash
# Micro-Otter ESP-IDF launcher — the repository's single `idf.py` entry point.
#
# Runs `${IDF_PATH}/tools/idf.py` for the toolchain selected by IDF_PATH. The devcontainer links this
# file as /usr/local/bin/idf.py (.devcontainer/link-idf-launcher.sh) instead of embedding a second
# copy in the image. The script never needs its own directory to find sibling files, so being invoked
# through a symlink on PATH is safe; do not resolve symlinks here.
#
# Locations (an exported value always wins):
#   IDF_PATH        ${MICRO_OTTER_TOOLCHAIN_DIR}/esp-idf, else /opt/esp-idf
#   IDF_TOOLS_PATH  ${MICRO_OTTER_TOOLCHAIN_DIR}/.espressif, else /opt/.espressif
#
# Contract: deploy/toolchain/README.md, docs/dev/deployment/deploy-layout.md
set -euo pipefail

if [[ -n "${MICRO_OTTER_TOOLCHAIN_DIR:-}" ]]; then
    IDF_PATH="${IDF_PATH:-${MICRO_OTTER_TOOLCHAIN_DIR}/esp-idf}"
    IDF_TOOLS_PATH="${IDF_TOOLS_PATH:-${MICRO_OTTER_TOOLCHAIN_DIR}/.espressif}"
else
    IDF_PATH="${IDF_PATH:-/opt/esp-idf}"
    IDF_TOOLS_PATH="${IDF_TOOLS_PATH:-/opt/.espressif}"
fi
export IDF_PATH IDF_TOOLS_PATH

readonly _idf_entry="${IDF_PATH}/tools/idf.py"

if [[ ! -f "${_idf_entry}" ]]; then
    printf 'idf.py: ESP-IDF not found at %s\n' "${IDF_PATH}" >&2
    printf "hint: run 'micro-otter toolchain install' or set MICRO_OTTER_TOOLCHAIN_DIR\n" >&2
    exit 127
fi

# A toolchain installed by bootstrap.sh always ships export.sh; a hand-built checkout may not, so a
# missing file is not an error. Third-party shell code is not guaranteed to be nounset-safe.
if [[ -f "${IDF_PATH}/export.sh" ]]; then
    set +u
    # shellcheck disable=SC1091
    source "${IDF_PATH}/export.sh" >/dev/null 2>&1
    set -u
fi

# Upstream tools/idf.py is not always marked executable after a manual checkout.
if [[ -x "${_idf_entry}" ]]; then
    exec "${_idf_entry}" "$@"
fi
exec "${PYTHON:-python3}" "${_idf_entry}" "$@"

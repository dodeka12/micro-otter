#!/usr/bin/env bash
# Link the repository-owned ESP-IDF launcher onto PATH inside the devcontainer.
#
# The image embeds no launcher copy: deploy/toolchain/esp-idf/idf.py is the single implementation and
# this script points /usr/local/bin/idf.py at it. postCreateCommand runs it between the toolchain
# bootstrap and post-create.sh. It installs nothing, needs no sudo (the container runs as root), and
# is idempotent.
#
# Contract: docs/dev/deployment/deploy-layout.md
set -euo pipefail

_link_source="${BASH_SOURCE[0]}"
_link_dir="${_link_source%/*}"
if [[ "${_link_dir}" == "${_link_source}" ]]; then
    _link_dir="."
fi
readonly _script_dir="$(cd -- "${_link_dir}" && pwd -P)"
readonly _repo_root="$(cd -- "${_script_dir}/.." && pwd -P)"
readonly _launcher="${_repo_root}/deploy/toolchain/esp-idf/idf.py"
readonly _link_path="/usr/local/bin/idf.py"

if [[ ! -f "${_launcher}" ]]; then
    printf 'error: ESP-IDF launcher not found at %s\n' "${_launcher}" >&2
    printf 'expected the repository launcher at deploy/toolchain/esp-idf/idf.py\n' >&2
    exit 1
fi

ln -sfn "${_launcher}" "${_link_path}"
printf 'Linked %s -> %s\n' "${_link_path}" "${_launcher}"

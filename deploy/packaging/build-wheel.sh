#!/usr/bin/env bash
# Build the Micro-Otter install wheel — the only supported install artifact.
#
# The wheel is self-contained: the built web app (`_dist/webapp`) and the shared
# toolchain assets (`deploy/toolchain`) are copied into the package before
# `uv build --wheel` runs, and `tools/inspect_wheel.py` then proves the contents.
# The script works from any working directory.
#
# Usage: bash deploy/packaging/build-wheel.sh [options]
#   --no-build       reuse an existing `_dist/webapp` instead of `npm run build`
#   --out-dir <dir>  write the wheel to <dir> (default: dist/)
#   --help           print this usage and exit
#
# Contract: the wheel/sdist targets in pyproject.toml and
# docs/dev/guides/build-and-deployment.md.
set -euo pipefail

print_usage() {
    cat <<'EOF'
Usage: bash deploy/packaging/build-wheel.sh [options]

Build the Micro-Otter install wheel and prove its contents with
tools/inspect_wheel.py.

Options:
  --no-build       reuse an existing _dist/webapp instead of `npm run build`
  --out-dir <dir>  write the wheel to <dir> (default: dist/)
  --help           print this usage and exit
EOF
}

# Report one contract failure and exit with the guard code (2).
fail() {
    printf 'error: %s\n' "$1" >&2
    exit 2
}

NO_BUILD=0
OUT_DIR="dist"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-build)
            NO_BUILD=1
            ;;
        --out-dir)
            [[ $# -ge 2 ]] || fail "--out-dir requires a directory"
            OUT_DIR="$2"
            shift
            ;;
        --help)
            print_usage
            exit 0
            ;;
        *)
            fail "unknown option: $1"
            ;;
    esac
    shift
done

# Resolve the repository root from this script's own location.
_build_wheel_source="${BASH_SOURCE[0]}"
_build_wheel_dir="${_build_wheel_source%/*}"
if [[ "${_build_wheel_dir}" == "${_build_wheel_source}" ]]; then
    _build_wheel_dir="."
fi
REPO_ROOT="$(cd -- "${_build_wheel_dir}/../.." && pwd -P)"
readonly REPO_ROOT

# 1. Every required tool must exist; the failure names the missing one.
require_tool() {
    command -v -- "$1" >/dev/null 2>&1 || fail "$1 is required but not on PATH"
}
require_tool node
require_tool npm
require_tool uv

cd "${REPO_ROOT}"

# 2. Install the exact dependency tree the web build needs.
npm ci

# The bundle copy below is a build input, never a tracked file: remove it on
# exit no matter how the build ends.
trap 'rm -rf "${REPO_ROOT}/src/micro_otter/dist"' EXIT

# 3-4. Produce the app version and the bundle (or reuse an existing bundle).
if [[ "${NO_BUILD}" -ne 1 ]]; then
    # `tools/project-version.mjs` fails the build when `src/micro_otter/_version.py`
    # is absent, so reinstall the package to let hatch-vcs write it before the
    # bundle is stamped. `--all-groups` keeps an `--all-groups` devcontainer intact.
    uv sync --all-groups --reinstall-package micro-otter
    npm run build
    [[ -f _dist/webapp/index.html ]] || fail "npm run build produced no _dist/webapp/index.html"
fi
[[ -f _dist/webapp/index.html ]] || fail "_dist/webapp/index.html is missing (run without --no-build, or build first)"

# 5. Copy the bundle into the package where pyproject.toml's `artifacts` reads it.
rm -rf src/micro_otter/dist/webapp
mkdir -p src/micro_otter/dist
cp -a _dist/webapp src/micro_otter/dist/webapp

# 6-7. Build the wheel into a clean output directory.
rm -rf "${OUT_DIR}"
uv build --wheel --out-dir "${OUT_DIR}"

# 8. The output directory must hold exactly one wheel and no sdist.
wheel_count=0
wheel_path=""
for candidate in "${OUT_DIR}"/micro_otter-*.whl; do
    [[ -f "${candidate}" ]] || continue
    wheel_count=$((wheel_count + 1))
    wheel_path="${candidate}"
done
[[ "${wheel_count}" -eq 1 ]] || fail "expected exactly one micro_otter-*.whl in ${OUT_DIR}, found ${wheel_count}"

if compgen -G "${OUT_DIR}"/*.tar.gz >/dev/null 2>&1; then
    fail "${OUT_DIR} contains an sdist (*.tar.gz); the wheel is the only supported artifact"
fi

uv run python tools/inspect_wheel.py "${wheel_path}"

# 9. Report the artifact.
printf 'wheel: %s (%s bytes)\n' "${wheel_path}" "$(wc -c < "${wheel_path}")"

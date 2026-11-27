#!/usr/bin/env bash
# Verify an installed Micro-Otter wheel serves a working server.
#
# Installs the wheel into a throwaway venv (no repository checkout involved) and
# proves: the package resolves its own web app and toolchain assets, the CLI
# entry point answers, and `micro-otter serve` answers `GET /api/server-capabilities`
# and `GET /` correctly. Needs nothing from the checkout except the wheel and
# `tools/wheel_smoke.py`, so CI can call it after `build-wheel.sh` from a clean tree.
#
# Usage:
#   bash deploy/packaging/verify-wheel.sh [--wheel <path>] [--keep]
#
# Contract: docs/dev/guides/build-and-deployment.md.
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: bash deploy/packaging/verify-wheel.sh [options]

Install a Micro-Otter wheel into a throwaway venv and prove it serves.

Options:
  --wheel <path>  wheel to verify (default: dist/micro_otter-*.whl)
  --keep          keep the temporary venv/logs and print their path
  --help          print this usage and exit
EOF
}

fail() {
    printf 'error: %s\n' "$1" >&2
    exit 2
}

WHEEL_GLOB="dist/micro_otter-*.whl"
KEEP=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --wheel)
            [[ $# -ge 2 ]] || fail "--wheel requires a path"
            WHEEL_GLOB="$2"
            shift
            ;;
        --keep)
            KEEP=1
            ;;
        --help)
            usage
            exit 0
            ;;
        *)
            fail "unknown option: $1"
            ;;
    esac
    shift
done

# Resolve the repository root from this script's own location.
_verify_wheel_source="${BASH_SOURCE[0]}"
_verify_wheel_dir="${_verify_wheel_source%/*}"
if [[ "${_verify_wheel_dir}" == "${_verify_wheel_source}" ]]; then
    _verify_wheel_dir="."
fi
REPO_ROOT="$(cd -- "${_verify_wheel_dir}/../.." && pwd -P)"
readonly REPO_ROOT

command -v -- uv >/dev/null 2>&1 || fail "uv is required but not on PATH"
command -v -- curl >/dev/null 2>&1 || fail "curl is required but not on PATH"

if [[ "${WHEEL_GLOB}" == /* ]]; then
    WHEEL_PATH="$(compgen -G "${WHEEL_GLOB}" | head -n 1 || true)"
else
    WHEEL_PATH="$(compgen -G "${REPO_ROOT}/${WHEEL_GLOB}" | head -n 1 || true)"
fi
[[ -n "${WHEEL_PATH}" ]] || fail "no wheel matching ${WHEEL_GLOB}"

TMP="$(mktemp -d)"
cleanup() {
    if [[ -n "${SERVER_PID:-}" ]]; then
        kill "${SERVER_PID}" 2>/dev/null || true
        wait "${SERVER_PID}" 2>/dev/null || true
    fi
    if [[ "${KEEP}" -ne 1 ]]; then
        rm -rf "${TMP}"
    fi
}
trap cleanup EXIT
if [[ "${KEEP}" -eq 1 ]]; then
    echo "temporary dir: ${TMP}"
fi

# 1-2. Throwaway venv with only the wheel installed.
uv venv --python 3.12 "${TMP}/venv"
uv pip install --python "${TMP}/venv/bin/python" "${WHEEL_PATH}"

# 3. The package resolves its own layout.
"${TMP}/venv/bin/python" "${REPO_ROOT}/tools/wheel_smoke.py" --installed

# 4. The CLI entry point answers in the installed venv.
"${TMP}/venv/bin/micro-otter" --help >/dev/null

# 5. Pick a free port with the venv's Python.
PORT="$("${TMP}/venv/bin/python" -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"

# 6. Serve and probe the capability endpoint.
MICRO_OTTER_HOME="${TMP}/home" \
    "${TMP}/venv/bin/micro-otter" serve --host 127.0.0.1 --port "${PORT}" --no-open-browser \
    >"${TMP}/serve.log" 2>&1 &
SERVER_PID=$!

ready=0
for _ in $(seq 1 60); do
    if curl -sf "http://127.0.0.1:${PORT}/api/server-capabilities" -o "${TMP}/capabilities.json"; then
        ready=1
        break
    fi
    sleep 0.5
done
if [[ "${ready}" -ne 1 ]]; then
    cat "${TMP}/serve.log" >&2
    fail "server did not serve /api/server-capabilities within 30s"
fi

"${TMP}/venv/bin/python" "${REPO_ROOT}/tools/wheel_smoke.py" --capabilities "${TMP}/capabilities.json"

STATUS="$(curl -s -o "${TMP}/index.html" -w '%{http_code}' "http://127.0.0.1:${PORT}/")"
[[ "${STATUS}" == "200" ]] || fail "GET / returned ${STATUS}, not 200"
grep -q '<title>Micro-Otter Node Editor</title>' "${TMP}/index.html" \
    || fail "GET / body lacks the Micro-Otter Node Editor title marker"

# 7. Report success; the trap stops the server.
WHEEL_SIZE="$(wc -c < "${WHEEL_PATH}")"
echo "verified ${WHEEL_PATH} (${WHEEL_SIZE} bytes)"

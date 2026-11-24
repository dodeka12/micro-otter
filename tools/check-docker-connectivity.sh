#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
DEFAULT_PORTS="5173,8000"

usage() {
    cat <<EOF
Usage: $SCRIPT_NAME [container] [ports_csv]

Examples:
  $SCRIPT_NAME
  $SCRIPT_NAME micro-otter
  $SCRIPT_NAME micro-otter 5173,5174,8000

Arguments:
  container   Container name or ID. If omitted, tries current HOSTNAME, then auto-selects when only one container is running.
  ports_csv   Comma-separated list of container TCP ports to check. Default: $DEFAULT_PORTS
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
    echo "ERROR: docker CLI is not available in PATH."
    exit 1
fi

CONTAINER="${1:-}"
PORTS_CSV="${2:-$DEFAULT_PORTS}"

if [[ -z "$CONTAINER" ]]; then
    if [[ -n "${HOSTNAME:-}" ]] && docker inspect "$HOSTNAME" >/dev/null 2>&1; then
        CONTAINER="$HOSTNAME"
    else
        mapfile -t RUNNING_CONTAINERS < <(docker ps --format '{{.Names}}')
        if [[ "${#RUNNING_CONTAINERS[@]}" -eq 1 ]]; then
            CONTAINER="${RUNNING_CONTAINERS[0]}"
        else
            echo "ERROR: Could not auto-select container."
            echo "Running containers:"
            docker ps --format '  - {{.Names}} ({{.ID}})'
            echo ""
            echo "Pass container name/ID explicitly: $SCRIPT_NAME <container> [ports_csv]"
            exit 1
        fi
    fi
fi

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
    echo "ERROR: Container '$CONTAINER' does not exist."
    exit 1
fi

echo "== Docker connectivity check =="
echo "Container: $CONTAINER"
echo "Ports:     $PORTS_CSV"
echo ""

echo "[1/4] Container state"
RUNNING_STATE="$(docker inspect --format '{{.State.Running}}' "$CONTAINER")"
if [[ "$RUNNING_STATE" != "true" ]]; then
    echo "  FAIL: Container is not running."
    exit 1
fi
echo "  OK: Container is running."

CONTAINER_IP="$(docker inspect --format '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$CONTAINER")"
echo "  Container IP: ${CONTAINER_IP:-unknown}"
echo ""

echo "[2/4] Published ports (docker port)"
PORT_OUTPUT="$(docker port "$CONTAINER" 2>/dev/null || true)"
if [[ -z "$PORT_OUTPUT" ]]; then
    echo "  WARN: No ports are published to host."
else
    while IFS= read -r line; do
        echo "  $line"
    done <<< "$PORT_OUTPUT"
fi
echo ""

IFS=',' read -r -a PORTS <<< "$PORTS_CSV"

echo "[3/4] Per-port checks"
OVERALL_FAIL=0

for raw_port in "${PORTS[@]}"; do
    PORT="$(echo "$raw_port" | tr -d '[:space:]')"
    if [[ -z "$PORT" ]]; then
        continue
    fi
    if ! [[ "$PORT" =~ ^[0-9]+$ ]]; then
        echo "  Port $PORT: FAIL (invalid port)"
        OVERALL_FAIL=1
        continue
    fi

    echo "  - Container TCP $PORT"

    MAP_LINES="$(docker port "$CONTAINER" "$PORT/tcp" 2>/dev/null || true)"
    if [[ -z "$MAP_LINES" ]]; then
        echo "    FAIL: Not published to host (docker -p missing)."
        OVERALL_FAIL=1
        continue
    fi

    LISTEN_LOCAL="$(docker exec "$CONTAINER" python -c "import socket; s=socket.socket(); s.settimeout(1.5);\ntry:\n s.connect(('127.0.0.1',$PORT)); print('ok')\nexcept Exception:\n print('fail')" 2>/dev/null || true)"
    if [[ "$LISTEN_LOCAL" == "ok" ]]; then
        echo "    OK: Service responds at 127.0.0.1:$PORT inside container."
    else
        echo "    FAIL: Nothing responds at 127.0.0.1:$PORT inside container."
        OVERALL_FAIL=1
    fi

    if [[ -n "$CONTAINER_IP" ]]; then
        LISTEN_IP="$(docker exec "$CONTAINER" python -c "import socket; s=socket.socket(); s.settimeout(1.5);\ntry:\n s.connect(('$CONTAINER_IP',$PORT)); print('ok')\nexcept Exception:\n print('fail')" 2>/dev/null || true)"
        if [[ "$LISTEN_LOCAL" == "ok" && "$LISTEN_IP" != "ok" ]]; then
            echo "    WARN: Likely loopback-only bind (127.0.0.1). Use 0.0.0.0/--host."
        fi
    fi

    while IFS= read -r map_line; do
        [[ -z "$map_line" ]] && continue
        HOST_BIND="${map_line%:*}"
        HOST_PORT="${map_line##*:}"
        [[ -z "$HOST_PORT" ]] && continue

        if curl -sS -m 3 -I "http://127.0.0.1:${HOST_PORT}/" >/dev/null 2>&1; then
            echo "    OK: Host can reach http://127.0.0.1:${HOST_PORT}/"
        else
            echo "    FAIL: Host cannot reach http://127.0.0.1:${HOST_PORT}/ (mapped from ${HOST_BIND}:${HOST_PORT})."
            OVERALL_FAIL=1
        fi
    done <<< "$MAP_LINES"
done

echo ""
echo "[4/4] Quick diagnosis hints"
echo "  - If 'Not published': add/verify docker '-p host:container' or devcontainer forwardPorts."
echo "  - If loopback-only bind warning: start server with 0.0.0.0 (for Vite: '--host')."
echo "  - If app moved to another port (e.g., 5174), publish/forward that port too."

echo ""
if [[ "$OVERALL_FAIL" -eq 0 ]]; then
    echo "Result: PASS"
    exit 0
fi

echo "Result: FAIL"
exit 2
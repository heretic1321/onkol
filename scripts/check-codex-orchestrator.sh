#!/usr/bin/env bash
set -euo pipefail

ONKOL_DIR="${ONKOL_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
CONFIG="$ONKOL_DIR/config.json"
TIMEOUT_SECONDS="${ONKOL_STARTUP_TIMEOUT:-0}"

if [[ "${1:-}" == "--wait" ]]; then
  [[ -n "${2:-}" ]] || { echo "ERROR: --wait requires seconds" >&2; exit 2; }
  TIMEOUT_SECONDS="$2"
  shift 2
fi
[[ $# -eq 0 ]] || { echo "Usage: $0 [--wait seconds]" >&2; exit 2; }
[[ "$TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] || {
  echo "ERROR: wait time must be a non-negative integer" >&2
  exit 2
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[[ -f "$CONFIG" ]] || fail "Missing $CONFIG"
[[ "$(jq -r '.runtime // "claude"' "$CONFIG")" == "codex" ]] \
  || fail "config runtime is not codex"

NODE_NAME="$(jq -r '.nodeName' "$CONFIG")"
TMUX_SESSION="onkol-${NODE_NAME}"
TMUX_TARGET="${TMUX_SESSION}:orchestrator"
WS_PORT="$(jq -r '.codex.wsPortBase // 18300' "$CONFIG")"
STARTED_AT=$SECONDS

probe() {
  tmux has-session -t "$TMUX_SESSION" 2>/dev/null || return 1
  tmux list-windows -t "$TMUX_SESSION" -F '#{window_name}' 2>/dev/null \
    | grep -Fxq orchestrator || return 1

  local pane dead pid args
  pane="$(tmux list-panes -t "$TMUX_TARGET" -F '#{pane_dead}|#{pane_pid}' 2>/dev/null | head -n 1)"
  [[ -n "$pane" ]] || return 1
  IFS='|' read -r dead pid <<<"$pane"
  [[ "$dead" == "0" ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
  [[ "$args" == *"runtime/codex/codex-bridge.js"* ]] || return 1
  curl --silent --show-error --fail --max-time 2 \
    "http://127.0.0.1:${WS_PORT}/readyz" >/dev/null 2>&1 || return 1
}

while ! probe; do
  (( SECONDS - STARTED_AT < TIMEOUT_SECONDS )) || break
  sleep 1
done

if probe; then
  PANE_PID="$(tmux list-panes -t "$TMUX_TARGET" -F '#{pane_pid}' 2>/dev/null | head -n 1)"
  printf 'Codex orchestrator is ready in %s (pid %s, port %s).\n' \
    "$TMUX_TARGET" "$PANE_PID" "$WS_PORT"
  exit 0
fi

tmux has-session -t "$TMUX_SESSION" 2>/dev/null \
  || fail "tmux session $TMUX_SESSION is not running"
tmux list-windows -t "$TMUX_SESSION" -F '#{window_name}' 2>/dev/null \
  | grep -Fxq orchestrator \
  || fail "tmux window $TMUX_TARGET is not running"
fail "Codex orchestrator process or ready endpoint on port $WS_PORT is unavailable"

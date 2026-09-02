#!/bin/bash
set -euo pipefail

ONKOL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ONKOL_DIR/config.json"
TRACKING="$ONKOL_DIR/workers/tracking.json"
NODE_NAME=$(jq -r '.nodeName' "$CONFIG")
TMUX_SESSION="onkol-${NODE_NAME}"

if [[ "${1:-}" == "--orchestrator" ]]; then
  exec "$ONKOL_DIR/scripts/start-codex-orchestrator.sh" --respawn
fi
[[ "${1:-}" == "--name" && -n "${2:-}" ]] || {
  echo "Usage: $0 --orchestrator | --name <worker>" >&2
  exit 1
}
WORKER_NAME="$2"
jq -e --arg name "$WORKER_NAME" 'any(.[]; .name == $name and .status == "active")' "$TRACKING" >/dev/null || {
  echo "ERROR: Active worker '$WORKER_NAME' not found" >&2
  exit 1
}
WRAPPER="$ONKOL_DIR/workers/$WORKER_NAME/start-worker.sh"
[[ -x "$WRAPPER" ]] || { echo "ERROR: Missing worker launcher $WRAPPER" >&2; exit 1; }
tmux kill-window -t "${TMUX_SESSION}:${WORKER_NAME}" 2>/dev/null || true
tmux new-window -t "$TMUX_SESSION" -n "$WORKER_NAME" "ONKOL_ROLE=worker bash '$WRAPPER'"
echo "Codex worker '$WORKER_NAME' restarted"

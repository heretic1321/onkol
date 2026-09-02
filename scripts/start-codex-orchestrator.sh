#!/bin/bash
set -euo pipefail

ONKOL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ONKOL_DIR/config.json"
RESPAWN=false
[[ "${1:-}" == "--respawn" ]] && RESPAWN=true

[[ -f "$CONFIG" ]] || { echo "ERROR: Missing $CONFIG" >&2; exit 1; }
[[ "$(jq -r '.runtime // "claude"' "$CONFIG")" == "codex" ]] || {
  echo "ERROR: config runtime is not codex" >&2
  exit 1
}

NODE_NAME=$(jq -r '.nodeName' "$CONFIG")
BOT_TOKEN=$(jq -r '.botToken' "$CONFIG")
GUILD_ID=$(jq -r '.guildId' "$CONFIG")
CHANNEL_ID=$(jq -r '.orchestratorChannelId' "$CONFIG")
ALLOWED_USER_IDS=$(jq -r '(.allowedUsers // []) | join(",")' "$CONFIG")
WS_PORT=$(jq -r '.codex.wsPortBase // 18300' "$CONFIG")
MODEL=$(jq -r '.codex.model // empty' "$CONFIG")
REASONING=$(jq -r '.codex.reasoningEffort // empty' "$CONFIG")
SERVICE_TIER=$(jq -r '.codex.serviceTier // empty' "$CONFIG")
AUTO_COMPACT=$(jq -r '.codex.autoCompactPercent // 80' "$CONFIG")
CODEX_HOME_DIR=$(jq -r '.codex.home // empty' "$CONFIG")
[[ -n "$CODEX_HOME_DIR" ]] || CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
CODEX_HOME_DIR="${CODEX_HOME_DIR/#\~/$HOME}"
TMUX_SESSION="onkol-${NODE_NAME}"
STATUS_FILE="$ONKOL_DIR/orchestrator-status.json"
BOOTSTRAP_FILE="$ONKOL_DIR/runtime/codex/orchestrator-bootstrap.md"
CHECK_SCRIPT="$ONKOL_DIR/scripts/check-codex-orchestrator.sh"
STARTUP_TIMEOUT="${ONKOL_STARTUP_TIMEOUT:-30}"

cat > "$BOOTSTRAP_FILE" <<EOF
Read AGENTS.md and the Onkol state files. You are the persistent orchestrator for ${NODE_NAME}. Announce that the node is online in Discord, report the active worker count, then wait for requests. Always dispatch tasks through scripts/spawn-worker.sh.
EOF

launch_command() {
  printf "cd %q && exec env CODEX_HOME=%q ONKOL_DIR=%q ONKOL_ROLE=orchestrator BOT_TOKEN=%q CHANNEL_ID=%q PROJECT_DIR=%q WS_PORT=%q ALLOWED_USER_IDS=%q GUILD_ID=%q BOT_DISPLAY_NAME=%q CONTEXT_DISPLAY=nickname STATUS_FILE=%q INITIAL_PROMPT_FILE=%q AUTO_COMPACT_PERCENT=%q CODEX_MODEL=%q CODEX_REASONING_EFFORT=%q CODEX_SERVICE_TIER=%q RESTART_COMMAND=%q node %q" \
    "$ONKOL_DIR" "$CODEX_HOME_DIR" "$ONKOL_DIR" "$BOT_TOKEN" "$CHANNEL_ID" "$ONKOL_DIR" "$WS_PORT" \
    "$ALLOWED_USER_IDS" "$GUILD_ID" "$NODE_NAME" "$STATUS_FILE" "$BOOTSTRAP_FILE" "$AUTO_COMPACT" \
    "$MODEL" "$REASONING" "$SERVICE_TIER" "./scripts/start-codex-orchestrator.sh --respawn" \
    "$ONKOL_DIR/runtime/codex/codex-bridge.js"
}

COMMAND=$(launch_command)
if $RESPAWN; then
  tmux has-session -t "$TMUX_SESSION" 2>/dev/null || {
    echo "ERROR: tmux session $TMUX_SESSION is not running" >&2
    exit 1
  }
  tmux respawn-window -k -t "${TMUX_SESSION}:orchestrator" "$COMMAND"
  ONKOL_DIR="$ONKOL_DIR" "$CHECK_SCRIPT" --wait "$STARTUP_TIMEOUT"
  echo "Codex orchestrator respawned in ${TMUX_SESSION}:orchestrator"
  exit 0
fi

if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
  if ONKOL_DIR="$ONKOL_DIR" "$CHECK_SCRIPT" --wait 2 >/dev/null 2>&1; then
    echo "Codex orchestrator is already running in ${TMUX_SESSION}:orchestrator."
    exit 0
  fi
  if tmux list-windows -t "$TMUX_SESSION" -F '#{window_name}' 2>/dev/null \
    | grep -Fxq orchestrator; then
    tmux respawn-window -k -t "${TMUX_SESSION}:orchestrator" "$COMMAND"
  else
    tmux new-window -d -t "$TMUX_SESSION" -n orchestrator "$COMMAND"
  fi
  ONKOL_DIR="$ONKOL_DIR" "$CHECK_SCRIPT" --wait "$STARTUP_TIMEOUT"
  echo "Codex orchestrator repaired in ${TMUX_SESSION}:orchestrator."
  exit 0
fi

tmux new-session -d -s "$TMUX_SESSION" -n orchestrator "$COMMAND"
ONKOL_DIR="$ONKOL_DIR" "$CHECK_SCRIPT" --wait "$STARTUP_TIMEOUT"
echo "Codex orchestrator started in tmux session '$TMUX_SESSION'."

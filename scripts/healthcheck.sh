#!/bin/bash
# Cron-based health check. Compares tracking.json against tmux windows.
# If a worker is tracked but its tmux window is gone, sends alert to Discord.

ONKOL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ONKOL_DIR/config.json"
TRACKING="$ONKOL_DIR/workers/tracking.json"

if [ ! -f "$TRACKING" ] || [ "$(jq length "$TRACKING")" -eq 0 ]; then
  exit 0
fi

BOT_TOKEN=$(jq -r '.botToken' "$CONFIG")
ORCHESTRATOR_CHANNEL=$(jq -r '.orchestratorChannelId' "$CONFIG")
NODE_NAME=$(jq -r '.nodeName' "$CONFIG")
TMUX_SESSION="onkol-${NODE_NAME}"

WINDOWS=$(tmux list-windows -t "$TMUX_SESSION" -F '#{window_name}' 2>/dev/null || echo "")

jq -r '.[] | select(.status == "active") | .name' "$TRACKING" | while read -r WORKER; do
  if ! echo "$WINDOWS" | grep -q "^${WORKER}$"; then
    # Worker is tracked but tmux window is gone
    curl -s -X POST \
      "https://discord.com/api/v10/channels/${ORCHESTRATOR_CHANNEL}/messages" \
      -H "Authorization: Bot ${BOT_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "{\"content\": \"[healthcheck] Worker **${WORKER}** appears to have crashed. Its tmux window is gone but it's still tracked. Please check and decide: respawn or dissolve.\"}" \
      > /dev/null 2>&1
  fi
done

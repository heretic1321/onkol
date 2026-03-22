#!/bin/bash
ONKOL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ONKOL_DIR/config.json"
NODE_NAME=$(jq -r '.nodeName' "$CONFIG")
TMUX_SESSION="onkol-${NODE_NAME}"

tmux has-session -t "$TMUX_SESSION" 2>/dev/null || \
  tmux new-session -d -s "$TMUX_SESSION" \
    "cd '$ONKOL_DIR' && claude \
      --dangerously-load-development-channels server:discord-filtered \
      --mcp-config '$ONKOL_DIR/.mcp.json'"

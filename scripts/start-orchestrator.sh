#!/bin/bash
ONKOL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ONKOL_DIR/config.json"
NODE_NAME=$(jq -r '.nodeName' "$CONFIG")
TMUX_SESSION="onkol-${NODE_NAME}"

if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
  echo "Session $TMUX_SESSION already running."
  exit 0
fi

tmux new-session -d -s "$TMUX_SESSION" \
  "cd '$ONKOL_DIR' && claude \
    --dangerously-skip-permissions \
    --dangerously-load-development-channels server:discord-filtered \
    --mcp-config '$ONKOL_DIR/.mcp.json'"

# Auto-accept interactive prompts (trust dialog + dev channels warning)
# Background loop sends Enter every 2 seconds until claude reaches the ❯ prompt
(
  for i in $(seq 1 10); do
    sleep 2
    PANE_CONTENT=$(tmux capture-pane -t "$TMUX_SESSION" -p 2>/dev/null || echo "")
    if echo "$PANE_CONTENT" | grep -q "^❯"; then
      break
    fi
    tmux send-keys -t "$TMUX_SESSION" Enter 2>/dev/null || true
  done
) &

echo "Orchestrator started in tmux session '$TMUX_SESSION'."
echo "Attach with: tmux attach -t $TMUX_SESSION"

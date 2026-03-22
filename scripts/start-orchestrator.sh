#!/bin/bash
set -euo pipefail

ONKOL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ONKOL_DIR/config.json"
NODE_NAME=$(jq -r '.nodeName' "$CONFIG")
TMUX_SESSION="onkol-${NODE_NAME}"

if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
  echo "Session $TMUX_SESSION already running."
  exit 0
fi

# Resolve full paths to binaries — critical for systemd which uses a minimal PATH
CLAUDE_BIN=$(command -v claude 2>/dev/null || echo "")
if [ -z "$CLAUDE_BIN" ]; then
  # Check common install locations
  for candidate in "$HOME/.local/bin/claude" /usr/local/bin/claude /usr/bin/claude; do
    if [ -x "$candidate" ]; then
      CLAUDE_BIN="$candidate"
      break
    fi
  done
fi
if [ -z "$CLAUDE_BIN" ]; then
  echo "ERROR: claude not found in PATH or common locations." >&2
  exit 1
fi

BUN_BIN=$(command -v bun 2>/dev/null || echo "")
if [ -z "$BUN_BIN" ]; then
  for candidate in "$HOME/.bun/bin/bun" /usr/local/bin/bun /usr/bin/bun; do
    if [ -x "$candidate" ]; then
      BUN_BIN="$candidate"
      break
    fi
  done
fi

# Build PATH that includes directories for claude and bun so MCP plugins can find them
EXTRA_PATH=""
[ -n "$CLAUDE_BIN" ] && EXTRA_PATH="$(dirname "$CLAUDE_BIN")"
if [ -n "$BUN_BIN" ]; then
  BUN_DIR="$(dirname "$BUN_BIN")"
  if [ -n "$EXTRA_PATH" ]; then
    EXTRA_PATH="$BUN_DIR:$EXTRA_PATH"
  else
    EXTRA_PATH="$BUN_DIR"
  fi
fi
FULL_PATH="${EXTRA_PATH:+$EXTRA_PATH:}${PATH}"

tmux new-session -d -s "$TMUX_SESSION" \
  "export PATH='$FULL_PATH'; cd '$ONKOL_DIR' && '$CLAUDE_BIN' \
    --dangerously-skip-permissions \
    --dangerously-load-development-channels server:discord-filtered \
    --mcp-config '$ONKOL_DIR/.mcp.json'; echo 'Claude exited with code '\$?'. Press Enter to close.'; read"

# Verify the session actually started and stayed alive
sleep 2
if ! tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
  echo "ERROR: tmux session '$TMUX_SESSION' died immediately after creation." >&2
  echo "Check that claude is working: $CLAUDE_BIN --version" >&2
  exit 1
fi

# Auto-accept interactive prompts (trust dialog + dev channels warning)
# Sends Enter every 2 seconds until claude reaches the prompt
for i in $(seq 1 10); do
  sleep 2
  PANE_CONTENT=$(tmux capture-pane -t "$TMUX_SESSION" -p 2>/dev/null || echo "")
  if echo "$PANE_CONTENT" | grep -q "^❯"; then
    break
  fi
  tmux send-keys -t "$TMUX_SESSION" Enter 2>/dev/null || true
done

echo "Orchestrator started in tmux session '$TMUX_SESSION'."
echo "Attach with: tmux attach -t $TMUX_SESSION"

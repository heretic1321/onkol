#!/bin/bash
set -euo pipefail

while [[ $# -gt 0 ]]; do
  case $1 in
    --name) WORKER_NAME="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

: "${WORKER_NAME:?--name is required}"

ONKOL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ONKOL_DIR/config.json"
BOT_TOKEN=$(jq -r '.botToken' "$CONFIG")
NODE_NAME=$(jq -r '.nodeName' "$CONFIG")
TMUX_SESSION="onkol-${NODE_NAME}"
WORKER_DIR="$ONKOL_DIR/workers/$WORKER_NAME"
TRACKING="$ONKOL_DIR/workers/tracking.json"

# Get channel ID from tracking
CHANNEL_ID=$(jq -r ".[] | select(.name == \"$WORKER_NAME\") | .channelId" "$TRACKING")

# Check learnings file
if [ ! -s "$WORKER_DIR/learnings.md" ]; then
  echo "WARNING: No learnings found at $WORKER_DIR/learnings.md"
  echo "Worker should write learnings before dissolution."
fi

# Copy learnings to knowledge base
DATE=$(date +%Y-%m-%d)
KNOWLEDGE_DIR="$ONKOL_DIR/knowledge"
mkdir -p "$KNOWLEDGE_DIR"

if [ -s "$WORKER_DIR/learnings.md" ]; then
  cp "$WORKER_DIR/learnings.md" "$KNOWLEDGE_DIR/${DATE}-${WORKER_NAME}.md"

  # Update index.json
  INDEX="$KNOWLEDGE_DIR/index.json"
  if [ ! -f "$INDEX" ]; then
    echo '[]' > "$INDEX"
  fi
  TASK_DESC=$(jq -r ".[] | select(.name == \"$WORKER_NAME\") | .intent" "$TRACKING" 2>/dev/null || echo "unknown")
  WORK_DIR=$(jq -r ".[] | select(.name == \"$WORKER_NAME\") | .workDir" "$TRACKING" 2>/dev/null || echo "unknown")
  UPDATED_INDEX=$(jq ". + [{
    \"file\": \"${DATE}-${WORKER_NAME}.md\",
    \"date\": \"$DATE\",
    \"tags\": [],
    \"project\": \"$WORK_DIR\",
    \"summary\": \"Learnings from worker $WORKER_NAME ($TASK_DESC)\"
  }]" "$INDEX")
  echo "$UPDATED_INDEX" > "$INDEX"
  echo "Learnings saved to $KNOWLEDGE_DIR/${DATE}-${WORKER_NAME}.md"
fi

# Kill tmux window (if exists)
tmux kill-window -t "${TMUX_SESSION}:${WORKER_NAME}" 2>/dev/null || true

# Delete Discord channel (if exists)
if [ -n "$CHANNEL_ID" ] && [ "$CHANNEL_ID" != "null" ]; then
  curl -s -X DELETE \
    "https://discord.com/api/v10/channels/${CHANNEL_ID}" \
    -H "Authorization: Bot ${BOT_TOKEN}" > /dev/null 2>&1 || true
  echo "Discord channel deleted."
fi

# Archive worker directory
ARCHIVE_DIR="$ONKOL_DIR/workers/.archive/${DATE}-${WORKER_NAME}"
mkdir -p "$ONKOL_DIR/workers/.archive"
mv "$WORKER_DIR" "$ARCHIVE_DIR"
echo "Worker directory archived to $ARCHIVE_DIR"

# Remove from tracking
UPDATED=$(jq "[.[] | select(.name != \"$WORKER_NAME\")]" "$TRACKING")
echo "$UPDATED" > "$TRACKING"

echo "Worker '$WORKER_NAME' dissolved."

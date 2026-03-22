#!/bin/bash
set -euo pipefail

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --name) WORKER_NAME="$2"; shift 2 ;;
    --dir) WORK_DIR="$2"; shift 2 ;;
    --task) TASK_DESC="$2"; shift 2 ;;
    --intent) INTENT="$2"; shift 2 ;;
    --context) CONTEXT="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# Validate required args
: "${WORKER_NAME:?--name is required}"
: "${WORK_DIR:?--dir is required}"
: "${TASK_DESC:?--task is required}"
: "${INTENT:=fix}"
: "${CONTEXT:=No additional context.}"

# Load config
ONKOL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ONKOL_DIR/config.json"
BOT_TOKEN=$(jq -r '.botToken' "$CONFIG")
GUILD_ID=$(jq -r '.guildId' "$CONFIG")
CATEGORY_ID=$(jq -r '.categoryId' "$CONFIG")
ALLOWED_USERS=$(jq -c '.allowedUsers' "$CONFIG")
NODE_NAME=$(jq -r '.nodeName' "$CONFIG")
MAX_WORKERS=$(jq -r '.maxWorkers // 3' "$CONFIG")
TMUX_SESSION="onkol-${NODE_NAME}"

# Check concurrency limit
TRACKING="$ONKOL_DIR/workers/tracking.json"
if [ -f "$TRACKING" ]; then
  ACTIVE_COUNT=$(jq '[.[] | select(.status == "active")] | length' "$TRACKING")
  if [ "$ACTIVE_COUNT" -ge "$MAX_WORKERS" ]; then
    echo "ERROR: Worker limit reached ($ACTIVE_COUNT/$MAX_WORKERS). Task queued."
    exit 1
  fi
fi

# Create Discord channel
CHANNEL_RESPONSE=$(curl -s -X POST \
  "https://discord.com/api/v10/guilds/${GUILD_ID}/channels" \
  -H "Authorization: Bot ${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"$(echo "$WORKER_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')\", \"type\": 0, \"parent_id\": \"${CATEGORY_ID}\"}")

CHANNEL_ID=$(echo "$CHANNEL_RESPONSE" | jq -r '.id')
if [ "$CHANNEL_ID" = "null" ] || [ -z "$CHANNEL_ID" ]; then
  echo "ERROR: Failed to create Discord channel: $CHANNEL_RESPONSE"
  exit 1
fi

# Create worker directory
WORKER_DIR="$ONKOL_DIR/workers/$WORKER_NAME"
mkdir -p "$WORKER_DIR"

# Write task.md (using printf to prevent heredoc injection from user input)
printf '%s\n' "# Task: $WORKER_NAME" "" \
  "**Intent:** $INTENT" \
  "**Working directory:** $WORK_DIR" \
  "**Created:** $(date -Iseconds)" "" \
  "## Description" "" > "$WORKER_DIR/task.md"
printf '%s' "$TASK_DESC" >> "$WORKER_DIR/task.md"

# Write context.md (using printf to prevent heredoc injection from user input)
printf '%s\n' "# Context for $WORKER_NAME" "" > "$WORKER_DIR/context.md"
printf '%s' "$CONTEXT" >> "$WORKER_DIR/context.md"

# Write .mcp.json (DISCORD_ALLOWED_USERS must be a string, not raw JSON array)
ALLOWED_USERS_ESCAPED=$(echo "$ALLOWED_USERS" | sed 's/\\/\\\\/g; s/"/\\"/g')
PLUGIN_PATH="$ONKOL_DIR/plugins/discord-filtered/index.ts"
cat > "$WORKER_DIR/.mcp.json" << MCPEOF
{
  "mcpServers": {
    "discord-filtered": {
      "command": "bun",
      "args": ["$PLUGIN_PATH"],
      "env": {
        "DISCORD_BOT_TOKEN": "$BOT_TOKEN",
        "DISCORD_CHANNEL_ID": "$CHANNEL_ID",
        "DISCORD_ALLOWED_USERS": "$ALLOWED_USERS_ESCAPED"
      }
    }
  }
}
MCPEOF

# Write worker CLAUDE.md
INTENT_INSTRUCTION=$(case $INTENT in
  fix) echo "- Diagnose the issue, fix it, run tests, commit to a branch (not main), report results" ;;
  investigate) echo "- Analyze the issue, gather data, report findings. Do NOT modify any files." ;;
  build) echo "- Implement the feature, write tests, create a branch, show diff, wait for approval" ;;
  analyze) echo "- Read logs/data/code, produce analysis, report. Do NOT modify any files." ;;
  override) echo "- Full autonomy including push and deploy. Before deploying: ask 'About to deploy. Confirm?' and wait." ;;
esac)

cat > "$WORKER_DIR/CLAUDE.md" << CLEOF
You are an Onkol worker session for "$NODE_NAME".

## Your Task
Read your task brief: $WORKER_DIR/task.md
Read your context: $WORKER_DIR/context.md

## Intent: $INTENT
$INTENT_INSTRUCTION

## Rules
- If you get stuck, ask in this channel. A human will respond.
- Update your status in $WORKER_DIR/status.json periodically
- Before dissolution, write learnings to $WORKER_DIR/learnings.md
CLEOF

# Write initial status.json
cat > "$WORKER_DIR/status.json" << STATUSEOF
{
  "status": "starting",
  "updated": "$(date -Iseconds)",
  "task": "$WORKER_NAME",
  "intent": "$INTENT"
}
STATUSEOF

# Write per-worker .claude/settings.json with PostToolUse hook for bash logging
mkdir -p "$WORKER_DIR/.claude"
cat > "$WORKER_DIR/.claude/settings.json" << SETTINGSEOF
{
  "hooks": {
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "jq -r 'if .tool_name == \"Bash\" then \"[\"+.tool_input.command+\"] => \"+(.tool_result.stdout // \"\" | tostring) else empty end' >> $WORKER_DIR/bash-log.txt"
          }
        ]
      }
    ]
  }
}
SETTINGSEOF

# Determine allowed tools based on intent
case $INTENT in
  fix|build|override) ALLOWED_TOOLS="Bash,Read,Edit,Write,Glob,Grep" ;;
  investigate|analyze) ALLOWED_TOOLS="Bash,Read,Glob,Grep" ;;
  *) ALLOWED_TOOLS="Bash,Read,Edit,Write,Glob,Grep" ;;
esac

# Pre-accept trust dialog for the working directory
CLAUDE_JSON="$HOME/.claude/.claude.json"
if [ -f "$CLAUDE_JSON" ]; then
  UPDATED_CLAUDE=$(jq --arg dir "$WORK_DIR" '
    .projects[$dir] = (.projects[$dir] // {}) + {hasTrustDialogAccepted: true, allowedTools: []}
  ' "$CLAUDE_JSON")
  echo "$UPDATED_CLAUDE" > "$CLAUDE_JSON"
fi

# Add startup instructions to the worker CLAUDE.md so it acts immediately
cat >> "$WORKER_DIR/CLAUDE.md" << STARTEOF

## On Startup
Immediately when you start:
1. Read $WORKER_DIR/task.md for your task
2. Read $WORKER_DIR/context.md for context
3. Begin work according to your intent
4. Report progress and results using the reply tool to your Discord channel
Do NOT wait for a message. Start working as soon as you boot.
STARTEOF

# Create a self-contained wrapper script with all paths baked in
WRAPPER="$WORKER_DIR/start-worker.sh"
cat > "$WRAPPER" << WRAPEOF
#!/bin/bash
TMUX_TARGET="${TMUX_SESSION}:${WORKER_NAME}"

# Auto-accept prompts in the background
(
  for i in \$(seq 1 10); do
    sleep 2
    PANE_CONTENT=\$(tmux capture-pane -t "\$TMUX_TARGET" -p 2>/dev/null || echo "")
    if echo "\$PANE_CONTENT" | grep -q "^❯"; then
      # Claude is ready — send the initial prompt via tmux keys
      sleep 1
      tmux send-keys -t "\$TMUX_TARGET" "Read $WORKER_DIR/task.md and $WORKER_DIR/context.md, then begin work per CLAUDE.md." Enter
      break
    fi
    tmux send-keys -t "\$TMUX_TARGET" Enter 2>/dev/null || true
  done
) &

# Start claude (no positional prompt — startup instructions are in CLAUDE.md,
# and the auto-acceptor sends the first prompt via tmux keys once claude is ready)
cd "$WORK_DIR" && claude \\
  --dangerously-skip-permissions \\
  --dangerously-load-development-channels server:discord-filtered \\
  --mcp-config "$WORKER_DIR/.mcp.json"
WRAPEOF
chmod +x "$WRAPPER"

# Start the worker in tmux
tmux new-window -t "$TMUX_SESSION" -n "$WORKER_NAME" "bash '$WRAPPER'"

# Update tracking.json
if [ ! -f "$TRACKING" ]; then
  echo '[]' > "$TRACKING"
fi
UPDATED=$(jq ". + [{
  \"name\": \"$WORKER_NAME\",
  \"channelId\": \"$CHANNEL_ID\",
  \"workDir\": \"$WORK_DIR\",
  \"intent\": \"$INTENT\",
  \"status\": \"active\",
  \"started\": \"$(date -Iseconds)\"
}]" "$TRACKING")
echo "$UPDATED" > "$TRACKING"

echo "Worker '$WORKER_NAME' spawned. Discord channel: $CHANNEL_ID"
echo "Talk to it in the new Discord channel."

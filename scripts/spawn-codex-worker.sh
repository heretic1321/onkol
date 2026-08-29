#!/bin/bash
set -euo pipefail

WORKER_NAME="" WORK_DIR="" TASK_DESC="" INTENT="fix" CONTEXT="No additional context."
MODEL_OVERRIDE="" REASONING_OVERRIDE="" SERVICE_TIER_OVERRIDE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) WORKER_NAME="$2"; shift 2 ;;
    --dir) WORK_DIR="$2"; shift 2 ;;
    --task) TASK_DESC="$2"; shift 2 ;;
    --intent) INTENT="$2"; shift 2 ;;
    --context) CONTEXT="$2"; shift 2 ;;
    --model) MODEL_OVERRIDE="$2"; shift 2 ;;
    --reasoning|--reasoning-effort|--effort) REASONING_OVERRIDE="$2"; shift 2 ;;
    --service-tier) SERVICE_TIER_OVERRIDE="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

[[ "$WORKER_NAME" =~ ^[a-z0-9][a-z0-9-]{0,48}$ ]] || {
  echo "ERROR: --name must be a lowercase Discord-safe slug (max 49 chars)" >&2
  exit 1
}
[[ -d "$WORK_DIR" ]] || { echo "ERROR: worker directory does not exist: $WORK_DIR" >&2; exit 1; }
[[ -n "$TASK_DESC" ]] || { echo "ERROR: --task is required" >&2; exit 1; }
[[ -z "$MODEL_OVERRIDE" || "$MODEL_OVERRIDE" =~ ^[a-zA-Z0-9._:-]+$ ]] || {
  echo "ERROR: --model contains unsupported characters" >&2
  exit 1
}
[[ -z "$REASONING_OVERRIDE" || "$REASONING_OVERRIDE" =~ ^(none|low|medium|high|xhigh|max)$ ]] || {
  echo "ERROR: reasoning effort must be none, low, medium, high, xhigh, or max" >&2
  exit 1
}
[[ -z "$SERVICE_TIER_OVERRIDE" || "$SERVICE_TIER_OVERRIDE" =~ ^[a-zA-Z0-9._:-]+$ ]] || {
  echo "ERROR: --service-tier contains unsupported characters" >&2
  exit 1
}

ONKOL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ONKOL_DIR/config.json"
TRACKING="$ONKOL_DIR/workers/tracking.json"
BOT_TOKEN=$(jq -r '.botToken' "$CONFIG")
GUILD_ID=$(jq -r '.guildId' "$CONFIG")
CATEGORY_ID=$(jq -r '.categoryId' "$CONFIG")
NODE_NAME=$(jq -r '.nodeName' "$CONFIG")
MAX_WORKERS=$(jq -r '.maxWorkers // 3' "$CONFIG")
ALLOWED_USER_IDS=$(jq -r '(.allowedUsers // []) | join(",")' "$CONFIG")
TMUX_SESSION="onkol-${NODE_NAME}"
EFFECTIVE_MODEL="${MODEL_OVERRIDE:-$(jq -r '.codex.model // empty' "$CONFIG")}"
EFFECTIVE_REASONING="${REASONING_OVERRIDE:-$(jq -r '.codex.reasoningEffort // empty' "$CONFIG")}"
EFFECTIVE_SERVICE_TIER="${SERVICE_TIER_OVERRIDE:-$(jq -r '.codex.serviceTier // empty' "$CONFIG")}"

tmux has-session -t "$TMUX_SESSION" 2>/dev/null || {
  echo "ERROR: orchestrator tmux session $TMUX_SESSION is not running" >&2
  exit 1
}
ACTIVE_COUNT=$(jq '[.[] | select(.status == "active")] | length' "$TRACKING")
(( ACTIVE_COUNT < MAX_WORKERS )) || {
  echo "ERROR: Worker limit reached ($ACTIVE_COUNT/$MAX_WORKERS)." >&2
  exit 1
}
jq -e --arg name "$WORKER_NAME" 'all(.[]; .name != $name)' "$TRACKING" >/dev/null || {
  echo "ERROR: Worker '$WORKER_NAME' already exists" >&2
  exit 1
}

BASE_PORT=$(jq -r '.codex.wsPortBase // 18300' "$CONFIG")
WS_PORT=$((BASE_PORT + 1))
while jq -e --argjson port "$WS_PORT" 'any(.[]; .wsPort == $port)' "$TRACKING" >/dev/null; do
  WS_PORT=$((WS_PORT + 1))
done

PAYLOAD=$(jq -n --arg name "$WORKER_NAME" --arg parent "$CATEGORY_ID" '{name:$name,type:0,parent_id:$parent}')
CHANNEL_RESPONSE=$(curl -fsS -X POST "https://discord.com/api/v10/guilds/${GUILD_ID}/channels" \
  -H "Authorization: Bot ${BOT_TOKEN}" -H "Content-Type: application/json" -d "$PAYLOAD")
CHANNEL_ID=$(jq -r '.id // empty' <<<"$CHANNEL_RESPONSE")
[[ -n "$CHANNEL_ID" ]] || { echo "ERROR: Discord channel creation failed" >&2; exit 1; }

WORKER_DIR="$ONKOL_DIR/workers/$WORKER_NAME"
mkdir -p "$WORKER_DIR"
printf '# Task: %s\n\n**Intent:** %s\n**Working directory:** %s\n**Created:** %s\n\n## Description\n\n%s\n' \
  "$WORKER_NAME" "$INTENT" "$WORK_DIR" "$(date -Iseconds)" "$TASK_DESC" > "$WORKER_DIR/task.md"
printf '# Context for %s\n\n%s\n' "$WORKER_NAME" "$CONTEXT" > "$WORKER_DIR/context.md"
cat > "$WORKER_DIR/initial-prompt.md" <<EOF
You are an ephemeral Onkol Codex worker. Read $WORKER_DIR/task.md and $WORKER_DIR/context.md, begin immediately, and communicate only through the scoped Discord MCP tools. Follow the requested intent. Before declaring completion, write reusable findings to $WORKER_DIR/learnings.md and update $WORKER_DIR/status.json.
EOF
cat > "$WORKER_DIR/status.json" <<EOF
{
  "status": "starting",
  "runtime": "codex",
  "model": "$EFFECTIVE_MODEL",
  "reasoningEffort": "$EFFECTIVE_REASONING",
  "updated": "$(date -Iseconds)",
  "task": "$WORKER_NAME",
  "intent": "$INTENT"
}
EOF

WRAPPER="$WORKER_DIR/start-worker.sh"
cat > "$WRAPPER" <<EOF
#!/bin/bash
set -euo pipefail
CONFIG="$CONFIG"
export CODEX_HOME="\$(jq -r '.codex.home // empty' "\$CONFIG")"
[[ -n "\$CODEX_HOME" ]] || export CODEX_HOME="\${CODEX_HOME:-\$HOME/.codex}"
export CODEX_HOME="\${CODEX_HOME/#\\~/\$HOME}"
export ONKOL_DIR="$ONKOL_DIR"
export BOT_TOKEN="\$(jq -r '.botToken' "\$CONFIG")"
export CHANNEL_ID="$CHANNEL_ID"
export PROJECT_DIR="$WORK_DIR"
export WS_PORT="$WS_PORT"
export ALLOWED_USER_IDS="\$(jq -r '(.allowedUsers // []) | join(",")' "\$CONFIG")"
export GUILD_ID="\$(jq -r '.guildId' "\$CONFIG")"
export BOT_DISPLAY_NAME="$NODE_NAME/$WORKER_NAME"
export CONTEXT_DISPLAY="channel-topic"
export STATUS_FILE="$WORKER_DIR/status.json"
export INITIAL_PROMPT_FILE="$WORKER_DIR/initial-prompt.md"
export AUTO_COMPACT_PERCENT="\$(jq -r '.codex.autoCompactPercent // 80' "\$CONFIG")"
export CODEX_MODEL="$EFFECTIVE_MODEL"
export CODEX_REASONING_EFFORT="$EFFECTIVE_REASONING"
export CODEX_SERVICE_TIER="$EFFECTIVE_SERVICE_TIER"
export RESTART_COMMAND='./scripts/restart-codex-session.sh --name "$WORKER_NAME"'
cd "$ONKOL_DIR"
exec node runtime/codex/codex-bridge.js
EOF
chmod 700 "$WRAPPER"

tmux new-window -t "$TMUX_SESSION" -n "$WORKER_NAME" "bash '$WRAPPER'"
TMP_TRACKING=$(mktemp "$ONKOL_DIR/workers/.tracking.XXXXXX")
jq --arg name "$WORKER_NAME" --arg channel "$CHANNEL_ID" --arg dir "$WORK_DIR" \
  --arg intent "$INTENT" --arg started "$(date -Iseconds)" --argjson port "$WS_PORT" \
  --arg model "$EFFECTIVE_MODEL" --arg reasoning "$EFFECTIVE_REASONING" --arg serviceTier "$EFFECTIVE_SERVICE_TIER" \
  '. + [{name:$name,channelId:$channel,workDir:$dir,intent:$intent,status:"active",runtime:"codex",started:$started,wsPort:$port,model:$model,reasoningEffort:$reasoning,serviceTier:$serviceTier}]' \
  "$TRACKING" > "$TMP_TRACKING"
mv "$TMP_TRACKING" "$TRACKING"
echo "Codex worker '$WORKER_NAME' spawned in Discord channel $CHANNEL_ID (model=${EFFECTIVE_MODEL:-default}, reasoning=${EFFECTIVE_REASONING:-default})"

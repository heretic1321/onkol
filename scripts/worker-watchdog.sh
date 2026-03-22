#!/bin/bash
# Worker watchdog — runs periodically to check on active workers.
# Uses an LLM to analyze tmux pane content instead of brittle regex.
# Falls back to basic checks if no LLM is configured.

set -uo pipefail

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

# Watchdog LLM config
WATCHDOG_PROVIDER=$(jq -r '.watchdog.provider // empty' "$CONFIG")
WATCHDOG_MODEL=$(jq -r '.watchdog.model // empty' "$CONFIG")
WATCHDOG_API_KEY=$(jq -r '.watchdog.apiKey // empty' "$CONFIG")

WINDOWS=$(tmux list-windows -t "$TMUX_SESSION" -F '#{window_name}' 2>/dev/null || echo "")

discord_msg() {
  local channel="$1" text="$2"
  curl -s -X POST \
    "https://discord.com/api/v10/channels/${channel}/messages" \
    -H "Authorization: Bot ${BOT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"content\": $(echo "$text" | jq -Rs .)}" \
    > /dev/null 2>&1
}

# Call LLM to analyze worker pane content.
# Returns a JSON object: {"status": "...", "action": "...", "message": "..."}
# status: working | done_replied | done_silent | error | idle | unknown
# action: none | nudge_reply | nudge_error | nudge_idle | alert_orchestrator
llm_analyze() {
  local pane_content="$1"
  local worker_name="$2"

  # Determine API endpoint and headers based on provider
  local api_url=""
  local auth_header=""
  local model="$WATCHDOG_MODEL"

  case "$WATCHDOG_PROVIDER" in
    openrouter)
      api_url="https://openrouter.ai/api/v1/chat/completions"
      auth_header="Authorization: Bearer ${WATCHDOG_API_KEY}"
      ;;
    gemini)
      api_url="https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
      auth_header="Authorization: Bearer ${WATCHDOG_API_KEY}"
      ;;
    custom)
      api_url=$(jq -r '.watchdog.apiUrl // empty' "$CONFIG")
      auth_header="Authorization: Bearer ${WATCHDOG_API_KEY}"
      ;;
    *)
      echo '{"status":"unknown","action":"none","message":"no llm configured"}'
      return
      ;;
  esac

  if [ -z "$api_url" ] || [ -z "$WATCHDOG_API_KEY" ]; then
    echo '{"status":"unknown","action":"none","message":"missing api config"}'
    return
  fi

  local sys_prompt="You analyze Claude Code terminal output to determine a worker's state. Respond with ONLY a JSON object, no markdown fences.

Keys:
- status: one of: working, done_replied, done_silent, error, idle
- action: one of: none, nudge_reply, nudge_error, nudge_idle, progress_update
- reason: one short sentence explaining your assessment
- summary: (ONLY when action is progress_update) A brief 1-2 sentence user-facing summary of what the worker is currently doing. Be specific — mention file names, tools being run, or operations in progress. Example: \"Reading agent config files and analyzing the call flow pipeline.\" or \"Running TypeScript type-check after modifying 4 frontend components.\"

Rules (check in this order):
1. done_replied: If ANYWHERE in the output you see 'discord-filtered - reply (MCP)' or 'discord-filtered - reply_with_file (MCP)' followed by 'sent', the worker HAS replied. Status=done_replied, Action=none. This takes priority — even if the worker is now idle at the prompt, if it replied earlier it is done_replied NOT idle.
2. working: Claude is actively executing tools, thinking, or generating output (not at the idle prompt). Action=progress_update. Include a summary field.
3. error: Worker hit a fatal error and stopped (Traceback, FATAL, crash at the prompt). Action: nudge_error. Errors from EARLIER that the worker recovered from do NOT count — only errors right before the current prompt.
4. done_silent: Worker finished work (wrote files, completed analysis, etc.) but NEVER used the reply MCP tool anywhere in the visible output. Action: nudge_reply
5. idle: Worker is sitting at the prompt with no clear completion, no error, and no reply tool usage. Action: nudge_idle

CRITICAL: If you see ANY 'discord-filtered - reply (MCP)' with 'sent' in the output, the answer is ALWAYS done_replied with action none, regardless of current prompt state."

  # Use jq to build the payload — handles all JSON escaping correctly
  local payload
  payload=$(jq -n \
    --arg model "$model" \
    --arg sys "$sys_prompt" \
    --arg user "Worker name: ${worker_name}

Terminal output (last 100 lines):
${pane_content}" \
    '{
      model: $model,
      messages: [
        {role: "system", content: $sys},
        {role: "user", content: $user}
      ],
      temperature: 0,
      max_tokens: 250
    }')

  local response
  response=$(curl -s -m 15 "$api_url" \
    -H "$auth_header" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>/dev/null)

  # Extract the content from the response
  local content
  content=$(echo "$response" | jq -r '.choices[0].message.content // empty' 2>/dev/null)

  if [ -z "$content" ]; then
    echo '{"status":"unknown","action":"none","message":"llm call failed"}'
    return
  fi

  # Strip markdown fences if present
  content=$(echo "$content" | sed 's/^```json//; s/^```//; s/```$//' | tr -d '\n')

  # Validate it's valid JSON
  if echo "$content" | jq . >/dev/null 2>&1; then
    echo "$content"
  else
    echo '{"status":"unknown","action":"none","message":"invalid llm response"}'
  fi
}

jq -r '.[] | select(.status == "active") | .name' "$TRACKING" | while read -r WORKER; do
  WORKER_DIR="$ONKOL_DIR/workers/$WORKER"
  WORKER_CHANNEL=$(jq -r ".[] | select(.name == \"$WORKER\") | .channelId" "$TRACKING")
  TMUX_TARGET="${TMUX_SESSION}:${WORKER}"

  # Case 1: tmux window is gone — worker crashed (no LLM needed)
  if ! echo "$WINDOWS" | grep -q "^${WORKER}$"; then
    discord_msg "$ORCHESTRATOR_CHANNEL" \
      "[watchdog] Worker **${WORKER}** has crashed — its tmux window is gone. Please check and decide: respawn or dissolve."
    continue
  fi

  # Capture pane content
  PANE_FULL=$(tmux capture-pane -t "$TMUX_TARGET" -p -S -100 2>/dev/null || echo "")

  # Use LLM if configured, otherwise skip (no more regex fallback — too brittle)
  if [ -z "$WATCHDOG_PROVIDER" ]; then
    continue
  fi

  # Check nudge cooldown (don't analyze more than once per 3 minutes per worker)
  NUDGE_FLAG="$WORKER_DIR/.watchdog-last-nudge"
  if [ -f "$NUDGE_FLAG" ] && [ -z "$(find "$NUDGE_FLAG" -mmin +3 2>/dev/null)" ]; then
    continue
  fi

  # Ask LLM to analyze the pane
  ANALYSIS=$(llm_analyze "$PANE_FULL" "$WORKER")
  ACTION=$(echo "$ANALYSIS" | jq -r '.action // "none"')
  STATUS=$(echo "$ANALYSIS" | jq -r '.status // "unknown"')
  REASON=$(echo "$ANALYSIS" | jq -r '.reason // ""')

  SUMMARY=$(echo "$ANALYSIS" | jq -r '.summary // ""')

  case "$ACTION" in
    progress_update)
      # Worker is actively working — post a progress summary to its channel
      if [ -n "$SUMMARY" ]; then
        touch "$NUDGE_FLAG"
        discord_msg "$WORKER_CHANNEL" "⏳ $SUMMARY"
      fi
      ;;
    nudge_reply)
      touch "$NUDGE_FLAG"
      tmux send-keys -t "$TMUX_TARGET" \
        "You appear to have finished your work but haven't sent results to Discord. Use the reply tool from the discord-filtered MCP server to send a summary of what you did and your findings. Use replyWithFile for any file deliverables. The user CANNOT see your terminal output." Enter
      discord_msg "$ORCHESTRATOR_CHANNEL" \
        "[watchdog] Worker **${WORKER}** — $REASON. Nudged it to send results via Discord."
      ;;
    nudge_error)
      touch "$NUDGE_FLAG"
      tmux send-keys -t "$TMUX_TARGET" \
        "You encountered an error. Use the reply tool to report this error to the user on Discord, then try to recover or ask for help." Enter
      discord_msg "$ORCHESTRATOR_CHANNEL" \
        "[watchdog] Worker **${WORKER}** — $REASON. Nudged it to report via Discord."
      ;;
    nudge_idle)
      touch "$NUDGE_FLAG"
      tmux send-keys -t "$TMUX_TARGET" \
        "You've been idle for a while. If you're done, use the reply tool to send your results to Discord. If you're stuck, use the reply tool to ask for help. The user cannot see your terminal." Enter
      discord_msg "$ORCHESTRATOR_CHANNEL" \
        "[watchdog] Worker **${WORKER}** — $REASON. Nudged it to respond."
      ;;
    none|*)
      # Worker is fine (already replied) — do nothing
      ;;
  esac
done

#!/bin/bash
# Worker watchdog — runs periodically to check on active workers.
# Detects: idle workers that finished but didn't reply, errors, crashes.
# Nudges workers via tmux or alerts the orchestrator via Discord.

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

jq -r '.[] | select(.status == "active") | .name' "$TRACKING" | while read -r WORKER; do
  WORKER_DIR="$ONKOL_DIR/workers/$WORKER"
  WORKER_CHANNEL=$(jq -r ".[] | select(.name == \"$WORKER\") | .channelId" "$TRACKING")
  TMUX_TARGET="${TMUX_SESSION}:${WORKER}"

  # Case 1: tmux window is gone — worker crashed
  if ! echo "$WINDOWS" | grep -q "^${WORKER}$"; then
    discord_msg "$ORCHESTRATOR_CHANNEL" \
      "[watchdog] Worker **${WORKER}** has crashed — its tmux window is gone. Please check and decide: respawn or dissolve."
    continue
  fi

  # Capture a large chunk of pane history to check for reply tool usage
  PANE_FULL=$(tmux capture-pane -t "$TMUX_TARGET" -p -S -100 2>/dev/null || echo "")
  # Recent pane for state detection
  PANE=$(tmux capture-pane -t "$TMUX_TARGET" -p -S -20 2>/dev/null || echo "")

  # Check if worker has already used the reply tool (MCP) — if so, skip nudging
  # tmux wraps long lines, so "reply (MCP)" and "sent" are on separate lines.
  # Check for both the MCP tool call and the "sent" confirmation independently.
  HAS_REPLIED=false
  if echo "$PANE_FULL" | grep -qE "discord-filtered - reply.*\(MCP\)" && echo "$PANE_FULL" | grep -q "sent$"; then
    HAS_REPLIED=true
  fi

  # Case 2: Worker hit an error and is sitting at the prompt
  # Only check the last 5 lines before the prompt to avoid false positives from earlier recovered errors
  RECENT_BEFORE_PROMPT=$(echo "$PANE" | tac | sed -n '/^❯/,+5p' | tac)
  if echo "$PANE" | grep -q "^❯" && echo "$RECENT_BEFORE_PROMPT" | grep -qiE "FATAL|panic|crashed|Traceback|ECONNREFUSED|exited with code [1-9]|Error:.*exit code"; then
    # Only nudge if it hasn't already reported the error via reply
    if [ "$HAS_REPLIED" = false ]; then
      NUDGE_FLAG="$WORKER_DIR/.watchdog-error-nudge"
      if [ ! -f "$NUDGE_FLAG" ] || [ "$(find "$NUDGE_FLAG" -mmin +10 2>/dev/null)" ]; then
        touch "$NUDGE_FLAG"
        tmux send-keys -t "$TMUX_TARGET" \
          "You encountered an error. Use the reply tool to report this error to the user on Discord, then try to recover or ask for help." Enter
        discord_msg "$ORCHESTRATOR_CHANNEL" \
          "[watchdog] Worker **${WORKER}** appears to have hit an error. Nudged it to report via Discord."
      fi
    fi
    continue
  fi

  # Case 3: Worker is idle at the prompt (finished work but may not have replied)
  if echo "$PANE" | grep -q "^❯"; then
    # If worker already sent replies, it's done — no nudge needed
    if [ "$HAS_REPLIED" = true ]; then
      continue
    fi

    # Check if the pane shows the worker completed work
    LOOKS_DONE=false
    if echo "$PANE" | grep -qiE "Done\.|Complete|Finished|wrote.*file|created.*file|report.*saved|analysis.*complete|All.*done"; then
      LOOKS_DONE=true
    fi

    if [ "$LOOKS_DONE" = true ]; then
      NUDGE_FLAG="$WORKER_DIR/.watchdog-done-nudge"
      if [ ! -f "$NUDGE_FLAG" ] || [ "$(find "$NUDGE_FLAG" -mmin +10 2>/dev/null)" ]; then
        touch "$NUDGE_FLAG"
        tmux send-keys -t "$TMUX_TARGET" \
          "You appear to have finished your work but haven't sent results to Discord. Use the reply tool to send a summary of what you did and your findings. Use replyWithFile for any file deliverables. The user CANNOT see your terminal output." Enter
        discord_msg "$ORCHESTRATOR_CHANNEL" \
          "[watchdog] Worker **${WORKER}** appears done but didn't reply to Discord. Nudged it to send results."
      fi
    else
      # Worker is idle but doesn't look like it completed meaningful work
      if [ -f "$WORKER_DIR/status.json" ]; then
        LAST_UPDATE=$(jq -r '.updated // empty' "$WORKER_DIR/status.json" 2>/dev/null)
        if [ -n "$LAST_UPDATE" ]; then
          LAST_EPOCH=$(date -d "$LAST_UPDATE" +%s 2>/dev/null || echo "0")
          NOW_EPOCH=$(date +%s)
          IDLE_MINS=$(( (NOW_EPOCH - LAST_EPOCH) / 60 ))
          if [ "$IDLE_MINS" -gt 15 ]; then
            NUDGE_FLAG="$WORKER_DIR/.watchdog-idle-nudge"
            if [ ! -f "$NUDGE_FLAG" ] || [ "$(find "$NUDGE_FLAG" -mmin +15 2>/dev/null)" ]; then
              touch "$NUDGE_FLAG"
              tmux send-keys -t "$TMUX_TARGET" \
                "You've been idle for a while. If you're done, use the reply tool to send your results to Discord. If you're stuck, use the reply tool to ask for help. The user cannot see your terminal." Enter
              discord_msg "$ORCHESTRATOR_CHANNEL" \
                "[watchdog] Worker **${WORKER}** has been idle for ${IDLE_MINS}min. Nudged it to respond."
            fi
          fi
        fi
      fi
    fi
  fi

  # Case 4: Worker is actively working — no action needed
done

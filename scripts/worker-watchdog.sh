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

  # Capture the current pane content
  PANE=$(tmux capture-pane -t "$TMUX_TARGET" -p -S -20 2>/dev/null || echo "")

  # Case 2: Worker hit an error and is sitting at the prompt
  if echo "$PANE" | grep -q "^❯" && echo "$PANE" | grep -qiE "error|FATAL|panic|crashed|Traceback|ECONNREFUSED"; then
    # Check if we already nudged recently (use a flag file)
    NUDGE_FLAG="$WORKER_DIR/.watchdog-error-nudge"
    if [ ! -f "$NUDGE_FLAG" ] || [ "$(find "$NUDGE_FLAG" -mmin +10 2>/dev/null)" ]; then
      touch "$NUDGE_FLAG"
      # Nudge the worker to report the error
      tmux send-keys -t "$TMUX_TARGET" \
        "You encountered an error. Use the reply tool to report this error to the user on Discord, then try to recover or ask for help." Enter
      discord_msg "$ORCHESTRATOR_CHANNEL" \
        "[watchdog] Worker **${WORKER}** appears to have hit an error. Nudged it to report via Discord."
    fi
    continue
  fi

  # Case 3: Worker is idle at the prompt (finished work but may not have replied)
  if echo "$PANE" | grep -q "^❯"; then
    # Check if the pane shows the worker completed work (wrote files, finished analysis, etc.)
    LOOKS_DONE=false
    if echo "$PANE" | grep -qiE "Done\.|Complete|Finished|wrote.*file|created.*file|report.*saved|analysis.*complete|All.*done"; then
      LOOKS_DONE=true
    fi

    if [ "$LOOKS_DONE" = true ]; then
      # Check if we already nudged for completion (use a different flag)
      NUDGE_FLAG="$WORKER_DIR/.watchdog-done-nudge"
      if [ ! -f "$NUDGE_FLAG" ] || [ "$(find "$NUDGE_FLAG" -mmin +10 2>/dev/null)" ]; then
        touch "$NUDGE_FLAG"
        tmux send-keys -t "$TMUX_TARGET" \
          "You appear to have finished your work but may not have sent results to Discord. Use the reply tool to send a summary of what you did and your findings. Use replyWithFile for any file deliverables. The user CANNOT see your terminal output." Enter
        discord_msg "$ORCHESTRATOR_CHANNEL" \
          "[watchdog] Worker **${WORKER}** appears done but idle. Nudged it to send results via Discord."
      fi
    else
      # Worker is idle but doesn't look like it completed meaningful work
      # Check how long it's been idle by looking at status.json
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

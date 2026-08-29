#!/bin/bash
set -euo pipefail

ONKOL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ONKOL_DIR/config.json"

[[ -f "$CONFIG" ]] || { echo "ERROR: Missing $CONFIG" >&2; exit 1; }
[[ "$(jq -r '.runtime // "claude"' "$CONFIG")" == "codex" ]] || exit 0
[[ "$(jq -r '.codex.syncMattPocockSkills // true' "$CONFIG")" == "true" ]] || {
  echo "Matt Pocock skill sync disabled in config.json"
  exit 0
}

CODEX_HOME_DIR=$(jq -r '.codex.home // empty' "$CONFIG")
[[ -n "$CODEX_HOME_DIR" ]] || CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
CODEX_HOME_DIR="${CODEX_HOME_DIR/#\~/$HOME}"
LOG_FILE="$ONKOL_DIR/runtime/codex/matt-pocock-skills-sync.log"

echo "Syncing latest mattpocock/skills for Codex..."
if ! CI=1 NO_COLOR=1 CODEX_HOME="$CODEX_HOME_DIR" \
  npx -y skills@latest add mattpocock/skills \
    --global --agent codex --skill '*' --yes --copy --full-depth \
    >"$LOG_FILE" 2>&1; then
  echo "ERROR: Matt Pocock skill sync failed. Last log lines:" >&2
  tail -40 "$LOG_FILE" >&2
  exit 1
fi

INSTALLED=$(CI=1 NO_COLOR=1 CODEX_HOME="$CODEX_HOME_DIR" \
  npx -y skills@latest list --global --agent codex --json)
COUNT=$(jq '[.[] | select(.source == "mattpocock/skills")] | length' <<<"$INSTALLED")
SETUP_PATH=$(jq -r '[.[] | select(.source == "mattpocock/skills" and .name == "setup-matt-pocock-skills")][0].path // empty' <<<"$INSTALLED")
(( COUNT > 0 )) || { echo "ERROR: Skill sync reported no mattpocock/skills installs" >&2; exit 1; }
[[ -f "$SETUP_PATH/SKILL.md" ]] || { echo "ERROR: setup-matt-pocock-skills is missing after sync" >&2; exit 1; }

echo "Matt Pocock skills synced for Codex: $COUNT installed."

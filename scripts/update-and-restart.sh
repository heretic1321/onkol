#!/bin/bash
# Update Onkol plugin + scripts from the latest npm package, then
# dissolve all active workers and respawn them with --resume so they
# keep their conversation history but pick up the new code.
#
# Usage:
#   onkol-update                  # update + restart all workers
#   onkol-update --skip-update    # just restart workers (no npm pull)
#   onkol-update --workers-only   # alias for --skip-update

set -uo pipefail

ONKOL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ONKOL_DIR/config.json"
TRACKING="$ONKOL_DIR/workers/tracking.json"

if [ ! -f "$CONFIG" ]; then
  echo "ERROR: No config.json found at $ONKOL_DIR. Is Onkol installed here?"
  exit 1
fi

NODE_NAME=$(jq -r '.nodeName' "$CONFIG")
SKIP_UPDATE=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-update|--workers-only) SKIP_UPDATE=true; shift ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

echo "=== Onkol Update & Restart ==="
echo "Node: $NODE_NAME"
echo "Install dir: $ONKOL_DIR"
echo ""

# ── Step 1: Update files from npm ──────────────────────────────────────────

if [ "$SKIP_UPDATE" = false ]; then
  echo "[1/3] Updating from latest npm package..."

  # Create a temp dir, download latest package, extract the files we need
  TMPDIR=$(mktemp -d)
  trap "rm -rf $TMPDIR" EXIT

  # Use npm pack to download the tarball without installing
  if command -v npm &>/dev/null; then
    npm pack onkol --pack-destination "$TMPDIR" &>/dev/null
    TARBALL=$(ls "$TMPDIR"/onkol-*.tgz 2>/dev/null | head -1)
  fi

  if [ -z "${TARBALL:-}" ] || [ ! -f "${TARBALL:-}" ]; then
    echo "WARNING: Could not download npm package. Trying npx..."
    # Fallback: use npx to find the package cache
    npx --yes onkol@latest --help &>/dev/null 2>&1
    PKG_DIR=$(find ~/.npm/_npx -name "onkol" -path "*/node_modules/*" -type d 2>/dev/null | head -1)
    if [ -z "$PKG_DIR" ]; then
      echo "ERROR: Could not find onkol package. Skipping update."
      echo "You can update manually: copy plugin/ and scripts/ from the repo."
      SKIP_UPDATE=true
    fi
  fi

  if [ "$SKIP_UPDATE" = false ]; then
    if [ -n "${TARBALL:-}" ] && [ -f "${TARBALL:-}" ]; then
      # Extract from tarball
      tar xzf "$TARBALL" -C "$TMPDIR"
      PKG_DIR="$TMPDIR/package"
    fi

    if [ -d "$PKG_DIR" ]; then
      # Update plugin files
      if [ -d "$PKG_DIR/src/plugin" ]; then
        cp "$PKG_DIR/src/plugin/"*.ts "$ONKOL_DIR/plugins/discord-filtered/" 2>/dev/null && \
          echo "  ✓ Plugin files updated"
      elif [ -d "$PKG_DIR/dist/plugin" ]; then
        cp "$PKG_DIR/dist/plugin/"*.js "$ONKOL_DIR/plugins/discord-filtered/" 2>/dev/null && \
          echo "  ✓ Plugin files updated (dist)"
      fi

      # Update scripts
      if [ -d "$PKG_DIR/scripts" ]; then
        for script in "$PKG_DIR/scripts/"*.sh; do
          name=$(basename "$script")
          cp "$script" "$ONKOL_DIR/scripts/$name"
          chmod +x "$ONKOL_DIR/scripts/$name"
        done
        echo "  ✓ Scripts updated"
      fi

      echo "  Done."
    fi
  fi
else
  echo "[1/3] Skipping update (--skip-update)"
fi

echo ""

# ── Step 2: Dissolve active workers (saving session IDs) ──────────────────

echo "[2/3] Dissolving active workers..."

if [ ! -f "$TRACKING" ] || [ "$(jq length "$TRACKING" 2>/dev/null)" -eq 0 ]; then
  echo "  No active workers to restart."
  echo ""
  echo "=== Update complete. No workers to restart. ==="
  exit 0
fi

# Build a list of workers with their session IDs before dissolving
declare -a WORKER_NAMES=()
declare -a WORKER_DIRS=()
declare -a WORKER_INTENTS=()
declare -a WORKER_SESSIONS=()

while IFS= read -r line; do
  W_NAME=$(echo "$line" | jq -r '.name')
  W_DIR=$(echo "$line" | jq -r '.workDir')
  W_INTENT=$(echo "$line" | jq -r '.intent')

  # Find the latest session ID for this worker's project directory
  # Claude Code stores sessions in ~/.claude/projects/<encoded-path>/
  ENCODED_PATH=$(echo "$W_DIR" | sed 's|^/||; s|/|-|g; s|^|-|')
  SESSION_DIR="$HOME/.claude/projects/$ENCODED_PATH"
  SESSION_ID=""

  if [ -d "$SESSION_DIR" ]; then
    LATEST_JSONL=$(find "$SESSION_DIR" -maxdepth 1 -name "*.jsonl" \
      -not -path "*/subagents/*" -printf '%T@ %f\n' 2>/dev/null \
      | sort -n | tail -1 | awk '{print $2}')
    if [ -n "$LATEST_JSONL" ]; then
      SESSION_ID="${LATEST_JSONL%.jsonl}"
    fi
  fi

  WORKER_NAMES+=("$W_NAME")
  WORKER_DIRS+=("$W_DIR")
  WORKER_INTENTS+=("$W_INTENT")
  WORKER_SESSIONS+=("$SESSION_ID")

  echo "  $W_NAME → session: ${SESSION_ID:-none}"
done < <(jq -c '.[] | select(.status == "active")' "$TRACKING")

echo ""

# Dissolve all workers
for name in "${WORKER_NAMES[@]}"; do
  "$ONKOL_DIR/scripts/dissolve-worker.sh" --name "$name" 2>&1 | sed 's/^/  /'
done

echo ""

# ── Step 3: Respawn with --resume ──────────────────────────────────────────

echo "[3/3] Respawning workers with --resume..."

for i in "${!WORKER_NAMES[@]}"; do
  W_NAME="${WORKER_NAMES[$i]}"
  W_DIR="${WORKER_DIRS[$i]}"
  W_INTENT="${WORKER_INTENTS[$i]}"
  W_SESSION="${WORKER_SESSIONS[$i]}"

  RESUME_ARG=""
  if [ -n "$W_SESSION" ]; then
    RESUME_ARG="--resume $W_SESSION"
  fi

  echo "  Spawning $W_NAME (intent: $W_INTENT, resume: ${W_SESSION:-fresh})..."

  "$ONKOL_DIR/scripts/spawn-worker.sh" \
    --name "$W_NAME" \
    --dir "$W_DIR" \
    --task "Continue the previous work. Check your conversation history for context." \
    --intent "$W_INTENT" \
    $RESUME_ARG 2>&1 | sed 's/^/    /'

  # Small delay between spawns to avoid Discord rate limits
  sleep 2
done

echo ""
echo "=== Update complete. ${#WORKER_NAMES[@]} worker(s) restarted. ==="

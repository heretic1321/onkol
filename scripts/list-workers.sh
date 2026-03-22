#!/bin/bash
ONKOL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TRACKING="$ONKOL_DIR/workers/tracking.json"

if [ ! -f "$TRACKING" ] || [ "$(jq length "$TRACKING")" -eq 0 ]; then
  echo "No active workers."
  exit 0
fi

echo "Active workers:"
jq -r '.[] | "  [\(.status)] \(.name) — intent: \(.intent), dir: \(.workDir), started: \(.started)"' "$TRACKING"

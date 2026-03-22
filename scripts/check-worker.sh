#!/bin/bash
while [[ $# -gt 0 ]]; do
  case $1 in
    --name) WORKER_NAME="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

: "${WORKER_NAME:?--name is required}"

ONKOL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATUS_FILE="$ONKOL_DIR/workers/$WORKER_NAME/status.json"

if [ ! -f "$STATUS_FILE" ]; then
  echo "Worker '$WORKER_NAME' not found or has no status file."
  exit 1
fi

jq '.' "$STATUS_FILE"

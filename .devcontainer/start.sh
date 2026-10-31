#!/bin/bash
# Starts SF Κέντρο in a GitHub Codespace (free, no server to rent). Runs every time the codespace starts or wakes up.
# The first administrator comes from two Codespaces secrets: KENTRO_ADMIN_USER and KENTRO_ADMIN_PASSWORD.
cd "$(dirname "$0")/../app" || exit 1
mkdir -p "${SFK_DATA:-/workspaces/sf-data}"
LOG="${SFK_DATA:-/workspaces/sf-data}/server.log"
PIDF="${SFK_DATA:-/workspaces/sf-data}/server.pid"
[ -f "$PIDF" ] && kill "$(cat "$PIDF")" 2>/dev/null && sleep 1
export SFK_ADMIN_USER="${KENTRO_ADMIN_USER:-}" SFK_ADMIN_PASSWORD="${KENTRO_ADMIN_PASSWORD:-}"
nohup node server.js > "$LOG" 2>&1 &
echo $! > "$PIDF"
sleep 3
if [ -z "$SFK_ADMIN_USER" ] && grep -q "setup code" "$LOG" 2>/dev/null; then
  echo "Δεν βρέθηκαν τα μυστικά KENTRO_ADMIN_USER / KENTRO_ADMIN_PASSWORD: δες τις οδηγίες στο DIAKOMISTIS-CLOUD.txt."
fi

#!/bin/bash
# ClaudeGrid hook - sends Claude Code lifecycle events to the visualizer
# Fire-and-forget POST to avoid blocking Claude Code

curl -s -X POST -H "Content-Type: application/json" \
  -d "$(cat)" --connect-timeout 1 --max-time 2 \
  "${CLAUDEGRID_URL:-http://localhost:3333}/api/events" &

exit 0

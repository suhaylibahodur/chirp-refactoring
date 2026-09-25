#!/usr/bin/env bash
set -euo pipefail

turbo run build

pnpm --filter @chirp/api start &
API_PID=$!

cleanup() {
  pkill -P "$API_PID" 2>/dev/null || true   # kill tsx's child (the real server)
  kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

HEALTH_URL="http://localhost:${HTTP_PORT:-3001}/health"
for i in $(seq 1 60); do
  if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then break; fi
  if [ "$i" -eq 60 ]; then
    echo "API did not become healthy at $HEALTH_URL within 30s" >&2
    exit 1
  fi
  sleep 0.5
done

turbo run test:e2e

#!/usr/bin/env bash
set -euo pipefail
USER_ID="${1:-tg:123}"

docker compose run --rm \
  -v "$(pwd)/tools/check-sub.js:/tmp/check-sub.js:ro" \
  -e USER_ID="$USER_ID" \
  api sh -lc 'cd /app/apps/api && node /tmp/check-sub.js'

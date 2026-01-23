#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
source ./.env.tokens
export BOT_TOKEN="$UX_BOT_TOKEN"

curl -s "https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook?drop_pending_updates=true" >/dev/null
echo "OK: pending updates dropped"

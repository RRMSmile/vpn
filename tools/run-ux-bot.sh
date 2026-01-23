#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
source .venv/bin/activate

source ./.env.tokens
export BOT_TOKEN="$UX_BOT_TOKEN"
export API_BASE="${API_BASE:-http://localhost:3001}"
export PYTHONUNBUFFERED=1

DROP="0"
if [[ "${1:-}" == "--drop-pending" ]]; then
  DROP="1"
fi

if [[ "$DROP" == "1" ]]; then
  echo ">> deleteWebhook + drop_pending_updates=true"
  curl -s "https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook?drop_pending_updates=true" >/dev/null
else
  echo ">> deleteWebhook (keep pending)"
  curl -s "https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook" >/dev/null
fi


if [[ ! -f "apps/bot-py/main.py" ]]; then
  echo "ERROR: apps/bot-py/main.py not found. (legacy UX bot is ignored by .gitignore)"
  echo "Hint: use Node bot via docker compose, or restore legacy bot locally if needed."
  exit 1
fi

exec python apps/bot-py/main.py

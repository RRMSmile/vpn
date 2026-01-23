#!/usr/bin/env bash
set -euo pipefail

# Safe checks that do NOT use getUpdates (no 409 conflict with polling)
TOKEN="${BOT_TOKEN:-${TELEGRAM_BOT_TOKEN:-}}"
if [[ -z "${TOKEN}" ]]; then
  echo "ERROR: BOT_TOKEN/TELEGRAM_BOT_TOKEN is empty in this shell" >&2
  exit 2
fi

echo "[tg] getMe"
curl -sS "https://api.telegram.org/bot${TOKEN}/getMe" | python3 -m json.tool | sed -n '1,120p'

echo
echo "[tg] getWebhookInfo"
curl -sS "https://api.telegram.org/bot${TOKEN}/getWebhookInfo" | python3 -m json.tool | sed -n '1,120p'

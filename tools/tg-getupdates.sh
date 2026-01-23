#!/usr/bin/env bash
set -euo pipefail

LIMIT="${1:-10}"

cd "$(dirname "$0")/.." || exit 1

echo "[tg] stopping bot to avoid 409..."
docker compose stop bot >/dev/null

TOKEN="$(
  docker compose run --rm -T bot sh -lc 'printf "%s" "${BOT_TOKEN:-}${TELEGRAM_BOT_TOKEN:-}"'
)"
if [[ -z "${TOKEN}" ]]; then
  echo "ERROR: token not available in container env" >&2
  exit 2
fi

echo "[tg] getUpdates?limit=${LIMIT}"
curl -sS "https://api.telegram.org/bot${TOKEN}/getUpdates?limit=${LIMIT}&timeout=0" | python3 -m json.tool | sed -n '1,220p'

echo
echo "[tg] starting bot back..."
docker compose up -d bot >/dev/null
echo "[tg] done"

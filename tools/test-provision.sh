#!/usr/bin/env bash
set -euo pipefail
BASE="${BASE:-http://localhost:3001}"

echo "== create device =="
resp="$(curl -sS --fail-with-body -X POST "$BASE/v1/devices" \
  -H 'content-type: application/json' \
  -d '{"userId":"tg:1001","platform":"IOS","name":"iphone"}')"

echo "RAW /v1/devices:"
echo "$resp"
echo

DEVICE_ID="$(printf "%s" "$resp" | python3 -c 'import sys,json; print(json.loads(sys.stdin.read())["id"])')"

if [ -z "${DEVICE_ID:-}" ]; then
  echo "ERROR: DEVICE_ID empty"
  exit 1
fi

echo "DEVICE_ID=$DEVICE_ID"
echo

echo "== provision =="
curl -sS --fail-with-body -X POST "$BASE/v1/devices/$DEVICE_ID/provision" \
  -H 'content-type: application/json' \
  -d '{}' | tee /tmp/prov.json

echo
echo "RESP /provision:"
cat /tmp/prov.json
echo

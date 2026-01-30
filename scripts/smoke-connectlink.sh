#!/usr/bin/env bash
set -euo pipefail
BASE="${BASE:-http://localhost:3001}"

echo "1) create link"
resp="$(curl -sS --fail-with-body -X POST "$BASE/v1/connect-links" -H "content-type: application/json" -d "{\"ttlMinutes\": 60}")"
echo "$resp"
token="$(python3 -c "import sys,json; print(json.load(sys.stdin)[\"token\"])" <<<"$resp")"
echo "token=${token:0:16}..."

echo "2) provision"
pub="TEST_PUBLIC_KEY_1234567890abcdef"
curl -sS --fail-with-body -X POST "$BASE/v1/connect/$token/provision" -H "content-type: application/json" -d "{\"publicKey\": \"$pub\", \"platform\": \"IOS\", \"deviceName\": \"iPhone\"}" | sed -n "1,120p"

echo "3) idempotent same publicKey"
curl -sS --fail-with-body -X POST "$BASE/v1/connect/$token/provision" -H "content-type: application/json" -d "{\"publicKey\": \"$pub\", \"platform\": \"IOS\", \"deviceName\": \"iPhone\"}" | sed -n "1,120p"

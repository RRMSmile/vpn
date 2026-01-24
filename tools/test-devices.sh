#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3001}"
USER_ID="${1:-tg:999}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1" >&2; exit 1; }; }
need curl
need python3

json_get() {
  python3 - "$1" <<'PY'
import sys, json
p=sys.argv[1]
o=json.load(sys.stdin)
for k in p.split("."):
  o=o[k]
print(o)
PY
}

echo "== health =="
curl -fsS "$BASE/health" | python3 -c 'import sys,json; print(json.load(sys.stdin))'

echo "== create device =="
resp="$(curl -fsS -X POST "$BASE/v1/devices" -H 'content-type: application/json' \
  -d "{\"userId\":\"$USER_ID\",\"platform\":\"IOS\",\"name\":\"iphone\"}")"
echo "$resp"

DEVICE_ID="$(printf '%s' "$resp" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')"
echo "DEVICE_ID=$DEVICE_ID"

echo "== get device =="
curl -fsS "$BASE/v1/devices/$DEVICE_ID" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("id"))'
echo "OK"

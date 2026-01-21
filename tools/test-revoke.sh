#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3001}"
USER_ID="${1:-tg:1001}"

echo "== sanity =="
curl -fsS "$BASE/v1/plans" >/dev/null
echo "API OK"

echo "== create/get device =="
resp="$(curl -fsS -X POST "$BASE/v1/devices" \
  -H 'content-type: application/json' \
  -d "{\"userId\":\"$USER_ID\",\"platform\":\"IOS\",\"name\":\"iphone\"}")"
echo "$resp"
DEVICE_ID="$(echo "$resp" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')"
echo "DEVICE_ID=$DEVICE_ID"

echo "== provision =="
curl -fsS -X POST "$BASE/v1/devices/$DEVICE_ID/provision" \
  -H 'content-type: application/json' \
  -d '{}' > /tmp/prov.json

python3 - <<'PY'
import json,re
j=json.load(open("/tmp/prov.json"))
cfg=j["clientConfig"]
m=re.search(r"(?m)^\s*PublicKey\s*=\s*([A-Za-z0-9+/]{43}=)\s*$", cfg)
print("nodeId:", j["node"]["id"])
print("peerId:", j["peer"]["id"])
print("allowedIp:", j["peer"]["allowedIp"])
print("node.serverPublicKey:", j["node"]["serverPublicKey"])
print("clientConfig.PublicKey:", m.group(1) if m else None)
assert m and m.group(1)==j["node"]["serverPublicKey"], "PublicKey mismatch"
print("OK: provision config is consistent")
PY

echo "== revoke =="
curl -fsS -X POST "$BASE/v1/devices/$DEVICE_ID/revoke" \
  -H 'content-type: application/json' \
  -d '{}' > /tmp/revoke.json
cat /tmp/revoke.json
echo

echo "== revoke idempotent (second call) =="
curl -fsS -X POST "$BASE/v1/devices/$DEVICE_ID/revoke" \
  -H 'content-type: application/json' \
  -d '{}' > /tmp/revoke2.json
cat /tmp/revoke2.json
echo

echo "OK: revoke endpoint works (logical flow)"

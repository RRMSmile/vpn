#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3001}"
USER_ID="${1:-tg:999}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1" >&2; exit 1; }; }
need curl
need python3

wait_health() {
  python3 - <<'PY'
import time, urllib.request, os
url=os.environ.get("BASE","http://localhost:3001") + "/health"
for i in range(60):
    try:
        print("health try", i+1, "->", urllib.request.urlopen(url, timeout=1).read().decode())
        raise SystemExit(0)
    except Exception:
        time.sleep(0.25)
print("health failed")
raise SystemExit(1)
PY
}

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

wg_pubkey() {
  python3 - <<'PY'
import os, base64
print(base64.b64encode(os.urandom(32)).decode())
PY
}

export BASE

echo "== health wait =="
wait_health

echo "== create/get device =="
resp="$(curl -fsS -X POST "$BASE/v1/devices" \
  -H 'content-type: application/json' \
  -d "{\"userId\":\"$USER_ID\",\"platform\":\"IOS\",\"name\":\"iphone\"}")"
echo "$resp" | python3 -m json.tool

DEVICE_ID="$(echo "$resp" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')"
echo "DEVICE_ID=$DEVICE_ID"

echo "== get device =="
curl -fsS "$BASE/v1/devices/$DEVICE_ID" | python3 -m json.tool

PUBKEY="$(wg_pubkey)"
echo "PUBKEY=$PUBKEY"

echo "== provision (new key) =="
prov="$(curl -fsS -X POST "$BASE/v1/devices/$DEVICE_ID/provision" \
  -H 'content-type: application/json' \
  -d "{\"publicKey\":\"$PUBKEY\"}")"
echo "$prov" | python3 -m json.tool

PEER_ID="$(echo "$prov" | python3 -c 'import sys,json; print(json.load(sys.stdin)["peer"]["id"])')"
echo "PEER_ID=$PEER_ID"

echo "== revoke =="
curl -fsS -X POST "$BASE/v1/devices/$DEVICE_ID/revoke" \
  -H 'content-type: application/json' \
  -d "{\"peerId\":\"$PEER_ID\"}" | python3 -m json.tool

echo "== re-provision (same key; should be 200 and same peer) =="
curl -fsS -X POST "$BASE/v1/devices/$DEVICE_ID/provision" \
  -H 'content-type: application/json' \
  -d "{\"publicKey\":\"$PUBKEY\"}" | python3 -m json.tool

echo "OK"

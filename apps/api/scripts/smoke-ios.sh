#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3001}"
EMAIL="${EMAIL:-test@example.com}"
DEVICE_ID="${DEVICE_ID:-ios-1}"
DEVICE_NAME="${DEVICE_NAME:-iPhone}"

echo "== 1) auth/request (devToken) =="
DEV_TOKEN="$(curl -fsS -X POST "$API_BASE/auth/request" \
  -H "content-type: application/json" \
  -d "{\"email\":\"$EMAIL\"}" | jq -r '.devToken')"

if [[ -z "$DEV_TOKEN" || "$DEV_TOKEN" == "null" ]]; then
  echo "ERROR: devToken is empty. Is MAIL_DEV_LOG_ONLY=true?"
  exit 2
fi
echo "DEV_TOKEN=$DEV_TOKEN"

echo "== 2) auth/consume (cookies.txt) =="
curl -fsS -X POST "$API_BASE/auth/consume" \
  -H "content-type: application/json" \
  -c cookies.txt \
  -d "{\"token\":\"$DEV_TOKEN\"}" | jq

echo "== 3) vpn/ios/provision =="
if [[ "${IOS_PUB:-}" == "" || "${IOS_PUB:-}" == "REPLACE_WITH_IOS_PUBLIC_KEY" ]]; then
  echo "ERROR: set IOS_PUB env var to REAL iOS public key"
  echo "Example: IOS_PUB='....' bash scripts/smoke-ios.sh"
  exit 3
fi

PROV="$(curl -fsS -X POST "$API_BASE/vpn/ios/provision" \
  -H "content-type: application/json" \
  -b cookies.txt \
  -d "{
    \"deviceId\": \"$DEVICE_ID\",
    \"deviceName\": \"$DEVICE_NAME\",
    \"clientPublicKey\": \"$IOS_PUB\"
  }")"

echo "$PROV" | jq

PEER_ID="$(echo "$PROV" | jq -r '.peerId')"
if [[ -z "$PEER_ID" || "$PEER_ID" == "null" ]]; then
  echo "ERROR: peerId missing in provision response"
  exit 4
fi
echo "PEER_ID=$PEER_ID"

echo "== 4) download config =="
curl -fsS -b cookies.txt "$API_BASE/vpn/peer/$PEER_ID/config" | sed -n '1,80p'
echo "OK"

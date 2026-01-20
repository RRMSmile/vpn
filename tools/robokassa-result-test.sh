#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3001}"
USER_ID="${USER_ID:-tg:123}"
ENV_FILE="${ENV_FILE:-$(pwd)/.env}"

env_get() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n1 || true)"
  echo -n "${line#*=}" | tr -d '\r' | sed -E "s/^['\"]//; s/['\"]$//"
}

PASS2="$(env_get ROBOKASSA_PASSWORD2)"
if [[ -z "$PASS2" ]]; then
  echo "ERROR: ROBOKASSA_PASSWORD2 not found in $ENV_FILE"
  exit 1
fi

# 1) planCode
plan_json="$(curl -sS "$BASE/v1/plans")"
plan_code="$(node -e 'const j=JSON.parse(process.argv[1]); console.log(j.items[0].code);' "$plan_json")"

# 2) create
create_json="$(curl -sS -X POST "$BASE/v1/payments/robokassa/create" \
  -H 'content-type: application/json' \
  -d "{\"userId\":\"$USER_ID\",\"planCode\":\"$plan_code\"}")"

inv_id="$(node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(String(j.invId||""));' "$create_json")"
pay_url="$(node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(String(j.payUrl||""));' "$create_json")"

if [[ -z "$inv_id" || -z "$pay_url" ]]; then
  echo "ERROR: create didn't return invId/payUrl"
  echo "$create_json"
  exit 1
fi

# 3) parse OutSum + Shp_* from pay_url (простым sed)
out_sum="$(echo "$pay_url" | sed -n 's/.*[?&]OutSum=\([^&]*\).*/\1/p' | head -n1)"
shp_user="$(echo "$pay_url" | sed -n 's/.*[?&]Shp_userId=\([^&]*\).*/\1/p' | head -n1)"
shp_plan="$(echo "$pay_url" | sed -n 's/.*[?&]Shp_plan=\([^&]*\).*/\1/p' | head -n1)"

# decode %xx (минимально достаточно)
shp_user="$(printf '%b' "${shp_user//%/\\x}")"
shp_plan="$(printf '%b' "${shp_plan//%/\\x}")"

echo "plan_code=$plan_code inv_id=$inv_id out_sum=$out_sum shp_user=$shp_user shp_plan=$shp_plan"

# сервер сортирует Shp_* по ключу: Shp_plan, потом Shp_userId
sig_base="${out_sum}:${inv_id}:${PASS2}:Shp_plan=${shp_plan}:Shp_userId=${shp_user}"
sig="$(printf '%s' "$sig_base" | openssl md5 | awk '{print $2}')"

echo "sig_base=$sig_base"
echo "sig=$sig"

resp="$(curl -sS -X POST "$BASE/v1/payments/robokassa/result" \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode "OutSum=$out_sum" \
  --data-urlencode "InvId=$inv_id" \
  --data-urlencode "SignatureValue=$sig" \
  --data-urlencode "Shp_userId=$shp_user" \
  --data-urlencode "Shp_plan=$shp_plan")"

echo "resp=$resp"

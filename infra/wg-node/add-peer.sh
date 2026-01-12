#!/usr/bin/env bash
set -euo pipefail

PUBKEY="${1:?pubkey required}"
USER_ID="${2:?userId required}"
PEER_ID="${3:?peerId required}"
IFACE="${4:-wg0}"

STATE_DIR="/opt/cloudgate/state"
mkdir -p "$STATE_DIR"
IP_POOL_FILE="$STATE_DIR/ip_pool.txt"
USED_FILE="$STATE_DIR/used.txt"

if [[ ! -f "$IP_POOL_FILE" ]]; then
  : >"$IP_POOL_FILE"
  for i in $(seq 10 250); do echo "10.8.0.$i/32" >>"$IP_POOL_FILE"; done
fi
touch "$USED_FILE"

# pick first free ip from pool (requires bash process substitution)
IP="$(comm -23 <(sort "$IP_POOL_FILE") <(sort "$USED_FILE") | head -n 1)"
if [[ -z "${IP}" ]]; then echo "error=no_free_ip" >&2; exit 10; fi
echo "$IP" >>"$USED_FILE"

SERVER_PUB="$(wg show "$IFACE" public-key)"
wg set "$IFACE" peer "$PUBKEY" allowed-ips "$IP"
wg-quick save "$IFACE" >/dev/null 2>&1 || true

echo "${PEER_ID} ${USER_ID} ${PUBKEY} ${IP} $(date -Is)" >> "$STATE_DIR/peers.log"
echo "ip=${IP} server_pub=${SERVER_PUB}"
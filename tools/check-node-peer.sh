#!/usr/bin/env bash
set -euo pipefail

PUBKEY="${1:-}"
if [ -z "$PUBKEY" ]; then
  echo "usage: $0 <PUBLIC_KEY_BASE64>"
  exit 2
fi

WG_HOST="${WG_HOST:-89.169.176.214}"
WG_USER="${WG_USER:-yc-user}"
WG_IF="${WG_IF:-wg0}"

ssh -o StrictHostKeyChecking=no "$WG_USER@$WG_HOST" \
  "sudo wg show $WG_IF | grep -F \"$PUBKEY\" >/dev/null && echo YES_ON_NODE || echo NO_ON_NODE"

#!/usr/bin/env bash
set -euo pipefail
PUBKEY="${1:?pubkey required}"
IFACE="${2:-wg0}"
wg set "$IFACE" peer "$PUBKEY" remove
wg-quick save "$IFACE" >/dev/null 2>&1 || true
echo "ok=1"
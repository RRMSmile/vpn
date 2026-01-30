#!/usr/bin/env bash
set -euo pipefail

HOST="${WG_NODE_SSH_HOST:?set WG_NODE_SSH_HOST}"
USER="${WG_NODE_SSH_USER:-yc-user}"
KEY="${WG_NODE_KEY_PATH:-/run/secrets/wg_node_key}"
KH="/run/secrets/known_hosts"

ssh -i "$KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$KH" \
  "${USER}@${HOST}" "echo OK_FROM_SCRIPT"

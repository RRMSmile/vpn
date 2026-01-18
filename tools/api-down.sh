#!/usr/bin/env bash
set -euo pipefail
fuser -k 3001/tcp >/dev/null 2>&1 || true
echo "OK: stopped 3001 (if it was running)"

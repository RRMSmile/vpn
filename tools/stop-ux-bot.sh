#!/usr/bin/env bash
set -euo pipefail

pkill -9 -f "python apps/bot-py/main.py" 2>/dev/null || true
rm -f /tmp/cloudgate-ux-bot.lock 2>/dev/null || true
echo "OK: stopped UX bot"

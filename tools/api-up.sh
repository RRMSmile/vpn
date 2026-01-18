#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

mkdir -p .logs

# stop old listener (silence output)
fuser -k 3001/tcp >/dev/null 2>&1 || true

# start detached
nohup ./tools/run-api.sh </dev/null > .logs/api.nohup.log 2>&1 &
API_PID="$!"
echo "API_JOB_PID=$API_PID"

# wait health
python3 - <<'PYIN'
import time, urllib.request
url="http://localhost:3001/health"
for i in range(80):
    try:
        body = urllib.request.urlopen(url, timeout=1).read().decode()
        print("OK health:", body)
        raise SystemExit(0)
    except Exception:
        time.sleep(0.25)
print("health failed; see .logs/api.nohup.log")
raise SystemExit(1)
PYIN

echo "OK: tools/api-up.sh fixed"

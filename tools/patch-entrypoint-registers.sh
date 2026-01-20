#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
API="$ROOT/apps/api"
SRC="$API/src"

# найдём файл, где есть listen()
ENTRY="$(grep -R --line-number "await .*listen" "$SRC" | head -n1 | cut -d: -f1 || true)"
if [[ -z "$ENTRY" ]]; then
  ENTRY="$(grep -R --line-number "\.listen\(" "$SRC" | head -n1 | cut -d: -f1 || true)"
fi

if [[ -z "$ENTRY" ]]; then
  echo "ERROR: cannot find entrypoint with listen()"
  echo "Run: grep -R --line-number \"listen(\" apps/api/src | head"
  exit 2
fi

python3 - <<PY
import re, pathlib
path = pathlib.Path("$ENTRY")
s = path.read_text()

def add_import(line: str):
  global s
  if line in s:
    return
  m = list(re.finditer(r'^(import .*?;\\s*)$', s, flags=re.M))
  if m:
    i = m[-1].end()
    s = s[:i] + "\\n" + line + "\\n" + s[i:]
  else:
    s = line + "\\n" + s

add_import('import formbody from "@fastify/formbody";')
add_import('import { plansRoutes } from "./routes/plans";')
add_import('import { subscriptionsRoutes } from "./routes/subscriptions";')
add_import('import { paymentsRobokassaRoutes } from "./routes/payments.robokassa";')

# вставляем register-блок ПЕРЕД первым listen()
if "await fastify.register(plansRoutes" not in s:
  block = (
    "  await fastify.register(formbody);\\n"
    "  await fastify.register(plansRoutes);\\n"
    "  await fastify.register(subscriptionsRoutes);\\n"
    "  await fastify.register(paymentsRobokassaRoutes);\\n\\n"
  )
  m = re.search(r'\\n(\\s*)await\\s+.*fastify\\.listen\\b', s)
  if not m:
    raise SystemExit("Cannot find insertion point before listen() in " + str(path))
  s = s[:m.start()+1] + block + s[m.start()+1:]

path.write_text(s)
print("patched entrypoint:", path)
PY

echo "OK: patched $ENTRY"
